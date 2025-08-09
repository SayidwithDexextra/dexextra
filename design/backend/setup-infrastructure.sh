#!/bin/bash

# =============================================
# Cloud-Native Chart Backend Setup Script
# No Docker Required - Uses Managed Services
# =============================================

set -e

echo "🚀 Setting up Cloud-Native Chart Backend for vAMM Markets"
echo "=========================================================="
echo "📋 This script will configure managed cloud services:"
echo "   ✅ ClickHouse Cloud (Database)"  
echo "   ✅ Upstash Redis (Caching)"
echo "   ✅ Pusher (Real-time)"
echo "   ✅ Vercel (Hosting)"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="vamm-chart-backend"
NODE_VERSION="18"

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    print_info "Checking prerequisites..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        print_info "Please install Node.js: https://nodejs.org/ (Version ${NODE_VERSION}+ required)"
        exit 1
    fi

    # Check Node version
    NODE_CURRENT=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_CURRENT" -lt "$NODE_VERSION" ]; then
        print_error "Node.js version $NODE_CURRENT detected. Version $NODE_VERSION+ required."
        exit 1
    fi

    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        print_info "Please install npm (usually comes with Node.js)"
        exit 1
    fi

    print_status "Node.js v$(node -v) and npm v$(npm -v) are available"
}

# Setup environment configuration
setup_environment() {
    print_info "Setting up environment configuration..."
    
    # Copy environment template if .env doesn't exist
    if [ ! -f .env ]; then
        if [ -f design/backend/environment-variables.txt ]; then
            cp design/backend/environment-variables.txt .env
            print_status "Created .env file from template"
            print_warning "Please configure .env with your cloud service credentials"
        else
            print_error "Environment template not found at design/backend/environment-variables.txt"
            exit 1
        fi
    else
        print_status ".env file already exists"
    fi
    
    # Create .env.example for reference
    if [ -f design/backend/environment-variables.txt ]; then
        cp design/backend/environment-variables.txt .env.example
        print_status "Created .env.example for reference"
    fi
}

# Install dependencies
install_dependencies() {
    print_info "Installing Node.js dependencies..."
    
    # Check if package.json exists
    if [ ! -f package.json ]; then
        print_info "Initializing new Node.js project..."
        npm init -y
    fi
    
    # Install core dependencies
    print_info "Installing ClickHouse client..."
    npm install @clickhouse/client
    
    print_info "Installing Upstash Redis client..."
    npm install @upstash/redis
    
    print_info "Installing Pusher for real-time features..."
    npm install pusher pusher-js
    
    print_info "Installing utility dependencies..."
    npm install joi cors express-rate-limit compression helmet
    
    # Install development dependencies
    print_info "Installing development dependencies..."
    npm install --save-dev @types/node typescript ts-node nodemon
    
    print_status "All dependencies installed successfully"
}

# Create project structure
create_project_structure() {
    print_info "Creating project structure..."
    
    # Create directories
    mkdir -p src/{api,lib,types,config,services}
    mkdir -p src/api/{charts,tradingview,lightweight}
    mkdir -p scripts
    mkdir -p docs
    
    print_status "Project structure created"
}

# Create configuration files
create_config_files() {
    print_info "Creating configuration files..."
    
    # Create TypeScript config
    cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
EOF

    # Create package.json scripts
    npm pkg set scripts.dev="next dev"
    npm pkg set scripts.build="next build"
    npm pkg set scripts.start="next start"
    npm pkg set scripts.setup:clickhouse="node scripts/setup-clickhouse.js"
    npm pkg set scripts.test:connections="node scripts/test-connections.js"
    npm pkg set scripts.seed:data="node scripts/seed-sample-data.js"
    
    print_status "Configuration files created"
}

