# MU Nexus gateway extension

This .NET 10 hosting startup extension restores `/api/v1/nexus` to the deployed
payments server without recompiling its application or changing its schema-5
database. It references the actual deployed `Mu.Server.dll` and reuses its
`Client` authorization policy, `AccountService`, permission snapshot, exception
handling, rate limits and routing table. The private worker still enforces job
ownership. No worker credentials or source grants are returned to clients.

The pinned payments baseline is `20261014-payments-e94ad754`, with server SHA-256
`e94ad754d3a5b95897fb6d83525dd594c8c9d9da0856ef71c714f599984e3bf0`.
The extension cannot be assumed compatible with a different server release.

## Build and stage

Supply the original deployed payments directory, including its dependency
manifest. Build artifacts and staged releases belong outside the source tree.

```sh
dotnet build platform/mu-nexus-gateway/Mu.NexusGateway.csproj -c Release \
  -p:MuServerPath=/absolute/payments-release \
  --artifacts-path /absolute/private-artifacts
node platform/mu-nexus-gateway/stage-release.cjs \
  /absolute/payments-release \
  /absolute/private-artifacts/bin/Mu.NexusGateway/release/Mu.NexusGateway.dll \
  /absolute/new-release
```

Staging adds `Mu.NexusGateway.dll` and its runtime dependency entry to
`Mu.Server.deps.json`. Every other original file is verified byte for byte,
including the server's embedded payment codes and private catalog. A manifest
records all original hashes and the extension hash. Treat the resulting release
as private, just like the original payment artifact.

Set `ASPNETCORE_HOSTINGSTARTUPASSEMBLIES=Mu.NexusGateway` in the server environment.
Keep the existing `Nexus__BackendUrl` and `Nexus__BackendToken` configuration.
The worker URL must be a loopback or Docker-private HTTP origin. The extension
does not provide a public reverse proxy or a client-selectable upstream address.

## Verification and deployment

`verify-runtime.py DATABASE ORIGIN` operates only on a guarded isolated database
path containing `payments-rehearsal-nexus-` and `/runtime/`. Run the candidate in
an isolated .NET 10 Linux container with its own database and keys, host networking,
and `Nexus__BackendUrl=http://127.0.0.1:18095`. The verifier serves a local worker
fixture on that address, seeds synthetic accounts and checks payment snapshots,
private catalog access, ownership, binary transfer, verification, input validation,
revocation and live feature denial. It never targets the production database.

The 2026-10-15 isolated run passed 33 integration assertions. Playwright then
passed 12 administrator payment checks against that same isolated instance,
including MFA enrollment, mandatory receipt verification, duplicate confirmation,
reference reuse, lifetime membership and the configuration appointment state.
`node --test test/nexus-platform.test.cjs` passed all 10 client contract tests.

`activate.sh` is pinned to the verified release and hashes. It requires successful
runtime and browser markers, checks the complete current production baseline,
locks deployment, stops the account service, and backs up both SQLite databases,
configuration, compose file and Data Protection keys. It starts the candidate in
maintenance, verifies every account table is unchanged with `verify-data.py`,
checks mail history, configuration and keys, then reopens writes. The only new
configuration is the hosting startup assembly setting.

The rollback trap restores the previous schema-5 binary and environment while
leaving all live database writes intact. It never restores an older snapshot or
starts a schema-4 server against schema 5.

Future account releases must either carry the compatible extension plus its
dependency/configuration entries, or include the Nexus endpoints directly and
remove the extension setting. Verify an anonymous `/api/v1/nexus/status` request
returns 401, authenticated requests reach the worker, and a real file transfers;
the account health endpoint alone does not cover Nexus.
