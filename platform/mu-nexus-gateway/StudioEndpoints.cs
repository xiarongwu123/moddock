using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Mu.Server;
using Mu.Server.Services;

namespace Mu.NexusGateway;

public static class StudioEndpoints
{
    public static void MapStudio(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1/studio").RequireAuthorization("Client");
        foreach (var action in new[] { "plan", "generate", "repair" })
        {
            var route = action;
            api.MapPost("/" + route, (HttpContext context, AccountService accounts, IConfiguration config, IHttpClientFactory clients) =>
                Forward(context, accounts, config, clients, route));
        }
    }

    private static async Task Forward(HttpContext context, AccountService accounts, IConfiguration config, IHttpClientFactory clients, string route)
    {
        var owner = context.User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        // Every provider call checks live membership through the private callback.
        // Authenticated task resume/cancel remains available with exhausted credit.
        if (!Uri.TryCreate(config["Studio:BackendUrl"], UriKind.Absolute, out var backend)
            || backend.Scheme != "http" || !IPAddress.TryParse(backend.Host, out var ip)
            || !(IPAddress.IsLoopback(ip) || ip.GetAddressBytes() is [172, >= 16 and <= 31, _, _])
            || backend.AbsolutePath != "/" || backend.UserInfo.Length != 0 || backend.Query.Length != 0 || backend.Fragment.Length != 0
            || !Regex.IsMatch(config["Studio:BackendToken"] ?? "", "^[a-f0-9]{64}$"))
            throw new ApiException(503, "studio_not_configured", "创作服务正在配置中。");
        using var body = new MemoryStream();
        var buffer = new byte[8192];
        int count;
        while ((count = await context.Request.Body.ReadAsync(buffer, context.RequestAborted)) > 0)
        {
            if (body.Length + count > 192 * 1024) throw new ApiException(413, "request_too_large", "本次创作上下文过大。");
            await body.WriteAsync(buffer.AsMemory(0, count), context.RequestAborted);
        }
        using var data = JsonDocument.Parse(body.ToArray());
        if (data.RootElement.ValueKind != JsonValueKind.Object) throw new ApiException(400, "invalid_request", "创作内容无效。");
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(backend, route));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config["Studio:BackendToken"]);
        request.Headers.Add("X-Mu-Account-Id", owner);
        var streamEvents = context.Request.Headers.Accept.ToString().Contains("application/x-ndjson", StringComparison.Ordinal);
        if (streamEvents) request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/x-ndjson"));
        request.Content = new ByteArrayContent(body.ToArray());
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        HttpResponseMessage response;
        try { response = await clients.CreateClient("StudioBackend").SendAsync(request, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted); }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException && !context.RequestAborted.IsCancellationRequested)
        { throw new ApiException(503, "studio_unavailable", "创作服务暂时无法连接。"); }
        using (response)
        {
            if (response.IsSuccessStatusCode && response.Content.Headers.ContentType?.MediaType == "application/x-ndjson" && streamEvents)
            {
                context.Response.ContentType = "application/x-ndjson; charset=utf-8";
                context.Response.Headers.CacheControl = "no-store";
                context.Response.Headers["X-Accel-Buffering"] = "no";
                await context.Response.StartAsync(context.RequestAborted);
                await using var source = await response.Content.ReadAsStreamAsync(context.RequestAborted);
                long total = 0;
                while ((count = await source.ReadAsync(buffer, context.RequestAborted)) > 0)
                {
                    total += count;
                    if (total > 2 * 1024 * 1024) { context.Abort(); return; }
                    await context.Response.Body.WriteAsync(buffer.AsMemory(0, count), context.RequestAborted);
                    await context.Response.Body.FlushAsync(context.RequestAborted);
                }
                return;
            }
            await response.Content.LoadIntoBufferAsync(256 * 1024, context.RequestAborted);
            using var result = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync(context.RequestAborted));
            if (!response.IsSuccessStatusCode)
            {
                var code = result.RootElement.TryGetProperty("code", out var error) ? error.GetString() : null;
                var allowed = new[] { "pro_required", "ai_quota_unconfigured", "studio_rate_limited", "ai_credits_exhausted", "ai_response_invalid", "invalid_request", "request_too_large" };
                if (code is null || !allowed.Contains(code)) throw new ApiException(503, "studio_unavailable", "创作服务请求失败。");
                var status = code == "studio_rate_limited" ? 429 : code == "invalid_request" ? 400 : code == "request_too_large" ? 413 : code == "pro_required" || code == "ai_credits_exhausted" ? 403 : code == "ai_quota_unconfigured" ? 503 : 502;
                throw new ApiException(status, code, code == "studio_rate_limited" ? "创作请求较多，请稍后重试。" : "创作服务请求失败。", status == 429 ? 30 : null);
            }
            context.Response.Headers.CacheControl = "no-store";
            await context.Response.WriteAsJsonAsync(result.RootElement, context.RequestAborted);
        }
    }
}
