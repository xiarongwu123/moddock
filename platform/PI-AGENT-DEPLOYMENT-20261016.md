# Pi Agent deployment: 2026-10-16

MODDOCK planning, generation and repair now use native Pi Agent sessions.
Game identity and detected engine select the bundled Skills. Pi handles model
streaming, bounded tools and specialist sessions. The current renderer presents
those events as creation progress and optional thinking/process records, without
exposing Pi, Skill or Agent branding to players.

## Active releases

| Component | Release |
| --- | --- |
| Private Pi service | `20261016-pi-agent-de586a2e` |
| MU streaming gateway | `20261016-pi-gateway-4002536d` |
| Pi SDK | `@earendil-works/pi-coding-agent@1.3.0` |
| Account database | Existing schema 5 |

The deployed `Mu.Server.dll` is unchanged. Only the gateway extension and private
creation service changed. The existing account/payment application, environment,
Compose configuration, keys and mail history were preserved. During maintenance,
all database table rows were compared with the final backup, including 1,200
accounts and existing orders, plans and sessions.

Artifact SHA-256:

```text
service archive: de586a2e805fa370e6495c9c2258c02c616522dfcae8a26e8f4a5badd9c9331e
Mu.NexusGateway.dll: 4002536d88191357d0298e3d335f6cb74ee030711533b653683a359544660358
Mu.Server.dll: e94ad754d3a5b95897fb6d83525dd594c8c9d9da0856ef71c714f599984e3bf0
```

## Verification

- `npm test`: 302 passed, zero failures.
- `npm run build`: passed.
- `npm run studio:check-agent`: 124 upstream file hashes and 12 routes passed.
- Schema-5 gateway compilation: zero warnings and errors.
- Isolated real MU/Pi integration: 22 checks passed, including authorization,
  payments, existing public features, real model calls and streamed events.
- Browser checks: actual Skills, thinking and tool states rendered; cancellation
  and narrow layout passed. Real-provider browser flow passed against an isolated
  account service and a temporary game fixture.
- Production: real Unity Mono planning invoked Pi, loaded the BepInEx Mono Skill
  and streamed thinking/tool events. Public health/plans and authentication
  boundaries were checked after activation.

Reports are in `output/mu-studio/pi-real-runtime-check.json`,
`output/mu-studio/pi-production-check.json` and
`output/playwright/pi-agent-live/browser-check.json`. The completed interface and
thinking screenshots are in `output/playwright/pi-agent-live/`.

Public Python probes use an empty User-Agent, as the existing edge policy rejects
Python's default User-Agent with Cloudflare error 1010. No edge rule was changed.
No production accounts or orders were created for the production Pi check.

## Rollback

Final locked backup:
`/home/xrw/amd-dlss-mu-account/backups/pi-cutover-20261016T073803Z`

Deployment state:
`/home/xrw/moddock-studio/pi-deployment-20261016-pi-agent-de586a2e.json`

Restore the prior releases while retaining current database writes:

```sh
ssh -p 1013 xrw@72.11.138.132 python3 \
  /home/xrw/moddock-studio/incoming/pi-20261016-final/activate-pi-deployment.py \
  /home/xrw/moddock-studio/pi-deployment-20261016-pi-agent-de586a2e.json --rollback
```

Prior account: `20261015-mu-studio-4b8aae58`.
Prior private service: `20261015-bg3-agent-a581d6f6`.
Temporary rehearsal services and the local SSH tunnel were stopped after checks.

## Acceptance boundaries

After the server cutover, the renderer was refined to show a compact progress
disclosure and a result card within the conversation. Browser fixtures for both
development plans and installable BG3 artifacts passed, including cancellation,
narrow layout and saving to the Mod library. Current screenshots are in
`output/playwright/studio-refined/` and
`output/playwright/studio-refined-bg3/`. These UI checks use temporary games and a
local model protocol fixture through the actual Pi SDK, not new production-model
calls. The private server release above did not change during this UI refinement.

This deployment updates the server and the current desktop source/renderer. It
does not produce or install a new Windows desktop installer. A physical Windows
machine and real game loading remain unverified. Skill coverage does not imply
every game has a verified installable-output adapter; unsupported targets produce
development plans. Minecraft uses the upstream Skill's documented workflow
without MCP until its MCP is separately configured and verified.
