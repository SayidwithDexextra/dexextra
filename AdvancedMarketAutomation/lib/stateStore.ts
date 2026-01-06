import fs from 'node:fs';
import path from 'node:path';

export type WalletRole = 'MAKER' | 'TAKER';

export type MarketRef = {
  symbol: string;
  market_identifier?: string;
  market_address: string; // orderBook/diamond
  market_id_bytes32: string;
  chain_id: number;
  tick_size?: number | null;
};

export type RunConfig = {
  makerRatio: number;
  maxOpenOrdersPerMaker: number;
  minDelayMs: number;
  maxDelayMs: number;
  sizeMin: number;
  sizeMax: number;
  mode: 'MEAN' | 'UP' | 'DOWN';
};

export type WalletCheckpoint = {
  nickname: string;
  role: WalletRole;
  sessionId?: string;
  sessionExpiry?: number;
  lastActionAt?: number;
};

export type MarketCheckpoint = {
  version: number;
  chainId: number;
  orderBook: string;
  market: MarketRef;
  run: { runId: string; startedAt: string; updatedAt: string };
  config: RunConfig;
  wallets: Record<string, WalletCheckpoint>; // addressLower -> checkpoint
};

export type ActionLogLine = {
  ts: number;
  runId: string;
  chainId: number;
  orderBook: string;
  marketIdBytes32: string;
  trader: string;
  nickname?: string;
  role?: WalletRole;
  action:
    | 'SESSION_INIT'
    | 'PLACE_LIMIT'
    | 'PLACE_MARKET'
    | 'CANCEL_ORDER'
    | 'MODIFY_ORDER'
    | 'SKIP'
    | 'ERROR';
  params?: any;
  txHash?: string;
  error?: string;
};

function safeMkdirp(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(filePath: string, obj: any) {
  const dir = path.dirname(filePath);
  safeMkdirp(dir);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export class AmaStateStore {
  readonly baseDir: string;

  constructor(baseDir = path.resolve(process.cwd(), 'AdvancedMarketAutomation', 'state')) {
    this.baseDir = baseDir;
  }

  marketDir(chainId: number, orderBook: string): string {
    return path.join(this.baseDir, String(chainId), orderBook.toLowerCase());
  }

  checkpointPath(chainId: number, orderBook: string): string {
    return path.join(this.marketDir(chainId, orderBook), 'checkpoint.json');
  }

  actionsPath(chainId: number, orderBook: string): string {
    return path.join(this.marketDir(chainId, orderBook), 'actions.jsonl');
  }

  walletPath(chainId: number, orderBook: string, trader: string): string {
    return path.join(this.marketDir(chainId, orderBook), 'wallets', `${trader.toLowerCase()}.json`);
  }

  loadCheckpoint(chainId: number, orderBook: string): MarketCheckpoint | null {
    const p = this.checkpointPath(chainId, orderBook);
    try {
      const txt = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(txt);
      return parsed as MarketCheckpoint;
    } catch {
      return null;
    }
  }

  saveCheckpoint(cp: MarketCheckpoint) {
    const p = this.checkpointPath(cp.chainId, cp.orderBook);
    atomicWriteJson(p, cp);
  }

  loadWallet(chainId: number, orderBook: string, trader: string): WalletCheckpoint | null {
    const p = this.walletPath(chainId, orderBook, trader);
    try {
      const txt = fs.readFileSync(p, 'utf8');
      return JSON.parse(txt) as WalletCheckpoint;
    } catch {
      return null;
    }
  }

  saveWallet(chainId: number, orderBook: string, trader: string, w: WalletCheckpoint) {
    const p = this.walletPath(chainId, orderBook, trader);
    atomicWriteJson(p, w);
  }

  appendAction(line: ActionLogLine) {
    const p = this.actionsPath(line.chainId, line.orderBook);
    safeMkdirp(path.dirname(p));
    fs.appendFileSync(p, JSON.stringify(line) + '\n', { encoding: 'utf8', mode: 0o600 });
  }

  readActions(chainId: number, orderBook: string, maxLines = 20000): ActionLogLine[] {
    const p = this.actionsPath(chainId, orderBook);
    try {
      const txt = fs.readFileSync(p, 'utf8');
      const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const slice = lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
      return slice.map((l) => JSON.parse(l)) as ActionLogLine[];
    } catch {
      return [];
    }
  }
}




