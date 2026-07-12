/**
 * Pinata IPFS pinning provider.
 *
 * Thin wrapper around Pinata's pinning API so the rest of the app depends on
 * a small, swappable surface (pinJson / pinBytes / fetchFromGateway) rather
 * than Pinata directly. To move to another provider later, reimplement these
 * three functions.
 *
 * Manifests are pinned as FILES containing canonical JSON (not via
 * pinJSONToIPFS) so the bytes served by the gateway are exactly the bytes we
 * hashed, enabling an independent sha256 integrity check on top of the CID.
 *
 * Env:
 *   PINATA_JWT       - required for pinning (server-side only, never public)
 *   PINATA_GATEWAY   - optional gateway base (default https://gateway.pinata.cloud)
 */

import crypto from 'crypto';

const PINATA_PIN_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const DEFAULT_GATEWAY = 'https://gateway.pinata.cloud';

export interface PinResult {
  /** IPFS CID returned by Pinata (CIDv1 or v0 depending on account settings). */
  cid: string;
  /** Canonical ipfs:// URI. */
  uri: string;
  /** Size in bytes of the pinned payload. */
  size: number;
  /** sha256 (hex) of the exact bytes pinned, for independent integrity checks. */
  sha256: string;
}

function getJwt(): string {
  const jwt = process.env.PINATA_JWT || '';
  if (!jwt) {
    throw new Error(
      'Pinata not configured: set PINATA_JWT (server-side) to pin market manifests.',
    );
  }
  return jwt;
}

export function getGatewayBase(): string {
  return (process.env.PINATA_GATEWAY || DEFAULT_GATEWAY).replace(/\/+$/, '');
}

export function sha256Hex(data: string | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Normalize an ipfs:// URI or bare CID into a gateway HTTP URL. */
export function toGatewayUrl(cidOrUri: string, gatewayBase = getGatewayBase()): string {
  const cid = cidFromUri(cidOrUri);
  return `${gatewayBase}/ipfs/${cid}`;
}

/** Extract the bare CID from an ipfs:// URI, gateway URL, or bare CID. */
export function cidFromUri(cidOrUri: string): string {
  if (!cidOrUri) throw new Error('cidFromUri: empty input');
  let s = cidOrUri.trim();
  if (s.startsWith('ipfs://')) s = s.slice('ipfs://'.length);
  // Strip any gateway prefix like https://host/ipfs/<cid>
  const ipfsIdx = s.indexOf('/ipfs/');
  if (ipfsIdx !== -1) s = s.slice(ipfsIdx + '/ipfs/'.length);
  // Drop any trailing path/query
  s = s.split(/[?#]/)[0].replace(/\/+$/, '');
  s = s.split('/')[0];
  return s;
}

export function isIpfsUri(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('ipfs://') || url.includes('/ipfs/');
}

/**
 * Pin a JSON-serializable object as a canonical-JSON file.
 * Returns the CID plus the sha256 of the exact bytes pinned.
 */
export async function pinJson(
  value: unknown,
  opts: { name?: string; canonicalJson?: string } = {},
): Promise<PinResult> {
  const json = opts.canonicalJson ?? JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  const name = opts.name || 'manifest.json';
  return pinBytes(bytes, { name, contentType: 'application/json' });
}

/**
 * Pin raw bytes (e.g. an evidence screenshot) to IPFS.
 */
export async function pinBytes(
  bytes: Uint8Array,
  opts: { name: string; contentType?: string },
): Promise<PinResult> {
  const jwt = getJwt();
  const form = new FormData();
  const blob = new Blob([bytes], { type: opts.contentType || 'application/octet-stream' });
  form.append('file', blob, opts.name);
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
  form.append('pinataMetadata', JSON.stringify({ name: opts.name }));

  const res = await fetch(PINATA_PIN_FILE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pinata pin failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as { IpfsHash?: string; PinSize?: number };
  if (!data?.IpfsHash) {
    throw new Error('Pinata pin failed: no IpfsHash in response');
  }

  const cid = data.IpfsHash;
  return {
    cid,
    uri: `ipfs://${cid}`,
    size: typeof data.PinSize === 'number' ? data.PinSize : bytes.byteLength,
    sha256: sha256Hex(bytes),
  };
}

/**
 * Fetch content bytes from an IPFS gateway by CID or ipfs:// URI.
 */
export async function fetchFromGateway(
  cidOrUri: string,
  opts: { timeoutMs?: number; gatewayBase?: string } = {},
): Promise<Uint8Array> {
  const url = toGatewayUrl(cidOrUri, opts.gatewayBase);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`IPFS gateway fetch failed (${res.status}) for ${url}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and parse a JSON document from IPFS.
 */
export async function fetchJsonFromGateway<T = unknown>(
  cidOrUri: string,
  opts: { timeoutMs?: number; gatewayBase?: string; expectedSha256?: string } = {},
): Promise<T> {
  const bytes = await fetchFromGateway(cidOrUri, opts);
  if (opts.expectedSha256) {
    const got = sha256Hex(bytes);
    if (got !== opts.expectedSha256) {
      throw new Error(
        `IPFS content integrity check failed: expected sha256 ${opts.expectedSha256}, got ${got}`,
      );
    }
  }
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}
