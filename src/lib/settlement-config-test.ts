/**
 * Settlement Configuration Test Utility
 * 
 * This utility helps verify that your settlement configuration is properly set up.
 * Run this to test your SETTLEMENT_PRIVATE_KEY configuration.
 */

import { env } from '@/lib/env';
import { createWalletClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

export class SettlementConfigTest {
  /**
   * Test all aspects of settlement configuration
   */
  static async runFullTest(): Promise<void> {
    console.log('🧪 Running Settlement Configuration Test...\n');
    
    // Test 1: Environment Variables
    console.log('📋 Test 1: Environment Variables');
    this.testEnvironmentVariables();
    
    // Test 2: Private Key Format
    console.log('\n🔑 Test 2: Private Key Format');
    this.testPrivateKeyFormat();
    
    // Test 3: Wallet Creation
    console.log('\n💼 Test 3: Wallet Creation');
    await this.testWalletCreation();
    
    // Test 4: RPC Connectivity  
    console.log('\n🌐 Test 4: RPC Connectivity');
    await this.testRpcConnectivity();
    
    console.log('\n✅ Settlement Configuration Test Complete!');
  }
  
  /**
   * Test environment variable availability
   */
  private static testEnvironmentVariables(): void {
    const requiredVars = [
      'SETTLEMENT_PRIVATE_KEY',
      'RPC_URL',
      'CHAIN_ID',
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];
    
    console.log('   Checking required environment variables:');
    for (const varName of requiredVars) {
      const value = env[varName as keyof typeof env];
      const status = value ? '✅' : '❌';
      console.log(`   ${status} ${varName}: ${value ? 'Set' : 'Missing'}`);
    }
    
    // Check process.env directly for debugging
    console.log('\n   Direct process.env check:');
    console.log(`   SETTLEMENT_PRIVATE_KEY in process.env: ${!!process.env.SETTLEMENT_PRIVATE_KEY}`);
    if (process.env.SETTLEMENT_PRIVATE_KEY) {
      console.log(`   Length: ${process.env.SETTLEMENT_PRIVATE_KEY.length} characters`);
      console.log(`   Starts with 0x: ${process.env.SETTLEMENT_PRIVATE_KEY.startsWith('0x')}`);
    }
  }
  
  /**
   * Test private key format validation
   */
  private static testPrivateKeyFormat(): void {
    const privateKey = env.SETTLEMENT_PRIVATE_KEY;
    
    if (!privateKey) {
      console.log('   ❌ SETTLEMENT_PRIVATE_KEY not found');
      return;
    }
    
    console.log('   ✅ SETTLEMENT_PRIVATE_KEY found');
    console.log(`   Length: ${privateKey.length} characters`);
    console.log(`   Starts with 0x: ${privateKey.startsWith('0x')}`);
    console.log(`   Valid format: ${privateKey.startsWith('0x') && privateKey.length === 66}`);
    
    if (privateKey.startsWith('0x') && privateKey.length === 66) {
      console.log('   ✅ Private key format is valid');
    } else {
      console.log('   ❌ Private key format is invalid');
      console.log('   Expected: 0x followed by 64 hexadecimal characters');
    }
  }
  
  /**
   * Test wallet creation from private key
   */
  private static async testWalletCreation(): Promise<void> {
    try {
      const privateKey = env.SETTLEMENT_PRIVATE_KEY;
      
      if (!privateKey) {
        console.log('   ❌ Cannot test wallet creation - private key missing');
        return;
      }
      
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      console.log('   ✅ Wallet account created successfully');
      console.log(`   Address: ${account.address}`);
      
    } catch (error) {
      console.log('   ❌ Failed to create wallet account');
      console.log(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Test RPC connectivity
   */
  private static async testRpcConnectivity(): Promise<void> {
    try {
      const privateKey = env.SETTLEMENT_PRIVATE_KEY;
      
      if (!privateKey) {
        console.log('   ❌ Cannot test RPC connectivity - private key missing');
        return;
      }
      
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      const client = createWalletClient({
        account,
        chain: polygon,
        transport: http(env.RPC_URL)
      });
      
      console.log('   ✅ Wallet client created successfully');
      console.log(`   RPC URL: ${env.RPC_URL}`);
      console.log(`   Chain: ${polygon.name} (ID: ${polygon.id})`);
      
      // Test basic RPC call
      const chainId = await client.getChainId();
      console.log(`   ✅ RPC connection successful - Chain ID: ${chainId}`);
      
    } catch (error) {
      console.log('   ❌ RPC connectivity test failed');
      console.log(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Quick check - just verify if settlement is ready
   */
  static isSettlementReady(): boolean {
    const privateKey = env.SETTLEMENT_PRIVATE_KEY;
    const validFormat = privateKey && privateKey.startsWith('0x') && privateKey.length === 66;
    const hasRequiredEnv = !!(env.RPC_URL && env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
    
    return !!(validFormat && hasRequiredEnv);
  }
  
  /**
   * Get settlement wallet address
   */
  static getSettlementWalletAddress(): string | null {
    try {
      const privateKey = env.SETTLEMENT_PRIVATE_KEY;
      if (!privateKey) return null;
      
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      return account.address;
    } catch {
      return null;
    }
  }
}

// Export for direct usage
export const testSettlementConfig = SettlementConfigTest.runFullTest;
export const isSettlementReady = SettlementConfigTest.isSettlementReady;
export const getSettlementWalletAddress = SettlementConfigTest.getSettlementWalletAddress;
