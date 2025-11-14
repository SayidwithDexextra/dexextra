## Market Rollover Database System (Supabase)

This document explains the end-to-end design of the market rollover system implemented in Supabase, how it integrates with existing `markets`, how the frontend consumes it, and how operations manage rolling from one contract to the next without relying on database start/end dates.

The design is additive and non-breaking: it does not modify the existing `markets` table or require contract start/end dates. Instead, it introduces three small tables and two helper views with clear responsibilities.

## Goals

- Support month-long overlaps where the expiring contract and its successor are both tradable.
- Avoid on-chain date scheduling in the database; settlement on-chain ends trading.
- Keep the data model additive and safe; no changes to existing `markets` logic or queries.
- Make it easy for the UI to:
  - Determine the default market for a series (routing).
  - Show both markets during rollover when overlap is active.
- Ensure data integrity and prevent misconfiguration via constraints and triggers.

## Core Concepts

- A “series” represents an instrument family across contract cycles (e.g., “BTC monthly”).
- Each concrete market (a row in `public.markets`) belongs to at most one series.
- “Primary” marks which market in the series should be the default route at any moment.
- During rollover, the UI should show two markets for the same series: the expiring one and the new one. This is controlled by a simple boolean flag in a linking table (no dates needed).

## Schema Overview

- Existing table:
  - `public.markets`: Canonical source of market metadata and on-chain references.
- New tables:
  - `public.market_series`: Instrument family metadata and grouping.
  - `public.series_markets`: Mapping table that assigns concrete `markets.id` to a series with an order and a single “primary”.
  - `public.market_rollovers`: Pairs a “from” market to a “to” market and toggles overlap via `is_active`.
- Helper views (read-only, client-friendly):
  - `public.v_series_routing`: For each series, which `market_id` is currently primary.
  - `public.v_active_rollover_pairs`: Which from→to pairs are actively in overlap.
- Integrity:
  - `public.fn_rollover_markets_belong_to_series` + `trg_rollover_membership` trigger ensure rollover pairs belong to the declared series.
- Security:
  - RLS allows public read-only access to the new tables and views; server-only writes using the service role.

## Existing `public.markets` (Quick Recap)

The system assumes you already have a unified `public.markets` table with:
- Identifiers and display fields: `id` (UUID), `market_identifier`, `symbol`, `name`, `description`, `category`.
- Contract addresses and blockchain metadata (`market_address`, `chain_id`, etc.).
- Status fields (e.g., `market_status`, `is_active`) and analytics counters.

Nothing in the rollover design requires modifying `public.markets`.

## New Tables

### `public.market_series`

Groups all contracts that represent the same instrument across expiries.

- `id uuid primary key default gen_random_uuid()`
- `slug text not null unique`: Human-readable ID for the series (e.g., `BTC-MONTHLY` or `A-SERIES`).
- `underlying_symbol text not null`: Symbol for the underlying (e.g., `BTC`).
- `base_asset text not null`: Primary asset (often the same as `underlying_symbol`).
- `quote_asset text not null`: Quote currency (e.g., `USD`).
- `roll_frequency text not null default 'monthly'`: Metadata to describe cadence.
- `metadata jsonb not null default '{}'`: Extra extensible metadata.
- `created_at timestamptz not null default now()`

Usage:
- Create one row per instrument family (series).
- The `slug` is referenced by the frontend and back-office.

RLS/Permissions:
- Public SELECT (frontend read).
- Server/service role can manage (insert/update/delete).

### `public.series_markets`

Assigns concrete `markets.id` rows into a `market_series`, and defines ordering and default routing.

- `series_id uuid not null references market_series(id) on delete cascade`
- `market_id uuid not null references markets(id) on delete cascade`
- `contract_code text`: Optional human-friendly contract tag (e.g., `DEC-2025`).
- `sequence integer not null`: Monotonic order within the series (lower = earlier contract).
- `is_primary boolean not null default false`: Which market is the default routing target.
- `created_at timestamptz not null default now()`
- Primary key: `(series_id, market_id)`
- Unique: `(series_id, sequence)`
- Partial unique index: at most one `is_primary` per series:
  - `create unique index series_markets_one_primary_idx on series_markets(series_id) where is_primary;`

Usage:
- Ensures exactly one primary (or zero, if desired), enforced by the partial unique index.
- UI can route users to the primary market by reading `v_series_routing`.

RLS/Permissions:
- Public SELECT (frontend read).
- Server/service role can manage.

### `public.market_rollovers`

Declares an active overlap between two markets within the same series. This enables the UI to show both markets concurrently during the roll window—without storing dates.