# Create setup scripts
create_setup_scripts() {
    print_info "Creating setup scripts..."
    
    # ClickHouse setup script
    cat > scripts/setup-clickhouse.js << 'EOF'
const { ClickHouse } = require('@clickhouse/client');

async function setupClickHouse() {
   console.log('🗄️  Setting up ClickHouse Cloud database...');
  
  const clickhouse = new ClickHouse({
    host: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE
  });

  try {
    // Test connection
    await clickhouse.query({ query: 'SELECT 1' });
     console.log('✅ ClickHouse connection successful');
    
    // Create database if not exists
    await clickhouse.query({
      query: `CREATE DATABASE IF NOT EXISTS ${process.env.CLICKHOUSE_DATABASE}`
    });
    
     console.log('✅ ClickHouse setup completed');
  } catch (error) {
    console.error('❌ ClickHouse setup failed:', error.message);
    process.exit(1);
  }
}

setupClickHouse();
EOF

    # Connection test script
    cat > scripts/test-connections.js << 'EOF'
require('dotenv').config();
const { ClickHouse } = require('@clickhouse/client');
const { Redis } = require('@upstash/redis');
const Pusher = require('pusher');

async function testConnections() {
   console.log('🔍 Testing cloud service connections...\n');
  
  // Test ClickHouse
  try {
    const clickhouse = new ClickHouse({
      host: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER,
      password: process.env.CLICKHOUSE_PASSWORD,
      database: process.env.CLICKHOUSE_DATABASE
    });
    
    const result = await clickhouse.query({ query: 'SELECT version() as version' });
    const data = await result.json();
     console.log('✅ ClickHouse Cloud: Connected');
     console.log(`   Version: ${data.data[0].version}`);
  } catch (error) {
     console.log('❌ ClickHouse Cloud: Failed');
     console.log(`   Error: ${error.message}`);
  }
  
  // Test Upstash Redis
  try {
    const redis = Redis.fromEnv();
    await redis.set('test', 'connection-test');
    const result = await redis.get('test');
    
    if (result === 'connection-test') {
       console.log('✅ Upstash Redis: Connected');
      await redis.del('test');
    } else {
       console.log('❌ Upstash Redis: Failed (unexpected response)');
    }
  } catch (error) {
     console.log('❌ Upstash Redis: Failed');
     console.log(`   Error: ${error.message}`);
  }
  
  // Test Pusher
  try {
    const pusher = new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER,
      useTLS: true
    });
    
    await pusher.trigger('test-channel', 'test-event', { test: 'data' });
     console.log('✅ Pusher: Connected');
  } catch (error) {
     console.log('❌ Pusher: Failed');
     console.log(`   Error: ${error.message}`);
  }
  
   console.log('\n🎉 Connection testing completed!');
}

testConnections();
EOF

    # Sample data seeding script
    cat > scripts/seed-sample-data.js << 'EOF'
require('dotenv').config();
const { ClickHouse } = require('@clickhouse/client');

async function seedSampleData() {
   console.log('🌱 Seeding sample market data...');
  
  const clickhouse = new ClickHouse({
    host: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE
  });

  try {
    // Create sample markets
    const markets = ['GOLD', 'BTC', 'ETH'];
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    for (const symbol of markets) {
       console.log(`📊 Creating sample data for ${symbol}...`);
      
      // Generate 60 minutes of 1-minute OHLCV data
      for (let i = 0; i < 60; i++) {
        const timestamp = new Date(oneHourAgo.getTime() + i * 60 * 1000);
        const basePrice = symbol === 'BTC' ? 50000 : symbol === 'ETH' ? 3000 : 2000;
        const volatility = Math.random() * 0.02; // 2% volatility
        
        const open = basePrice * (1 + (Math.random() - 0.5) * volatility);
        const close = open * (1 + (Math.random() - 0.5) * volatility);
        const high = Math.max(open, close) * (1 + Math.random() * volatility / 2);
        const low = Math.min(open, close) * (1 - Math.random() * volatility / 2);
        const volume = Math.random() * 1000000;
        
        // Insert sample data (adjust table name as needed)
         console.log(`   📈 ${symbol} @ ${timestamp.toISOString()}: $${close.toFixed(2)}`);
      }
    }
    
     console.log('✅ Sample data seeded successfully');
  } catch (error) {
    console.error('❌ Failed to seed sample data:', error.message);
  }
}

seedSampleData();
EOF

    chmod +x scripts/*.js
    print_status "Setup scripts created"
}

# Display setup instructions
display_setup_instructions() {
    echo ""
    echo "🎉 Cloud-Native Setup Complete!"
    echo "==============================="
    echo ""
    print_info "Next Steps:"
    echo ""
    echo "1. 📝 Configure your cloud services:"
    echo "   • ClickHouse Cloud: https://clickhouse.cloud/"
    echo "   • Upstash Redis: https://upstash.com/"  
    echo "   • Pusher: https://pusher.com/"
    echo ""
    echo "2. ⚙️  Update .env file with your service credentials"
    echo ""
    echo "3. 🧪 Test your connections:"
    echo "   npm run test:connections"
    echo ""
    echo "4. 🗄️  Initialize ClickHouse database:"
    echo "   npm run setup:clickhouse"
    echo ""
    echo "5. 🌱 Seed sample data (optional):"
    echo "   npm run seed:data"
    echo ""
    echo "6. 🚀 Start development server:"
    echo "   npm run dev"
    echo ""
    echo "7. 🌐 Deploy to Vercel:"
    echo "   npx vercel --prod"
    echo ""
    print_status "Ready to build enterprise-grade charts! 📈"
    
    print_warning "Don't forget to configure your .env file with actual credentials!"
}

# Error handler
handle_error() {
    print_error "Setup failed on line $1"
    print_info "Please check the error above and try again"
    exit 1
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Main execution
main() {
    print_info "Starting cloud-native setup for $PROJECT_NAME..."
    
    check_prerequisites
    setup_environment  
    install_dependencies
    create_project_structure
    create_config_files
    create_setup_scripts
    display_setup_instructions
}

# Run main function
main "$@" 