using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection;

[assembly: HostingStartup(typeof(Mu.NexusGateway.GatewayHostingStartup))]

namespace Mu.NexusGateway;

public sealed class GatewayHostingStartup : IHostingStartup
{
    public void Configure(IWebHostBuilder builder) => builder.ConfigureServices(services =>
    {
        services.AddHttpClient("NexusBackend", client => client.Timeout = TimeSpan.FromSeconds(30))
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        services.AddHttpClient("StudioBackend", client => client.Timeout = TimeSpan.FromSeconds(190))
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        services.AddTransient<IStartupFilter, GatewayStartupFilter>();
    });
}

internal sealed class GatewayStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (context, nextRequest) =>
        {
            if (context.Request.Path.StartsWithSegments("/api/v1/studio"))
            {
                var limit = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
                if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = 192 * 1024;
            }
            await nextRequest();
        });
        next(app);
        // Add to the host's existing routing table, preserving its complete middleware pipeline.
        app.UseEndpoints(endpoints => { endpoints.MapNexusDownloads(); endpoints.MapStudio(); });
    };
}
