import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { XPathGeneratorService } from '@/services/metric-oracle/XPathGeneratorService';

const InputSchema = z.object({
  metric: z.string().min(1).max(500),
  url: z.string().url().optional(),
  html: z.string().optional(),
  hintText: z.string().optional()
}).refine(v => !!v.url || !!v.html, { message: 'Either url or html is required', path: ['url'] });

async function fetchHtml(url: string): Promise<{ html: string; contentType: string | null }> {
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const contentType = res.headers.get('content-type');
  const html = await res.text();
  return { html, contentType };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = InputSchema.parse(body);

    let html = input.html || '';
    if (!html && input.url) {
      const { html: fetched } = await fetchHtml(input.url);
      html = fetched;
    }
    if (!html) {
      return NextResponse.json({ ok: false, error: 'Failed to load HTML' }, { status: 400 });
    }

    const svc = new XPathGeneratorService();
    const result = await svc.generateFromHtml({ metric: input.metric, html, url: input.url, hintText: input.hintText });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    if (e?.name === 'ZodError') {
      return NextResponse.json({ ok: false, error: 'Invalid input', details: e.errors }, { status: 400 });
    }
    const message = e?.message || 'Failed to generate XPath';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}


