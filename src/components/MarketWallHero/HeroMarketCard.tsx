import Link from "next/link";
import { useId } from "react";
import styles from "./HeroMarketCard.module.css";

/**
 * Dexetera hero market card. Visual match of the small market wall card on dexetera.org.
 * Pass real market data. Nothing here is mocked.
 */
export type HeroMarketCardProps = {
  href: string;              // e.g. `/token/${symbol}`
  name: string;              // "S&P 500"
  symbol: string;            // "500"
  category?: string | null;  // first entry of market.category, e.g. "Indices"
  unit?: string | null;      // optional, e.g. "$/dozen". Omitted -> "SYMBOL/USDC"
  price: string;             // already formatted, e.g. "$7,594.21"
  changePct?: number | null; // 24h change in percent. null/undefined -> "—"
  series: number[];          // the same price series the old sparkline used (oldest -> newest)
  settlementDate?: string | Date | null; // market.settlement_date
  live?: boolean;            // true for real, active markets (default true)
};

const W = 200, H = 60;

function smooth(P: [number, number][]) {
  let d = `M${P[0][0].toFixed(2)},${P[0][1].toFixed(2)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

function fmtSettle(v?: string | Date | null) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const m = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getUTCMonth()];
  return `SETTLES ${String(d.getUTCDate()).padStart(2, "0")} ${m} ${d.getUTCFullYear()}`;
}

export function HeroSpark({ data, up }: { data: number[]; up: boolean }) {
  const gid = "hmc" + useId().replace(/:/g, "");
  const pts = data.length >= 2 ? data : data.length === 1 ? [data[0], data[0]] : [0, 0];
  const min = Math.min(...pts), max = Math.max(...pts), rg = max - min || 1;
  const flat = max === min;
  const yy = (v: number) => (flat ? H / 2 : H - 3 - ((v - min) / rg) * (H - 6));
  const line = smooth(pts.map((v, i) => [(i / (pts.length - 1)) * W, yy(v)]));
  const color = up ? "var(--hmc-green)" : "var(--hmc-red)";
  return (
    <svg className={styles.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function HeroMarketCard(p: HeroMarketCardProps) {
  const hasChg = typeof p.changePct === "number" && isFinite(p.changePct);
  const first = p.series[0], last = p.series[p.series.length - 1];
  const up = hasChg ? (p.changePct as number) >= 0 : !(last < first);
  const settle = fmtSettle(p.settlementDate);
  const live = p.live !== false;
  return (
    <Link href={p.href} className={styles.card} prefetch={false}>
      <span className={styles.top}>
        <span className={styles.cat}>{p.category || "Market"}</span>
        <span className={live ? styles.tagLive : styles.tag}>{live ? "LIVE" : "EXAMPLE"}</span>
      </span>
      <span className={styles.id}>
        <span className={styles.name}>{p.name}</span>
        <span className={styles.sym}>{p.unit ? `${p.symbol} · ${p.unit}` : `${p.symbol}/USDC`}</span>
      </span>
      <span className={styles.row}>
        <span className={styles.px}>
          <span className={styles.price}>{p.price}</span>
          <span className={hasChg ? (up ? styles.up : styles.down) : styles.flat}>
            {hasChg ? `${up ? "▲" : "▼"} ${Math.abs(p.changePct as number).toFixed(2)}%` : "—"}
          </span>
        </span>
        <span className={styles.sparkBox}><HeroSpark data={p.series} up={up} /></span>
      </span>
      {settle && <span className={styles.settle}>{settle}</span>}
    </Link>
  );
}
