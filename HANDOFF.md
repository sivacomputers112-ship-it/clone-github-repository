# Forge / Agent Remote — Handoff

Public app origin: **https://clone-github-repository-olive.vercel.app**

The Cloudflare Worker is already deployed. Do not redeploy it unless the worker source changed.

---

## Status

The installer now finds the coding CLI on the laptop (`claude`, then `codex`/`grok`). If Claude Code is missing and npm is available, it installs `@anthropic-ai/claude-code`. If the CLI is present but not logged in, the install output and the console both tell you to run `claude login`.

The console no longer requires picking a project. It defaults to the laptop home directory with **Full access** (`bypassPermissions`) so the CLI can work across the machine.

Done:

- Pairing UI at `/` issues a 10-minute code and shows a public install command against `https://clone-github-repository-olive.vercel.app`.
- After the laptop is online, the pairing page opens `/console` automatically.
- Console talks to the laptop daemon through `deviceRpc()` → `/d/<deviceId>/<path>` → the existing worker → the laptop bridge.
- Re-running the install command replaces any leftover Forge process on that laptop.
- Installer detects/installs the CLI and writes `claude_bin` / `providers` / `permission_mode=bypassPermissions` into `~/.agentremoted/config.json`.
- Console shows a login banner when the CLI is missing or not signed in.

Still on you:

1. Open **https://clone-github-repository-olive.vercel.app**
2. Click **New code**
3. Copy the new command and paste it in Command Prompt
4. If the installer says to log in, open a **new** Command Prompt and run `claude login`
5. Wait until the page opens the console with **Online** and **Daemon ready**
6. Type a prompt and send — no project picker required

If it still sits on Claimed, read `%USERPROFILE%\.forge\bridge.log` and `%USERPROFILE%\.forge\daemon.log`.

---

## Architecture

Three pieces, no inbound laptop port:

| Piece | Where | Job |
| --- | --- | --- |
| Next.js app | Vercel, this repo | Pairing UI, console UI, API routes that proxy to the relay |
| Cloudflare Worker | `worker/` (already deployed) | Durable Object per device; laptop WebSocket; RPC forward; D1 pairing/devices |
| Laptop daemon + bridge | installed by `/install.py` | Finds/runs the local CLI; one outbound WebSocket to the worker |

### Console → daemon

`deviceRpc(deviceId, phoneSecret, path)` hits `/d/<deviceId>/<path>`:

- `GET /api/ping` — providers + `auth` (`cli_on_path`, login status)
- `GET /api/projects`
- `POST /api/shell` — used once to resolve the laptop home directory
- `POST /api/sessions/new {cwd, prompt, provider, permission_mode}`
- `POST /api/sessions/<id>/continue {prompt, permission_mode?}`
- `GET /api/jobs/<id>?since=<seq>`
- `POST /api/jobs/<id>/permission {request_id, allow}`
- `POST /api/jobs/<id>/question {request_id, answers\|cancel}`
- `POST /api/jobs/<id>/stop`

The bridge injects `X-Auth-Token` from `~/.agentremoted/token`. The browser only sends the phone secret.

### Env (already set)

`ALLOWED_ORIGINS`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_WORKER_URL`, `D1_DATABASE_ID`, `DATABASE_NAME`, `WORKER_PROXY_SECRET`, `WORKERS_SUBDOMAIN`, plus `GITHUB_*` and `VERCEL_*`.

Installer origin fallback lives in `lib/app-origin.ts` as `PUBLISHED_APP_ORIGIN`. Override with `NEXT_PUBLIC_APP_URL` / `APP_URL` if the Vercel hostname changes.
