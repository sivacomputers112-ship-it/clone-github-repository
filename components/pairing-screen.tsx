'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CheckIcon, CopyIcon, LaptopIcon, TerminalIcon, TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { PUBLISHED_APP_ORIGIN, isPrivateHost } from '@/lib/app-origin'

const SESSION_KEY = 'forge.v1'
const APP_ORIGIN_OVERRIDE = (process.env.NEXT_PUBLIC_APP_URL || PUBLISHED_APP_ORIGIN).replace(/\/+$/, '')

type LaptopPlatform = 'windows' | 'unix'
type PairStatus = 'loading' | 'waiting' | 'claimed' | 'online' | 'expired' | 'error'

type PairSession = {
  code: string
  phoneSecret: string
  expiresAt?: string
  deviceId?: string
  hostname?: string
  daemonOnline?: boolean
}

type WorkerDevice = {
  id?: string
  name?: string
  online?: boolean
  daemonOnline?: boolean
}

export function PairingScreen() {
  const router = useRouter()
  const [session, setSession] = useState<PairSession | null>(null)
  const [status, setStatus] = useState<PairStatus>('loading')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [appOrigin, setAppOrigin] = useState('')
  const [platform, setPlatform] = useState<LaptopPlatform>('unix')
  const [introStep, setIntroStep] = useState(0)
  const [selectedCli, setSelectedCli] = useState('antigravity')
  const [reviewedCompatibility, setReviewedCompatibility] = useState(false)

  const cliOptions = [
    { id: 'antigravity', name: 'Antigravity', logo: '/logos/antigravity.svg', tone: 'lime' },
    { id: 'claude', name: 'Claude Code', logo: '/logos/claude-code.svg', tone: 'cyan' },
    { id: 'cursor', name: 'Cursor', logo: '/logos/cursor.svg', tone: 'blue' },
    { id: 'codex', name: 'Codex', logo: '/logos/codex.svg', tone: 'pink' },
  ] as const

  const chosenCli = cliOptions.find((cli) => cli.id === selectedCli) ?? cliOptions[0]!

  useEffect(() => {
    setAppOrigin(APP_ORIGIN_OVERRIDE)
    setPlatform(/Windows/i.test(navigator.userAgent) ? 'windows' : 'unix')
    const existing = readSession()
    if (existing?.code && existing.phoneSecret && !isSessionExpired(existing)) {
      setSession(existing)
      return
    }
    localStorage.removeItem(SESSION_KEY)
    void createPair()
  }, [])

  useEffect(() => {
    if (status === 'online' && session?.deviceId) {
      router.push('/console')
    }
  }, [status, session?.deviceId, router])

  useEffect(() => {
    if (!session?.code || !session.phoneSecret) return
    let cancelled = false

    const tick = async () => {
      const url = session.deviceId
        ? `/api/devices/${encodeURIComponent(session.deviceId)}`
        : `/api/pair?code=${encodeURIComponent(session.code)}`
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${session.phoneSecret}` },
          cache: 'no-store',
        })
        const data = await response.json()
        if (cancelled) return
        if (!response.ok) {
          if ([401, 404, 409, 410].includes(response.status)) {
            localStorage.removeItem(SESSION_KEY)
            setSession(null)
            await createPair()
            return
          }
          if (response.status >= 500) return
          setStatus('error')
          setError(data.error || 'Pairing status is unavailable')
          return
        }
        if (data.status === 'expired') {
          localStorage.removeItem(SESSION_KEY)
          setSession(null)
          await createPair()
          return
        }
        const device = data.device as WorkerDevice | undefined
        const next: PairSession = {
          ...session,
          deviceId: device?.id || session.deviceId,
          hostname: device?.name || session.hostname,
          daemonOnline: Boolean(device?.daemonOnline),
        }
        if (JSON.stringify(next) !== JSON.stringify(session)) {
          writeSession(next)
          setSession(next)
        }
        if (device?.online) setStatus('online')
        else if (device?.id || data.status === 'claimed') setStatus('claimed')
        else setStatus('waiting')
      } catch {
        if (!cancelled) {
          setStatus('error')
          setError('Could not reach the Forge relay')
        }
      }
    }

    void tick()
    const timer = window.setInterval(() => void tick(), 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [session])

  async function createPair() {
    setStatus('loading')
    setError('')
    try {
      const response = await fetch('/api/pair', { method: 'POST', cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not create a pairing code')
      const next = {
        code: data.code as string,
        phoneSecret: data.phoneSecret as string,
        expiresAt: data.expiresAt as string | undefined,
      }
      writeSession(next)
      setSession(next)
      setStatus('waiting')
    } catch (cause) {
      setStatus('error')
      setError(cause instanceof Error ? cause.message : 'Could not start pairing')
    }
  }

  async function resetPairing() {
    if (session?.deviceId && session.phoneSecret) {
      await fetch(`/api/devices/${encodeURIComponent(session.deviceId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.phoneSecret}` },
      }).catch(() => undefined)
    }
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    await createPair()
  }

  const command = useMemo(() => {
    if (!appOrigin || !session?.code) return ''
    if (platform === 'windows') {
      return `curl.exe -fsSL ${appOrigin}/install.cmd -o "%TEMP%\\forge-install.cmd" && call "%TEMP%\\forge-install.cmd" ${session.code}`
    }
    return `curl -fsSL ${appOrigin}/install | bash -s -- ${session.code}`
  }, [appOrigin, platform, session?.code])

  async function copyCommand() {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const connected = status === 'online'
  const privateOrigin = Boolean(appOrigin) && isPrivateHost(originHost(appOrigin))

  return (
    <main className="forge-shell min-h-svh overflow-hidden px-4 py-4 text-[#101313] sm:px-8 sm:py-6">
      <div className="mx-auto flex min-h-[calc(100svh-2rem)] w-full max-w-6xl flex-col border-[3px] border-[#101313] bg-[#f3f0e8] shadow-[10px_10px_0_#101313]">
        <header className="flex items-center justify-between border-b-[3px] border-[#101313] px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3"><span className="grid size-8 place-items-center border-2 border-[#101313] bg-[#b9ff3d] font-mono text-sm font-bold">F/</span><span className="font-mono text-xs font-bold tracking-[0.3em]">FORGE_REMOTE</span></div>
          <div className="flex items-center gap-3"><button type="button" onClick={() => void resetPairing()} className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] underline underline-offset-4">New code</button><span className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] sm:flex"><span>v0.4.0</span><span className="size-2 rounded-full bg-[#b9ff3d] ring-2 ring-[#101313]" />Encrypted link</span></div>
        </header>

        <div className="grid flex-1 lg:grid-cols-[1fr_1.1fr]">
          <section className="flex flex-col justify-between border-b-[3px] border-[#101313] p-6 sm:p-10 lg:border-b-0 lg:border-r-[3px]">
            <div>
              <p className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-[#16a6c8]">{introStep === 0 ? '01 / wake the machine' : introStep === 1 ? '02 / choose your driver' : introStep === 2 ? '03 / check compatibility' : '04 / make the connection'}</p>
              <h1 className="max-w-xl text-4xl font-black leading-[0.95] tracking-[-0.06em] sm:text-6xl">Your computer,<br /><span className="text-[#16a6c8]">in your pocket.</span></h1>
              <p className="mt-6 max-w-md font-mono text-sm leading-6">Forge is a remote control for the coding tools already living on your machine. Private by design. Built for the long run.</p>
            </div>

            {introStep === 1 ? (
              <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                {cliOptions.map((cli) => <button key={cli.id} type="button" onClick={() => setSelectedCli(cli.id)} className={`group flex min-h-28 flex-col justify-between border-2 border-[#101313] p-3 text-left transition-transform hover:-translate-y-1 ${selectedCli === cli.id ? 'bg-[#b9ff3d] shadow-[4px_4px_0_#101313]' : 'bg-white/60'}`} aria-pressed={selectedCli === cli.id}><img src={cli.logo} alt="" className="size-9" /><span className="font-mono text-[11px] font-bold uppercase">{cli.name}</span></button>)}
              </div>
            ) : null}

            <div className="mt-10 flex items-center gap-3 border-t-2 border-[#101313] pt-5">
              {introStep === 0 ? <Button type="button" onClick={() => setIntroStep(1)} className="h-12 rounded-none border-2 border-[#101313] bg-[#101313] px-6 font-mono text-xs font-bold uppercase tracking-[0.12em] text-white shadow-[4px_4px_0_#16a6c8] hover:bg-[#101313]/90">Slide computer to continue</Button> : introStep === 1 ? <span className="font-mono text-xs font-bold uppercase">Click the glowing mouse to continue <span className="text-[#16a6c8]">●</span></span> : <span className="font-mono text-xs font-bold uppercase">Pairing station ready <span className="text-[#16a6c8]">●</span></span>}
              {introStep === 1 ? <button type="button" onClick={() => setIntroStep(0)} className="font-mono text-xs underline underline-offset-4">Back</button> : null}
            </div>
          </section>

          <section className="flex flex-col justify-center bg-[#d8d2c5] p-5 sm:p-10">
            <PixelComputer step={introStep} selectedCli={selectedCli} cliOptions={cliOptions} onSelectCli={setSelectedCli} onMouseClick={() => introStep === 1 && setIntroStep(2)} />
            {introStep === 3 ? <div className="mt-6 border-2 border-[#101313] bg-[#f3f0e8] p-4"><div className="mb-3 flex items-center justify-between"><span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">Pairing code</span><StatusBadge status={status} /></div><p className="font-mono text-3xl font-black tracking-[0.14em] sm:text-4xl">{session?.code || '————-————'}</p><p className="mt-2 font-mono text-[11px] leading-5">Run the command on your laptop. This code expires in 10 minutes.</p><button type="button" onClick={copyCommand} disabled={!command || privateOrigin} className="mt-3 inline-flex items-center gap-2 border-2 border-[#101313] bg-[#b9ff3d] px-3 py-2 font-mono text-[10px] font-bold uppercase shadow-[3px_3px_0_#101313] disabled:opacity-50">{copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}{copied ? 'Copied' : 'Copy command'}</button></div> : <div className="mt-6 grid grid-cols-3 gap-2 font-mono text-[10px] uppercase"><span className="border-2 border-[#101313] bg-[#f3f0e8] p-3">Private<br /><b>by default</b></span><span className="border-2 border-[#101313] bg-[#f3f0e8] p-3">Live<br /><b>terminal</b></span><span className="border-2 border-[#101313] bg-[#f3f0e8] p-3">Zero<br /><b>signup</b></span></div>}
          </section>
        </div>

        {introStep === 3 ? <section className="border-t-[3px] border-[#101313] bg-[#f3f0e8] p-5 sm:p-8"><div className="flex flex-col gap-4"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">Compatibility check</p><div className="grid gap-3 sm:grid-cols-3"><div className="border-2 border-[#101313] bg-white/60 p-3 font-mono text-xs"><b>01</b><br />Forge identifies the selected CLI by name.</div><div className="border-2 border-[#101313] bg-white/60 p-3 font-mono text-xs"><b>02</b><br />Your credentials stay on your laptop.</div><div className="border-2 border-[#101313] bg-white/60 p-3 font-mono text-xs"><b>03</b><br />Forge is independent, not endorsed.</div></div><label className="flex items-start gap-3 font-mono text-xs"><input type="checkbox" checked={reviewedCompatibility} onChange={(event) => setReviewedCompatibility(event.target.checked)} className="mt-0.5 size-4 accent-[#101313]" />I understand Forge only identifies compatible tools and does not represent, sponsor, or modify their brands.</label><Button type="button" disabled={!reviewedCompatibility} onClick={() => setIntroStep(3)} className="w-fit rounded-none border-2 border-[#101313] bg-[#101313] font-mono text-xs font-bold uppercase text-white shadow-[4px_4px_0_#16a6c8]">Continue to pairing</Button></div></section> : null}

        {introStep === 3 ? <section className="border-t-[3px] border-[#101313] bg-[#f3f0e8] p-5 sm:p-8"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">Install on laptop · {chosenCli.name} selected</p><p className="mt-2 font-mono text-xs text-black/60">{platform === 'windows' ? 'Windows Command Prompt' : 'macOS / Linux terminal'}</p></div><div className="flex gap-2"><Button size="sm" variant={platform === 'windows' ? 'secondary' : 'ghost'} onClick={() => setPlatform('windows')}>Windows</Button><Button size="sm" variant={platform === 'unix' ? 'secondary' : 'ghost'} onClick={() => setPlatform('unix')}>macOS / Linux</Button><Button size="sm" variant="outline" onClick={copyCommand} disabled={!command || privateOrigin}>{copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}{copied ? 'Copied' : 'Copy command'}</Button></div></div><pre className="mt-4 overflow-x-auto border-2 border-[#101313] bg-[#101313] p-4 font-mono text-[11px] leading-6 text-[#b9ff3d]"><code>{command || 'Creating pairing code...'}</code></pre>{privateOrigin ? <Alert variant="destructive" className="mt-4 rounded-none"><TriangleAlertIcon /><AlertTitle>Publish before installing</AlertTitle><AlertDescription>Laptop installers need a public HTTPS URL.</AlertDescription></Alert> : null}<div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="flex items-center gap-2 font-mono text-xs">{connected ? <><span className="size-2 rounded-full bg-[#b9ff3d] ring-2 ring-[#101313]" />{session?.hostname || 'Laptop online'}</> : status === 'claimed' ? <><Spinner />Starting bridge...</> : <><TerminalIcon className="size-4" />Waiting for laptop to claim code</>}</p>{connected ? <Button onClick={() => router.push('/console')} className="h-11 rounded-none border-2 border-[#101313] bg-[#b9ff3d] font-mono text-xs font-bold uppercase text-[#101313] shadow-[4px_4px_0_#101313]"><LaptopIcon data-icon="inline-start" />Open console</Button> : <Button variant="ghost" onClick={() => setIntroStep(1)}>Change CLI</Button>}</div>{status === 'error' ? <p className="mt-3 font-mono text-xs text-red-700">{error}</p> : null}</section> : null}
        <p className="forge-trademark-note px-5 py-3 sm:px-8">Forge is an independent compatibility interface. Product names and logos identify their respective tools only; no affiliation, sponsorship, or endorsement is implied. All marks belong to their respective owners.</p>
      </div>
    </main>
  )
}

function PixelComputer({ step, selectedCli, cliOptions, onSelectCli, onMouseClick }: { step: number; selectedCli: string; cliOptions: readonly { id: string; name: string; logo: string; tone: string }[]; onSelectCli: (id: string) => void; onMouseClick: () => void }) {
  return (
    <div className="pixel-stage" aria-label="Pixel art computer onboarding illustration">
      <div className="pixel-stars" aria-hidden="true">✦　·　✧　·　✦</div>
      <div className={`pixel-monitor ${step === 0 ? 'pixel-monitor-active' : ''}`}>
        <div className="pixel-screen">
          <div className="pixel-screen-grid" />
          {step === 0 ? <><div className="pixel-window"><span /> <span /> <span /></div><div className="pixel-prompt">CLICK TO BOOT_</div></> : step === 1 ? <><div className="pixel-terminal-line">CLICK A DRIVER</div><div className="pixel-logo-grid">{cliOptions.map((cli) => <button type="button" key={cli.id} onClick={() => onSelectCli(cli.id)} className={`pixel-logo-button ${selectedCli === cli.id ? 'pixel-logo-selected' : ''}`}><img src={cli.logo} alt="" /><small>{cli.name}</small></button>)}</div></> : step === 2 ? <><div className="pixel-terminal-line">CHECK BEFORE LINK</div><div className="pixel-cli-mark">{selectedCli.toUpperCase()}</div></> : <><div className="pixel-terminal-line">LINK READY</div><div className="pixel-code-line">{`> ${'pair --secure'}`}</div></>}
        </div>
        <div className="pixel-monitor-controls"><span /><span /><span /></div>
      </div>
      <div className="pixel-monitor-neck" />
      <div className="pixel-monitor-base" />
      <div className="pixel-keyboard"><span /><span /><span /><span /><span /><span /><span /><span /></div>
      <button type="button" onClick={onMouseClick} aria-label="Click glowing mouse to continue" className={`pixel-mouse ${step === 1 ? 'pixel-mouse-active' : ''}`}><span /></button>
      <p className="pixel-caption">{step === 0 ? 'click / slide computer to continue' : step === 1 ? 'choose the cli that lives on your machine' : 'click the mouse to open your secure link'}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: PairStatus }) {
  if (status === 'online') return <Badge>Connected</Badge>
  if (status === 'claimed') return <Badge variant="secondary">Claimed</Badge>
  if (status === 'expired') return <Badge variant="destructive">Expired</Badge>
  if (status === 'error') return <Badge variant="destructive">Error</Badge>
  return <Badge variant="secondary">Waiting</Badge>
}

function Step({ n, children, done, active, highlight }: { n: number; children: ReactNode; done?: boolean; active?: boolean; highlight?: boolean }) {
  return (
    <li className="flex items-start gap-3 border-l border-foreground/10 py-2.5 pl-4 first:pt-0 last:pb-0">
      <span className={done ? 'mt-0.5 flex size-5 items-center justify-center rounded-full bg-primary font-mono text-[10px] text-primary-foreground' : 'mt-0.5 flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground'}>
        {done ? <CheckIcon className="size-3" /> : n}
      </span>
      <span className={highlight && active && !done ? 'text-sm text-foreground' : 'text-sm text-muted-foreground'}>{children}</span>
    </li>
  )
}

function originHost(origin: string) {
  try {
    return new URL(origin).hostname
  } catch {
    return ''
  }
}

function isSessionExpired(session: PairSession) {
  if (!session.expiresAt) return false
  const expiresAt = Date.parse(session.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
}

function readSession(): PairSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as PairSession) : null
  } catch {
    localStorage.removeItem(SESSION_KEY)
    return null
  }
}

function writeSession(session: PairSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}
