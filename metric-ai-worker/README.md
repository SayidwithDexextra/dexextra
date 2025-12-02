# Dexextra Metric AI Worker

Standalone Next.js microservice that performs background AI metric analysis and persists results to Supabase. Designed to be deployed as a separate Vercel Project with Root Directory set to `metric-ai-worker/`.

## Endpoints

- POST `/api/metric-ai`
  - Body:
    ```json
    {
      "metric": "BTC price (USD)",
      "description": "Propose start price",
      "urls": ["https://www.coindesk.com/price/bitcoin/"],
      "related_market_identifier": "BTC",
      "context": "create"
    }
    ```
  - Returns: `202` with `{ jobId, statusUrl }`
  - Work runs in background via `after()` and writes to:
    - `metric_oracle_jobs`
    - `metric_oracle_resolutions`
    - Optional back-link to `markets.metric_resolution_id`

- GET `/api/metric-ai?jobId=...`
  - Returns job status and, if completed, the AI resolution payload

## Environment Variables

- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional; default `gpt-4.1`)
- `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL` (required)
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY` (required)
- `ALLOW_ORIGIN` (optional; set to your app origin for CORS, e.g. `https://yourapp.com`)
- `APP_URL` (optional; used in User-Agent)

## Vercel Setup

1. Create a new Vercel Project in team "dexetra's projects"
2. Root Directory: `metric-ai-worker/`
3. Framework Preset: Next.js
4. Add the env vars above (Production + Preview)
5. Deploy

## Example cURL

```bash
curl -X POST "https://<worker>.vercel.app/api/metric-ai" \
  -H "Content-Type: application/json" \
  -d '{
        "metric": "BTC price (USD)",
        "urls": ["https://www.coindesk.com/price/bitcoin/"],
        "related_market_identifier": "BTC",
        "context": "create"
      }'
```


