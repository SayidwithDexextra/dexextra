# 🔍 Event Pipeline Diagnostic Scripts

This directory contains diagnostic scripts to help troubleshoot your DEX event processing system.

## 📋 Available Scripts

### `diagnose-event-pipeline.js` - Comprehensive Pipeline Test

This is the main diagnostic script that tests your entire event processing pipeline from blockchain to database.

#### What it tests:
1. **RPC Connectivity** - Tests connection to your blockchain RPC endpoint
2. **Database Connectivity** - Verifies Supabase connection and table access
3. **Contract Configurations** - Checks deployed contracts in your database
4. **Blockchain Event Queries** - Tests direct blockchain event retrieval
5. **Event Formatting Logic** - Validates event parsing and formatting
6. **Event Listener API** - Checks if your event listener service is running
7. **Full Pipeline Simulation** - End-to-end test with mock data

#### How to run:
```bash
# Using npm script (recommended)
npm run diagnose-pipeline

# Or directly
node scripts/diagnose-event-pipeline.js
```

#### What to expect:
The script will output detailed step-by-step information about each test, including:
- ✅ Success indicators for working components
- ❌ Error indicators with specific troubleshooting tips
- 📊 Statistics about events found
- 💡 Recommendations for fixing issues

#### Example output:
```
🔍 EVENT PIPELINE DIAGNOSTIC SCRIPT
=====================================

📋 Configuration loaded:
   - RPC URL: http://localhost:8545
   - WebSocket URL: ws://localhost:8545
   - Chain ID: 31337
   - Batch Size: 400
   - Supabase: Configured ✅

🔗 STEP 1: Testing RPC Connectivity
-----------------------------------
   ✅ Connected to network: unknown (Chain ID: 31337)
   ✅ Current block: 150234
   ✅ Latest block hash: 0xabc123...

📊 STEP 2: Testing Database Connectivity
----------------------------------------
   ✅ Database connectivity successful
   📊 Total events in database: 42
   📈 Recent event types: { PositionOpened: 5, PositionClosed: 3 }

... and so on
```

## 🔧 Common Issues and Solutions

### RPC Connectivity Failed
- Check your `RPC_URL` in `.env.local`
- Ensure your blockchain node is running
- Verify network connectivity

### Database Connectivity Failed
- Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`
- Verify Supabase project is active
- Check if database tables exist

### No Contracts Found
- Deploy contracts using the create-market wizard
- Check if contracts are marked as active in database
- Verify contract addresses are correct

### No Events Found
- Check if contracts are generating events
- Verify block range is appropriate
- Ensure event listener is running (`npm run event-listener`)

### Event Listener API Not Responding
- Make sure Next.js app is running (`npm run dev`)
- Check if port 3000 is accessible
- Verify event listener service is started

## 📝 Other Scripts

### `test-event-system.js` - Quick Event System Test
Tests basic event system functionality.

### `diagnose-event-system.js` - Legacy Diagnostic
Older diagnostic script (use `diagnose-event-pipeline.js` instead).

### `fix-event-monitoring.js` - Event Monitoring Fix
Attempts to fix common event monitoring issues.

## 🎯 When to Use These Scripts

1. **After initial setup** - Verify everything is working
2. **When events aren't showing** - Identify where the pipeline is failing
3. **Before production deployment** - Ensure all components are healthy
4. **When troubleshooting** - Get detailed diagnostic information

## 📞 Getting Help

If the diagnostic script identifies issues you can't resolve:

1. Check the specific error messages and follow the 💡 recommendations
2. Review the relevant documentation in the `docs/` directory
3. Ensure all environment variables are properly configured
4. Verify your contracts are deployed and generating events

The diagnostic script is designed to be comprehensive and provide actionable feedback for any issues it finds. 