using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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

public sealed record NexusFileRequest(string Domain, string ModId, string FileId);
public sealed record NexusVerificationClick(Guid Revision, int X, int Y);

public static class NexusEndpoints
{
    public static void MapNexusDownloads(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1/nexus").RequireAuthorization("Client");
        api.MapGet("/status", (HttpContext context, AccountService accounts, IConfiguration config, IHttpClientFactory clients) =>
            Forward(context, accounts, config, clients, HttpMethod.Get, "status"));
        api.MapPost("/jobs", (NexusFileRequest input, HttpContext context, AccountService accounts, IConfiguration config, IHttpClientFactory clients) =>
        {
            if (!Regex.IsMatch(input.Domain ?? "", "^[a-z0-9_-]{1,80}$") || !Regex.IsMatch(input.ModId ?? "", "^[1-9][0-9]{0,14}$") || !Regex.IsMatch(input.FileId ?? "", "^[1-9][0-9]{0,14}$"))
                throw new ApiException(400, "invalid_nexus_file", "文件标识无效。");
            return Forward(context, accounts, config, clients, HttpMethod.Post, "jobs", input);
        });
        api.MapGet("/jobs/{id:guid}", (Guid id, HttpContext context, AccountService accounts, IConfiguration config, IHttpClientFactory clients) =>
            Forward(context, accounts, config, clients, HttpMethod.Get, "jobs/" + id));
        api.MapDelete("/jobs/{id:guid}", (Guid id, HttpContext context, AccountService accounts, IConfiguration config, IHttpClientFactory clients) =>
            Forward(context, accounts, config, clients, HttpMethod.Delete, "jobs/" + id));
        api.MapGet("/jobs/{id:guid}/file", (Guid id, HttpContext context, AccountService accounts, IConfiguration config, IHttpClientFactory clients) =>
            Forward(context, accounts, config, clients, HttpMethod.Get, "jobs/" + id + "/file", binary: true));
        api.MapGet("/jobs/{id:guid}/verification", (Guid id, HttpContext context, AccountService accounts, IConfiguration config, IHttpClientFactory clients) =>
            Forward(context, accounts, config, clients, HttpMethod.Get, "jobs/" + id + "/verification", maxBytes: 1500000));
        api.MapPost("/jobs/{id:guid}/verification/click", (Guid id, NexusVerificationClick input, HttpContext context, AccountService accounts, IConfiguration config, IHttpClientFactory clients) =>
        {
            if (input.Revision == Guid.Empty || input.X < 0 || input.Y < 0 || input.X >= 2200 || input.Y >= 1700)
                throw new ApiException(400, "invalid_verification_input", "验证操作无效。");
            return Forward(context, accounts, config, clients, HttpMethod.Post, "jobs/" + id + "/verification/click", input);
        });
    }

    private static async Task Forward(HttpContext context, AccountService accounts, IConfiguration config, IHttpClientFactory clients,
        HttpMethod method, string route, object? input = null, bool binary = false, int maxBytes = 16384)
    {
        var owner = context.User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var account = await accounts.SnapshotAsync(owner);
        if (account.Features.SingleOrDefault(feature => feature.Key == "library.manage")?.Allowed != true)
            throw new ApiException(403, "feature_denied", "当前账号没有下载权限。");
        if (!Uri.TryCreate(config["Nexus:BackendUrl"], UriKind.Absolute, out var backend)
            || backend.Scheme != "http" || !IPAddress.TryParse(backend.Host, out var ip)
            || !(IPAddress.IsLoopback(ip) || ip.GetAddressBytes() is [172, >= 16 and <= 31, _, _])
            || backend.AbsolutePath != "/" || backend.UserInfo.Length != 0 || backend.Query.Length != 0 || backend.Fragment.Length != 0
            || !Regex.IsMatch(config["Nexus:BackendToken"] ?? "", "^[a-f0-9]{64}$"))
            throw new ApiException(503, "nexus_unavailable", "下载服务正在准备中，请稍后重试。");
        using var request = new HttpRequestMessage(method, new Uri(backend, route));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config["Nexus:BackendToken"]);
        request.Headers.Add("X-Mu-Account-Id", owner);
        if (!string.IsNullOrEmpty(config["Nexus:BackendHost"])) request.Headers.Host = config["Nexus:BackendHost"];
        if (input != null) request.Content = JsonContent.Create(input);
        HttpResponseMessage response;
        try { response = await clients.CreateClient("NexusBackend").SendAsync(request, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted); }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException && !context.RequestAborted.IsCancellationRequested)
        { throw new ApiException(503, "nexus_unavailable", "下载服务暂不可用，请稍后重试。"); }
        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var code = response.StatusCode switch { HttpStatusCode.NotFound => 404, HttpStatusCode.TooManyRequests => 429, HttpStatusCode.Conflict => 409, _ => 503 };
                if (code == 429) context.Response.Headers.RetryAfter = "10";
                throw new ApiException(code, code == 404 ? "download_not_found" : "nexus_unavailable",
                    code == 404 ? "下载任务不存在。" : code == 429 ? "下载服务繁忙，请稍后重试。" : "下载服务暂不可用，请稍后重试。");
            }
            context.Response.StatusCode = (int)response.StatusCode;
            if (binary)
            {
                if (response.Content.Headers.ContentType?.MediaType != "application/octet-stream") throw new ApiException(503, "nexus_unavailable", "下载服务未返回文件。");
                context.Response.ContentType = "application/octet-stream";
                context.Response.ContentLength = response.Content.Headers.ContentLength;
                await response.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
                return;
            }
            await response.Content.LoadIntoBufferAsync(maxBytes, context.RequestAborted);
            var bytes = await response.Content.ReadAsByteArrayAsync(context.RequestAborted);
            using var data = JsonDocument.Parse(bytes);
            await context.Response.WriteAsJsonAsync(data.RootElement, context.RequestAborted);
        }
    }
}