- `id uuid primary key default gen_random_uuid()`
- `series_id uuid not null references market_series(id) on delete cascade`
- `from_market_id uuid not null references markets(id) on delete cascade`
- `to_market_id uuid not null references markets(id) on delete cascade`
- `is_active boolean not null default false`: When true, both are tradable and shown in UI.
- `default_overlap_days integer not null default 30`: Optional hint for ops; no scheduling enforced.
- `notes text`
- `created_at timestamptz not null default now()`
- Unique: `(series_id, from_market_id, to_market_id)`
- Check: `from_market_id <> to_market_id`
- Index: `create index market_rollovers_active_idx on market_rollovers(series_id, is_active)`

Usage:
- Ops set `is_active=true` to start an overlap between `from_market_id` → `to_market_id`.
- When the old contract finally settles on-chain, ops set `is_active=false` to end the overlap.

RLS/Permissions:
- Public SELECT (frontend read).
- Server/service role can manage.

## Integrity Function and Trigger

The following ensures that any rollover pair you declare actually belongs to the same series. This blocks accidental cross-series pairings.

```sql
create or replace function public.fn_rollover_markets_belong_to_series()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1
    from series_markets sm
    where sm.series_id = new.series_id
      and sm.market_id = new.from_market_id
  ) then
    raise exception 'from_market_id (%) is not a member of series (%)', new.from_market_id, new.series_id;
  end if;

  if not exists (
    select 1
    from series_markets sm
    where sm.series_id = new.series_id
      and sm.market_id = new.to_market_id
  ) then
    raise exception 'to_market_id (%) is not a member of series (%)', new.to_market_id, new.series_id;
  end if;

  return new;
end;
$$;

create trigger trg_rollover_membership
before insert or update of series_id, from_market_id, to_market_id
on public.market_rollovers
for each row execute function public.fn_rollover_markets_belong_to_series();
```

Notes:
- Trigger timing is BEFORE insert/update so invalid data never lands.
- The trigger only runs when one of the key columns changes (not for toggling `is_active`).

## Helper Views (Frontend-Friendly)

### `public.v_series_routing`

Gives the default `market_id` for each series (the `is_primary=true` mapping).

Columns:
- `series_id uuid`
- `slug text`
- `primary_market_id uuid`

Usage:
- Frontend uses this to route which market to display by default for each instrument family.

### `public.v_active_rollover_pairs`

Lists from→to pairs where overlap is active.

Columns:
- `series_id uuid`
- `from_market_id uuid`
- `to_market_id uuid`
- `default_overlap_days integer`
- `series_slug text`

Usage:
- Frontend uses this to decide whether to show both contracts at once for a given series.

## Row-Level Security (RLS) and Grants

- RLS is enabled on `market_series`, `series_markets`, `market_rollovers`.
- Policies:
  - Public can SELECT from all three tables (and views).
  - Only `service_role` can INSERT/UPDATE/DELETE (server-only writes).
- Grants:
  - `authenticated`, `anon`: SELECT.
  - `service_role`: ALL privileges (for writes from server-side).

Implication:
- The browser (public) can safely read new tables/views to power the UI.
- All mutations (e.g., creating a series, mapping markets, toggling rollover) must occur on the server using the service role credentials.

## Operational Workflows

### Onboarding a New Series

1) Create a `market_series` row with `slug`, `underlying_symbol`, `base_asset`, `quote_asset`.
2) Map existing market(s) into the series via `series_markets` with appropriate `sequence` values.
3) Mark one as `is_primary=true` to define default routing.

```sql
insert into public.market_series (slug, underlying_symbol, base_asset, quote_asset)
values ('BTC-MONTHLY', 'BTC', 'BTC', 'USD')
on conflict (slug) do nothing;

insert into public.series_markets (series_id, market_id, contract_code, sequence, is_primary)
values ($series_id, $marketAId, 'NOV-2025', 1, true);
```

### Launching the Next Contract (B)

1) Insert a `series_markets` row for B with a higher `sequence`:
```sql
insert into public.series_markets (series_id, market_id, contract_code, sequence, is_primary)
values ($series_id, $marketBId, 'DEC-2025', 2, false)
on conflict (series_id, market_id) do update
  set sequence = excluded.sequence, is_primary = excluded.is_primary;
```
2) Start the overlap:
```sql
insert into public.market_rollovers (series_id, from_market_id, to_market_id, is_active)
values ($series_id, $marketAId, $marketBId, true)
on conflict (series_id, from_market_id, to_market_id)
do update set is_active = excluded.is_active;
```
3) Optionally flip default routing to B when ready:
```sql
update public.series_markets set is_primary = false where series_id = $series_id;
update public.series_markets set is_primary = true
where series_id = $series_id and market_id = $marketBId;
```

### Ending the Overlap

- When A settles on-chain, end the overlap:
```sql
update public.market_rollovers
set is_active = false
where series_id = $series_id and from_market_id = $marketAId and to_market_id = $marketBId;
```
- Optionally mark A inactive in `public.markets` if you want to hide it from general lists:
```sql
update public.markets set is_active = false where id = $marketAId;
```

