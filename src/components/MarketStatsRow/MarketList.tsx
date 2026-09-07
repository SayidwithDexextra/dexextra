'use client';

import Link from 'next/link';
import styles from './MarketStatsRow.module.css';
import type { MarketListItem, MarketListValueField } from './types';

const ROW_COUNT = 4;

function formatChange(changePct: number | null, direction: 'up' | 'down'): string {
  if (changePct == null) return '—';
  const abs = Math.abs(changePct).toFixed(1);
  return `${direction === 'up' ? '▲' : '▼'} ${abs}%`;
}

export interface MarketListProps {
  title: string;
  markets: MarketListItem[];
  valueField: MarketListValueField;
  isLoading?: boolean;
  error?: string | null;
}

const PanelHeader: React.FC<{ title: string; count: string }> = ({ title, count }) => (
  <div className={styles.panelHead}>
    <h4>{title}</h4>
    <div className={styles.badge}>{count}</div>
  </div>
);

const MarketList: React.FC<MarketListProps> = ({
  title,
  markets,
  valueField,
  isLoading = false,
  error = null,
}) => {
  const shown = markets.slice(0, ROW_COUNT);

  return (
    <section className={styles.card}>
      <PanelHeader title={title} count={isLoading ? '—' : String(shown.length)} />
      <div className={styles.list}>
        {isLoading ? (
          Array.from({ length: ROW_COUNT }, (_, i) => <SkeletonRow key={i} />)
        ) : error ? (
          <div className={`${styles.item} ${styles.itemIdle}`}>
            <div className={styles.leftGroup}>
              <i className={`${styles.dot} ${styles.dotError}`} />
              <span className={styles.name}>{error}</span>
            </div>
          </div>
        ) : shown.length === 0 ? (
          <div className={`${styles.item} ${styles.itemIdle}`}>
            <div className={styles.leftGroup}>
              <i className={`${styles.dot} ${styles.dotIdle}`} />
              <span className={styles.name}>No markets found</span>
            </div>
          </div>
        ) : (
          shown.map((m) => <ListRow key={m.id} item={m} valueField={valueField} />)
        )}
      </div>
    </section>
  );
};

const ListRow: React.FC<{ item: MarketListItem; valueField: MarketListValueField }> = ({
  item,
  valueField,
}) => {
  const isUp = item.direction === 'up';
  const changeText = formatChange(item.changePct, item.direction);
  const signed =
    item.changePct == null
      ? 'unchanged'
      : `${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(1)}%`;
  const value = valueField === 'volume24h' ? item.volume24h : item.price;

  return (
    <Link href={`/token/${encodeURIComponent(item.slug)}`} className={styles.item}>
      <span className={styles.leftGroup}>
        <i className={`${styles.dot} ${isUp ? styles.dotUp : styles.dotDown}`} />
        <span className={styles.name}>{item.name}</span>
      </span>
      <span className={styles.rightGroup}>
        <span className={styles.value}>{value}</span>
        <span
          className={`${styles.change} ${isUp ? styles.up : styles.down}`}
          aria-label={`${item.direction === 'up' ? 'up' : 'down'} ${signed}`}
        >
          <span aria-hidden="true">{changeText}</span>
        </span>
      </span>
    </Link>
  );
};

const SkeletonRow: React.FC = () => (
  <div className={styles.item} aria-hidden="true">
    <span className={styles.leftGroup}>
      <span className={styles.skelBar} style={{ width: 6, height: 6, borderRadius: 999 }} />
      <span className={styles.skelBar} style={{ width: 96 }} />
    </span>
    <span className={styles.rightGroup}>
      <span className={styles.skelBar} style={{ width: 52 }} />
      <span className={styles.skelBar} style={{ width: 40 }} />
    </span>
  </div>
);

export default MarketList;
