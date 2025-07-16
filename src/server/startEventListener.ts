/*
 * ⚠️ LEGACY CONTRACT MONITORING SYSTEM ⚠️
 * 
 * This file starts the old polling-based event listener that is NOT compatible 
 * with Vercel deployment due to long-running processes.
 * 
 * ✅ NEW SYSTEM: Webhooks are automatically handled by /api/webhooks/alchemy
 * 
 * The new webhook-based system doesn't need a separate server process:
 * - Events are delivered directly to API routes via webhooks
 * - No manual startup required - webhooks are registered automatically
 * - Fully serverless and Vercel compatible
 * 
 * This file is kept for local development and reference only.
 */

import 'dotenv/config'
import { getEventListener } from '@/services/eventListener'

// Boot‐up script that immediately starts the singleton listener.
// This file should only run in a backend / Node environment – never in the browser.

(async () => {
  try {
    console.log('Starting event listener...')
    const listener = await getEventListener()

    if (!listener.getStatus().isRunning) {
      await listener.start()
      console.log('🔄 Smart-contract event listener started')
    } else {
      console.log('✅ Event listener already running')
    }
  } catch (error) {
    console.error('❌ Failed to start Smart-contract event listener:', error)
    process.exit(1)
  }
})() 