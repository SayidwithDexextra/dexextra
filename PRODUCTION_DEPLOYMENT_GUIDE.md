# DexExtra Production Deployment Guide

## 🚀 Prerequisites

Before deploying to production, ensure you have:

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Supabase Project**: Create a project at [supabase.com](https://supabase.com)
3. **Blockchain RPC Access**: Alchemy/Infura account for reliable blockchain access
4. **Domain Ready**: Custom domain configured (optional but recommended)

## 📋 Pre-Deployment Checklist

### ✅ Code Changes Completed
- [x] Fixed TypeScript linter errors
- [x] Removed hardcoded secrets from codebase
- [x] Created environment configuration
- [x] Optimized Next.js configuration
- [x] Added Vercel configuration

### ✅ Environment Variables Setup
- [ ] Configure all required environment variables in Vercel
- [ ] Test environment variables in preview deployment
- [ ] Verify blockchain connectivity with production RPC

### ✅ Database & Services
- [ ] Set up Supabase project and configure tables
- [ ] Run database migrations if needed
- [ ] Configure authentication providers

## 🔧 Step-by-Step Deployment

### Step 1: Prepare Your Repository

1. **Commit all changes:**
   ```bash
   git add .
   git commit -m "Prepare for production deployment"
   git push origin main
   ```

2. **Ensure your repository is clean:**
   ```bash
   # Check for any uncommitted changes
   git status
   
   # Verify no .env files are committed
   git ls-files | grep -E "\.env"
   ```

### Step 2: Configure Environment Variables

1. **Copy environment template:**
   ```bash
   cp env.example .env.local
   ```

2. **Fill in your production values in `.env.local`:**
   - Get Supabase URL and keys from your Supabase dashboard
   - Configure blockchain RPC URLs (recommend using Alchemy)
   - Set strong authentication secrets
   - Configure contract addresses

3. **Required Environment Variables:**
   ```bash
   # Core Application
   NODE_ENV=production
   APP_URL=https://your-domain.vercel.app
   
   # Supabase (get from Supabase dashboard)
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-actual-anon-key
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-actual-anon-key
   
   # Blockchain
   RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
   WS_RPC_URL=wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
   
   # Security
   AUTH_SECRET=$(openssl rand -base64 32)
   ```

### Step 3: Deploy to Vercel

#### Option A: Deploy via Vercel Dashboard
1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Configure environment variables in the dashboard
4. Deploy

#### Option B: Deploy via CLI
1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel:**
   ```bash
   vercel login
   ```

3. **Deploy:**
   ```bash
   vercel --prod
   ```

### Step 4: Configure Environment Variables in Vercel

1. Go to your project dashboard on Vercel
2. Navigate to **Settings** → **Environment Variables**
3. Add all variables from your `env.example` file:

**Critical Variables:**
- `NODE_ENV` = `production`
- `APP_URL` = `https://your-domain.vercel.app`
- `SUPABASE_URL` = Your Supabase project URL
- `SUPABASE_ANON_KEY` = Your Supabase anon key
- `NEXT_PUBLIC_SUPABASE_URL` = Same as SUPABASE_URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = Same as SUPABASE_ANON_KEY
- `RPC_URL` = Your blockchain RPC endpoint
- `AUTH_SECRET` = Strong random string (32+ characters)

### Step 5: Verify Deployment

1. **Check build logs:**
   - No environment variable errors
   - All dependencies installed successfully
   - Build completed without warnings

2. **Test functionality:**
   - Homepage loads correctly
   - Wallet connection works
   - API endpoints respond
   - Database queries work
   - Blockchain interactions function

3. **Monitor for errors:**
   ```bash
   # Check Vercel function logs
   vercel logs --follow
   ```

## 🔒 Security Checklist

### Environment Variables
- [ ] No hardcoded secrets in code
- [ ] All sensitive variables use environment variables
- [ ] Production secrets are different from development
- [ ] Supabase RLS (Row Level Security) is enabled

### Headers & CORS
- [ ] Security headers configured (handled by `next.config.ts`)
- [ ] CORS properly configured for your domain
- [ ] Content Security Policy implemented

### Blockchain Security
- [ ] Using secure RPC endpoints (HTTPS/WSS)
- [ ] Contract addresses verified
- [ ] Rate limiting implemented for API calls

## 🚨 Troubleshooting

### Common Issues

**Build Fails:**
```bash
# Check for TypeScript errors
npm run build

# Check for linting issues  
npm run lint
```

**Environment Variable Errors:**
- Verify all required variables are set in Vercel dashboard
- Check variable names match exactly (case-sensitive)
- Ensure `NEXT_PUBLIC_` prefix for client-side variables

**API Routes Not Working:**
- Check function timeout settings in `vercel.json`
- Verify environment variables for database/blockchain access
- Check Vercel function logs for detailed errors

**Blockchain Connection Issues:**
- Verify RPC URL is accessible
- Check if RPC provider allows Vercel's IP ranges
- Test with alternative RPC providers

### Debug Commands

```bash
# Test environment variables locally
npm run build
npm run start

# Check specific environment variables
vercel env ls

# Pull environment variables for local testing
vercel env pull .env.local

# Check deployment logs
vercel logs --follow [deployment-url]
```

## 🚀 Post-Deployment

### Performance Monitoring
1. Set up Vercel Analytics
2. Monitor API response times
3. Track blockchain interaction success rates
4. Set up error monitoring (Sentry, LogRocket, etc.)

### SEO & Marketing
1. Configure custom domain
2. Set up proper meta tags
3. Configure sitemap.xml
4. Set up Google Analytics

### Maintenance
1. Regularly update dependencies
2. Monitor security advisories
3. Test contract interactions on testnets first
4. Keep environment variables secure and rotated

## 📞 Support

If you encounter issues:

1. **Check Vercel Documentation**: [vercel.com/docs](https://vercel.com/docs)
2. **Next.js Documentation**: [nextjs.org/docs](https://nextjs.org/docs)
3. **Supabase Documentation**: [supabase.com/docs](https://supabase.com/docs)
4. **Review project logs**: `vercel logs --follow`

## 🎉 Success!

Once deployed successfully, your DexExtra platform will be live at:
- **Production URL**: `https://your-domain.vercel.app`
- **Custom Domain**: `https://your-custom-domain.com` (if configured)

Monitor the deployment and enjoy your live DeFi trading platform! 🚀 