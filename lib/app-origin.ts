export const PUBLISHED_APP_ORIGIN = 'https://clone-github-repository-olive.vercel.app'

export function configuredAppOrigin() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    PUBLISHED_APP_ORIGIN
  ).replace(/\/+$/, '')
}

export function isPrivateHost(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.v0.build') ||
    hostname.endsWith('.v0.app') ||
    hostname.endsWith('.vercel.run')
  )
}

export function publicAppOrigin(request: Request) {
  const configured = configuredAppOrigin()
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host') ||
    new URL(request.url).host
  const hostname = host.split(':')[0] || ''
  if (isPrivateHost(hostname)) return configured
  return `${proto}://${host}`
}