## Frontend Integration

The browser uses the public Supabase client (e.g., `src/lib/supabase-browser.ts`) to read:

1) Default routing per series:
```sql
select series_id, slug, primary_market_id
from public.v_series_routing;
```
2) Active overlap pairs:
```sql
select series_id, from_market_id, to_market_id, series_slug
from public.v_active_rollover_pairs;
```
3) Market details for whichever `market_id`s you plan to display:
```sql
select *
from public.markets
where id in ($from_market_id, $to_market_id, $primary_market_id);
```

Example TypeScript (client-side read-only):

```ts
import getSupabaseClient from '@/src/lib/supabase-browser';

export async function fetchSeriesRoutingAndRollovers() {
  const supabase = getSupabaseClient();

  const [{ data: routing, error: routingErr }, { data: rollovers, error: rollErr }] = await Promise.all([
    supabase.from('v_series_routing').select('series_id, slug, primary_market_id'),
    supabase.from('v_active_rollover_pairs').select('series_id, from_market_id, to_market_id, series_slug')
  ]);

  if (routingErr) throw routingErr;
  if (rollErr) throw rollErr;

  return { routing: routing ?? [], rollovers: rollovers ?? [] };
}
```

UI recipe:
- Show one “instrument” tile per series using `v_series_routing.slug`.
- Default to `primary_market_id` for each series.
- If a row exists in `v_active_rollover_pairs` for a series, show both `from_market_id` and `to_market_id` (e.g., tabs or toggle) and label them using `series_markets.contract_code` if provided.

## Server Integration (Writes)

Use the server-side Supabase client (with `service_role`):
- File reference: `src/lib/supabase-admin.ts`
- Env vars: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`

Typical writes:
- Insert/update `market_series`.
- Upsert `series_markets` (set `sequence`, flip `is_primary`).
- Upsert `market_rollovers` (toggle `is_active`).

Idempotency:
- Prefer `on conflict` upserts to safely re-run operational scripts.
- The partial unique index on `is_primary` enforces one primary per series.
- The integrity trigger blocks cross-series rollover pairs.

## Integrity, Performance, and Safety

- Integrity:
  - FK constraints on series and markets.
  - Trigger enforces membership of both sides of rollover pairs.
  - Unique constraints prevent duplicate mappings and duplicate pairs.
- Performance:
  - Indexes on `series_id`, partial unique on primary, and active rollover help common queries.
  - Trigger cost is minimal (two indexed EXISTS checks per write to `market_rollovers`).
- Safety:
  - Public reads, server-only writes via RLS.
  - No on-chain scheduling in the DB; overlap is a simple boolean.

## End-to-End Example (A → B)

Given two markets `A` and `B` in `public.markets`:
1) Create series `A-SERIES`, map `A` (sequence 1, `is_primary=true`) and `B` (sequence 2).
2) Start the overlap: insert `market_rollovers (A → B)` with `is_active=true`.
3) Optionally switch primary routing to `B` at any time.
4) When `A` is settled on-chain, set `is_active=false` to end overlap.

Verification queries:

```sql
-- Confirm routing
select * from public.v_series_routing where slug = 'A-SERIES';

-- Confirm overlap visible to UI
select * from public.v_active_rollover_pairs where series_slug = 'A-SERIES';

-- Inspect series membership and ordering
select m.symbol, m.market_identifier, s.slug, sm.sequence, sm.is_primary
from public.series_markets sm
join public.markets m on m.id = sm.market_id
join public.market_series s on s.id = sm.series_id
where s.slug = 'A-SERIES'
order by sm.sequence;
```

## Troubleshooting

- “from_market_id is not a member of series”: Add or fix `series_markets` entries for that series before inserting the rollover.
- “duplicate key value violates unique constraint (series_id, sequence)”: Adjust `sequence` to be unique within the series.
- “duplicate key value violates unique constraint (series_id, from_market_id, to_market_id)”: The pair already exists; use `on conflict` … `do update` for `is_active`.
- Primary routing conflicts: The partial unique index ensures one primary per series. Clear all `is_primary` then set the one you want to true.

## Extensions (Optional)

- Enforce `to.sequence > from.sequence` via an additional trigger if your operational model benefits from it.
- Add audit trails (e.g., a history log table for primary flips), if change history is required.
- Add validation that `markets.is_active=true` for both markets when `is_active=true` in rollovers (soft rule).

## Quick Reference

- Tables:
  - `market_series`: instrument families across expiries
  - `series_markets`: series→market mapping; order + default routing
  - `market_rollovers`: active overlap pairs (from→to)
- Views:
  - `v_series_routing`: default market per series (primary)
  - `v_active_rollover_pairs`: currently active overlaps
- Function/Trigger:
  - `fn_rollover_markets_belong_to_series`, `trg_rollover_membership`
- RLS:
  - Public SELECT; server-only writes via `service_role`





