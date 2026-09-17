import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'

const FILES: Record<string, string> = {
  'cli_launch.py': 'cli_launch.py',
  'cursor.py': 'cursor.py',
  'antigravity.py': 'antigravity.py',
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params
  const file = FILES[name]
  if (!file) {
    return new Response('not found', { status: 404 })
  }
  const body = await readFile(join(process.cwd(), 'public', 'forge', file), 'utf8')
  return new Response(body, {
    headers: {
      'Content-Type': 'text/x-python; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
