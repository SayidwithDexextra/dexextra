// This API endpoint is no longer needed - settlement is fully automated
// The settlement-scheduler edge function handles everything automatically
// when markets become ACTIVE with settlement_date set

export async function POST() {
  return Response.json({
    message: 'Settlement is now fully automated. Manual proposal no longer supported.',
    automated: true
  }, { status: 410 }) // 410 Gone
}

