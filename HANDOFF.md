# Forge / Agent Remote — Handoff

Public app origin: **https://clone-github-repository-olive.vercel.app**

The Cloudflare Worker is already deployed. Do not redeploy it unless the worker source changed.

---

## Status

The installer finds Claude Code (`claude`), Antigravity (`agy`), Cursor (`agent`), and Codex (`codex`) on the laptop. After cloning Agent Remote it overlays a Windows launcher so `claude.cmd` no longer dies with WinError 2, and registers Cursor/Antigravity providers.

If Claude Code is missing and npm is available, it installs `@anthropic-ai/claude-code`. If a CLI is present but not logged in, the console tells you the exact login command (`claude login`, `agent login`, `agy`, or `codex login`).

The console no longer requires picking a project. It defaults to the laptop home directory with **Full access** (`bypassPermissions`) so the CLI can work across the machine.

Done:

- Pairing UI at `/` issues a 10-minute code and shows a public install command against `https://clone-github-repository-olive.vercel.app`.
- After the laptop is online, the pairing page opens `/console` automatically.
- Console talks to the laptop daemon through `deviceRpc()` → `/d/<deviceId>/<path>` → the existing worker → the laptop bridge.
- Re-running the install command replaces any leftover Forge process on that laptop.
- Installer detects Claude Code, Antigravity, Cursor, and Codex and writes their absolute paths into `~/.agentremoted/config.json`.
- After cloning Agent Remote, the installer overlays a Windows CLI launcher (fixes `WinError 2` on `claude.cmd`) plus Cursor/Antigravity providers.
- Console shows a login banner when the selected CLI is missing or not signed in.

Still on you:

1. Open **https://clone-github-repository-olive.vercel.app**
2. Click **New code**
3. Copy the new command and paste it in Command Prompt
4. Watch the installer print which CLIs it found. If it says to log in, open a **new** Command Prompt and run that command (`claude login`, `agent login`, `agy`, or `codex login`)
5. Wait until the page opens the console with **Online** and **Daemon ready**
6. Pick the CLI in the header if more than one was found, type a prompt, and send

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
