# Forge / Agent Remote — Handoff & Copy-Paste Prompt

This file is both the project handoff and a prompt you can paste into a fresh v0 chat.
Everything below the line is written to be pasted as-is.

---

## Copy-paste prompt (start here)

> I'm building **Forge** (a.k.a. Agent Remote): a web console that drives AI coding agents
> (Claude Code / Codex / etc.) running on my own laptop, with no inbound port on the laptop.
>
> **The bug:** the console returns `504` and the agent session never starts — it never even
> reaches an IDE or the daemon. I need the prompt to actually reach a live agent and work.
>
> **Architecture (3 pieces):**
> 1. **Next.js app on Vercel** (this repo) — pairing UI at `/`, console at `/console`, and API
>    routes that proxy to the Cloudflare Worker relay. Key routes: `POST /api/pair`,
>    `GET /api/pair?code=`, `GET|DELETE /api/devices/[id]`, and the catch-all RPC proxy
>    `app/d/[deviceId]/[...path]/route.ts`. Installer endpoints: `/install`, `/install.cmd`,
>    `/install.py`.
> 2. **Cloudflare Worker relay** (`worker/`) — a Durable Object `DeviceRelay` per device that
>    holds the laptop's outbound WebSocket and forwards RPC requests, streaming responses back.
>    D1 stores pairing codes + devices. Env: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
>    `CLOUDFLARE_WORKER_URL`, `D1_DATABASE_ID`, `WORKER_PROXY_SECRET`, `WORKERS_SUBDOMAIN`.
> 3. **Laptop side** — `/install.py` clones the `agent-remote` daemon, builds a venv, writes
>    `~/.forge/config.json`, then starts the daemon (`agentremoted` on `127.0.0.1:8473`) and the
>    bridge (`bridge/forge_bridge.py`), which opens **one outbound WebSocket** to the worker.
>
> **Pairing flow:** browser `POST /api/pair` → worker `POST /v1/pairs` → `{code, phoneSecret}`.
> User runs the install command with the code → installer `POST /api/pair/claim` → worker
> `POST /v1/pairs/claim` → creates the device, returns `{deviceId, deviceToken,
> workerWebSocketUrl}`. The bridge connects to that `wss://…/v1/devices/<id>/connect?token=…`.
> The browser polls `/api/pair?code=` or `/api/devices/<id>` for `online` / `claimed`.
> The console sends RPC via `/d/<deviceId>/<path>` → Next route → worker
> `/v1/devices/<id>/rpc` → Durable Object → laptop bridge → local daemon.
>
> **Root cause of the 504 / "never reaches an agent":**
> - The console currently just renders an `<iframe src="/ar/index.html">` (the vendored web
>   client). That client expects to talk to a daemon directly, but the daemon lives on the
>   laptop behind the relay — the iframe has no route to it, so nothing ever starts.
> - The relay also 504s when the laptop bridge is connected but the local daemon isn't running,
>   or when the bridge never accepts the request in time.
>
> **What I need you to do:**
> 1. Replace the console iframe with a real **pick-agent + prompt console** that talks to the
>    daemon through the relay using `lib/device-rpc.ts` (`deviceRpc(deviceId, phoneSecret, path)`),
>    which hits `/d/<deviceId>/<path>`. Use these daemon endpoints:
>    - `GET /api/ping` → liveness + provider name + capability flags + auth
>    - `GET /api/projects` → projects (most recent first) to pick a working directory
>    - `GET /api/sessions?project=<id>&limit=<n>` → recent sessions
>    - `POST /api/sessions/new {cwd, prompt, permission_mode?}` → start a new agent session
>    - `POST /api/sessions/<id>/continue {prompt, permission_mode?}` → continue a session
>    - `GET /api/jobs` and `GET /api/jobs/<id>?since=<seq>` → poll job status + new events
>    - `POST /api/jobs/<id>/input {prompt}` → type into an interactive TUI
>    - `POST /api/jobs/<id>/permission {request_id, allow}` → answer a permission prompt
>    - `POST /api/jobs/<id>/question {request_id, answers|cancel}` → answer AskUserQuestion
>    - `POST /api/jobs/<id>/stop` → stop a job
> 2. Show clear connection state: laptop **online/offline** and **daemon ready/unavailable**
>    (the bridge already sends a `heartbeat` with `daemonOnline`).
> 3. Keep the friendly error mapping in `lib/device-rpc.ts` (503 offline, 504 timeout, 429 busy).
> 4. Make sure the worker is deployed (`wrangler deploy` in `worker/`) and the Next app is
>    published, since the laptop installer can only reach a public HTTPS URL.
>
> **Already done in the current code (don't redo):**
> - `worker/src/types.ts` has an `rpc_accepted` message type.
> - `worker/src/device-relay.ts` sends/awaits `rpc_accepted`, uses `ACCEPT_TIMEOUT_MS = 45s`,
>   `DAEMON_TIMEOUT_MS = 120s`, `RPC_LIFETIME_MS = 5min`, and no longer races a premature
>   first-byte timeout.
> - `bridge/forge_bridge.py` sends `rpc_accepted` immediately and reports
>   "Local daemon is not running" distinctly.
> - `lib/device-rpc.ts`, `lib/forge-session.ts` exist; `lib/relay.ts` origin checks are relaxed.
>
> Please implement the console and make a prompt actually reach a live agent.

---

## 1. What this project is

Forge lets you open a web page, run one command on your laptop, and then drive the AI coding
agents on that laptop from the browser. There is **no account** and **no inbound laptop port** —
the laptop makes a single outbound WebSocket to a Cloudflare relay.

## 2. The three pieces

| Piece | Where | Job |
| --- | --- | --- |
| Next.js app | Vercel (this repo) | Pairing UI, console UI, API routes that proxy to the relay |
| Cloudflare Worker relay | `worker/` | Durable Object per device; holds the laptop socket; forwards RPC; D1 for pairing/devices |
| Laptop daemon + bridge | installed by `/install.py` | Runs the agents locally; bridge opens one outbound WebSocket |

### Next.js routes
- `POST /api/pair` — create a pairing code (proxies worker `POST /v1/pairs`).
- `GET /api/pair?code=` — poll pairing status.
- `GET|DELETE /api/devices/[id]` — device status / remove.
- `app/d/[deviceId]/[...path]/route.ts` — catch-all RPC proxy to the relay (blocks `/internal`).
- `/install`, `/install.cmd`, `/install.py` — installer scripts.

### Worker routes (`worker/src/index.ts`)
- `POST /v1/pairs`, `POST /v1/pairs/claim`, `GET /v1/pairs/status`
- `GET|DELETE /v1/devices/<id>`, `POST /v1/devices/<id>/rpc`
- `GET /v1/devices/<id>/connect` (WebSocket upgrade, token-authenticated)
- Durable Object `DeviceRelay` (`worker/src/device-relay.ts`): `/connect`, `/status`,
  `/disconnect`, `/rpc`.

### Laptop daemon API (all under `/api`, JSON, `X-Auth-Token` auth)
`GET /api/ping`, `GET /api/usage`, `GET /api/projects`, `GET /api/sessions`,
`GET /api/sessions/<id>`, `GET /api/sessions/<id>/messages`, `POST /api/sessions/<id>/continue`,
`POST /api/sessions/new`, `GET /api/jobs`, `GET /api/jobs/<id>?since=<seq>`,
`POST /api/jobs/<id>/input`, `POST /api/jobs/<id>/queue`, `POST /api/jobs/<id>/stop`,
`POST /api/jobs/<id>/permission`, `POST /api/jobs/<id>/question`, `POST /api/shell`,
`POST /api/attachments`, `GET /api/drop`.

## 3. How it was configured

- **Cloudflare Worker** deployed with a D1 database (`worker/schema.sql`) and a
  `WORKER_PROXY_SECRET` shared with the Next app. The Next app reaches the worker via
  `CLOUDFLARE_WORKER_URL` and authenticates with the proxy secret.
- **Vercel env vars** already present: `ALLOWED_ORIGINS`, `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_WORKER_URL`, `D1_DATABASE_ID`, `DATABASE_NAME`,
  `WORKER_PROXY_SECRET`, `WORKERS_SUBDOMAIN`, plus `GITHUB_*` and `VERCEL_*`.
- **Laptop install**: `curl -fsSL <origin>/install | bash -s -- ABC-DEF-GHJ` (or the Windows
  `install.cmd`). The installer clones the daemon at a pinned commit, builds a venv, writes
  `~/.forge/config.json` (`deviceId`, `deviceToken`, `workerWebSocketUrl`, `daemonUrl`), and
  starts the daemon + bridge (with a startup entry so they survive reboots).

## 4. The problem

- The console returns **504** and the agent session **never starts** — it never reaches an IDE
  or the daemon.
- Two causes:
  1. **The console is just an iframe** (`/ar/index.html`) of the vendored web client. That client
     expects a directly reachable daemon, but the daemon is on the laptop behind the relay, so
     the iframe can never reach it.
  2. **The relay 504s** when the bridge is connected but the daemon isn't running, or when the
     bridge never accepts the request in time.

## 5. What's already changed

- `worker/src/types.ts`: added `rpc_accepted`.
- `worker/src/device-relay.ts`: awaits `rpc_accepted`; `ACCEPT_TIMEOUT_MS = 45s`,
  `DAEMON_TIMEOUT_MS = 120s`, `RPC_LIFETIME_MS = 5min`; removed the premature first-byte race.
- `bridge/forge_bridge.py`: sends `rpc_accepted` immediately; distinct "Local daemon is not
  running" error.
- `lib/device-rpc.ts`: `deviceRpc()` + friendly 503/504/429 errors.
- `lib/forge-session.ts`: session + console-prefs helpers.
- `lib/relay.ts`: relaxed origin checks (`v0.dev`, `vusercontent.net`, `sec-fetch-site` fallback).

## 6. What to do next

1. **Build the real console** (`components/console-frame.tsx` + `app/console/page.tsx`):
   pick a project → type a prompt → start a session → stream/poll job events → answer
   permission prompts. Route every call through `deviceRpc(deviceId, phoneSecret, path)`.
2. **Surface connection state** from the heartbeat (`online`, `daemonOnline`).
3. **Deploy**: `wrangler deploy` in `worker/`, then publish the Next app (the installer needs a
   public HTTPS origin).
4. **Verify end to end**: pair → install on the laptop → confirm `daemonOnline` → send a prompt →
   confirm the agent session starts and streams back.
