"""Google Antigravity CLI adapter (binary: agy)."""

import os
from pathlib import Path

from . import RunnerError
from ..cli_launch import handle_stream_line, resolve_bin


class AntigravityStore:
    def __init__(self, config):
        self.config = config
        self.titler = None

    def list_projects(self):
        return []

    def list_sessions(self, project_id=None, limit=25, user_only=True):
        return []

    def search_sessions(self, query, project_id=None, limit=25, user_only=True):
        return []

    def get_session(self, session_id):
        return None

    def get_messages(self, session_id, offset=None, limit=50):
        return None


class AntigravityRunner:
    name = "antigravity"

    def __init__(self, config):
        self.config = config

    def _bin(self):
        return str(
            getattr(self.config, "agy_bin", None)
            or getattr(self.config, "antigravity_bin", None)
            or "agy"
        )

    def capabilities(self):
        return {"turns": True}

    def auth_health(self):
        raw = self._bin()
        path = resolve_bin(raw) or resolve_bin("agy") or resolve_bin("antigravity")
        on_path = bool(path)
        creds = Path.home() / ".gemini" / "antigravity-cli"
        logged_in = creds.exists() or bool(os.environ.get("GEMINI_API_KEY"))
        if not on_path:
            status = "missing"
            detail = "Antigravity CLI (`agy`) is not on PATH — install it, then run `agy`"
        elif logged_in:
            status = "ok"
            detail = path
        else:
            status = "missing"
            detail = "Antigravity CLI found, but no login yet — run `agy` on the laptop"
        return {
            "cli": "agy",
            "cli_on_path": on_path,
            "mode": "subscription",
            "status": status,
            "detail": detail,
        }

    def slash_commands(self):
        return []

    def title_for(self, text):
        return ""

    def prepare(self, job, mode):
        raw = self._bin()
        binary = resolve_bin(raw) or resolve_bin("agy") or resolve_bin("antigravity")
        if not binary:
            raise RunnerError("Antigravity CLI not found. Install it, then run: agy")
        if not job.cwd:
            job.cwd = str(Path.home())
        cmd = [binary, "-p", job.prompt, "--output-format", "stream-json"]
        if mode in ("bypassPermissions", "acceptEdits", ""):
            cmd.append("--dangerously-skip-permissions")
        env = dict(os.environ)
        extra = getattr(self.config, "agy_env", None) or {}
        env.update({str(k): str(v) for k, v in extra.items()})
        return cmd, env

    def handle_stream_line(self, job, line):
        handle_stream_line(job, line)

    def tick(self, job):
        return None

    def finalize(self, job, returncode, stderr_tail):
        return None

    def cleanup(self, job):
        return None
