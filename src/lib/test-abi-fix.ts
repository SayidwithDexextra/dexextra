/**
 * Test ABI loading and validation
 * Run this in the browser console to verify ABIs are loaded correctly
 */

import { getABIInfo } from './contractABIs';

export function testABILoading() {
  console.log('🧪 Testing ABI Loading...\n');

  // Test router ABI
  const routerInfo = getABIInfo('METRIC_VAMM_ROUTER');
  console.log('📋 Router ABI Info:', routerInfo);

  // Test specific methods
  const requiredMethods = ['getAllUserPositions', 'getPortfolioDashboard', 'getMetricPriceComparison'];
  const results = requiredMethods.map(method => ({
    method,
    exists: routerInfo.functions?.includes(method) || false
  }));

  console.log('🔍 Required Methods Check:');
  results.forEach(({ method, exists }) => {
    console.log(exists ? `✅ ${method}` : `❌ ${method} MISSING`);
  });

  // Overall result
  const allMethodsExist = results.every(r => r.exists);
  console.log('\n🎯 Overall Result:', allMethodsExist ? '✅ ALL METHODS FOUND' : '❌ METHODS MISSING');

  return {
    routerInfo,
    requiredMethods: results,
    allMethodsExist
  };
}

// Auto-run if in browser environment
if (typeof window !== 'undefined') {
  testABILoading();
} 