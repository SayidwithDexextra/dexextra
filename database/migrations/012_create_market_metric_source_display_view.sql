-- =============================================
-- Migration: 012_create_market_metric_source_display_view.sql
-- Market metric source display (script config fallback)
-- =============================================
--
-- Goal:
-- Provide a DB-level, single-query "what should we display as the metric source?"
-- for UI components like `MetricLivePrice`.
--
-- Behavior:
-- - If a market has a script-config with BOTH `table` and `mark` populated, we display that.
-- - Otherwise, we fall back to the original metric URL (typically `initial_order.metricUrl`).
-- - If that is missing, we fall back to the AI locator URL (if present).
--
-- Notes:
-- - Script config is stored inside `markets.market_config` under either:
--   - `script_config` (preferred)
--   - `metric_script_config` (legacy/alternate)
--
-- View columns:
-- - display_kind: 'script' | 'url' | 'none'
-- - display_value: 'table:mark' for scripts, or the URL string for url-kind
-- - source_url: URL string when display_kind='url', else NULL
--

CREATE OR REPLACE VIEW market_metric_source_display AS
WITH base AS (
  SELECT
    m.id,
    m.market_identifier,
    m.symbol,
    m.initial_order,
    m.market_config,
    -- Script config (table/mark) from market_config
    NULLIF(
      btrim(
        COALESCE(
          m.market_config #>> '{script_config,table}',
          m.market_config #>> '{metric_script_config,table}',
          m.market_config #>> '{script,table}'
        )
      ),
      ''
    ) AS script_table,
    NULLIF(
      btrim(
        COALESCE(
          m.market_config #>> '{script_config,mark}',
          m.market_config #>> '{metric_script_config,mark}',
          m.market_config #>> '{script,mark}',
          m.market_config #>> '{script_config,metric}',
          m.market_config #>> '{metric_script_config,metric}',
          m.market_config #>> '{script_config,metric_name}',
          m.market_config #>> '{metric_script_config,metric_name}'
        )
      ),
      ''
    ) AS script_mark,
    -- Original metric URL from initial_order JSON
    NULLIF(
      btrim(
        COALESCE(
          m.initial_order ->> 'metricUrl',
          m.initial_order ->> 'metric_url',
          m.initial_order ->> 'metricurl'
        )
      ),
      ''
    ) AS initial_metric_url,
    -- Optional AI locator URL
    NULLIF(
      btrim(
        COALESCE(
          m.market_config #>> '{ai_source_locator,url}',
          m.market_config #>> '{ai_source_locator,primary_source_url}'
        )
      ),
      ''
    ) AS locator_url
  FROM markets m
)
SELECT
  id,
  market_identifier,
  symbol,
  script_table,
  script_mark,
  initial_metric_url,
  locator_url,
  CASE
    WHEN script_table IS NOT NULL AND script_mark IS NOT NULL THEN 'script'
    WHEN initial_metric_url IS NOT NULL THEN 'url'
    WHEN locator_url IS NOT NULL THEN 'url'
    ELSE 'none'
  END AS display_kind,
  CASE
    WHEN script_table IS NOT NULL AND script_mark IS NOT NULL THEN script_table || ':' || script_mark
    ELSE COALESCE(initial_metric_url, locator_url)
  END AS display_value,
  CASE
    WHEN initial_metric_url IS NOT NULL THEN initial_metric_url
    WHEN locator_url IS NOT NULL THEN locator_url
    ELSE NULL
  END AS source_url
FROM base;

