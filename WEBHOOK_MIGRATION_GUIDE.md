# 🔄 Migration Guide: Polling → Alchemy Webhooks

This guide helps you migrate from the old polling-based event monitoring system to the new Alchemy Notify API webhook system, which is fully compatible with Vercel deployment.

## 🎯 Why Migrate?

The old polling system has several limitations that make it incompatible with Vercel:

### ❌ Old System Issues
- **Long-running processes** that don't work on serverless platforms
- **WebSocket connections** that timeout on Vercel
- **High RPC usage** leading to rate limiting
- **30-second polling delays** for event detection
- **Complex retry logic** that's hard to maintain

### ✅ New System Benefits
- **🚀 Vercel Compatible**: Fully serverless, no long-running processes
- **⚡ Real-time Events**: Immediate delivery via webhooks
- **📉 Reduced Costs**: 90% reduction in RPC calls
- **🛡️ Built-in Reliability**: Alchemy handles retries and failover
- **🔧 Easy Maintenance**: Less infrastructure to manage

## 📋 Prerequisites

Before starting the migration:

1. **Alchemy Account**: Get an API key from [Alchemy Dashboard](https://dashboard.alchemy.com/)
2. **Deployed App**: Your app must be accessible via HTTPS for webhooks
3. **Supabase Access**: Database should be running and accessible
4. **Deployed Contracts**: At least one VAMM contract deployed

## 🚀 Step-by-Step Migration

### Step 1: Environment Configuration

Add the required environment variables:

```bash
# Required for webhook monitoring
ALCHEMY_API_KEY=your-alchemy-api-key

# Required for webhook endpoint
APP_URL=https://your-app.vercel.app

# Optional: For production webhook security
ALCHEMY_WEBHOOK_SIGNING_KEY=your-webhook-signing-key
```

### Step 2: Database Migration

Run the database migration to add the webhook configuration table:

```sql
-- Run this in your Supabase SQL editor
-- File: database/migrations/002_create_webhook_configs.sql

CREATE TABLE IF NOT EXISTS webhook_configs (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
  address_activity_webhook_id VARCHAR(100) NOT NULL,
  mined_transaction_webhook_id VARCHAR(100) NOT NULL,
  contracts JSONB NOT NULL DEFAULT '[]',
  network VARCHAR(50) NOT NULL DEFAULT 'polygon',
  chain_id BIGINT NOT NULL DEFAULT 137,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Step 3: Run Migration Script

Execute the automated migration script:

```bash
# Make sure you're in the project root
npm run migrate-to-webhooks
```

The script will:
- ✅ Validate your environment configuration
- ✅ Scan for deployed contracts in your database
- ✅ Register webhooks with Alchemy
- ✅ Store webhook configuration in Supabase
- ✅ Test the webhook endpoint

### Step 4: Deploy to Vercel

Deploy your updated app to Vercel with the new webhook system:

```bash
# Deploy to Vercel
vercel --prod

# Or push to your connected Git repository
git add .
git commit -m "Migrate to Alchemy webhook system"
git push origin main
```

### Step 5: Verify Migration

Check that the webhook system is working:

```bash
# Check webhook status
npm run webhook-status

# Get detailed status
npm run webhook-status-detailed
```

You should see output like:
```json
{
  "status": "healthy",
  "system": "webhook-based", 
  "vercelCompatible": true,
  "listener": {
    "isInitialized": true,
    "webhooksActive": 2,
    "contractsMonitored": 3
  }
}
```

## 📊 System Comparison

| Feature | Old Polling System | New Webhook System |
|---------|-------------------|-------------------|
| **Vercel Compatible** | ❌ No | ✅ Yes |
| **Event Latency** | 30 seconds | < 1 second |
| **RPC Calls/Hour** | ~1,200 | ~10 |
| **Infrastructure** | Complex | Simple |
| **Reliability** | Manual retries | Automatic |
| **Maintenance** | High | Low |

## 🔧 API Endpoints

The new webhook system provides these endpoints:

### Webhook Handler
- **URL**: `/api/webhooks/alchemy`
- **Method**: `POST` (receives webhooks from Alchemy)
- **Method**: `GET` (health check)

### Status Monitoring
- **URL**: `/api/webhooks/alchemy/status`
- **Method**: `GET` (basic status)
- **Method**: `GET?detailed=true` (detailed status)
- **Method**: `POST` (initialize webhooks)

### Legacy Endpoints (Deprecated)
- `/api/events/trigger` - Marked as legacy
- `/api/event-listener` - Marked as legacy

## 🐛 Troubleshooting

### Common Issues

#### 1. "ALCHEMY_API_KEY is required"
**Solution**: Add your Alchemy API key to environment variables
```bash
ALCHEMY_API_KEY=your-actual-api-key
```

#### 2. "APP_URL is required for webhook endpoint"
**Solution**: Set APP_URL to your deployed application URL
```bash
APP_URL=https://your-app.vercel.app
```

#### 3. "No contracts found in database"
**Solution**: Deploy contracts first via the create-market wizard
- Go to `/create-market`
- Complete the market creation process
- Contracts will be automatically registered

#### 4. "Webhook endpoint returned non-200 status"
**Solution**: Ensure your app is deployed and accessible
- Check that the app is deployed to Vercel
- Verify the `/api/webhooks/alchemy` endpoint is accessible
- Check Vercel function logs for errors

#### 5. "Database connection failed"
**Solution**: Verify Supabase configuration
- Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Ensure database migrations have been run
- Verify network connectivity to Supabase

### Debug Commands

```bash
# Test webhook endpoint health
curl https://your-app.vercel.app/api/webhooks/alchemy

# Check webhook status
curl https://your-app.vercel.app/api/webhooks/alchemy/status

# Get detailed system status
curl "https://your-app.vercel.app/api/webhooks/alchemy/status?detailed=true"

# Test Alchemy API connection
node -e "console.log(process.env.ALCHEMY_API_KEY ? 'API key set' : 'API key missing')"
```

## 📚 File Structure Changes

### New Files Added
```
src/services/
├── alchemyNotifyService.ts     # Alchemy webhook management
└── webhookEventListener.ts     # Webhook-based event listener

src/app/api/webhooks/
├── alchemy/
│   ├── route.ts               # Webhook handler
│   └── status/
│       └── route.ts           # Status monitoring

database/migrations/
└── 002_create_webhook_configs.sql # Webhook config table

scripts/
└── migrate-to-alchemy-webhooks.js # Migration script
```

### Legacy Files (Marked as deprecated)
```
src/services/
├── eventListener.ts           # Legacy polling system
├── blockchainEventQuerier.ts  # Legacy event querying
└── server/startEventListener.ts # Legacy startup script
```

## 🔄 Rollback Plan

If you need to rollback to the old system temporarily:

1. **Disable webhooks** in Alchemy dashboard
2. **Revert environment variables** (remove ALCHEMY_API_KEY)
3. **Use legacy endpoints** (though they won't work on Vercel)
4. **Local development only** (old system doesn't work on Vercel)

**Note**: The legacy system is deprecated and will be removed in future versions.

## ✅ Migration Checklist

Use this checklist to ensure complete migration:

- [ ] Added `ALCHEMY_API_KEY` to environment variables
- [ ] Added `APP_URL` to environment variables
- [ ] Run database migration (002_create_webhook_configs.sql)
- [ ] Executed migration script (`npm run migrate-to-webhooks`)
- [ ] Deployed app to Vercel
- [ ] Verified webhook status (`npm run webhook-status`)
- [ ] Tested event reception (create a test transaction)
- [ ] Updated monitoring to use new endpoints
- [ ] Removed references to old event listener scripts

## 🎉 Success Criteria

Your migration is successful when:

1. **Webhook Status**: `/api/webhooks/alchemy/status` returns `"status": "healthy"`
2. **Active Webhooks**: Shows 2+ active webhooks
3. **Event Reception**: New events appear in database via webhooks
4. **Vercel Deployment**: App deploys and runs without issues
5. **No Polling**: Old polling processes are disabled

## 📞 Support

If you need help with the migration:

1. **Check the troubleshooting section** above
2. **Review Vercel deployment logs** for errors
3. **Check Alchemy dashboard** for webhook status
4. **Verify Supabase logs** for database connectivity

## 🔜 Next Steps

After successful migration:

1. **Monitor webhook performance** via status endpoints
2. **Remove legacy code references** in production
3. **Update documentation** for your team
4. **Set up monitoring alerts** for webhook health
5. **Consider adding webhook signing verification** for production security

Your app is now fully compatible with Vercel and benefits from real-time, reliable event monitoring! 🎉 