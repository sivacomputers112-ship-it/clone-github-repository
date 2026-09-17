"""Resolve coding CLIs and launch them on Windows.

Agent Remote's job manager calls CreateProcess on argv[0]. On Windows the
Claude/Codex npm shims are *.cmd files, and a detached daemon often lacks
%APPDATA%\\npm on PATH — both produce WinError 2. This helper is overlaid
onto the cloned daemon at install time.
"""

from __future__ import print_function

import os
import shutil
import subprocess
from pathlib import Path

CREATE_NEW_PROCESS_GROUP = 0x00000200

_NODE_SCRIPTS = {
    "claude": [
        ("@anthropic-ai/claude-code", "cli.js"),
        ("@anthropic-ai/claude-code", "bin/claude.js"),
    ],
    "codex": [
        ("@openai/codex", "bin/codex.js"),
        ("@openai/codex", "codex.js"),
    ],
}


def _home():
    return Path.home()


def _appdata():
    return Path(os.environ.get("APPDATA") or (_home() / "AppData/Roaming"))


def _localappdata():
    return Path(os.environ.get("LOCALAPPDATA") or (_home() / "AppData/Local"))


def cli_dirs():
    home = _home()
    dirs = [
        _appdata() / "npm",
        _localappdata() / "agy" / "bin",
        _localappdata() / "Programs" / "cursor",
        home / ".local" / "bin",
        home / ".cursor" / "bin",
        home / ".antigravity" / "bin",
        Path(r"C:\Program Files\nodejs"),
        Path(r"C:\Program Files (x86)\nodejs"),
        Path("/usr/local/bin"),
        Path("/opt/homebrew/bin"),
    ]
    return [path for path in dirs if path.is_dir()]


def cli_path():
    return os.pathsep.join(str(path) for path in cli_dirs())


def _which(name, env=None):
    path = None
    if env is not None:
        path = env.get("PATH")
    found = shutil.which(name, path=path)
    if found:
        return found
    if os.name == "nt":
        for suffix in (".cmd", ".exe", ".bat"):
            found = shutil.which(name + suffix, path=path)
            if found:
                return found
        try:
            output = subprocess.check_output(
                ["where", name],
                env=env,
                text=True,
                errors="ignore",
                timeout=10,
            )
            line = output.strip().splitlines()[0].strip() if output.strip() else ""
            if line and os.path.isfile(line):
                return line
        except Exception:
            pass
    return ""


def refresh_cli_bins(config):
    if config is None:
        return
    mapping = (
        ("agy_bin", ("agy", "antigravity")),
        ("claude_bin", ("claude",)),
        ("cursor_bin", ("agent", "cursor-agent")),
        ("codex_bin", ("codex",)),
        ("grok_bin", ("grok",)),
    )
    for attr, aliases in mapping:
        current = str(getattr(config, attr, "") or "")
        if current and os.path.isfile(current):
            continue
        for alias in aliases:
            found = resolve_bin(alias)
            if found:
                try:
                    setattr(config, attr, found)
                except Exception:
                    pass
                break


def resolve_bin(name, env=None):
    raw = str(name or "").strip().strip('"')
    if not raw:
        return ""
    if os.path.isfile(raw):
        return raw
    found = _which(raw, env)
    if found:
        return found
    base = Path(raw).name
    stem = Path(base).stem
    aliases = {
        "claude": ["claude"],
        "codex": ["codex"],
        "agent": ["agent", "cursor-agent"],
        "cursor-agent": ["agent", "cursor-agent"],
        "cursor": ["agent", "cursor-agent"],
        "agy": ["agy", "antigravity"],
        "antigravity": ["agy", "antigravity"],
        "node": ["node"],
    }.get(stem.lower(), [stem])
    for alias in aliases:
        found = _which(alias, env)
        if found:
            return found
        for folder in cli_dirs():
            for candidate in (
                folder / alias,
                folder / (alias + ".cmd"),
                folder / (alias + ".exe"),
                folder / (alias + ".bat"),
            ):
                if candidate.is_file():
                    return str(candidate)
    return ""


def _node_script(head, resolved):
    stem = Path(str(head)).stem.lower()
    packages = _NODE_SCRIPTS.get(stem) or _NODE_SCRIPTS.get(Path(str(resolved or "")).stem.lower())
    if not packages:
        return ""
    roots = []
    if resolved:
        roots.append(Path(resolved).resolve().parent)
    roots.append(_appdata() / "npm")
    roots.append(_appdata() / "npm" / "node_modules")
    for root in roots:
        for package, rel in packages:
            direct = root / "node_modules" / package / rel
            nested = root / package / rel
            for candidate in (direct, nested):
                if candidate.is_file():
                    return str(candidate)
    return ""


