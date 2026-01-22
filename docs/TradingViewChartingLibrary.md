# TradingView Charting Library Setup

This app uses the TradingView Charting Library for advanced charting. The library is not bundled with the repo and must be hosted locally under `public/charting_library`.

## 1. Install the Library

Download the TradingView charting library from the official source and copy it into:

```
public/charting_library/
```

Minimum required files:

- `public/charting_library/charting_library.min.js`
- `public/charting_library/` (all supporting assets)

## 2. Verify the Frontend

The chart component is:

- `TradingViewChart` for all layouts

If the library is missing, the UI will display an error message prompting you to install it.

## 3. Datafeed Endpoints

The charting library expects these endpoints:

- `GET /api/tradingview/config`
- `GET /api/tradingview/search?query=SYMBOL`
- `GET /api/tradingview/symbols?symbol=SYMBOL`
- `GET /api/tradingview/history`

## 4. Real-Time Updates

If Pusher is configured, the datafeed subscribes to:

- Channel: `market-{SYMBOL}`
- Event: `price-update`

Event payload format:

```
{ timestamp, open, high, low, close, volume }
```

## 5. Environment Variables

```
NEXT_PUBLIC_PUSHER_KEY=...
NEXT_PUBLIC_PUSHER_CLUSTER=...
```

## Notes

The TradingView Charting Library requires a commercial license for production usage. Contact TradingView for licensing details.

