'use client';

import MiniChart from '@/components/widgets/MiniChart';
import {
  marketCapChartData,
  tradingVolumeChartData,
} from '@/components/widgets/utils/mockData';
import useMarketOverviewData from '@/hooks/useMarketOverviewData';
import MarketList from './MarketList';
import { useMarketList } from './useMarketList';
import styles from './MarketStatsRow.module.css';
import type { MarketStat } from './types';

const MarketStatsRow: React.FC = () => {
  const {
    marketCap,
    marketCapChange,
    tradingVolume,
    isLoading: statsLoading,
    error: statsError,
  } = useMarketOverviewData();

  const trending = useMarketList('trending', 4);
  const topVolume = useMarketList('top_volume', 4);

  const capUp = marketCapChange >= 0;
  const marketCapStat: MarketStat = {
    label: 'Market Cap',
    value: marketCap,
    delta: `${capUp ? '▲' : '▼'} ${Math.abs(marketCapChange).toFixed(1)}%`,
    direction: capUp ? 'up' : 'down',
    series: marketCapChartData,
  };

  const volumeStat: MarketStat = {
    label: '24h Trading Volume',
    value: tradingVolume,
    direction: 'up',
    series: tradingVolumeChartData,
  };

  return (
    <div className={styles.row}>
      <div className={styles.statStack}>
        <StatCard stat={marketCapStat} isLoading={statsLoading} error={!!statsError} />
        <StatCard stat={volumeStat} isLoading={statsLoading} error={!!statsError} />
      </div>

      <MarketList
        title="Trending"
        markets={trending.markets}
        valueField="price"
        isLoading={trending.isLoading}
        error={trending.error}
      />
      <MarketList
        title="Top Volume"
        markets={topVolume.markets}
        valueField="volume24h"
        isLoading={topVolume.isLoading}
        error={topVolume.error}
      />
    </div>
  );
};

const StatCard: React.FC<{
  stat: MarketStat;
  isLoading?: boolean;
  error?: boolean;
}> = ({ stat, isLoading, error }) => {
  const stroke = stat.direction === 'up' ? '#4ADE80' : '#F87171';

  return (
    <div className={`${styles.card} ${styles.statCard}`}>
      <div className={styles.statLeft}>
        <h4 className={styles.statLabel}>{stat.label}</h4>
        {isLoading ? (
          <div className={styles.skelBar} style={{ width: 96, height: 14, marginTop: 7 }} />
        ) : error ? (
          <div className={styles.statValue}>—</div>
        ) : (
          <div className={styles.statValue}>
            {stat.value}
            {stat.delta ? (
              <span
                className={`${styles.statDelta} ${stat.direction === 'up' ? styles.up : styles.down}`}
                aria-label={stat.delta}
              >
                <span aria-hidden="true">{stat.delta}</span>
              </span>
            ) : null}
          </div>
        )}
      </div>
      <div className={styles.sparkWrap}>
        {isLoading || error || !stat.series?.length ? (
          <div className={styles.skelSpark} aria-hidden="true" />
        ) : (
          <MiniChart data={stat.series} color={stroke} width={80} height={34} />
        )}
      </div>
    </div>
  );
};

export default MarketStatsRow;
