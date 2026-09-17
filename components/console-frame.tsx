'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SquareIcon } from 'lucide-react'
import { ConsoleTranscript } from '@/components/console-transcript'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  PERMISSION_MODES,
  cliSetupMessage,
  jobIsActive,
  optionLabel,
  pickReadyProvider,
  pingProviders,
  providerLabel,
  questionLabel,
  type DaemonQuestion,
  type JobEvent,
  type JobSnapshot,
  type PingResponse,
  type Project,
} from '@/lib/daemon'
import { DeviceRpcError, deviceRpc } from '@/lib/device-rpc'
import {
  clearForgeSession,
  readConsolePrefs,
  readForgeSession,
  writeConsolePrefs,
  writeForgeSession,
  type ForgeSession,
} from '@/lib/forge-session'

type DeviceStatus = {
  device?: {
    name?: string
    online?: boolean
    daemonOnline?: boolean
  }
}

export function ConsoleFrame() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<ForgeSession | null>(null)
  const [online, setOnline] = useState(false)
  const [daemonOnline, setDaemonOnline] = useState(false)
  const [hostname, setHostname] = useState('Laptop')
  const [ping, setPing] = useState<PingResponse | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [cwd, setCwd] = useState('')
  const [provider, setProvider] = useState('')
  const [permissionMode, setPermissionMode] = useState('bypassPermissions')
  const [cliMessage, setCliMessage] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [jobId, setJobId] = useState('')
  const [job, setJob] = useState<JobSnapshot | null>(null)
  const [events, setEvents] = useState<JobEvent[]>([])
  const [error, setError] = useState('')
  const [answering, setAnswering] = useState(false)
  const seqRef = useRef(0)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const deviceId = session?.deviceId || ''
  const phoneSecret = session?.phoneSecret || ''

  useEffect(() => {
    const existing = readForgeSession()
    if (!existing?.deviceId || !existing.phoneSecret) {
      router.replace('/')
      return
    }
    const prefs = readConsolePrefs()
    setSession(existing)
    setHostname(existing.hostname || 'Laptop')
    if (prefs.cwd) setCwd(prefs.cwd)
    if (prefs.provider) setProvider(prefs.provider)
    if (prefs.sessionId) setSessionId(prefs.sessionId)
    setReady(true)
  }, [router])

  const refreshDevice = useCallback(async (active: ForgeSession) => {
    if (!active.deviceId || !active.phoneSecret) return
    try {
      const response = await fetch(`/api/devices/${active.deviceId}`, {
        headers: { Authorization: `Bearer ${active.phoneSecret}` },
        cache: 'no-store',
      })
      if (!response.ok) {
        setOnline(false)
        setDaemonOnline(false)
        return
      }
      const data = (await response.json()) as DeviceStatus
      setOnline(Boolean(data.device?.online))
      setDaemonOnline(Boolean(data.device?.daemonOnline))
      if (data.device?.name) {
        setHostname(data.device.name)
        writeForgeSession({ ...active, hostname: data.device.name, daemonOnline: Boolean(data.device.daemonOnline) })
      }
    } catch {
      setOnline(false)
      setDaemonOnline(false)
    }
  }, [])

  useEffect(() => {
    if (!session?.deviceId) return
    void refreshDevice(session)
    const timer = window.setInterval(() => void refreshDevice(session), 2500)
    return () => window.clearInterval(timer)
  }, [refreshDevice, session])

  useEffect(() => {
    if (!deviceId || !phoneSecret || !daemonOnline) return
    let cancelled = false
    const load = async () => {
      try {
        const nextPing = await deviceRpc<PingResponse>(deviceId, phoneSecret, '/api/ping')
        if (cancelled) return
        setPing(nextPing)
        const nextProvider = pickReadyProvider(nextPing)
        const chosenProvider = readConsolePrefs().provider || nextProvider
        setProvider((current) => current || nextProvider)
        setCliMessage(cliSetupMessage(nextPing, chosenProvider))
        const projectData = await deviceRpc<{ projects?: Project[] }>(deviceId, phoneSecret, '/api/projects')
        if (cancelled) return
        const home = await resolveLaptopHome(deviceId, phoneSecret)
        if (cancelled) return
        const listed = projectData.projects ?? []
        const machine: Project = {
          id: 'laptop-home',
          cwd: home,
          name: 'This laptop',
        }
        const nextProjects = home
          ? [machine, ...listed.filter((project) => normalizePath(project.cwd) !== normalizePath(home))]
          : listed
        setProjects(nextProjects)
        setCwd((current) => current || home || nextProjects[0]?.cwd || '')
        setError('')
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof DeviceRpcError ? cause.message : 'Could not reach the local daemon.')
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [daemonOnline, deviceId, phoneSecret])

  useEffect(() => {
    if (!deviceId || !phoneSecret || !jobId) return
    let cancelled = false
    let timer = 0
    const stop = () => {
      cancelled = true
      window.clearInterval(timer)
    }
    const tick = async () => {
      try {
        const snapshot = await deviceRpc<JobSnapshot>(
          deviceId,
          phoneSecret,
          `/api/jobs/${encodeURIComponent(jobId)}?since=${seqRef.current}`,
        )
        if (cancelled) return
        if (snapshot.events?.length) {
          setEvents((current) => mergeEvents(current, snapshot.events))
        }
        seqRef.current = snapshot.next_seq ?? seqRef.current
        setJob(snapshot)
        const nextSessionId = snapshot.new_session_id || snapshot.session_id
        if (nextSessionId) {
          setSessionId(nextSessionId)
          writeConsolePrefs({ cwd, provider, sessionId: nextSessionId })
        }
        if (!jobIsActive(snapshot.status)) {
          if (snapshot.error) setError(snapshot.error)
          stop()
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof DeviceRpcError ? cause.message : 'Job status is unavailable.')
          if (cause instanceof DeviceRpcError && cause.status === 404) stop()
        }
      }
    }
    timer = window.setInterval(() => void tick(), 900)
    void tick()
    return stop
  }, [cwd, deviceId, jobId, phoneSecret, provider])

  useEffect(() => {
    const node = transcriptRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [events, job?.pending_permission, job?.pending_question])

  async function sendPrompt() {
    const text = prompt.trim()
    if (!text || sending || !deviceId || !phoneSecret) return
    if (!online) {
      setError('Laptop is offline. Keep the Forge bridge running on that machine.')
      return
    }
    if (!daemonOnline) {
      setError('The laptop is online, but the local agent daemon did not answer. Re-run the install command so the daemon and bridge restart.')
      return
    }
    const workingDir = cwd.trim()
    if (!workingDir) {
      setError('The laptop home directory is not available yet. Wait for Daemon ready, then send again.')
      return
    }
    const activeProvider = provider || pickReadyProvider(ping)
    if (!activeProvider) {
      setError('No coding CLI is available on this laptop yet. Re-run the install command after Claude Code, Cursor, Antigravity, or Codex is installed.')
      return
    }
    setSending(true)
    setError('')
    setEvents((current) => [...current, { seq: -Date.now(), kind: 'user', text }])
    try {
      const body: Record<string, string> = {
        prompt: text,
        cwd: workingDir,
        permission_mode: permissionMode || 'bypassPermissions',
        provider: activeProvider,
      }
      let result: { job_id?: string }
      if (sessionId) {
        result = await deviceRpc<{ job_id?: string }>(
          deviceId,
          phoneSecret,
          `/api/sessions/${encodeURIComponent(sessionId)}/continue`,
          { method: 'POST', body: JSON.stringify({ prompt: text, permission_mode: permissionMode || 'bypassPermissions' }) },
        )
      } else {
        result = await deviceRpc<{ job_id?: string }>(deviceId, phoneSecret, '/api/sessions/new', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      }
      if (!result.job_id) throw new Error('The daemon did not return a job id.')
      setPrompt('')
      seqRef.current = 0
      setJob(null)
      setJobId(result.job_id)
      writeConsolePrefs({ cwd, provider, sessionId })
    } catch (cause) {
      if (sessionId && cause instanceof DeviceRpcError && cause.status === 404) {
        try {
          const retry = await deviceRpc<{ job_id?: string }>(deviceId, phoneSecret, '/api/sessions/new', {
            method: 'POST',
            body: JSON.stringify({
              prompt: text,
              cwd: workingDir,
              permission_mode: permissionMode || 'bypassPermissions',
              provider: activeProvider,
            }),
          })
          if (!retry.job_id) throw new Error('The daemon did not return a job id.')
          setPrompt('')
          setSessionId('')
          seqRef.current = 0
          setJob(null)
          setJobId(retry.job_id)
          writeConsolePrefs({ cwd, provider, sessionId: '' })
          return
        } catch (retryCause) {
          setError(retryCause instanceof DeviceRpcError ? retryCause.message : 'Could not start a new session.')
          return
        }
      }
      setError(cause instanceof DeviceRpcError ? cause.message : 'Could not send the prompt to the laptop.')
    } finally {
      setSending(false)
    }
  }

  async function stopJob() {
    if (!jobId || !deviceId || !phoneSecret) return
    try {
      await deviceRpc(deviceId, phoneSecret, `/api/jobs/${encodeURIComponent(jobId)}/stop`, {
        method: 'POST',
        body: '{}',
      })
    } catch (cause) {
      setError(cause instanceof DeviceRpcError ? cause.message : 'Could not stop the job.')
    }
  }

  async function answerPermission(allow: boolean) {
    const pending = job?.pending_permission
    if (!pending || !jobId || answering) return
    setAnswering(true)
    try {
      await deviceRpc(deviceId, phoneSecret, `/api/jobs/${encodeURIComponent(jobId)}/permission`, {
        method: 'POST',
        body: JSON.stringify({ request_id: pending.request_id, allow }),
      })
    } catch (cause) {
      setError(cause instanceof DeviceRpcError ? cause.message : 'Could not answer the permission prompt.')
    } finally {
      setAnswering(false)
    }
  }

  async function answerQuestion(question: DaemonQuestion, label: string) {
    const pending = job?.pending_question
    if (!pending || !jobId || answering) return
    setAnswering(true)
    try {
      const answers = (pending.questions || [question]).map((item) =>
        item === question ? [label] : [optionLabel((item.options || [])[0] || 'Skip')],
      )
      await deviceRpc(deviceId, phoneSecret, `/api/jobs/${encodeURIComponent(jobId)}/question`, {
        method: 'POST',
        body: JSON.stringify({ request_id: pending.request_id, answers }),
      })
    } catch (cause) {
      setError(cause instanceof DeviceRpcError ? cause.message : 'Could not answer the agent question.')
    } finally {
      setAnswering(false)
    }
  }

  async function cancelQuestion() {
    const pending = job?.pending_question
    if (!pending || !jobId || answering) return
    setAnswering(true)
    try {
      await deviceRpc(deviceId, phoneSecret, `/api/jobs/${encodeURIComponent(jobId)}/question`, {
        method: 'POST',
        body: JSON.stringify({ request_id: pending.request_id, cancel: true }),
      })
    } catch (cause) {
      setError(cause instanceof DeviceRpcError ? cause.message : 'Could not cancel the question.')
    } finally {
      setAnswering(false)
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    event.preventDefault()
    void sendPrompt()
  }

  async function resetPairing() {
    try {
      if (session?.deviceId && session.phoneSecret) {
        await fetch(`/api/devices/${encodeURIComponent(session.deviceId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.phoneSecret}` },
        })
      }
    } catch {
      // Local cleanup still prevents this browser from reusing the credential.
    }
    clearForgeSession()
    localStorage.removeItem('agentremote.profiles')
    router.replace('/')
  }

  function startNewChat() {
    setSessionId('')
    setJobId('')
    setJob(null)
    setEvents([])
    seqRef.current = 0
    writeConsolePrefs({ cwd, provider, sessionId: '' })
  }

  if (!ready) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading console…
      </main>
    )
  }

  const running = jobIsActive(job?.status)
  const working = sending || running || Boolean(jobId && (!job || jobIsActive(job.status)))
  const providers = pingProviders(ping)
  const emptyHint = !online
    ? 'Laptop is offline. Keep this tab open and the Forge bridge running on that machine.'
    : !daemonOnline
      ? 'Bridge is connected, but the local agent daemon is not ready yet. Re-run the install command if this stays unavailable.'
      : cliMessage
        ? cliMessage
        : 'Type a prompt and send it. Forge launches Antigravity on this laptop first, then Claude Code, Cursor, or Codex if those are installed.'

  return (
    <div className="flex h-svh flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="shrink-0 font-mono text-[11px] tracking-[0.28em] text-muted-foreground">
            FORGE
          </Link>
          <span className="truncate text-sm">{hostname}</span>
          <Badge variant={online ? 'default' : 'secondary'}>{online ? 'Online' : 'Offline'}</Badge>
          <Badge className="hidden sm:inline-flex" variant={daemonOnline ? 'secondary' : 'outline'}>
            {daemonOnline ? 'Daemon ready' : 'Daemon unavailable'}
          </Badge>
          {ping?.provider ? (
            <span className="hidden truncate font-mono text-[11px] text-muted-foreground md:inline">
              {ping.provider}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Pairing
          </Link>
          <Button size="sm" variant="outline" onClick={resetPairing}>
            Reset
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-foreground/10 px-4 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 uppercase tracking-wide">Project</span>
          <select
            className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
            value={cwd}
            onChange={(event) => {
              const next = event.target.value
              setCwd(next)
              setSessionId('')
              writeConsolePrefs({ cwd: next, provider, sessionId: '' })
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.cwd}>
                {project.name} {project.cwd ? `— ${project.cwd}` : ''}
              </option>
            ))}
          </select>
        </label>
        {providers.length ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="uppercase tracking-wide">CLI</span>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
              value={provider}
              onChange={(event) => {
                const next = event.target.value
                setProvider(next)
                setCliMessage(cliSetupMessage(ping, next))
                writeConsolePrefs({ cwd, provider: next, sessionId })
              }}
            >
              {providers.map((name) => (
                <option key={name} value={name}>
                  {providerLabel(name)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="uppercase tracking-wide">Mode</span>
          <select
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
            value={permissionMode}
            onChange={(event) => setPermissionMode(event.target.value)}
          >
            {PERMISSION_MODES.map((mode) => (
              <option key={mode.id || 'default'} value={mode.id}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="ghost" onClick={startNewChat}>
          New chat
        </Button>
      </div>

      <div className="border-b border-foreground/10 px-4 py-2">
        <Input
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
          placeholder="Laptop working directory (defaults to the whole user profile)"
          aria-label="Working directory"
          className="font-mono text-xs"
        />
      </div>
      {cliMessage ? (
        <p className="border-b border-foreground/10 px-4 py-2 text-sm text-destructive">{cliMessage}</p>
      ) : null}

      <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto">
        <ConsoleTranscript events={events} emptyHint={emptyHint} />
        {job?.pending_permission ? (
          <section className="mx-4 mb-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">Permission</p>
            <p className="mt-2 text-sm">
              Allow {job.pending_permission.tool_name || 'this tool'}
              {job.pending_permission.detail ? ` — ${job.pending_permission.detail}` : ''}?
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => void answerPermission(true)} disabled={answering}>
                Allow
              </Button>
              <Button size="sm" variant="outline" onClick={() => void answerPermission(false)} disabled={answering}>
                Deny
              </Button>
            </div>
          </section>
        ) : null}
        {job?.pending_question?.questions?.length ? (
          <section className="mx-4 mb-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            {job.pending_question.questions.map((question, index) => (
              <div key={`${job.pending_question?.request_id}-${index}`} className="flex flex-col gap-2">
                <p className="text-sm font-medium">{questionLabel(question)}</p>
                <div className="flex flex-wrap gap-2">
                  {(question.options || []).map((option) => {
                    const label = optionLabel(option)
                    return (
                      <Button
                        key={label}
                        size="sm"
                        variant="outline"
                        disabled={answering}
                        onClick={() => void answerQuestion(question, label)}
                      >
                        {label}
                      </Button>
                    )
                  })}
                </div>
              </div>
            ))}
            <Button className="mt-3" size="sm" variant="ghost" onClick={() => void cancelQuestion()} disabled={answering}>
              Skip
            </Button>
          </section>
        ) : null}
      </div>

      {error ? <p className="px-4 pb-2 text-sm text-destructive">{error}</p> : null}

      <form
        className="border-t border-foreground/10 p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void sendPrompt()
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={daemonOnline ? 'Ask the agent on this laptop…' : 'Waiting for the laptop daemon…'}
            disabled={!online}
            className="min-h-20 flex-1 resize-none"
            aria-label="Prompt"
          />
          <div className="flex flex-col gap-2">
            {working ? (
              <Button type="button" variant="outline" onClick={() => void stopJob()} disabled={!jobId}>
                <SquareIcon data-icon="inline-start" />
                Stop
              </Button>
            ) : null}
            <Button type="submit" disabled={working || !online || !daemonOnline || !prompt.trim()}>
              {sending ? <Spinner data-icon="inline-start" /> : null}
              Send
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Enter to send, Shift+Enter for a new line. The laptop CLI receives the prompt and can work anywhere on this machine.
        </p>
      </form>
    </div>
  )
}

function mergeEvents(current: JobEvent[], incoming: JobEvent[]) {
  const seen = new Set(current.map((event) => `${event.seq}:${event.kind}:${event.text || event.name || ''}`))
  const next = [...current]
  for (const event of incoming) {
    const key = `${event.seq}:${event.kind}:${event.text || event.name || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(event)
  }
  return next
}

function normalizePath(value: string) {
  return value.replace(/[\\/]+$/, '').toLowerCase()
}

function looksLikeHome(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/error|traceback|not recognized|cannot find/i.test(trimmed)) return false
  return trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)
}

async function resolveLaptopHome(deviceId: string, phoneSecret: string) {
  const commands = [
    'python -c "import os; print(os.path.expanduser(chr(126)))"',
    'py -3 -c "import os; print(os.path.expanduser(chr(126)))"',
    'echo %USERPROFILE%',
    'printf %s "$HOME"',
  ]
  for (const command of commands) {
    try {
      const result = await deviceRpc<{ output?: string }>(deviceId, phoneSecret, '/api/shell', {
        method: 'POST',
        body: JSON.stringify({ command }),
      })
      const line = (result.output || '')
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .pop()
      if (line && looksLikeHome(line)) return line
    } catch {
      // Try the next home-detection command.
    }
  }
  return ''
}
