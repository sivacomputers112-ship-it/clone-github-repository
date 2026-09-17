const DAEMON_COMMIT = 'fb8ec4e43e44099d5d86076194e98d971582fb97'

function safeUrl(value: string) {
  return value.replace(/[\r\n'"&|<>^%!]/g, '')
}

export function unixInstallScript(origin: string) {
  const safeOrigin = safeUrl(origin)
  return `#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash forge-install.sh ABC-DEF-GHJ" >&2
  exit 2
fi
command -v python3 >/dev/null 2>&1 || { echo "Python 3 is required." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }

installer="\${TMPDIR:-/tmp}/forge-install-$$.py"
trap 'rm -f "$installer"' EXIT
curl -fsSL '${safeOrigin}/install.py' -o "$installer"
python3 "$installer" "$1"
`
}

export function windowsCmdInstallScript(origin: string) {
  const safeOrigin = safeUrl(origin)
  return String.raw`@echo off
setlocal
if "%~1"=="" (
  echo Usage: forge-install.cmd ABC-DEF-GHJ 1>&2
  exit /b 2
)
where py.exe >nul 2>&1 || (
  echo Python 3 is required. Install it from python.org and enable the py launcher. 1>&2
  exit /b 1
)
where curl.exe >nul 2>&1 || (
  echo curl.exe is required. 1>&2
  exit /b 1
)
set "FORGE_INSTALLER=%TEMP%\forge-install-%RANDOM%.py"
curl.exe -fsSL "${safeOrigin}/install.py" -o "%FORGE_INSTALLER%"
if errorlevel 1 (
  echo Installer download failed from ${safeOrigin}. 1>&2
  exit /b 1
)
py.exe -3 "%FORGE_INSTALLER%" "%~1"
set "FORGE_EXIT=%ERRORLEVEL%"
del /q "%FORGE_INSTALLER%" >nul 2>&1
exit /b %FORGE_EXIT%
`
}

export function pythonInstallScript(origin: string) {
  const safeOrigin = safeUrl(origin)
  return `#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ORIGIN = ${JSON.stringify(safeOrigin)}
DAEMON_REPOSITORY = "https://github.com/jxw1102/agent-remote.git"
DAEMON_COMMIT = "${DAEMON_COMMIT}"
FORGE_HOME = Path.home() / ".forge"
AGENT_HOME = FORGE_HOME / "agent-remote"
VENV_HOME = FORGE_HOME / "venv"
DAEMON_PORT = 8473
BRIDGE_LOCK_PORT = 18473
DETACHED = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000


def fail(message):
    raise SystemExit("Forge install failed: " + message)


def run(command, **kwargs):
    try:
        subprocess.run(command, check=True, **kwargs)
    except (OSError, subprocess.CalledProcessError) as error:
        fail(str(error))


def download(path, destination):
    try:
        request = urllib.request.Request(ORIGIN + path, headers={"User-Agent": "forge-installer/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            destination.write_bytes(response.read())
    except Exception as error:
        fail("could not download " + path + ": " + str(error))


def venv_python():
    return VENV_HOME / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def kill_pid(pid):
    if pid <= 0:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.kill(pid, 9)
        except OSError:
            pass


def listening_pids(port):
    pids = set()
    if os.name == "nt":
        try:
            output = subprocess.check_output(["netstat", "-ano"], text=True, errors="ignore")
        except Exception:
            return pids
        needle = ":" + str(port)
        for line in output.splitlines():
            if needle not in line or "LISTENING" not in line.upper():
                continue
            parts = line.split()
            if parts and parts[-1].isdigit():
                pids.add(int(parts[-1]))
        return pids
    try:
        output = subprocess.check_output(["lsof", "-ti", "tcp:" + str(port)], text=True, errors="ignore")
        for line in output.split():
            if line.isdigit():
                pids.add(int(line))
    except Exception:
        pass
    return pids


def command_line_pids():
    pids = set()
    markers = ("agentremoted", ".forge" + os.sep + "bridge.py", ".forge/bridge.py")
    if os.name == "nt":
        script = (
            "$markers = @('agentremoted', '.forge\\\\bridge.py', '.forge/bridge.py');"
            "Get-CimInstance Win32_Process | ForEach-Object {"
            "  if ($_.CommandLine) {"
            "    foreach ($m in $markers) {"
            "      if ($_.CommandLine -like ('*' + $m + '*')) { $_.ProcessId; break }"
            "    }"
            "  }"
            "}"
        )
        try:
            output = subprocess.check_output(
                ["powershell.exe", "-NoProfile", "-Command", script],
                text=True,
                errors="ignore",
                timeout=20,
            )
            for line in output.split():
                if line.isdigit():
                    pids.add(int(line))
        except Exception:
            pass
        return pids
    try:
        output = subprocess.check_output(["ps", "-ax", "-o", "pid=,command="], text=True, errors="ignore")
    except Exception:
        return pids
    self_pid = os.getpid()
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) != 2 or not parts[0].isdigit():
            continue
        pid = int(parts[0])
        if pid == self_pid:
            continue
        command = parts[1]
        if any(marker in command for marker in markers):
            pids.add(pid)
    return pids


def stop_autostart():
    if platform.system() == "Darwin":
        plist = Path.home() / "Library/LaunchAgents/app.forge.bridge.plist"
        if plist.exists():
            subprocess.run(["launchctl", "unload", str(plist)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif shutil.which("systemctl"):
        subprocess.run(["systemctl", "--user", "stop", "forge-bridge.service"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def kill_old_forge():
    print("Stopping any previous Forge process on this laptop...")
    stop_autostart()
    pids = listening_pids(DAEMON_PORT) | listening_pids(BRIDGE_LOCK_PORT) | command_line_pids()
    pids.discard(os.getpid())
    for pid in sorted(pids):
        kill_pid(pid)
    time.sleep(1.2)


def claim(code):
    payload = json.dumps({
        "code": code,
        "name": socket.gethostname(),
        "platform": platform.system(),
    }).encode("utf-8")
    request = urllib.request.Request(
        ORIGIN + "/api/pair/claim",
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "forge-installer/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8")).get("error")
        except Exception:
            detail = None
        fail(detail or ("pairing request returned HTTP " + str(error.code)))
    except Exception as error:
        fail("could not reach the Forge app: " + str(error))


def install_daemon():
    if not shutil.which("git"):
        fail("Git is required to install the local agent daemon")
    if AGENT_HOME.exists() and not (AGENT_HOME / ".git").is_dir():
        shutil.rmtree(AGENT_HOME)
    if not AGENT_HOME.exists():
        run(["git", "clone", "--filter=blob:none", DAEMON_REPOSITORY, str(AGENT_HOME)])
    run(["git", "-C", str(AGENT_HOME), "fetch", "--depth", "1", "origin", DAEMON_COMMIT])
    run(["git", "-C", str(AGENT_HOME), "checkout", "--detach", DAEMON_COMMIT])


def which_cli(name):
    found = shutil.which(name) or shutil.which(name + ".cmd") or shutil.which(name + ".exe")
    if found:
        return found
    if os.name == "nt":
        try:
            output = subprocess.check_output(["where", name], text=True, errors="ignore", timeout=10)
            line = output.strip().splitlines()[0].strip() if output.strip() else ""
            if line and Path(line).exists():
                return line
        except Exception:
            pass
    home = Path.home()
    appdata = Path(os.environ.get("APPDATA") or (home / "AppData/Roaming"))
    local = Path(os.environ.get("LOCALAPPDATA") or (home / "AppData/Local"))
    candidates = [
        home / ".local/bin" / name,
        home / ".local/bin" / (name + ".exe"),
        home / ".cursor/bin" / name,
        home / ".cursor/bin" / (name + ".exe"),
        home / ".antigravity/bin" / name,
        home / ".antigravity/bin" / (name + ".exe"),
        appdata / "npm" / (name + ".cmd"),
        appdata / "npm" / (name + ".exe"),
        local / "agy/bin" / name,
        local / "agy/bin" / (name + ".exe"),
        local / "Programs" / name / (name + ".exe"),
        local / "npm" / (name + ".cmd"),
        Path("C:/Program Files/nodejs") / (name + ".cmd"),
        Path("C:/Program Files/nodejs") / (name + ".exe"),
    ]
    for path in candidates:
        if path.exists():
            return str(path)
    return ""


def npm_cmd():
    return shutil.which("npm") or shutil.which("npm.cmd") or ""


def extra_path():
    parts = []
    npm = npm_cmd()
    if npm:
        try:
            output = subprocess.check_output([npm, "bin", "-g"], text=True, errors="ignore", timeout=20)
            line = output.strip().splitlines()[-1].strip() if output.strip() else ""
            if line:
                parts.append(line)
        except Exception:
            pass
    home = Path.home()
    appdata = Path(os.environ.get("APPDATA") or (home / "AppData/Roaming"))
    local = Path(os.environ.get("LOCALAPPDATA") or (home / "AppData/Local"))
    for path in (
        appdata / "npm",
        local / "agy/bin",
        home / ".local/bin",
        home / ".cursor/bin",
        home / ".antigravity/bin",
        Path("C:/Program Files/nodejs"),
        Path("C:/Program Files (x86)/nodejs"),
    ):
        parts.append(str(path))
    return os.pathsep.join(part for part in parts if part)


def claude_logged_in():
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return True
    creds = Path.home() / ".claude" / ".credentials.json"
    if creds.exists():
        return True
    claude_json = Path.home() / ".claude.json"
    return claude_json.exists()


def install_claude():
    npm = npm_cmd()
    if not npm:
        print("Node/npm was not found, so Claude Code could not be installed automatically.")
        print("Install Claude Code, then run: claude login")
        return ""
    print("Claude CLI not found. Installing @anthropic-ai/claude-code...")
    try:
        subprocess.run([npm, "install", "-g", "@anthropic-ai/claude-code"], check=True, timeout=240)
    except Exception as error:
        print("Automatic Claude install failed: " + str(error))
        print("Install Claude Code yourself, then run: claude login")
        return ""
    return which_cli("claude")


def prepare_cli():
    found = {}
    specs = (
        ("claude", ("claude",)),
        ("antigravity", ("agy", "antigravity")),
        ("cursor", ("agent", "cursor-agent")),
        ("codex", ("codex",)),
        ("grok", ("grok",)),
    )
    for name, aliases in specs:
        for alias in aliases:
            path = which_cli(alias)
            if path:
                found[name] = path
                print("Found " + name + " CLI: " + path)
                break
    if "claude" not in found:
        installed = install_claude()
        if installed:
            found["claude"] = installed
            print("Installed Claude Code CLI: " + installed)
    if not found:
        print("No coding CLI is available yet. Forge will still connect.")
        print("Install Claude Code, Cursor CLI, Antigravity, or Codex, then log in.")
    elif "claude" in found and not claude_logged_in():
        print("Claude CLI is installed but not logged in.")
        print("Open a new Command Prompt and run: claude login")
        print("Then return to the Forge tab and send a prompt.")
    if "cursor" in found:
        print("Cursor CLI found. If prompts fail, run: agent login")
    if "antigravity" in found:
        print("Antigravity CLI found. If prompts fail, run: agy")
    if "codex" in found:
        print("Codex CLI found. If prompts fail, run: codex login")
    return found


def overlay_daemon():
    daemon = AGENT_HOME / "daemon" / "agentremoted"
    providers = daemon / "providers"
    if not providers.is_dir():
        fail("cloned daemon is missing providers")
    download("/api/forge/cli_launch.py", daemon / "cli_launch.py")
    download("/api/forge/cursor.py", providers / "cursor.py")
    download("/api/forge/antigravity.py", providers / "antigravity.py")
    jobs = daemon / "jobs.py"
    text = jobs.read_text(encoding="utf-8")
    old = "            proc = subprocess.Popen(cmd, **popen_kw)"
    new = (
        "            from .cli_launch import prepare_popen\\n"
        "            cmd, popen_kw = prepare_popen(cmd, popen_kw)\\n"
        "            proc = subprocess.Popen(cmd, **popen_kw)"
    )
    if "prepare_popen" not in text:
        if old not in text:
            fail("could not patch daemon job launcher")
        jobs.write_text(text.replace(old, new, 1), encoding="utf-8")
    init = providers / "__init__.py"
    init_text = init.read_text(encoding="utf-8")
    if "CursorRunner" not in init_text:
        needle = "    if store is not None:"
        insert = (
            "    elif name in (\\"cursor\\", \\"agent\\"):\\n"
            "        from .cursor import CursorRunner, CursorStore\\n"
            "        store, runner = CursorStore(config), CursorRunner(config)\\n"
            "    elif name in (\\"antigravity\\", \\"agy\\"):\\n"
            "        from .antigravity import AntigravityRunner, AntigravityStore\\n"
            "        store, runner = AntigravityStore(config), AntigravityRunner(config)\\n"
            "    if store is not None:"
        )
        if needle not in init_text:
            fail("could not patch daemon providers")
        init.write_text(init_text.replace(needle, insert, 1), encoding="utf-8")


def configure_daemon(found):
    daemon_home = Path.home() / ".agentremoted"
    daemon_home.mkdir(parents=True, exist_ok=True)
    config_path = daemon_home / "config.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8")) if config_path.exists() else {}
    except (OSError, ValueError):
        config = {}
    names = list(found.keys()) or ["claude"]
    config.update({
        "bind": "127.0.0.1",
        "port": DAEMON_PORT,
        "providers": names,
        "provider": names[0],
        "permission_mode": "bypassPermissions",
        "codex_sandbox": "danger-full-access",
    })
    if found.get("claude"):
        config["claude_bin"] = found["claude"]
    if found.get("codex"):
        config["codex_bin"] = found["codex"]
    if found.get("grok"):
        config["grok_bin"] = found["grok"]
    if found.get("cursor"):
        config["cursor_bin"] = found["cursor"]
    if found.get("antigravity"):
        config["agy_bin"] = found["antigravity"]
    config_path.write_text(json.dumps(config, indent=2) + "\\n", encoding="utf-8")


def spawn_detached(command, logfile, env=None):
    log = open(logfile, "ab", buffering=0)
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    kwargs = {
        "args": command,
        "stdin": subprocess.DEVNULL,
        "stdout": log,
        "stderr": subprocess.STDOUT,
        "env": merged_env,
        "close_fds": True,
    }
    if os.name == "nt":
        kwargs["creationflags"] = DETACHED | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
        kwargs["startupinfo"] = startup
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen(**kwargs)


def daemon_env():
    env = os.environ.copy()
    env["PYTHONPATH"] = str(AGENT_HOME / "daemon")
    extra = extra_path()
    if extra:
        env["PATH"] = extra + os.pathsep + env.get("PATH", "")
    return env


def start_processes(python_executable):
    spawn_detached(
        [python_executable, "-m", "agentremoted", "--bind", "127.0.0.1", "--port", str(DAEMON_PORT)],
        str(FORGE_HOME / "daemon.log"),
        env=daemon_env(),
    )
    if not wait_port(DAEMON_PORT, 40):
        fail("local daemon did not start. See " + str(FORGE_HOME / "daemon.log"))
    spawn_detached(
        [str(venv_python()), str(FORGE_HOME / "bridge.py")],
        str(FORGE_HOME / "bridge.log"),
    )
    if not wait_port(BRIDGE_LOCK_PORT, 20):
        fail("laptop bridge did not start. See " + str(FORGE_HOME / "bridge.log"))


def wait_port(port, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        sock = socket.socket()
        sock.settimeout(1)
        try:
            sock.connect(("127.0.0.1", port))
            return True
        except OSError:
            time.sleep(0.4)
        finally:
            sock.close()
    return False


def write_windows_autostart(python_executable):
    python = str(python_executable)
    bridge_py = str(FORGE_HOME / "bridge.py")
    daemon_path = str(AGENT_HOME / "daemon")
    extra = extra_path()
    vbs = FORGE_HOME / "start.vbs"
    lines = [
        'Set sh = CreateObject("Wscript.Shell")',
        'sh.Environment("Process")("PYTHONPATH") = "' + daemon_path + '"',
    ]
    if extra:
        lines.append('sh.Environment("Process")("PATH") = "' + extra + ';" & sh.Environment("Process")("PATH")')
    lines.extend([
        'sh.Run """' + python + '"" -m agentremoted --bind 127.0.0.1 --port 8473", 0, False',
        'WScript.Sleep 2500',
        'sh.Run """' + python + '"" """' + bridge_py + '""", 0, False',
        '',
    ])
    vbs.write_text("\\r\\n".join(lines), encoding="utf-8")
    start_path = FORGE_HOME / "start.cmd"
    start_path.write_text("@echo off\\r\\nwscript.exe \\"" + str(vbs) + "\\"\\r\\n", encoding="utf-8")
    startup = Path(os.environ.get("APPDATA", str(Path.home()))) / "Microsoft/Windows/Start Menu/Programs/Startup"
    startup.mkdir(parents=True, exist_ok=True)
    old_cmd = startup / "Forge.cmd"
    if old_cmd.exists():
        old_cmd.unlink()
    shutil.copyfile(vbs, startup / "Forge.vbs")


def write_unix_autostart(python_executable):
    start_path = FORGE_HOME / "start.sh"
    extra = extra_path()
    start_path.write_text(
        "#!/usr/bin/env bash\\n"
        + "export PYTHONPATH=" + shell_quote(str(AGENT_HOME / "daemon")) + "\\n"
        + (("export PATH=" + shell_quote(extra) + ":$PATH\\n") if extra else "")
        + "if ! curl -fsS http://127.0.0.1:8473/api/ping >/dev/null 2>&1; then\\n"
        + "  " + shell_quote(python_executable) + " -m agentremoted --bind 127.0.0.1 --port 8473 >> " + shell_quote(str(FORGE_HOME / "daemon.log")) + " 2>&1 &\\n"
        + "  sleep 2\\n"
        + "fi\\n"
        + "exec " + shell_quote(str(venv_python())) + " " + shell_quote(str(FORGE_HOME / "bridge.py")) + " >> " + shell_quote(str(FORGE_HOME / "bridge.log")) + " 2>&1\\n",
        encoding="utf-8",
    )
    start_path.chmod(0o700)
    if platform.system() == "Darwin":
        launch_agents = Path.home() / "Library/LaunchAgents"
        launch_agents.mkdir(parents=True, exist_ok=True)
        plist = launch_agents / "app.forge.bridge.plist"
        plist.write_text("""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>app.forge.bridge</string><key>ProgramArguments</key><array><string>""" + str(start_path) + """</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>
""", encoding="utf-8")
        subprocess.run(["launchctl", "unload", str(plist)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        run(["launchctl", "load", str(plist)])
        return True
    if shutil.which("systemctl"):
        units = Path.home() / ".config/systemd/user"
        units.mkdir(parents=True, exist_ok=True)
        unit = units / "forge-bridge.service"
        unit.write_text("[Unit]\\nDescription=Forge outbound laptop bridge\\nAfter=network-online.target\\n[Service]\\nExecStart=" + str(start_path) + "\\nRestart=always\\nRestartSec=5\\n[Install]\\nWantedBy=default.target\\n", encoding="utf-8")
        run(["systemctl", "--user", "daemon-reload"])
        run(["systemctl", "--user", "enable", "--now", "forge-bridge.service"])
        return True
    return False


def shell_quote(value):
    return "'" + value.replace("'", "'\\\"'\\\"'") + "'"


def main():
    if len(sys.argv) != 2:
        fail("one pairing code is required")
    code = sys.argv[1].strip().replace("\\r", "").upper()
    FORGE_HOME.mkdir(parents=True, exist_ok=True)
    kill_old_forge()
    print("Installing isolated Python environment...")
    if not VENV_HOME.exists():
        run([sys.executable, "-m", "venv", str(VENV_HOME)])
    python = str(venv_python())
    run([python, "-m", "pip", "install", "--disable-pip-version-check", "--quiet", "websocket-client==1.8.0"])
    download("/bridge.py", FORGE_HOME / "bridge.py")
    print("Looking for the coding CLI on this laptop...")
    found = prepare_cli()
    print("Installing pinned local daemon...")
    install_daemon()
    print("Wiring Claude, Cursor, Antigravity, and Codex launchers...")
    overlay_daemon()
    configure_daemon(found)
    print("Claiming pairing code...")
    credentials = claim(code)
    ws_url = str(credentials.get("workerWebSocketUrl") or "")
    token = str(credentials.get("deviceToken") or "")
    if token and "token=" not in ws_url:
        ws_url += ("&" if "?" in ws_url else "?") + "token=" + urllib.parse.quote(token, safe="")
    config = {
        "deviceId": credentials["deviceId"],
        "deviceToken": token,
        "workerWebSocketUrl": ws_url,
        "daemonUrl": "http://127.0.0.1:" + str(DAEMON_PORT),
    }
    (FORGE_HOME / "config.json").write_text(json.dumps(config, indent=2) + "\\n", encoding="utf-8")
    if os.name == "nt":
        write_windows_autostart(python)
        start_processes(python)
    else:
        managed = write_unix_autostart(python)
        if not managed:
            start_processes(python)
        elif not wait_port(BRIDGE_LOCK_PORT, 25):
            start_processes(python)
    print("Forge is installed and connected. You can close this window.")
    if not found:
        print("Next: install Claude Code, run: claude login")
    elif "claude" in found and not claude_logged_in():
        print("Next: open a new Command Prompt and run: claude login")
    print("Logs: " + str(FORGE_HOME / "bridge.log"))


if __name__ == "__main__":
    main()
`
}
