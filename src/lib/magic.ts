import { Magic } from 'magic-sdk'
import { OAuthExtension } from '@magic-ext/oauth2'
import { EVMExtension } from '@magic-ext/evm'
import { env } from './env'

let magicInstance: InstanceType<typeof Magic> | null = null
let magicConfigSig: string | null = null

// Blockade: when an external (non-Magic) wallet is connected, prevent automatic
// Magic SDK initialization so its iframe never loads and no login UI can appear.
let _magicAutoInitBlocked = false

export function blockMagicAutoInit(): void {
  _magicAutoInitBlocked = true
}

export function unblockMagicAutoInit(): void {
  _magicAutoInitBlocked = false
}

export function isMagicAutoInitBlocked(): boolean {
  return _magicAutoInitBlocked
}

// IMPORTANT:
// Magic runs parts of its provider in an embedded context (iframe/popup).
// That context can enforce a CSP which blocks `http://localhost:*` RPC URLs.
// So for Magic we MUST default to an https RPC, not a local proxy.
const FALLBACK_ARBITRUM_RPCS = [
  'https://rpc.ankr.com/arbitrum',
  'https://arbitrum-one-rpc.publicnode.com',
  'https://arb1.arbitrum.io/rpc',
] as const

const MAGIC_ARB_RPC_OVERRIDE_KEY = 'magic:arbRpcOverride'

function isSafeHttpsRpc(url: string): boolean {
  return /^https:\/\//i.test(url) && !/localhost|127\.0\.0\.1/i.test(url)
}

function getClientRpcOverride(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(MAGIC_ARB_RPC_OVERRIDE_KEY)
    if (v && isSafeHttpsRpc(v)) return v
  } catch {
    // ignore
  }
  return null
}

function setClientRpcOverride(url: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (!url) window.localStorage.removeItem(MAGIC_ARB_RPC_OVERRIDE_KEY)
    else window.localStorage.setItem(MAGIC_ARB_RPC_OVERRIDE_KEY, url)
  } catch {
    // ignore
  }
}

function rotateClientRpcOverride(): string {
  const current = getClientRpcOverride()
  const list = [...FALLBACK_ARBITRUM_RPCS]
  const idx = current ? list.indexOf(current as any) : -1
  const next = list[(idx + 1) % list.length]
  setClientRpcOverride(next)
  return next
}

function getArbitrumRpcUrlForMagic(): string {
  // On the client, only NEXT_PUBLIC_* vars are available. If none is provided,
  // fall back to a public https RPC known to work cross-origin.
  const envUrl = env.NEXT_PUBLIC_ARBITRUM_RPC_URL || env.ARBITRUM_RPC_URL
  if (envUrl && isSafeHttpsRpc(envUrl)) return envUrl

  const override = getClientRpcOverride()
  if (override) return override

  return FALLBACK_ARBITRUM_RPCS[0]
}

export function resetMagic(): void {
  magicInstance = null
  magicConfigSig = null
}

export function hasMagicPublishableKey(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY)
}

export function getMagic(): InstanceType<typeof Magic> {
  const key = process.env.NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY
  if (!key) {
    throw new Error('NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY is not set')
  }

  const arbitrumRpcUrl = getArbitrumRpcUrlForMagic()
  const hlChainId = env.CHAIN_ID
  const hlRpcUrl = isSafeHttpsRpc(env.RPC_URL) ? env.RPC_URL : null
  const sig = `${key}|arb:${arbitrumRpcUrl}|hl:${hlChainId}:${hlRpcUrl || 'none'}`
  if (magicInstance && magicConfigSig === sig) return magicInstance

  // Avoid stale instances across Next.js HMR / hot reloads.
  magicConfigSig = sig
  try {
    if (typeof window !== 'undefined') {
      console.log('[Magic] Initializing with Arbitrum rpcUrl:', arbitrumRpcUrl)
    }
  } catch {
    // ignore
  }
  magicInstance = new Magic(key, {
    deferPreload: true,
    extensions: [
      new OAuthExtension(),
      new EVMExtension([
        ...(hlRpcUrl ? [{ rpcUrl: hlRpcUrl, chainId: hlChainId, default: true }] : []),
        { rpcUrl: arbitrumRpcUrl, chainId: 42161, default: !hlRpcUrl },
      ]),
    ],
  })

  return magicInstance
}

export async function loginWithGoogle() {
  const magic = getMagic()
  const result = await (magic.oauth2 as OAuthExtension).loginWithPopup({
    provider: 'google',
    scope: ['openid', 'profile', 'email'],
  })
  return result
}

export async function getMagicUserAddress(): Promise<string | null> {
  if (_magicAutoInitBlocked) return null
  const magic = getMagic()
  const isLoggedIn = await magic.user.isLoggedIn()
  if (!isLoggedIn) return null

  const metadata = await magic.user.getInfo()
  return metadata.publicAddress ?? null
}

export async function logoutMagic(): Promise<void> {
  const magic = getMagic()
  const isLoggedIn = await magic.user.isLoggedIn()
  if (isLoggedIn) {
    await magic.user.logout()
  }
}

