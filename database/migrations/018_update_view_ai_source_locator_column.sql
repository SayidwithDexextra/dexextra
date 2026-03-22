-- =============================================
-- Migration: 018_update_view_ai_source_locator_column.sql
-- Purpose: Update market_metric_source_display view to read from
--          the new dedicated ai_source_locator column instead of
--          market_config->'ai_source_locator'.
-- =============================================

CREATE OR REPLACE VIEW market_metric_source_display AS
WITH base AS (
  SELECT
    m.id,
    m.market_identifier,
    m.symbol,
    m.initial_order,
    m.market_config,
    (
      m.market_config IS NULL
      OR jsonb_typeof(m.market_config) IS DISTINCT FROM 'object'
      OR m.market_config = '{}'::jsonb
    ) AS market_config_empty,
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
    NULLIF(
      btrim(
        COALESCE(
          m.ai_source_locator ->> 'url',
          m.ai_source_locator ->> 'primary_source_url'
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
  NULL::text AS script_table,
  NULL::text AS script_mark,
  initial_metric_url,
  locator_url,
  CASE
    WHEN locator_url IS NOT NULL THEN 'url'
    WHEN initial_metric_url IS NOT NULL THEN 'url'
    ELSE 'none'
  END AS display_kind,
  COALESCE(locator_url, initial_metric_url) AS display_value,
  COALESCE(locator_url, initial_metric_url) AS source_url
FROM base;
