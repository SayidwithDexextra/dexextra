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