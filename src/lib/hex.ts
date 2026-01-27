export function normalizeBytes32Hex(value?: string | null): string {
  try {
    const raw = String(value || '').trim().toLowerCase()
    if (!raw) return ''

    const without0x = raw.startsWith('0x') ? raw.slice(2) : raw
    const cleaned = without0x.replace(/[^0-9a-f]/g, '')
    if (!cleaned) return ''

    // Ensure 32-byte hex string: 0x + 64 hex chars
    return `0x${cleaned.padStart(64, '0').slice(-64)}`
  } catch {
    return ''
  }
}

