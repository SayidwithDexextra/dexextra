import fs from 'node:fs';

export type WalletRow = {
  nickname: string;
  address: string;
  privateKey: string;
};

function isHexAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function isHexPrivateKey(pk: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(pk);
}

// Minimal CSV row parser that supports quoted fields and commas inside quotes.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = '';
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseWalletCsv(csvText: string): WalletRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('nickname') && header.includes('address') && header.includes('privatekey');
  const start = hasHeader ? 1 : 0;

  const wallets: WalletRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    const nickname = String(parts[0] ?? '').trim();
    const address = String(parts[1] ?? '').trim();
    const privateKey = String(parts[2] ?? '').trim();
    if (!isHexAddress(address) || !isHexPrivateKey(privateKey)) continue;
    wallets.push({ nickname, address, privateKey });
  }
  return wallets;
}

export function loadWalletsFromCsvFile(csvPath: string): WalletRow[] {
  const txt = fs.readFileSync(csvPath, 'utf8');
  const wallets = parseWalletCsv(txt);
  if (wallets.length === 0) {
    throw new Error(`No valid wallets found in CSV: ${csvPath}`);
  }
  return wallets;
}