export function getMagicProvider() {
  const magic = getMagic()
  return magic.rpcProvider as unknown as {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
    on: (event: string, callback: (...args: unknown[]) => void) => void
    removeListener: (event: string, callback: (...args: unknown[]) => void) => void
  }
}

export async function magicRequestWithRetry<T = unknown>(
  args: { method: string; params?: unknown[] },
  opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const retries = Math.max(0, opts.retries ?? 2)
  const baseDelayMs = Math.max(50, opts.baseDelayMs ?? 250)

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const provider = getMagicProvider()
      return (await provider.request(args)) as T
    } catch (e) {
      lastErr = e
      const msg = String((e as any)?.message || '')
      const isFetchy = msg.toLowerCase().includes('failed to fetch')
      if (!isFetchy || attempt === retries) break
      // If we got here due to a stale cached instance/config OR a blocked RPC,
      // rotate the RPC (unless user explicitly configured one) and retry.
      if (attempt === 0) {
        const envUrl = env.NEXT_PUBLIC_ARBITRUM_RPC_URL || env.ARBITRUM_RPC_URL
        if (!envUrl) {
          const next = rotateClientRpcOverride()
          try {
            console.warn('[Magic] RPC fetch failed; rotating Arbitrum rpcUrl to:', next)
          } catch {}
        }
        resetMagic()
      }
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)))
    }
  }
  throw lastErr
}

export async function switchMagicChain(chainId: number): Promise<void> {
  const magic = getMagic() as unknown as InstanceType<typeof Magic> & {
    evm?: { switchChain?: (id: number) => Promise<void> }
  }

  if (!magic.evm?.switchChain) {
    throw new Error('Magic EVM chain switching is not available')
  }

  await magic.evm.switchChain(chainId)
}

export async function switchMagicChainWithRetry(
  chainId: number,
  opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<void> {
  const retries = Math.max(0, opts.retries ?? 2)
  const baseDelayMs = Math.max(50, opts.baseDelayMs ?? 250)
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await switchMagicChain(chainId)
      return
    } catch (e) {
      lastErr = e
      const msg = String((e as any)?.message || '')
      const isFetchy = msg.toLowerCase().includes('failed to fetch')
      if (!isFetchy || attempt === retries) break
      if (attempt === 0) {
        const envUrl = env.NEXT_PUBLIC_ARBITRUM_RPC_URL || env.ARBITRUM_RPC_URL
        if (!envUrl) {
          const next = rotateClientRpcOverride()
          try {
            console.warn('[Magic] switchChain fetch failed; rotating Arbitrum rpcUrl to:', next)
          } catch {}
        }
        resetMagic()
      }
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)))
    }
  }
  throw lastErr
}

/**
 * DOM-level safety net: watches for Magic's iframe overlay and hides it
 * immediately when an external wallet is connected. Returns a cleanup function.
 */
export function suppressMagicUIOverlay(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  const hideIfBlocked = (node: Node) => {
    if (!(node instanceof HTMLElement)) return
    const isIframe = node.tagName === 'IFRAME'
    const src = (node as HTMLIFrameElement).src || ''
    const isMagicFrame =
      isIframe && (src.includes('auth.magic.link') || src.includes('fortmatic.com'))
    const hasMagicAttr =
      node.id?.toLowerCase().includes('magic') ||
      node.className?.toString().toLowerCase().includes('magic')

    if (isMagicFrame || hasMagicAttr) {
      if (_magicAutoInitBlocked) {
        ;(node as HTMLElement).style.display = 'none'
        ;(node as HTMLElement).style.visibility = 'hidden'
        ;(node as HTMLElement).style.pointerEvents = 'none'
      }
    }

    // Magic wraps its UI in a full-screen container div
    if (node.parentElement && _magicAutoInitBlocked) {
      const parent = node.parentElement
      const pId = parent.id?.toLowerCase() || ''
      const pClass = parent.className?.toString().toLowerCase() || ''
      if (pId.includes('magic') || pClass.includes('magic')) {
        parent.style.display = 'none'
        parent.style.visibility = 'hidden'
      }
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        hideIfBlocked(node)
        if (node instanceof HTMLElement) {
          node.querySelectorAll('iframe').forEach(hideIfBlocked)
        }
      }
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}

export function isMagicSelectedWallet(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem('walletProvider') === 'magic'
  } catch {
    return false
  }
}

export async function showMagicWalletUI(): Promise<{ success: boolean; error?: string }> {
  try {
    const magic: any = getMagic() as any
    if (magic?.wallet?.showUI && typeof magic.wallet.showUI === 'function') {
      await magic.wallet.showUI()
      return { success: true }
    }
    // Fallback: open Magic account settings if wallet UI is unavailable.
    if (magic?.user?.showSettings && typeof magic.user.showSettings === 'function') {
      await magic.user.showSettings()
      return { success: true }
    }
    return { success: false, error: 'Magic wallet UI is not available in this build.' }
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to open Magic wallet UI.' }
  }
}
