/**
 * Test script for Metric Discovery API
 * 
 * Usage:
 *   npx tsx scripts/test-metric-discovery.ts
 * 
 * Prerequisites:
 *   - SERPAPI_KEY must be set in .env.local
 *   - OPENAI_API_KEY must be set in .env.local
 *   - Next.js dev server must be running
 */

const TEST_CASES = [
  {
    name: 'Valid measurable metric - Bitcoin price',
    description: 'Current price of Bitcoin in USD',
    expectedMeasurable: true,
  },
  {
    name: 'Valid measurable metric - Gold price',
    description: 'Spot price of gold per ounce',
    expectedMeasurable: true,
  },
  {
    name: 'Ambiguous metric',
    description: 'How happy people are today',
    expectedMeasurable: false,
  },
  {
    name: 'Subjective metric',
    description: 'Which movie is the best',
    expectedMeasurable: false,
  },
  {
    name: 'Complex but measurable',
    description: 'US unemployment rate for December 2024',
    expectedMeasurable: true,
  },
];

async function testMetricDiscovery() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  
  console.log('🧪 Testing Metric Discovery API\n');
  console.log(`Base URL: ${baseUrl}\n`);

  for (const testCase of TEST_CASES) {
    console.log(`\n📝 Test: ${testCase.name}`);
    console.log(`   Description: "${testCase.description}"`);
    console.log(`   Expected measurable: ${testCase.expectedMeasurable}`);

    try {
      const startTime = Date.now();
      
      const response = await fetch(`${baseUrl}/api/metric-discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: testCase.description }),
      });

      const elapsed = Date.now() - startTime;
      const data = await response.json();

      if (!response.ok) {
        console.log(`   ❌ FAILED: ${data.error || 'Unknown error'}`);
        console.log(`      Message: ${data.message || 'No message'}`);
        continue;
      }

      const matches = data.measurable === testCase.expectedMeasurable;
      const icon = matches ? '✅' : '⚠️';
      
      console.log(`   ${icon} Result: ${data.measurable ? 'MEASURABLE' : 'NOT MEASURABLE'}`);
      console.log(`   ⏱️  Processing time: ${elapsed}ms`);

      if (data.measurable && data.metric_definition) {
        console.log(`   📊 Metric: ${data.metric_definition.metric_name}`);
        console.log(`   📏 Unit: ${data.metric_definition.unit}`);
        console.log(`   🌐 Scope: ${data.metric_definition.scope}`);
        console.log(`   ⏰ Time basis: ${data.metric_definition.time_basis}`);
        
        if (data.sources?.primary_source) {
          console.log(`   🔗 Primary source: ${data.sources.primary_source.authority}`);
          console.log(`   🎯 Confidence: ${Math.round(data.sources.primary_source.confidence * 100)}%`);
        }
      } else if (data.rejection_reason) {
        console.log(`   ℹ️  Rejection: ${data.rejection_reason.slice(0, 100)}...`);
      }

      if (!matches) {
        console.log(`   ⚠️  WARNING: Expected ${testCase.expectedMeasurable ? 'measurable' : 'not measurable'} but got ${data.measurable ? 'measurable' : 'not measurable'}`);
      }
    } catch (error) {
      console.log(`   ❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  console.log('\n\n✅ Test suite complete!\n');
}

// Run tests
testMetricDiscovery().catch(console.error);
