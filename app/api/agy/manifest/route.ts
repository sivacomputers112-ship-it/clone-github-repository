const UPDATER = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app'

const ALLOWED = new Set([
  'windows_amd64',
  'windows_arm64',
  'darwin_amd64',
  'darwin_arm64',
  'linux_amd64',
  'linux_arm64',
  'linux_amd64_musl',
  'linux_arm64_musl',
])

const WINDOWS_AMD64_FALLBACK = {
  version: '1.2.4',
  url: 'https://storage.googleapis.com/antigravity-public/antigravity-cli/1.2.4-6085322963025920/windows-x64/cli_windows_x64.exe',
  sha512:
    '6f72c8b5f4dde4ae098b8818967043a8bcf1f3f1904a19d9d10e9496c95637a3fa8f3a7f6f04ce9627440df0a63e7ed26e5c54f82597ea874c5de24231942165',
}

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const platform = new URL(request.url).searchParams.get('platform') || 'windows_amd64'
  if (!ALLOWED.has(platform)) {
    return Response.json({ error: 'unsupported platform' }, { status: 400 })
  }
  try {
    const response = await fetch(`${UPDATER}/manifests/${platform}.json`, {
      headers: { 'User-Agent': 'forge-installer/1.0' },
      cache: 'no-store',
    })
    if (response.ok) {
      const data = await response.json()
      if (data?.url) {
        return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
      }
    }
  } catch {
    // The laptop often cannot resolve Google's Cloud Run updater. Serve a
    // known GCS binary URL so install can continue.
  }
  if (platform === 'windows_amd64') {
    return Response.json(WINDOWS_AMD64_FALLBACK, { headers: { 'Cache-Control': 'no-store' } })
  }
  return Response.json({ error: 'manifest unavailable' }, { status: 502 })
}
