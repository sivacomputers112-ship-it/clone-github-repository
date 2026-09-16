# Forge / Agent Remote — Handoff

Public app origin: **https://clone-github-repository-olive.vercel.app**

The Cloudflare Worker is already deployed. Do not redeploy it unless the worker source changed.

---

## Status

Done:

- Pairing UI at `/` issues a 10-minute code and shows a public install command against `https://clone-github-repository-olive.vercel.app`.
- Installer scripts (`/install`, `/install.cmd`, `/install.py`) embed that public origin when the request comes from a private v0 preview.
- Console at `/console` is a real prompt UI. It talks to the laptop daemon through `deviceRpc()` → `/d/<deviceId>/<path>` → the existing worker → the laptop bridge. The iframe `/ar/index.html` client is gone.
- Connection badges show laptop **Online/Offline** and **Daemon ready/unavailable**.
- Prompts start `POST /api/sessions/new` (or `/continue`), then poll `GET /api/jobs/<id>?since=`. Permission and AskUserQuestion gates are answered from the console.
- Worker RPC already waits for `rpc_accepted` (`ACCEPT_TIMEOUT_MS = 45s`, `DAEMON_TIMEOUT_MS = 120s`).

Still on you:

1. Open **https://clone-github-repository-olive.vercel.app**
2. Copy the install command and run it on the laptop
3. Wait until the console shows **Online** and **Daemon ready**
4. Pick a project, type a prompt, send

If the laptop is Online but the daemon stays unavailable, re-run the install command so `agentremoted` and `forge_bridge.py` both start.

---

## Architecture

Three pieces, no inbound laptop port:

| Piece | Where | Job |
| --- | --- | --- |
| Next.js app | Vercel, this repo | Pairing UI, console UI, API routes that proxy to the relay |
| Cloudflare Worker | `worker/` (already deployed) | Durable Object per device; laptop WebSocket; RPC forward; D1 pairing/devices |
| Laptop daemon + bridge | installed by `/install.py` | Runs agents locally; one outbound WebSocket to the worker |

### Next.js routes

- `POST /api/pair` — create a pairing code (worker `POST /v1/pairs`)
- `GET /api/pair?code=` — poll pairing status
- `GET\|DELETE /api/devices/[id]` — device status / remove
- `app/d/[deviceId]/[...path]/route.ts` — catch-all RPC proxy (blocks `/internal`)
- `/install`, `/install.cmd`, `/install.py` — installer scripts

### Worker routes (`worker/src/index.ts`)

- `POST /v1/pairs`, `POST /v1/pairs/claim`, `GET /v1/pairs/status`
- `GET\|DELETE /v1/devices/<id>`, `POST /v1/devices/<id>/rpc`
- `GET /v1/devices/<id>/connect` (WebSocket upgrade)
- Durable Object `DeviceRelay`: `/connect`, `/status`, `/disconnect`, `/rpc`

### Console → daemon

`deviceRpc(deviceId, phoneSecret, path)` hits `/d/<deviceId>/<path>`:

- `GET /api/ping`
- `GET /api/projects`
- `POST /api/sessions/new {cwd, prompt, permission_mode?}`
- `POST /api/sessions/<id>/continue {prompt, permission_mode?}`
- `GET /api/jobs/<id>?since=<seq>`
- `POST /api/jobs/<id>/permission {request_id, allow}`
- `POST /api/jobs/<id>/question {request_id, answers\|cancel}`
- `POST /api/jobs/<id>/stop`

The bridge injects `X-Auth-Token` from `~/.agentremoted/token`. The browser only sends the phone secret.

### Env (already set)

`ALLOWED_ORIGINS`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_WORKER_URL`, `D1_DATABASE_ID`, `DATABASE_NAME`, `WORKER_PROXY_SECRET`, `WORKERS_SUBDOMAIN`, plus `GITHUB_*` and `VERCEL_*`.

Installer origin fallback lives in `lib/app-origin.ts` as `PUBLISHED_APP_ORIGIN`. Override with `NEXT_PUBLIC_APP_URL` / `APP_URL` if the Vercel hostname changes.

### Pairing flow

Browser `POST /api/pair` → worker `POST /v1/pairs` → `{code, phoneSecret}`.
Laptop install `POST /api/pair/claim` → worker creates the device → `{deviceId, deviceToken, workerWebSocketUrl}`.
Bridge connects to `wss://…/v1/devices/<id>/connect?token=…`.
Console RPC: `/d/<id>/<path>` → worker `/v1/devices/<id>/rpc` → Durable Object → bridge → `127.0.0.1:8473`.
