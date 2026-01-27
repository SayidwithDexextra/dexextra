-- =============================================
-- Migration: 013_market_metric_source_display_fallback_initial_order.sql
-- DB fallback: initial_order when market_config is empty
-- =============================================
--
-- Requirement:
-- - If `markets.market_config` is NULL / empty JSON, fall back to `markets.initial_order.metricUrl`
--   for the metric source URL display.
--
-- Notes:
-- - Some code paths also store an AI locator under `market_config.ai_source_locator`.
-- - We only trust locator_url when market_config is non-empty, per requirement.
-- - We keep a stable view name so the UI can query it.
--

CREATE OR REPLACE VIEW market_metric_source_display AS
WITH base AS (
  SELECT
    m.id,
    m.market_identifier,
    m.symbol,
    m.initial_order,
    m.market_config,
    -- "empty" covers NULL, non-object, or {} object.
    (
      m.market_config IS NULL
      OR jsonb_typeof(m.market_config) IS DISTINCT FROM 'object'
      OR m.market_config = '{}'::jsonb
    ) AS market_config_empty,
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
    -- Optional AI locator URL (only considered when market_config is non-empty)
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
  -- Keep these columns for UI compatibility; scripts are not used in this simplified fallback.
  NULL::text AS script_table,
  NULL::text AS script_mark,
  initial_metric_url,
  CASE WHEN market_config_empty THEN NULL ELSE locator_url END AS locator_url,
  CASE
    WHEN market_config_empty THEN
      CASE WHEN initial_metric_url IS NOT NULL THEN 'url' ELSE 'none' END
    ELSE
      CASE WHEN locator_url IS NOT NULL THEN 'url' WHEN initial_metric_url IS NOT NULL THEN 'url' ELSE 'none' END
  END AS display_kind,
  CASE
    WHEN market_config_empty THEN initial_metric_url
    ELSE COALESCE(locator_url, initial_metric_url)
  END AS display_value,
  CASE
    WHEN market_config_empty THEN initial_metric_url
    ELSE COALESCE(locator_url, initial_metric_url)
  END AS source_url
FROM base;

