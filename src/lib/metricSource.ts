export type MetricSource = {
  url: string | null;
  host: string | null;
  label: string | null;
};

function clean(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

export function resolveMetricSourceUrl(marketConfig: any, initialOrder: any): string | null {
  const cfg = marketConfig ?? null;
  const initial = initialOrder ?? null;

  // Keep this resolution order aligned with `src/components/metrics/MetricLivePrice.tsx`.
  const marketConfigSourceUrl = clean(
    cfg?.source_url ??
      cfg?.sourceUrl ??
      cfg?.sourceURL ??
      cfg?.wayback_snapshot?.source_url ??
      cfg?.wayback_snapshot?.sourceUrl ??
      cfg?.ai_source_locator?.url ??
      cfg?.ai_source_locator?.primary_source_url
  );

  const initialOrderMetricUrl = clean(initial?.metricUrl ?? initial?.metric_url ?? initial?.metricurl);

  return marketConfigSourceUrl || initialOrderMetricUrl;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Best-effort "registrable domain" extraction without a PSL dependency.
 * Handles common multi-part public suffixes like `co.uk`, `com.au`, etc.
 *
 * Examples:
 * - markets.businessinsider.com -> businessinsider
 * - www.worldometers.info -> worldometers
 * - sub.foo.co.uk -> foo
 */
function registrableLabelFromHost(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '').trim();
  const parts = h.split('.').filter(Boolean);
  if (parts.length === 0) return h;
  if (parts.length === 1) return parts[0];

  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];

  // Common 2nd-level public suffix patterns for ccTLDs.
  const commonSecondLevel = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
  const isCcTld = last.length === 2;
  const hasSecondLevelSuffix = isCcTld && commonSecondLevel.has(secondLast);
  const suffixPartsCount = hasSecondLevelSuffix ? 2 : 1;

  const idx = parts.length - suffixPartsCount - 1;
  return idx >= 0 ? parts[idx] : secondLast;
}

/**
 * Convert a URL host into a display-friendly "site" label.
 * - drops `www.`
 * - reduces subdomains to the registrable label (best-effort)
 * - strips the TLD
 * - title-cases words separated by '-' / '_'
 */
function labelFromHost(host: string): string {
  const label = registrableLabelFromHost(host);
  const words = label.split(/[-_]+/).filter(Boolean).map(capitalize);
  return words.join(' ') || capitalize(host.replace(/^www\./, ''));
}

export function metricSourceFromMarket(market: {
  market_config?: any;
  initial_order?: any;
  metric_source_url?: string | null;
  metric_source_label?: string | null;
}): MetricSource {
  const explicitUrl = clean(market.metric_source_url);
  const cfgLabel = clean(
    market?.market_config?.source_label ??
      market?.market_config?.sourceLabel ??
      market?.market_config?.metric_source_label ??
      market?.market_config?.metricSourceLabel
  );
  const explicitLabel = clean(market.metric_source_label) || cfgLabel;

  const url = explicitUrl ?? resolveMetricSourceUrl(market.market_config, market.initial_order);
  if (!url) return { url: null, host: null, label: null };

  const host = hostFromUrl(url);
  const label = explicitLabel ?? (host ? labelFromHost(host) : null);

  return { url, host, label };
}

