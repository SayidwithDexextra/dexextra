/**
 * Runtime Environment Loader
 * 
 * This module provides bulletproof environment variable loading that works
 * in all Next.js contexts including API routes, server components, and edge functions.
 */

import { config } from 'dotenv';
import path from 'path';

// Cache for loaded environment variables
let _envLoaded = false;
let _loadedVars: Record<string, string> = {};

/**
 * Force load environment variables from all possible sources
 */
export function forceLoadEnvironment(): void {
  if (_envLoaded) return;
  
  console.log('🔄 Force loading environment variables...');
  
  try {
    // Load from .env.local (highest priority)
    const envLocalPath = path.join(process.cwd(), '.env.local');
    const envLocal = config({ path: envLocalPath });
    if (envLocal.parsed) {
      Object.assign(_loadedVars, envLocal.parsed);
      console.log(`✅ Loaded ${Object.keys(envLocal.parsed).length} vars from .env.local`);
    }
    
    // Load from .env
    const envPath = path.join(process.cwd(), '.env');
    const envFile = config({ path: envPath });
    if (envFile.parsed) {
      // Don't override .env.local values
      Object.keys(envFile.parsed).forEach(key => {
        if (!_loadedVars[key]) {
          _loadedVars[key] = envFile.parsed![key];
        }
      });
      console.log(`✅ Loaded ${Object.keys(envFile.parsed).length} vars from .env`);
    }
    
    // Merge with process.env (process.env takes precedence)
    Object.keys(process.env).forEach(key => {
      if (process.env[key] !== undefined) {
        _loadedVars[key] = process.env[key]!;
      }
    });
    
    _envLoaded = true;
    console.log(`🎯 Total environment variables loaded: ${Object.keys(_loadedVars).length}`);
    
  } catch (error) {
    console.error('❌ Failed to force load environment:', error);
  }
}

/**
 * Get environment variable with bulletproof loading
 */
export function getEnvVar(key: string): string | undefined {
  forceLoadEnvironment();
  return _loadedVars[key] || process.env[key];
}

/**
 * Get settlement private key with maximum reliability
 */
export function getSettlementPrivateKey(): string | null {
  forceLoadEnvironment();
  
  // Try multiple sources in order of preference
  const sources = [
    _loadedVars['SETTLEMENT_PRIVATE_KEY'],
    process.env.SETTLEMENT_PRIVATE_KEY,
    _loadedVars['PRIVATE_KEY'], // Fallback
    process.env.PRIVATE_KEY     // Fallback
  ];
  
  for (const key of sources) {
    if (key && key.startsWith('0x') && key.length === 66) {
      console.log(`🔑 Found valid settlement private key from source`);
      return key;
    }
  }
  
  console.warn('⚠️ No valid settlement private key found in any source');
  console.log('🔍 Available keys:', Object.keys(_loadedVars).filter(k => k.includes('PRIVATE')));
  return null;
}

/**
 * Debug environment loading
 */
export function debugEnvironment(): void {
  forceLoadEnvironment();
  
  console.log('🐛 Environment Debug Info:');
  console.log(`  - _envLoaded: ${_envLoaded}`);
  console.log(`  - Total loaded vars: ${Object.keys(_loadedVars).length}`);
  console.log(`  - process.env keys: ${Object.keys(process.env).length}`);
  console.log(`  - SETTLEMENT_PRIVATE_KEY sources:`);
  console.log(`    - _loadedVars: ${!!_loadedVars['SETTLEMENT_PRIVATE_KEY']}`);
  console.log(`    - process.env: ${!!process.env.SETTLEMENT_PRIVATE_KEY}`);
  console.log(`    - _loadedVars PRIVATE_KEY: ${!!_loadedVars['PRIVATE_KEY']}`);
  console.log(`    - process.env PRIVATE_KEY: ${!!process.env.PRIVATE_KEY}`);
  
  // Show first 10 chars of keys for debugging (security safe)
  const privateKeys = Object.keys(_loadedVars).filter(k => k.includes('PRIVATE'));
  privateKeys.forEach(key => {
    const value = _loadedVars[key];
    console.log(`    - ${key}: ${value ? value.substring(0, 10) + '...' : 'undefined'}`);
  });
}
