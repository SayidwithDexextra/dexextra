// EIP-6963: Multi Injected Provider Discovery
// Lets dapps enumerate multiple injected wallets safely (no "window.ethereum" race).

export type Eip6963ProviderInfo = {
  uuid: string
  name: string
  icon: string
  rdns: string
}

export type Eip6963ProviderDetail<TProvider = unknown> = {
  info: Eip6963ProviderInfo
  provider: TProvider
}

type AnnounceEvent = CustomEvent<Eip6963ProviderDetail>

const discoveredByUuid = new Map<string, Eip6963ProviderDetail>()
let discoveryStarted = false

function isValidInfo(info: any): info is Eip6963ProviderInfo {
  return (
    !!info &&
    typeof info === 'object' &&
    typeof info.uuid === 'string' &&
    typeof info.name === 'string' &&
    typeof info.icon === 'string' &&
    typeof info.rdns === 'string' &&
    info.uuid.length > 0 &&
    info.name.length > 0
  )
}

function isValidDetail(detail: any): detail is Eip6963ProviderDetail {
  return (
    !!detail &&
    typeof detail === 'object' &&
    isValidInfo(detail.info) &&
    !!detail.provider &&
    typeof detail.provider === 'object'
  )
}

export function startEip6963Discovery(): void {
  if (discoveryStarted) return
  if (typeof window === 'undefined') return

  discoveryStarted = true

  const onAnnounce = (event: Event) => {
    const detail = (event as AnnounceEvent)?.detail
    if (!isValidDetail(detail)) return
    discoveredByUuid.set(detail.info.uuid, detail)
  }

  window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener)

  // Ask providers to announce themselves now and after short delays to catch
  // slower-initializing extensions.
  const request = () => {
    try {
      window.dispatchEvent(new Event('eip6963:requestProvider'))
    } catch {
      // ignore
    }
  }

  request()
  setTimeout(request, 250)
  setTimeout(request, 1000)
}

export function getEip6963Providers(): Eip6963ProviderDetail[] {
  if (typeof window === 'undefined') return []
  startEip6963Discovery()
  return Array.from(discoveredByUuid.values())
}

export function getEip6963ProviderByUuid(uuid: string): Eip6963ProviderDetail | null {
  if (typeof window === 'undefined') return null
  startEip6963Discovery()
  return discoveredByUuid.get(uuid) ?? null
}