def rewrite_command(cmd, env):
    cmd = [str(part) for part in cmd]
    if not cmd:
        return cmd
    resolved = resolve_bin(cmd[0], env) or cmd[0]
    script = _node_script(cmd[0], resolved)
    if script:
        node = resolve_bin("node", env)
        if node:
            return [node, script] + cmd[1:]
    return [resolved] + cmd[1:]


def prepare_popen(cmd, popen_kw):
    popen_kw = dict(popen_kw or {})
    env = dict(os.environ)
    if popen_kw.get("env"):
        env.update(popen_kw["env"])
    extra = cli_path()
    if extra:
        env["PATH"] = extra + os.pathsep + env.get("PATH", "")
    popen_kw["env"] = env
    cmd = rewrite_command(cmd, env)
    if os.name == "nt":
        popen_kw.pop("start_new_session", None)
        popen_kw["creationflags"] = int(popen_kw.get("creationflags") or 0) | CREATE_NEW_PROCESS_GROUP
        head = str(cmd[0]).lower()
        if head.endswith(".cmd") or head.endswith(".bat"):
            comspec = env.get("COMSPEC") or r"C:\Windows\System32\cmd.exe"
            cmd = [comspec, "/d", "/s", "/c", subprocess.list2cmdline(cmd)]
    return cmd, popen_kw


def handle_stream_line(job, line):
    text = (line or "").strip()
    if not text:
        return
    try:
        import json
        obj = json.loads(text)
    except (ValueError, TypeError):
        job.add_event("text", text=text)
        return
    if not isinstance(obj, dict):
        return
    kind = str(obj.get("type") or obj.get("event") or "")
    subtype = str(obj.get("subtype") or "")
    if kind == "init" or (kind == "system" and subtype == "init"):
        init = obj.get("init") if isinstance(obj.get("init"), dict) else obj
        session_id = str(obj.get("conversation_id") or obj.get("session_id") or "")
        if session_id:
            with job.lock:
                job.new_session_id = session_id
        model = ""
        if isinstance(init, dict):
            model = str(init.get("model") or obj.get("model") or "")
        job.add_event("init", session_id=session_id, model=model)
        return
    if kind == "step_update":
        step = obj.get("step_update") if isinstance(obj.get("step_update"), dict) else obj
        delta = step.get("text_delta")
        if isinstance(delta, str) and delta:
            job.add_event("text", text=delta)
        if str(step.get("step_type") or "") == "tool":
            info = step.get("tool_info") if isinstance(step.get("tool_info"), dict) else {}
            name = str(step.get("tool_name") or info.get("name") or "tool")
            detail = info.get("parameters") or info.get("output") or ""
            job.add_event("tool", name=name, detail=str(detail)[:400])
        return
    if kind in ("assistant", "message", "text", "content"):
        extracted = _assistant_text(obj)
        if extracted:
            job.add_event("text", text=extracted)
        return
    if kind in ("tool", "tool_use", "tool_call", "tool_start"):
        name = str(obj.get("name") or obj.get("tool") or obj.get("tool_name") or "tool")
        detail = obj.get("input") or obj.get("args") or obj.get("detail") or ""
        job.add_event("tool", name=name, detail=str(detail)[:400])
        return
    if kind in ("error",) or obj.get("is_error"):
        job.add_event("error", text=str(obj.get("error") or obj.get("result") or text)[:2000])
        return
    if kind in ("result", "done"):
        result = obj.get("result")
        if isinstance(result, dict):
            response = result.get("response")
            error = result.get("error")
            if result.get("status") == "ERROR" and error:
                job.add_event("error", text=str(error)[:2000])
            elif isinstance(response, str) and response.strip():
                job.add_event("text", text=response)
            session_id = str(result.get("conversation_id") or "")
            if session_id:
                with job.lock:
                    job.new_session_id = session_id
        elif isinstance(result, str) and result.strip():
            job.add_event("text", text=result)
        return


def _assistant_text(obj):
    if isinstance(obj.get("text"), str) and obj["text"].strip():
        return obj["text"]
    message = obj.get("message") if isinstance(obj.get("message"), dict) else obj
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                parts.append(str(block["text"]))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return ""
