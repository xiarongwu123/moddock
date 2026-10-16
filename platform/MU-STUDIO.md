# MU AI creation service

The desktop uses its existing MU session for POST `/api/v1/studio/plan`,
`/generate` and `/repair`. The MU gateway derives the owner from authenticated
claims, reads current Pro membership and feature policies, and forwards only
these fixed routes to the private service. Standard, expired, disabled and
revoked accounts cannot invoke the model. User prompts and provider responses
are not written to server logs.

`studio-mu-client.cjs` sends bounded game context without local installation or
compiler paths. Login token refresh is serialized; long AI requests run outside
the session queue so polling, cancellation and sign-out stay responsive.
Client packages exclude the direct model adapter and never read model keys.

BG3 authoring tool rounds reuse the fixed `/generate` route with bounded
`agentStep` and `toolHistory` fields. The private service chooses its fixed
agent prompt; clients cannot choose an upstream, system prompt or executable.
MU authenticates every round. Local game inspection, API reference search,
Lua compilation and managed log reads execute in the desktop; results return
to the model as untrusted context. Rounds retain cancellation and per-owner
concurrency/rate limits. This is not a remote shell or arbitrary tool relay.

The 0.5.8 change updates only the private Node release. The active schema-5
account/payment/Nexus assembly, environment, credentials and databases remain
in place. `stage-studio-service.cjs` allowlists server files; preparation and
activation scripts retain the previous private service for rollback. No model
key or private transport token enters a desktop build.

The private Node service in `studio-service.cjs` runs on the MU Docker bridge,
requires a separate server-only token and a claims-derived account header,
and calls the fixed DeepSeek provider. Each account can have one active request;
the service allows four global requests and 120 requests per account per hour.
Requests have a 192 KiB input limit, a 256 KiB output limit and an 85-second
deadline. Cancellation aborts the upstream request. Provider error bodies and
credentials are never returned to clients.

The server environment file `/home/xrw/moddock-studio/service.env` must be
readable only by its owner and supply `MODDOCK_DEEPSEEK_API_KEY`,
`MODDOCK_STUDIO_TOKEN`, `MODDOCK_STUDIO_HOST` and `MODDOCK_STUDIO_PORT`.
The MU account service receives only `Studio__BackendUrl` and
`Studio__BackendToken`; it does not receive the model key.

The gateway is built against the deployed schema-5 payment binary. Extend the
existing `Mu.NexusGateway` hosting startup assembly to preserve its original
authentication, payment application, database and Nexus routes. Stage with
`mu-nexus-gateway/stage-studio-release.cjs`; it preserves every previous file
except that assembly. Do not replace production with the older local MU source.

`verify-studio-runtime.py DATABASE ORIGIN` accepts only a guarded isolated
rehearsal database. It creates synthetic identities there, logs in through MU,
checks authentication and live feature restrictions, and sends real planning
and generation calls through the candidate gateway. It also checks the existing
payment plans, catalog, Nexus, presets, wishes and compatibility routes.
Production activation must follow successful isolated and browser checks,
with locked backup, maintenance, database/configuration verification and rollback
to the previous schema-5 release while preserving current database writes.
