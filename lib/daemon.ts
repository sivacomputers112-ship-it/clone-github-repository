export type PingResponse = {
  ok?: boolean
  host?: string
  provider?: string
  providers?: string[]
  multi?: boolean
  caps?: Record<string, boolean | string | number>
  auth?: { status?: string; detail?: string; cli?: string }
  provider_details?: Record<string, { auth?: { status?: string; detail?: string } }>
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
  { id: '', label: 'Default' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan' },
  { id: 'bypassPermissions', label: 'Bypass' },
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
