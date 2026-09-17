"""Cursor Agent CLI adapter (binary: agent / cursor-agent)."""

import os
from pathlib import Path

from . import RunnerError
from ..cli_launch import handle_stream_line, resolve_bin


class CursorStore:
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


class CursorRunner:
    name = "cursor"

    def __init__(self, config):
        self.config = config

    def _bin(self):
        return str(
            getattr(self.config, "cursor_bin", None)
            or getattr(self.config, "agent_bin", None)
            or "agent"
        )

    def capabilities(self):
        return {"turns": True}

    def auth_health(self):
        raw = self._bin()
        path = resolve_bin(raw) or resolve_bin("agent") or resolve_bin("cursor-agent")
        on_path = bool(path)
        return {
            "cli": "agent",
            "cli_on_path": on_path,
            "mode": "subscription",
            "status": "ok" if on_path else "missing",
            "detail": path or "Cursor CLI (`agent`) is not on PATH — run the Cursor install script, then `agent login`",
        }

    def slash_commands(self):
        return []

    def title_for(self, text):
        return ""

    def prepare(self, job, mode):
        raw = self._bin()
        binary = resolve_bin(raw) or resolve_bin("agent") or resolve_bin("cursor-agent")
        if not binary:
            raise RunnerError("Cursor CLI not found. Install it, then run: agent login")
        if not job.cwd:
            job.cwd = str(Path.home())
        cmd = [binary, "-p", job.prompt, "--output-format", "stream-json"]
        if mode in ("bypassPermissions", "acceptEdits", ""):
            cmd.append("--force")
        env = dict(os.environ)
        extra = getattr(self.config, "cursor_env", None) or {}
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
