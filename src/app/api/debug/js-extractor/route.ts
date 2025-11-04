import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PerformanceOptimizedMetricOracle } from '@/services/metric-oracle/PerformanceOptimizedMetricOracle';

let demoOracle: PerformanceOptimizedMetricOracle | null = null;
function getOracle() {
  if (!demoOracle) demoOracle = new PerformanceOptimizedMetricOracle();
  return demoOracle;
}

const InputSchema = z.object({
  metric: z.string().min(1).max(500),
  description: z.string().optional(),
  urls: z.array(z.string().url()).min(1).max(10)
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = InputSchema.parse(body);

    const oracle = getOracle();
    const resolution = await oracle.resolveMetricFast({
      metric: input.metric,
      description: input.description,
      urls: input.urls
    });

    const primary = resolution.sources?.[0] || null;

    return NextResponse.json({
      status: 'completed',
      metric: resolution.metric,
      value: resolution.value,
      unit: resolution.unit,
      as_of: resolution.as_of,
      confidence: resolution.confidence,
      asset_price_suggestion: resolution.asset_price_suggestion,
      reasoning: resolution.reasoning,
      primary_source_url: primary?.url || null,
      css_selector: primary?.css_selector || null,
      xpath: primary?.xpath || null,
      html_snippet: primary?.html_snippet || null,
      js_extractor: (primary as any)?.js_extractor || null,
      sources: resolution.sources.map(s => ({
        url: s.url,
        css_selector: s.css_selector || null,
        xpath: s.xpath || null,
        html_snippet: s.html_snippet || null,
        js_extractor: (s as any).js_extractor || null,
        quote: s.quote,
        match_score: s.match_score,
        screenshot_url: s.screenshot_url || null
      }))
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ status: 'error', error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ status: 'error', error: error?.message || 'Failed to extract JS snippet' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const metric = searchParams.get('metric') || '';
    const urls = (searchParams.getAll('url') || []).filter(Boolean);
    const description = searchParams.get('description') || undefined;

    if (!metric || urls.length === 0) {
      return NextResponse.json({
        info: 'POST a JSON body or use query params to test extractor.',
        example_post: {
          metric: 'ALU-USD',
          description: 'Resolve current aluminum price',
          urls: ['https://example.com/price']
        },
        example_get: '/api/debug/js-extractor?metric=ALU-USD&url=https://example.com/price'
      });
    }

    const oracle = getOracle();
    const resolution = await oracle.resolveMetricFast({ metric, description, urls });
    const primary = resolution.sources?.[0] || null;

    return NextResponse.json({
      status: 'completed',
      metric: resolution.metric,
      value: resolution.value,
      unit: resolution.unit,
      as_of: resolution.as_of,
      confidence: resolution.confidence,
      asset_price_suggestion: resolution.asset_price_suggestion,
      primary_source_url: primary?.url || null,
      css_selector: primary?.css_selector || null,
      xpath: primary?.xpath || null,
      html_snippet: primary?.html_snippet || null,
      js_extractor: (primary as any)?.js_extractor || null
    });
  } catch (error: any) {
    return NextResponse.json({ status: 'error', error: error?.message || 'Failed to extract JS snippet' }, { status: 500 });
  }
}




