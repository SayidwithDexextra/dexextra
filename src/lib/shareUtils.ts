// Share utilities for generating platform-specific share content

export interface MarketShareData {
  symbol: string;
  name: string;
  price: number;
  priceFormatted: string;
  priceChange24h?: number;
  settlementDate: string;
  volume?: string;
  category?: string;
  url: string;
  iconUrl?: string;
}

export interface PositionShareData {
  symbol: string;
  name: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  url: string;
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  return `$${price.toPrecision(4)}`;
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(1)}M`;
  }
  if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(1)}K`;
  }
  return `$${volume.toFixed(0)}`;
}

function formatSettlementDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export const shareTemplates = {
  twitter: (data: MarketShareData) => {
    const lines = [
      `$${data.symbol.replace('-USD', '')} at ${data.priceFormatted} on @dexeteralabs`,
      '',
      `Settlement ${data.settlementDate}${data.volume ? ` · Volume ${data.volume}` : ''}`,
    ];
    return lines.join('\n');
  },

  telegram: (data: MarketShareData) => {
    const lines = [
      `${data.name} on Dexetera`,
      '',
      `${data.priceFormatted} · Settlement ${data.settlementDate}`,
      'Trade any metric, no permission needed',
    ];
    return lines.join('\n');
  },

  whatsapp: (data: MarketShareData) => {
    return `Check out ${data.name} on Dexetera - ${data.priceFormatted}\n\nSettles ${data.settlementDate}`;
  },

  reddit: (data: MarketShareData) => {
    return `${data.name} - Trade on Dexetera`;
  },

  discord: (data: MarketShareData) => {
    const lines = [
      `**${data.name}** on Dexetera`,
      `Price: ${data.priceFormatted}`,
      `Settlement: ${data.settlementDate}`,
    ];
    return lines.join('\n');
  },

  email: {
    subject: (data: MarketShareData) => `${data.name} on Dexetera`,
    body: (data: MarketShareData) => {
      const lines = [
        `I found this market on Dexetera:`,
        '',
        data.name,
        `Current Price: ${data.priceFormatted}`,
        `Settlement: ${data.settlementDate}`,
        '',
        'Check it out:',
      ];
      return lines.join('\n');
    },
  },

  default: (data: MarketShareData) => {
    return `${data.name} - ${data.priceFormatted} on Dexetera`;
  },
};

export const positionShareTemplates = {
  twitter: (data: PositionShareData) => {
    const direction = data.side === 'long' ? 'LONG' : 'SHORT';
    const pnlSign = data.pnl >= 0 ? '+' : '';
    const lines = [
      `I'm ${direction} on $${data.symbol.replace('-USD', '')} on @dexeteralabs`,
      '',
      `Entry: ${formatPrice(data.entryPrice)} → Now: ${formatPrice(data.currentPrice)}`,
      `${pnlSign}${formatPrice(data.pnl)} (${pnlSign}${data.pnlPercent.toFixed(1)}%)`,
    ];
    return lines.join('\n');
  },

  default: (data: PositionShareData) => {
    const direction = data.side === 'long' ? 'LONG' : 'SHORT';
    return `${direction} ${data.symbol} on Dexetera`;
  },
};

export function getShareText(
  platform: string,
  data: MarketShareData
): string {
  const template = shareTemplates[platform as keyof typeof shareTemplates];
  
  if (typeof template === 'function') {
    return template(data);
  }
  
  if (platform === 'email' && shareTemplates.email) {
    return shareTemplates.email.body(data);
  }
  
  return shareTemplates.default(data);
}

export function getShareSubject(data: MarketShareData): string {
  return shareTemplates.email.subject(data);
}

export function getPositionShareText(
  platform: string,
  data: PositionShareData
): string {
  const template = positionShareTemplates[platform as keyof typeof positionShareTemplates];
  
  if (typeof template === 'function') {
    return template(data);
  }
  
  return positionShareTemplates.default(data);
}

export function buildMarketShareData(market: {
  symbol?: string;
  name?: string;
  last_trade_price?: number;
  mark_price?: number;
  settlement_date?: string;
  total_volume?: number;
  category?: string;
  icon_image_url?: string;
  market_identifier?: string;
}, baseUrl: string = 'https://dexetera.org'): MarketShareData {
  const price = (market.mark_price ?? market.last_trade_price ?? 0) / 1_000_000;
  const symbol = market.symbol || market.market_identifier || 'MARKET';
  
  return {
    symbol,
    name: market.name || symbol,
    price,
    priceFormatted: formatPrice(price),
    settlementDate: market.settlement_date 
      ? formatSettlementDate(market.settlement_date) 
      : 'TBD',
    volume: market.total_volume 
      ? formatVolume(Number(market.total_volume)) 
      : undefined,
    category: market.category,
    url: `${baseUrl}/token/${market.market_identifier || symbol}`,
    iconUrl: market.icon_image_url,
  };
}

export function buildShareUrl(
  baseUrl: string,
  referralCode?: string
): string {
  if (!referralCode) return baseUrl;
  
  const url = new URL(baseUrl);
  url.searchParams.set('ref', referralCode);
  return url.toString();
}
