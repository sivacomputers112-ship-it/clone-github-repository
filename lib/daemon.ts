export type AuthHealth = {
  cli?: string
  cli_on_path?: boolean
  mode?: string
  status?: string
  detail?: string
  by_provider?: Record<string, AuthHealth>
}

export type PingResponse = {
  ok?: boolean
  host?: string
  provider?: string
  providers?: string[]
  multi?: boolean
  caps?: Record<string, boolean | string | number>
  auth?: AuthHealth
  provider_details?: Record<string, { auth?: AuthHealth }>
}

export type Project = {
  id: string
  cwd: string
  name: string
  session_count?: number
}

export type DaemonSession = {
  id: string
  title?: string
  cwd?: string
  provider?: string
}

export type QuestionOption = {
  label?: string
  description?: string
}

export type DaemonQuestion = {
  header?: string
  question?: string
  prompt?: string
  options?: Array<QuestionOption | string>
  multiSelect?: boolean
  multi_select?: boolean
}

export type JobEvent = {
  seq: number
  kind: string
  text?: string
  name?: string
  detail?: string
  tool_name?: string
  request_id?: string
  questions?: DaemonQuestion[]
  allow?: boolean
  cancelled?: boolean
}

export type PendingPermission = {
  request_id: string
  tool_name?: string
  detail?: string
}

export type PendingQuestion = {
  request_id: string
  questions?: DaemonQuestion[]
}

export type JobSnapshot = {
  id: string
  session_id?: string
  new_session_id?: string
  status: string
  error?: string
  result_text?: string
  pending_permission?: PendingPermission | null
  pending_question?: PendingQuestion | null
  next_seq: number
  events: JobEvent[]
}

export const PERMISSION_MODES = [
  { id: 'bypassPermissions', label: 'Full access' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan' },
  { id: '', label: 'Ask each time' },
] as const

export function jobIsActive(status?: string) {
  return status === 'starting' || status === 'running'
}

export function questionLabel(question: DaemonQuestion) {
  return question.header || question.question || question.prompt || 'Question'
}

export function optionLabel(option: QuestionOption | string) {
  return typeof option === 'string' ? option : option.label || 'Option'
}

export function pingProviders(ping: PingResponse | null) {
  if (ping?.providers?.length) return ping.providers
  return ping?.provider ? [ping.provider] : []
}

export function providerAuth(ping: PingResponse | null, name: string): AuthHealth | undefined {
  return ping?.provider_details?.[name]?.auth || (ping?.auth?.cli === name ? ping.auth : ping?.auth)
}

export function readyProviders(ping: PingResponse | null) {
  const names = pingProviders(ping)
  const preferred = ['antigravity', 'claude', 'cursor', 'codex', 'grok']
  const ordered = [
    ...preferred.filter((name) => names.includes(name)),
    ...names.filter((name) => !preferred.includes(name)),
  ]
  const installed = ordered.filter((name) => {
    const auth = providerAuth(ping, name)
    return !auth || auth.cli_on_path !== false
  })
  return installed.length ? installed : ordered
}

export function pickReadyProvider(ping: PingResponse | null) {
  const names = readyProviders(ping)
  const ready = names.find((name) => providerAuth(ping, name)?.status === 'ok')
  return ready || names[0] || ''
}

export function providerLabel(name: string) {
  if (name === 'claude') return 'Claude Code'
  if (name === 'cursor' || name === 'agent') return 'Cursor'
  if (name === 'antigravity' || name === 'agy') return 'Antigravity'
  if (name === 'codex') return 'Codex'
  if (name === 'grok') return 'Grok'
  return name
}

export function cliLoginCommand(name: string) {
  if (name === 'cursor' || name === 'agent') return 'agent login'
  if (name === 'antigravity' || name === 'agy') return 'agy'
  if (name === 'codex') return 'codex login'
  if (name === 'grok') return 'grok auth login'
  return 'claude login'
}

export function cliSetupMessage(ping: PingResponse | null, provider: string) {
  const auth = providerAuth(ping, provider) || ping?.auth
  if (!auth) return ''
  const cli = auth.cli || provider || 'claude'
  const login = cliLoginCommand(cli)
  if (auth.status === 'ok') return ''
  if (!auth.cli_on_path) {
    return `${providerLabel(cli)} is not installed on this laptop. Re-run the Forge install command, or install the CLI and run \`${login}\` in Command Prompt.`
  }
  if (auth.status === 'missing' || auth.status === 'expired') {
    return `On the laptop, open Command Prompt and run \`${login}\`. Then send a prompt here.`
  }
  return auth.detail || ''
}
