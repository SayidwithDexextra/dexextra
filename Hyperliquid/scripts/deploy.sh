#!/bin/bash

# HyperLiquid Polygon Deployment Script
# This script handles the complete deployment and verification process

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check environment setup
check_environment() {
    print_status "Checking environment setup..."
    
    # Check if Node.js is installed
    if ! command_exists node; then
        print_error "Node.js is not installed. Please install Node.js first."
        exit 1
    fi
    
    # Check if npm is installed
    if ! command_exists npm; then
        print_error "npm is not installed. Please install npm first."
        exit 1
    fi
    
    # Check if Hardhat is available
    if ! command_exists npx; then
        print_error "npx is not available. Please update npm."
        exit 1
    fi
    
    print_success "Environment checks passed"
}

# Function to install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    
    if [ ! -d "node_modules" ]; then
        npm install
        print_success "Dependencies installed"
    else
        print_status "Dependencies already installed"
    fi
}

# Function to check network configuration
check_network_config() {
    local network=$1
    print_status "Checking network configuration for $network..."
    
    # Check if .env file exists
    if [ ! -f ".env.polygon" ] && [ ! -f ".env" ]; then
        print_warning "No .env.polygon or .env file found"
        print_status "Creating .env.polygon from template..."
        cp env.polygon.example .env.polygon
        print_warning "Please edit .env.polygon with your configuration before proceeding"
        exit 1
    fi
    
    # Load environment variables
    if [ -f ".env.polygon" ]; then
        source .env.polygon
    elif [ -f ".env" ]; then
        source .env
    fi
    
    # Check required variables
    if [ -z "$PRIVATE_KEY" ]; then
        print_error "PRIVATE_KEY not set in environment file"
        exit 1
    fi
    
    if [ -z "$POLYGONSCAN_API_KEY" ] && [ "$network" = "polygon" ]; then
        print_warning "POLYGONSCAN_API_KEY not set - verification may fail"
    fi
    
    print_success "Network configuration checked"
}

# Function to compile contracts
compile_contracts() {
    print_status "Compiling contracts..."
    
    npx hardhat compile --config hardhat.config.polygon.ts
    
    if [ $? -eq 0 ]; then
        print_success "Contracts compiled successfully"
    else
        print_error "Contract compilation failed"
        exit 1
    fi
}

# Function to run tests
run_tests() {
    print_status "Running tests..."
    
    npx hardhat test --config hardhat.config.polygon.ts
    
    if [ $? -eq 0 ]; then
        print_success "All tests passed"
    else
        print_error "Tests failed"
        exit 1
    fi
}

# Function to deploy contracts
deploy_contracts() {
    local network=$1
    print_status "Deploying contracts to $network..."
    
    npx hardhat run scripts/deploy-and-verify.ts --network $network --config hardhat.config.polygon.ts
    
    if [ $? -eq 0 ]; then
        print_success "Deployment completed successfully"
    else
        print_error "Deployment failed"
        exit 1
    fi
}

# Function to verify contracts only
verify_contracts() {
    local network=$1
    print_status "Verifying contracts on $network..."
    
    npx hardhat run scripts/verify-contracts.ts --network $network --config hardhat.config.polygon.ts
    
    if [ $? -eq 0 ]; then
        print_success "Verification completed successfully"
    else
        print_error "Verification failed"
        exit 1
    fi
}

# Function to batch verify from deployment file
batch_verify() {
    local network=$1
    print_status "Running batch verification for $network..."
    
    npx hardhat run scripts/batch-verify.ts --network $network --config hardhat.config.polygon.ts
    
    if [ $? -eq 0 ]; then
        print_success "Batch verification completed successfully"
    else
        print_error "Batch verification failed"
        exit 1
    fi
}

# Function to show help
show_help() {
    echo "HyperLiquid Polygon Deployment Script"
    echo ""
    echo "Usage: $0 [OPTIONS] COMMAND [NETWORK]"
    echo ""
    echo "Commands:"
    echo "  deploy         Deploy all contracts"
    echo "  verify         Verify already deployed contracts"
    echo "  batch-verify   Batch verify from deployment file"
    echo "  compile        Compile contracts only"
    echo "  test           Run tests only"
    echo "  full           Full pipeline: compile, test, deploy, verify"
    echo ""
    echo "Networks:"
    echo "  polygon        Polygon mainnet"
    echo "  mumbai         Polygon Mumbai testnet"
    echo "  localhost      Local hardhat network"
    echo ""
    echo "Options:"
    echo "  --skip-tests   Skip running tests"
    echo "  --skip-verify  Skip contract verification"
    echo "  --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 deploy polygon"
    echo "  $0 verify mumbai"
    echo "  $0 full polygon --skip-tests"
    echo "  $0 batch-verify polygon"
}

# Parse command line arguments
SKIP_TESTS=false
SKIP_VERIFY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-verify)
            SKIP_VERIFY=true
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

COMMAND=$1
NETWORK=${2:-polygon}

# Validate network
case $NETWORK in
    polygon|mumbai|localhost)
        ;;
    *)
        print_error "Invalid network: $NETWORK"
        echo "Supported networks: polygon, mumbai, localhost"
        exit 1
        ;;
esac

# Main execution
print_status "Starting HyperLiquid deployment process..."
print_status "Command: $COMMAND"
print_status "Network: $NETWORK"
print_status "Skip Tests: $SKIP_TESTS"
print_status "Skip Verify: $SKIP_VERIFY"
echo ""

case $COMMAND in
    compile)
        check_environment
        install_dependencies
        compile_contracts
        ;;
    test)
        check_environment
        install_dependencies
        compile_contracts
        run_tests
        ;;
    deploy)
        check_environment
        install_dependencies
        check_network_config $NETWORK
        compile_contracts
        if [ "$SKIP_TESTS" = false ]; then
            run_tests
        fi
        deploy_contracts $NETWORK
        ;;
    verify)
        check_environment
        install_dependencies
        check_network_config $NETWORK
        verify_contracts $NETWORK
        ;;
    batch-verify)
        check_environment
        install_dependencies
        check_network_config $NETWORK
        batch_verify $NETWORK
        ;;
    full)
        check_environment
        install_dependencies
        check_network_config $NETWORK
        compile_contracts
        if [ "$SKIP_TESTS" = false ]; then
            run_tests
        fi
        deploy_contracts $NETWORK
        if [ "$SKIP_VERIFY" = false ] && [ "$NETWORK" != "localhost" ]; then
            sleep 30  # Wait for contracts to be indexed
            verify_contracts $NETWORK
        fi
        ;;
    *)
        print_error "Unknown command: $COMMAND"
        echo ""
        show_help
        exit 1
        ;;
esac

print_success "Script execution completed successfully!"

# Final instructions
if [ "$COMMAND" = "deploy" ] || [ "$COMMAND" = "full" ]; then
    echo ""
    print_status "Next steps:"
    echo "1. Check the deployment report for contract addresses"
    echo "2. Update your frontend configuration with the new addresses"
    echo "3. Verify contracts on block explorer if not done automatically"
    if [ "$NETWORK" = "polygon" ]; then
        echo "4. Consider setting up monitoring for your contracts"
        echo "5. Update documentation with mainnet addresses"
    fi
fi
