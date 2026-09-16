import type { JobEvent } from '@/lib/daemon'

export function ConsoleTranscript({
  events,
  emptyHint,
}: {
  events: JobEvent[]
  emptyHint: string
}) {
  if (events.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <p className="max-w-md text-center text-sm leading-relaxed text-muted-foreground text-pretty">
          {emptyHint}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {events.map((event, index) => (
        <EventRow key={`${event.seq}-${event.kind}-${index}`} event={event} />
      ))}
    </div>
  )
}

function EventRow({ event }: { event: JobEvent }) {
  if (event.kind === 'user') {
    return (
      <article className="ml-auto w-full max-w-2xl rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
        <p className="mb-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">You</p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{event.text}</p>
      </article>
    )
  }

  if (event.kind === 'tool') {
    return (
      <article className="rounded-lg bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
        <span className="text-foreground">{event.name || 'tool'}</span>
        {event.detail ? <span>{`  ${event.detail}`}</span> : null}
      </article>
    )
  }

  if (event.kind === 'permission') {
    return (
      <article className="rounded-lg px-3 py-2 text-xs text-muted-foreground">
        Permission requested for {event.tool_name || 'a tool'}
        {event.detail ? ` — ${event.detail}` : ''}
      </article>
    )
  }

  if (event.kind === 'permission_resolved') {
    return (
      <article className="rounded-lg px-3 py-2 text-xs text-muted-foreground">
        Permission {event.allow ? 'allowed' : 'denied'}
      </article>
    )
  }

  if (event.kind === 'question') {
    return (
      <article className="rounded-lg px-3 py-2 text-xs text-muted-foreground">
        Agent asked a question
      </article>
    )
  }

  if (event.kind === 'error') {
    return (
      <article className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {event.text || 'The agent reported an error.'}
      </article>
    )
  }

  if (event.kind === 'init') {
    return (
      <article className="font-mono text-[11px] text-muted-foreground">
        Session started
      </article>
    )
  }

  if (event.kind === 'result') {
    return event.text ? (
      <article className="whitespace-pre-wrap text-sm leading-relaxed">{event.text}</article>
    ) : null
  }

  if (event.text) {
    return (
      <article className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed">{event.text}</article>
    )
  }

  return null
}
