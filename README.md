# Forge

Drive Claude Code, Codex, and other local coding agents from the browser. The laptop makes one outbound WebSocket. There is no inbound port and no account.

Public URL: https://clone-github-repository-olive.vercel.app

1. Open the site and copy the install command.
2. Run it on the laptop.
3. When the console shows Online and Daemon ready, pick a project and send a prompt.

The Cloudflare Worker relay is already deployed. Pairing codes and device RPC go through that worker; this Next.js app is the public UI and proxy.
