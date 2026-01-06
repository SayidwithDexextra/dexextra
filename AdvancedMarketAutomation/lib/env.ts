import fs from 'node:fs';
import path from 'node:path';

export type AmaEnv = {
  appUrl: string;
  rpcUrl: string;
  sessionRegistryAddress: string;
  chainId: number;
};

function readEnvVarFromFile(varName: string, filePath: string): string {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const re = new RegExp(`^\\s*${varName}\\s*=\\s*(.*)\\s*$`, 'm');
    const m = txt.match(re);
    if (!m) return '';
    let v = String(m[1] ?? '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v.trim();
  } catch {
    return '';
  }
}

function loadDotEnvPreferred() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dotenv = require('dotenv');
    const candidates = [
      path.resolve(process.cwd(), '.env.local'),
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), '..', '.env.local'),
      path.resolve(process.cwd(), '..', '.env'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: true });
        break;
      }
    }
  } catch {
    // ignore
  }
}

function fallbackReadEnv(vars: string[]) {
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env.local'),
    path.resolve(process.cwd(), '..', '.env'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    for (const v of vars) {
      if (process.env[v] && process.env[v]!.trim() !== '') continue;
      const read = readEnvVarFromFile(v, p);
      if (read) process.env[v] = read;
    }
  }
}

function requireHexAddress(name: string, v: string | undefined): string {
  const s = String(v || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) {
    throw new Error(`Missing/invalid ${name}. Expected 0x-address, got: ${s || '(unset)'}`);
  }
  return s;
}

export function loadAmaEnv(): AmaEnv {
  loadDotEnvPreferred();
  fallbackReadEnv([
    'APP_URL',
    'RPC_URL',
    'RPC_URL_HYPEREVM',
    'SESSION_REGISTRY_ADDRESS',
    'CHAIN_ID',
    'NEXT_PUBLIC_CHAIN_ID',
  ]);

  const appUrl = (process.env.APP_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
  const rpcUrl = (process.env.RPC_URL || process.env.RPC_URL_HYPEREVM || '').trim();
  if (!rpcUrl) throw new Error('Missing RPC_URL (or RPC_URL_HYPEREVM) in env');

  const sessionRegistryAddress = requireHexAddress(
    'SESSION_REGISTRY_ADDRESS',
    process.env.SESSION_REGISTRY_ADDRESS
  );

  const chainIdRaw = (process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || '').trim();
  const chainId = Number(chainIdRaw || 0);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error(`Missing/invalid CHAIN_ID (or NEXT_PUBLIC_CHAIN_ID). Got: ${chainIdRaw || '(unset)'}`);
  }

  return { appUrl, rpcUrl, sessionRegistryAddress, chainId };
}





