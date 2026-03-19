// This API endpoint is no longer needed - settlement is fully automated
// The settlement engine (src/lib/settlement-engine.ts) handles everything
// via the market-lifecycle cron route when markets reach their settlement date

export async function POST() {
  return Response.json({
    message: 'Settlement is now fully automated. Manual proposal no longer supported.',
    automated: true
  }, { status: 410 }) // 410 Gone
}

