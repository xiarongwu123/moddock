using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Mu.Server.Services;

namespace Mu.NexusGateway;

public static class AiAccounts
{
    public static void MapAiAccount(this IEndpointRouteBuilder app)
    {
        app.MapGet("/internal/moddock/ai-account", async (HttpContext context, AccountService accounts, IConfiguration config) =>
        {
            var expected = Encoding.UTF8.GetBytes("Bearer " + config["Studio:BackendToken"]);
            var supplied = Encoding.UTF8.GetBytes(context.Request.Headers.Authorization.ToString());
            var address = context.Connection.RemoteIpAddress;
            var bytes = address?.MapToIPv4().GetAddressBytes();
            if (expected.Length != 71 || supplied.Length != expected.Length || !CryptographicOperations.FixedTimeEquals(expected, supplied)
                || address is null || !(IPAddress.IsLoopback(address) || bytes is [172, >= 16 and <= 31, _, _]))
            { context.Response.StatusCode = 403; return; }
            var owner = context.Request.Headers["X-Mu-Account-Id"].ToString();
            if (!System.Text.RegularExpressions.Regex.IsMatch(owner, "^[a-zA-Z0-9_-]{1,128}$"))
            { context.Response.StatusCode = 400; return; }
            context.Response.Headers.CacheControl = "no-store";
            await context.Response.WriteAsJsonAsync(await accounts.SnapshotAsync(owner));
        });
    }

    // Decorate every account response without replacing the deployed payment assembly.
    public static async Task Serialize(HttpContext context, RequestDelegate next)
    {
        if (!(context.Request.Path.StartsWithSegments("/api/v1/account") || context.Request.Path.StartsWithSegments("/api/v1/auth")))
        { await next(context); return; }
        var original = context.Response.Body;
        await using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await next(context);
            if (context.Response.StatusCode is >= 200 and < 300 && context.Response.ContentType?.Contains("application/json") == true)
            {
                buffer.Position = 0;
                var json = await JsonNode.ParseAsync(buffer);
                async Task Decorate(JsonNode? node)
                {
                    if (node is JsonObject obj)
                    {
                        if (obj["membership"] is JsonObject && obj["features"] is JsonArray && obj["id"]?.GetValue<string>() is { } owner)
                        {
                            JsonNode? quota = null;
                            try
                            {
                                var config = context.RequestServices.GetRequiredService<IConfiguration>();
                                var factory = context.RequestServices.GetRequiredService<IHttpClientFactory>();
                                using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(new Uri(config["Studio:BackendUrl"]!), "quota"));
                                request.Headers.Authorization = new("Bearer", config["Studio:BackendToken"]);
                                request.Headers.Add("X-Mu-Account-Id", owner);
                                using var response = await factory.CreateClient("AiQuota").SendAsync(request, context.RequestAborted);
                                if (response.IsSuccessStatusCode) quota = JsonNode.Parse(await response.Content.ReadAsStringAsync(context.RequestAborted));
                            }
                            catch (Exception error) when (error is HttpRequestException or TaskCanceledException or UriFormatException or ArgumentNullException) { }
                            obj["aiUsage"] = quota;
                            return;
                        }
                        foreach (var item in obj.ToArray()) await Decorate(item.Value);
                    }
                    else if (node is JsonArray array) foreach (var item in array) await Decorate(item);
                }
                await Decorate(json);
                buffer.SetLength(0);
                buffer.Position = 0;
                await System.Text.Json.JsonSerializer.SerializeAsync(buffer, json);
            }
            context.Response.ContentLength = buffer.Length;
            buffer.Position = 0;
            await buffer.CopyToAsync(original, context.RequestAborted);
        }
        finally { context.Response.Body = original; }
    }
}
