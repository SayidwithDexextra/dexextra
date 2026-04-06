/**
 * Market Naming Conventions
 * 
 * Generates clean, short market identifiers and symbols.
 * 
 * Examples:
 *   "DAILY-PALLADIUM-PRICE" → "XPD-1D"
 *   "GOLD SPOT PRICE"       → "XAU"
 *   "BITCOIN"               → "BTC"
 *   "weekly ethereum"       → "ETH-1W"
 *   "S&P 500 Monthly"       → "SPX-1M"
 */

// Standard commodity/asset ticker mappings
const ASSET_TICKERS: Record<string, string> = {
  // Precious metals
  palladium: 'XPD',
  gold: 'XAU',
  silver: 'XAG',
  platinum: 'XPT',
  rhodium: 'XRH',
  
  // Crypto
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  cardano: 'ADA',
  ripple: 'XRP',
  dogecoin: 'DOGE',
  litecoin: 'LTC',
  polkadot: 'DOT',
  chainlink: 'LINK',
  avalanche: 'AVAX',
  polygon: 'MATIC',
  
  // Forex
  euro: 'EUR',
  pound: 'GBP',
  yen: 'JPY',
  yuan: 'CNY',
  franc: 'CHF',
  dollar: 'USD',
  
  // Indices
  'sp500': 'SPX',
  's&p': 'SPX',
  'sp 500': 'SPX',
  's&p 500': 'SPX',
  nasdaq: 'NDX',
  dow: 'DJI',
  'dow jones': 'DJI',
  russell: 'RUT',
  vix: 'VIX',
  ftse: 'UKX',
  dax: 'DAX',
  nikkei: 'NKY',
  
  // Energy
  oil: 'CL',
  'crude oil': 'CL',
  'brent': 'BZ',
  'natural gas': 'NG',
  gasoline: 'RB',
  
  // Agriculture
  corn: 'ZC',
  wheat: 'ZW',
  soybean: 'ZS',
  coffee: 'KC',
  sugar: 'SB',
  cocoa: 'CC',
  cotton: 'CT',
};

// Period suffixes
const PERIOD_PATTERNS: Array<{ pattern: RegExp; suffix: string }> = [
  { pattern: /\b(daily|1d|1-d|1day|1-day)\b/i, suffix: '1D' },
  { pattern: /\b(weekly|1w|1-w|1week|1-week|7d)\b/i, suffix: '1W' },
  { pattern: /\b(monthly|1m|1-m|1month|1-month|30d)\b/i, suffix: '1M' },
  { pattern: /\b(quarterly|1q|q1|q2|q3|q4|3m|3-m)\b/i, suffix: '1Q' },
  { pattern: /\b(yearly|annual|1y|1-y|12m)\b/i, suffix: '1Y' },
  { pattern: /\b(hourly|1h|1-h|60m)\b/i, suffix: '1H' },
  { pattern: /\b(4h|4-h|4hour)\b/i, suffix: '4H' },
];

// Words to strip from raw input
const NOISE_WORDS = new Set([
  'price', 'spot', 'futures', 'market', 'index', 'rate', 'value',
  'contract', 'the', 'of', 'a', 'an', 'for', 'on', 'at',
]);

export interface MarketNamingResult {
  /** Short identifier (e.g., "XPD-1D") */
  identifier: string;
  /** Display symbol (same as identifier unless customized) */
  symbol: string;
  /** Human-readable name (e.g., "Palladium Daily") */
  displayName: string;
  /** Detected asset ticker (e.g., "XPD") */
  assetTicker: string | null;
  /** Detected period suffix (e.g., "1D") */
  periodSuffix: string | null;
}

/**
 * Parse raw market input and generate clean naming.
 * 
 * @param rawInput - User-provided market name/symbol (e.g., "DAILY-PALLADIUM-PRICE")
 * @returns Clean naming result
 */
