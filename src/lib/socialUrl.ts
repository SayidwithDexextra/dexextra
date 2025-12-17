export type SocialPlatform = 'instagram' | 'facebook'

function coerceString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.trim()
}

function stripLeadingAt(handle: string) {
  return handle.startsWith('@') ? handle.slice(1) : handle
}

function isLikelyHandle(value: string) {
  // No scheme, no slashes, no whitespace
  if (/\s/.test(value)) return false
  if (value.includes('/')) return false
  if (value.includes('://')) return false
  return value.length > 0
}

function ensureHttps(url: string) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `https://${url}`
}

function firstPathSegment(url: URL): string | null {
  const seg = url.pathname.split('/').filter(Boolean)[0]
  return seg || null
}

export function normalizeSocialUrlInput(
  platform: SocialPlatform,
  value: unknown
): string | undefined | null {
  const raw = coerceString(value)
  if (raw === null) return null
  if (raw === '') return undefined

  if (platform === 'instagram') {
    const reserved = new Set(['p', 'reel', 'tv', 'stories', 'explore'])

    // Handle-only input
    if (raw.startsWith('@') || isLikelyHandle(raw)) {
      const handle = stripLeadingAt(raw)
      if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return null
      return `https://www.instagram.com/${handle}/`
    }

    // URL input (or something close to it)
    try {
      const url = new URL(ensureHttps(raw))
      if (!/instagram\.com$/i.test(url.hostname) && !/\.instagram\.com$/i.test(url.hostname)) return null
      const seg = firstPathSegment(url)
      if (!seg || reserved.has(seg)) return null
      if (!/^[A-Za-z0-9._]{1,30}$/.test(seg)) return null
      return `https://www.instagram.com/${seg}/`
    } catch {
      return null
    }
  }

  if (platform === 'facebook') {
    // Handle-only input
    if (raw.startsWith('@') || isLikelyHandle(raw)) {
      const handle = stripLeadingAt(raw)
      // Facebook page/usernames can contain dots; avoid spaces and slashes already filtered
      if (!/^[A-Za-z0-9.]{3,50}$/.test(handle)) return null
      return `https://www.facebook.com/${handle}`
    }

    // URL input
    try {
      const url = new URL(ensureHttps(raw))
      if (!/facebook\.com$/i.test(url.hostname) && !/\.facebook\.com$/i.test(url.hostname)) return null

      // Support profile.php?id=...
      const seg = firstPathSegment(url)
      if (seg === 'profile.php') {
        const id = url.searchParams.get('id')
        if (!id || !/^\d+$/.test(id)) return null
        return `https://www.facebook.com/profile.php?id=${id}`
      }

      if (!seg) return null
      if (!/^[A-Za-z0-9.]{3,50}$/.test(seg)) return null
      return `https://www.facebook.com/${seg}`
    } catch {
      return null
    }
  }

  return null
}




