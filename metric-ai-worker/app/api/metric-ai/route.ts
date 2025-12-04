import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 120;

const InputSchema = z.object({
  metric: z.string().min(1).max(500),
  description: z.string().optional(),
  urls: z.array(z.string().url()).min(1).max(10),
  related_market_id: z.string().optional(),
  related_market_identifier: z.string().optional(),
  user_address: z.string().optional(),
  context: z.enum(['create', 'settlement']).optional()
});

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env missing');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function corsHeaders(origin?: string) {
  const allowRaw = process.env.ALLOW_ORIGIN || '*';
  // Always vary on Origin so CDNs/CDN cache correctly
  const varyHeader = { 'Vary': 'Origin' as const };
  if (allowRaw === '*') {
    return {
      ...varyHeader,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    };
  }
  // Support comma-separated allow-list: e.g. "https://www.dexetera.xyz,http://localhost:3000"
  const allowList = allowRaw.split(',').map(s => s.trim()).filter(Boolean);
  const isAllowed = origin && allowList.some(allowed => origin === allowed || (allowed && origin!.endsWith(allowed)));
  const acao = isAllowed ? (origin as string) : (allowList[0] || '*');
  return {
    ...varyHeader,
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin') || undefined) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = InputSchema.parse(body);

    const supabase = getSupabase();
    const jobId = `metric_ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    await supabase.from('metric_oracle_jobs').insert([{
      job_id: jobId,
      status: 'processing',
      progress: 0,
      metric_input: {
        metric: input.metric,
        description: input.description || null,
        urls: input.urls
      },
      created_at: new Date()
    }]);

    after(async () => {
      const started = Date.now();
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const texts: string[] = [];
        for (const url of input.urls) {
          try {
            const r = await fetch(url, { headers: { 'User-Agent': `Dexextra/1.0 (+${process.env.APP_URL || 'https://dexextra.com'})` } });
            const html = await r.text();
            const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                                 .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                                 .replace(/<[^>]+>/g, ' ')
                                 .replace(/\s+/g, ' ')
                                 .slice(0, 6000);
            texts.push(`SOURCE: ${url}\n${stripped}`);
          } catch { /* skip bad sources */ }
        }
        const prompt = [
          `METRIC: ${input.metric}`,
          input.description ? `DESCRIPTION: ${input.description}` : '',
          `TASK: Determine the current numeric value and a tradable asset_price_suggestion.`,
          `Return JSON: { "value": "...", "unit": "...", "as_of": "...", "confidence": 0.0-1.0, "asset_price_suggestion": "123.45", "reasoning": "...", "source_quotes": [{ "url": "...", "quote": "...", "match_score": 0.0-1.0 }] }`,
          `PRICE RULES:`,
          `- If financial quote (USD per BTC/oz/barrel/etc) use as-is; else rescale large metrics to natural human units.`,
          `- asset_price_suggestion must be a numeric string with up to 5 significant figures, no units.`,
          `SOURCES:`,
          texts.join('\n\n')
        ].filter(Boolean).join('\n');

        const resp = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4.1',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are an expert metric analyst. Return strict JSON only.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 1400
        });

        let content = resp.choices[0]?.message?.content?.trim() || '{}';
        try { content = content.replace(/```json|```/g, '').trim(); } catch {}
        const json = JSON.parse(content);

        const resolution = {
          metric: input.metric,
          value: json.value || 'N/A',
          unit: json.unit || 'unknown',
          as_of: json.as_of || new Date().toISOString(),
          confidence: typeof json.confidence === 'number' ? Math.min(Math.max(json.confidence, 0), 1) : 0.5,
          asset_price_suggestion: json.asset_price_suggestion || json.value || '50.00',
          reasoning: json.reasoning || '',
          sources: Array.isArray(json.source_quotes) ? json.source_quotes.map((q: any) => ({
            url: String(q.url || ''),
            screenshot_url: '',
            quote: String(q.quote || '').slice(0, 800),
            match_score: typeof q.match_score === 'number' ? q.match_score : 0.5
          })) : []
        };

        let resolutionId: string | null = null;
        try {
          const { data, error } = await supabase
            .from('metric_oracle_resolutions')
            .insert([{
              metric_name: input.metric,
              metric_description: input.description || null,
              source_urls: input.urls,
              resolution_data: resolution,
              confidence_score: resolution.confidence,
              processing_time_ms: Date.now() - started,
              user_address: input.user_address || null,
              related_market_id: input.related_market_id || input.related_market_identifier || null,
              created_at: new Date()
            }])
            .select('id')
            .single();
          if (error) throw error;
          resolutionId = data?.id || null;
        } catch (e) { /* log-only */ }

        if (resolutionId && (input.related_market_id || input.related_market_identifier)) {
          const update: any = { metric_resolution_id: resolutionId, updated_at: new Date().toISOString() };
          try {
            if (input.related_market_id) {
              await supabase.from('markets').update(update).eq('id', input.related_market_id);
            } else {
              await supabase.from('markets').update(update).eq('market_identifier', input.related_market_identifier);
            }
          } catch {}
        }

        await supabase.from('metric_oracle_jobs').update({
          status: 'completed',
          progress: 100,
          result: resolution,
          processing_time_ms: Date.now() - started,
          completed_at: new Date()
        }).eq('job_id', jobId);
      } catch (err: any) {
        await supabase.from('metric_oracle_jobs').update({
          status: 'failed',
          progress: 100,
          error: err?.message || 'unknown',
          completed_at: new Date()
        }).eq('job_id', jobId);
      }
    });

    return NextResponse.json(
      {
        status: 'processing',
        jobId,
        statusUrl: `/api/metric-ai?jobId=${jobId}`,
        message: 'AI metric analysis started'
      },
      { status: 202, headers: corsHeaders(req.headers.get('origin') || undefined) }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Invalid input', message: e?.message || 'Unknown error' },
      { status: 400, headers: corsHeaders(req.headers.get('origin') || undefined) }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400, headers: corsHeaders(req.headers.get('origin') || undefined) });
    }
    const supabase = getSupabase();
    const { data, error } = await supabase.from('metric_oracle_jobs').select('*').eq('job_id', jobId).single();
    if (error) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404, headers: corsHeaders(req.headers.get('origin') || undefined) });
    }
    return NextResponse.json(data, { headers: corsHeaders(req.headers.get('origin') || undefined) });
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500, headers: corsHeaders(req.headers.get('origin') || undefined) });
  }
}