export function generateMarketNaming(rawInput: string): MarketNamingResult {
  const input = String(rawInput || '').trim();
  
  // If input is already a known short ticker (like "BTC" or "ETH-1D"), use as-is
  const cleanInput = input.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const lowerInput = input.toLowerCase();
  
  // Check if this is a known ticker or short format that should be preserved
  const isKnownTicker = Object.values(ASSET_TICKERS).includes(cleanInput.split('-')[0]);
  if (isKnownTicker && cleanInput.length <= 8 && /^[A-Z0-9]+(-[A-Z0-9]+)?$/.test(cleanInput)) {
    return {
      identifier: cleanInput,
      symbol: cleanInput,
      displayName: input,
      assetTicker: cleanInput.split('-')[0] || null,
      periodSuffix: cleanInput.includes('-') ? cleanInput.split('-')[1] : null,
    };
  }
  
  // Check if the full word is a known asset name (e.g., "bitcoin" → "BTC")
  const directTicker = ASSET_TICKERS[lowerInput];
  if (directTicker) {
    return {
      identifier: directTicker,
      symbol: directTicker,
      displayName: input.charAt(0).toUpperCase() + input.slice(1).toLowerCase(),
      assetTicker: directTicker,
      periodSuffix: null,
    };
  }
  
  // Normalize input for parsing
  const normalized = input
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
  
  // Detect period suffix
  let periodSuffix: string | null = null;
  for (const { pattern, suffix } of PERIOD_PATTERNS) {
    if (pattern.test(normalized)) {
      periodSuffix = suffix;
      break;
    }
  }
  
  // Remove period words from normalized string for asset detection
  const withoutPeriod = normalized
    .replace(/\b(daily|weekly|monthly|quarterly|yearly|annual|hourly)\b/gi, '')
    .replace(/\b\d+[dwmqyh]\b/gi, '')
    .trim();
  
  // Detect asset ticker
  let assetTicker: string | null = null;
  const words = withoutPeriod.split(/\s+/).filter(w => !NOISE_WORDS.has(w));
  
  // Check each word against known tickers
  for (const word of words) {
    const ticker = ASSET_TICKERS[word];
    if (ticker) {
      assetTicker = ticker;
      break;
    }
    // Also check multi-word patterns
    const phrase = words.join(' ');
    for (const [key, val] of Object.entries(ASSET_TICKERS)) {
      if (phrase.includes(key)) {
        assetTicker = val;
        break;
      }
    }
    if (assetTicker) break;
  }
  
  // If no known ticker, create one from the first significant word
  if (!assetTicker && words.length > 0) {
    const primaryWord = words[0].toUpperCase();
    // Use first 3-4 chars as ticker
    assetTicker = primaryWord.slice(0, Math.min(4, primaryWord.length));
  }
  
  // Build identifier
  let identifier = assetTicker || 'MKT';
  if (periodSuffix) {
    identifier = `${identifier}-${periodSuffix}`;
  }
  
  // Build display name
  const assetName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const periodName = periodSuffix ? {
    '1D': 'Daily',
    '1W': 'Weekly',
    '1M': 'Monthly',
    '1Q': 'Quarterly',
    '1Y': 'Yearly',
    '1H': 'Hourly',
    '4H': '4-Hour',
  }[periodSuffix] : null;
  
  const displayName = periodName 
    ? `${assetName} ${periodName}`.trim() 
    : assetName || identifier;
  
  return {
    identifier: identifier.toUpperCase(),
    symbol: identifier.toUpperCase(),
    displayName: displayName || identifier,
    assetTicker,
    periodSuffix,
  };
}

/**
 * Quick helper to just get the short identifier.
 */
export function toShortIdentifier(rawInput: string): string {
  return generateMarketNaming(rawInput).identifier;
}

/**
 * Validate and clean a user-provided symbol.
 * Returns uppercase, alphanumeric with hyphens only.
 */
export function cleanSymbol(rawSymbol: string): string {
  return String(rawSymbol || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20); // Max 20 chars
}

/**
 * Check if a symbol looks like it's already in short format.
 */
export function isShortFormat(symbol: string): boolean {
  const s = String(symbol || '').trim().toUpperCase();
  // Short format: 2-6 letters, optionally followed by hyphen and 1-3 alphanumeric
  return /^[A-Z]{2,6}(-[A-Z0-9]{1,3})?$/.test(s);
}
