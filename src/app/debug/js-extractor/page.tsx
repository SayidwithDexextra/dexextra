'use client';

import React, { useState } from 'react';
import useMetricLivePrice from '@/hooks/useMetricLivePrice';

type ApiSource = {
  url: string;
  css_selector?: string | null;
  xpath?: string | null;
  html_snippet?: string | null;
  js_extractor?: string | null;
  quote: string;
  match_score: number;
  screenshot_url?: string | null;
};

type ApiResponse = {
  status: 'completed' | 'error' | 'processing';
  metric: string;
  value: string;
  unit: string;
  as_of: string;
  confidence: number;
  asset_price_suggestion: string;
  reasoning?: string;
  primary_source_url?: string | null;
  css_selector?: string | null;
  xpath?: string | null;
  html_snippet?: string | null;
  js_extractor?: string | null;
  sources?: ApiSource[];
  error?: string;
};

export default function DebugJSExtractorPage() {
  const [metric, setMetric] = useState('NICKEL');
  const [description, setDescription] = useState('Resolve current nickel price in USD per Ton from authoritative sources');
  const [urlsInput, setUrlsInput] = useState('https://markets.businessinsider.com/commodities/nickel-price');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [polling, setPolling] = useState(false);
  const [liveValue, setLiveValue] = useState<string | null>(null);
  const [liveAsOf, setLiveAsOf] = useState<string | null>(null);
  const [marketId, setMarketId] = useState('');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testValue, setTestValue] = useState<string | null>(null);
  // XPath generator state
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genResult, setGenResult] = useState<{ url?: string | null; xpath: string | null; css_selector?: string | null; numeric_value?: string | null; quote?: string | null; confidence?: number; reasoning?: string; context_snippet?: string | null } | null>(null);

  // Live preview from generated XPath/CSS
  const genLive = useMetricLivePrice({
    url: genResult?.url || undefined,
    xpath: genResult?.xpath || undefined,
    cssSelector: genResult?.css_selector || undefined,
    enabled: Boolean(genResult?.url && (genResult?.xpath || genResult?.css_selector)),
    pollIntervalMs: 15000,
    baseline: (() => {
      try {
        const seed = genResult?.numeric_value || result?.value || '';
        if (!seed) return undefined;
        const n = Number(String(seed).replace(/,/g, ''));
        return Number.isFinite(n) ? n : undefined;
      } catch { return undefined; }
    })()
  });

  // Headless fallback when static HTML provides no value (for JS-rendered pages)
  const [genHeadlessValue, setGenHeadlessValue] = useState<string | null>(null);
  const [genHeadlessAsOf, setGenHeadlessAsOf] = useState<string | null>(null);
  const [genHeadlessErr, setGenHeadlessErr] = useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    let intervalId: any = null;
    const shouldRun = Boolean(genResult?.url && (genResult?.xpath || genResult?.css_selector));
    if (!shouldRun) return () => {};

    const tick = async () => {
      try {
        // Only attempt headless if the static pipeline produced nothing
        if (genLive.value != null) { if (!cancelled) { setGenHeadlessValue(null); setGenHeadlessErr(null); } return; }
        setGenHeadlessErr(null);
        const body: any = { url: genResult?.url };
        if (genResult?.xpath) body.xpath = genResult.xpath;
        if (genResult?.css_selector) body.css_selector = genResult.css_selector;
        const res = await fetch('/api/debug/pull-metric', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!cancelled) {
          if (res.ok && data?.ok && data?.value) {
            setGenHeadlessValue(String(data.value));
            setGenHeadlessAsOf(new Date().toISOString());
          } else {
            setGenHeadlessErr(data?.error || 'Headless extractor failed');
          }
        }
      } catch (e: any) {
        if (!cancelled) setGenHeadlessErr(e?.message || 'Headless error');
      }
    };
    // Run immediately and then poll
    void tick();
    intervalId = setInterval(tick, 15000);
    return () => { cancelled = true; if (intervalId) clearInterval(intervalId); };
  }, [genResult?.url, genResult?.xpath, genResult?.css_selector, genLive.value]);

  const saveLocator = async (res: ApiResponse) => {
    try {
      if (!marketId) { setSaveStatus('Market ID required'); return; }
      // Run test before saving
      const test = await testLocator(res);
      if (!test.ok || !test.value) {
        setSaveStatus('Extractor/selector test failed; not saved');
        return;
      }
      const payload = {
        marketId,
        primary_source_url: res.primary_source_url || res.sources?.[0]?.url || null,
        css_selector: res.css_selector || res.sources?.[0]?.css_selector || null,
        xpath: res.xpath || res.sources?.[0]?.xpath || null,
        html_snippet: res.html_snippet || res.sources?.[0]?.html_snippet || null,
        js_extractor: res.js_extractor || res.sources?.[0]?.js_extractor || null,
        // Persist full kit/AI payload and extraction strategy metadata in markets.market_config
        kit_payload: res,
        extraction_strategy: {
          order: ['xpath', 'css', 'js', 'html', 'headless'],
          verified: Boolean(test.ok && test.value),
          used: test.method || null
        },
        js_extractor_b64: (() => {
          try {
            const code = res.js_extractor || res.sources?.[0]?.js_extractor || '';
            return code ? btoa(unescape(encodeURIComponent(code))) : null;
          } catch { return null; }
        })(),
      };
      const saveRes = await fetch('/api/debug/market-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData?.error) throw new Error(saveData?.error || 'Save failed');
      setSaveStatus('Saved');
    } catch (e: any) {
      setSaveStatus(e?.message || 'Failed to save');
    }
  };

  const testLocator = async (res: ApiResponse): Promise<{ ok: boolean; value: string; method?: 'xpath' | 'css' | 'js' | 'html' | 'headless' }> => {
    try {
      setTestStatus('Testing…');
      setTestValue(null);
      const primaryUrl = res.primary_source_url || res.sources?.[0]?.url || '';
      if (!primaryUrl) return { ok: false, value: '' };
      const cacheBust = Date.now();
      const fetchRes = await fetch(`/api/metric-source/fetch-html?url=${encodeURIComponent(primaryUrl)}&t=${cacheBust}`, { cache: 'no-store' });
      const data = await fetchRes.json();
      if (!fetchRes.ok || !data?.ok) return { ok: false, value: '' };
      let html: string = data.html || '';
      const selector = res.css_selector || res.sources?.[0]?.css_selector || '';
      const xpath = res.xpath || res.sources?.[0]?.xpath || '';
      const extractor = res.js_extractor || res.sources?.[0]?.js_extractor || '';
      const snippet = res.html_snippet || res.sources?.[0]?.html_snippet || '';
      try {
        console.log('[JSExtractor][Test] fetch-html meta', {
          content_type: (data as any)?.content_type,
          status: (data as any)?.status,
          redirected: (data as any)?.redirected,
          final_url: (data as any)?.final_url,
          html_length: html.length,
          has_xpath: Boolean(xpath),
          has_selector: Boolean(selector),
          has_js: Boolean(extractor),
        });
      } catch {}

      function extractBestNumeric(text: string, baseline?: number): string {
        const raw = String(text || '');
        const tokens = raw.match(/[+\-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g) || [];
        const nums = tokens
          .map(tok => ({ tok, n: Number(tok.replace(/,/g, '')) }))
          .filter(x => Number.isFinite(x.n));
        if (nums.length === 0) return '';
        let chosen = nums[0];
        if (typeof baseline === 'number' && Number.isFinite(baseline)) {
          chosen = nums.reduce((best, cur) => (Math.abs(cur.n - baseline) < Math.abs(best.n - baseline) ? cur : best), chosen);
        } else {
          chosen = nums.reduce((best, cur) => (Math.abs(cur.n) > Math.abs(best.n) ? cur : best), chosen);
        }
        return String(chosen.n);
      }

      const baseline = ((): number | undefined => {
        try { return Number(String(res.value || '').replace(/,/g, '')); } catch { return undefined; }
      })();

      let extracted = '';

      function evalXPathText(doc: Document, xp: string): string {
        try {
          const result = doc.evaluate(xp, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const node = result.singleNodeValue as Node | null;
          if (!node) return '';
          const text = (node as any).textContent || '';
          return text ? String(text) : '';
        } catch { return ''; }
      }

      // Try XPath first with static retries
      if (xpath) {
        const staticRetries = 3;
        const staticRetryDelay = 2000;
        for (let attempt = 0; attempt <= staticRetries; attempt++) {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            try { console.log('[JSExtractor][Test] doc title', (doc as any).title || ''); } catch {}
            let text = evalXPathText(doc, xpath);
            if (!text) {
              try {
                const strRes = doc.evaluate(xpath, doc, null, XPathResult.STRING_TYPE, null) as any;
                if (typeof strRes?.stringValue === 'string' && strRes?.stringValue) {
                  console.log('[JSExtractor][Test] XPath STRING_TYPE', strRes.stringValue);
                  text = String(strRes.stringValue);
                }
                const numRes = doc.evaluate(xpath, doc, null, XPathResult.NUMBER_TYPE, null) as any;
                if (!text && typeof numRes?.numberValue === 'number' && Number.isFinite(numRes?.numberValue)) {
                  console.log('[JSExtractor][Test] XPath NUMBER_TYPE', numRes.numberValue);
                  text = String(numRes.numberValue);
                }
              } catch {}
            }
            extracted = extractBestNumeric(text, baseline);
            console.log('[JSExtractor][Test] XPath attempt', { attempt, text, extracted });
            if (extracted) {
              setTestValue(extracted);
              setTestStatus(attempt === 0 ? 'OK (xpath)' : 'OK (xpath via static retry)');
              return { ok: true, value: extracted, method: 'xpath' };
            }
          } catch {}
          if (attempt < staticRetries) {
            await new Promise(r => setTimeout(r, staticRetryDelay));
            // re-fetch html before next attempt
            const refetchTs = Date.now();
            const refetch = await fetch(`/api/metric-source/fetch-html?url=${encodeURIComponent(primaryUrl)}&t=${refetchTs}`, { cache: 'no-store' });
            const refData = await refetch.json();
            if (refetch.ok && refData?.ok && typeof refData?.html === 'string') {
              html = refData.html as string;
            }
          }
        }
      }
      // Try CSS selector first
      if (selector) {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const el = doc.querySelector(selector);
          try { console.log('[JSExtractor][Test] CSS match', { exists: Boolean(el), selector }); } catch {}
          const text = el ? (el.textContent || '') : '';
          extracted = extractBestNumeric(text, baseline);
          if (extracted) {
            setTestValue(extracted);
            setTestStatus('OK (css)');
            return { ok: true, value: extracted, method: 'css' };
          }
        } catch {}
      }

      // Next: try extractor IIFE against parsed document
      if (!extracted && extractor) {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const fn = new Function('document', `return (${extractor});`);
          const val = fn(doc);
          try { console.log('[JSExtractor][Test] JS extractor result type', typeof val); } catch {}
          if (typeof val === 'string') extracted = extractBestNumeric(val, baseline);
          else if (val != null) extracted = extractBestNumeric(String(val), baseline);
          if (extracted) {
            setTestValue(extracted);
            setTestStatus('OK (js)');
            return { ok: true, value: extracted, method: 'js' };
          }
        } catch {}
      }

      // Fallback: try provided HTML snippet alone
      if (!extracted && snippet) {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(String(snippet), 'text/html');
          const text = doc.body ? (doc.body.textContent || '') : '';
          extracted = extractBestNumeric(text, baseline);
          if (extracted) {
            setTestValue(extracted);
            setTestStatus('OK (html)');
            return { ok: true, value: extracted, method: 'html' };
          }
        } catch {}
      }

      // Final fallback: one-off headless pull for JS-rendered pages
      if (!extracted) {
        try {
          const headlessRes = await fetch('/api/debug/pull-metric', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: primaryUrl, xpath: xpath || undefined, js_extractor: extractor || undefined, css_selector: selector || undefined })
          });
          const headless = await headlessRes.json();
          if (headlessRes.ok && headless?.ok && headless?.value) {
            extracted = String(headless.value);
            setTestValue(extracted);
            setTestStatus('OK (headless)');
            return { ok: true, value: extracted, method: 'headless' };
          }
        } catch {}
      }

      setTestValue(extracted || '');
      setTestStatus(extracted ? 'OK' : 'No numeric found');
      return { ok: Boolean(extracted), value: extracted || '' };
    } catch {
      setTestStatus('Error');
      return { ok: false, value: '' };
    }
  };

  const parseUrls = (input: string): string[] => {
    return input
      .split(/\n|,/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 10);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    try { console.log('[JSExtractor] Run Analysis: start', { metric, description, urlsInput }); } catch {}
    const urls = parseUrls(urlsInput);
    if (!metric || urls.length === 0) {
      setError('Metric and at least one URL are required');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/debug/js-extractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric, description, urls })
      });
      const data: ApiResponse = await res.json();
      try { console.log('[JSExtractor] AI response payload', data); } catch {}
      if (!res.ok || data.status === 'error') {
        throw new Error(data.error || 'Request failed');
      }
      setResult(data);
      // Immediately fetch raw HTML for the primary source and test returned XPath on it
      try {
        const primaryUrl = data.primary_source_url || data.sources?.[0]?.url || '';
        const xp = data.xpath || data.sources?.[0]?.xpath || '';
        try { console.log('[JSExtractor] Testing XPath on raw HTML', { primaryUrl, xpath: xp }); } catch {}
        if (primaryUrl && xp) {
          const cacheBust = Date.now();
          const fetchRes = await fetch(`/api/metric-source/fetch-html?url=${encodeURIComponent(primaryUrl)}&t=${cacheBust}&delayMs=1500&retries=2&retryDelayMs=1500`, { cache: 'no-store' });
          const rawPayload = await fetchRes.json();
          try {
            console.log('[JSExtractor] fetch-html payload', rawPayload);
            if (typeof rawPayload?.html === 'string') {
              console.log('[JSExtractor] RAW HTML:', rawPayload.html);
            }
          } catch {}
          if (fetchRes.ok && rawPayload?.ok && typeof rawPayload?.html === 'string') {
            // Evaluate XPath against full HTML
            const html: string = rawPayload.html;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            try {
              console.log('[JSExtractor] Static parse meta', {
                content_type: rawPayload?.content_type,
                status: rawPayload?.status,
                redirected: rawPayload?.redirected,
                final_url: rawPayload?.final_url,
                html_length: html.length,
                doc_title: (doc && (doc as any).title) || '',
                xpath: xp,
              });
            } catch {}
            const evalXPathText = (documentNode: Document, xpExpr: string): string => {
              try {
                const resultNode = documentNode.evaluate(xpExpr, documentNode, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const node = resultNode.singleNodeValue as Node | null;
                if (!node) return '';
                const text = (node as any).textContent || '';
                return text ? String(text) : '';
              } catch { return ''; }
            };
            const extractBestNumeric = (text: string): string => {
              try {
                const raw = String(text || '');
                const tokens = raw.match(/[+\-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g) || [];
                const nums = tokens.map(t => ({ t, n: Number(t.replace(/,/g, '')) })).filter(x => Number.isFinite(x.n));
                if (nums.length === 0) return '';
                const chosen = nums.reduce((best, cur) => Math.abs(cur.n) > Math.abs(best.n) ? cur : best, nums[0]);
                try { console.log('[JSExtractor] Tokenization', { tokens, chosen }); } catch {}
                return String(chosen.n);
              } catch { return ''; }
            };
            let text = evalXPathText(doc, xp);
            if (!text) {
              // Try STRING_TYPE
              try {
                const strRes = doc.evaluate(xp, doc, null, XPathResult.STRING_TYPE, null) as any;
                const strVal = strRes?.stringValue;
                if (typeof strVal === 'string' && strVal) {
                  text = String(strVal);
                  console.log('[JSExtractor] XPath STRING_TYPE result', { stringValue: strVal });
                }
              } catch {}
            }
            if (!text) {
              // Try NUMBER_TYPE
              try {
                const numRes = doc.evaluate(xp, doc, null, XPathResult.NUMBER_TYPE, null) as any;
                const numVal = numRes?.numberValue;
                if (typeof numVal === 'number' && Number.isFinite(numVal)) {
                  text = String(numVal);
                  console.log('[JSExtractor] XPath NUMBER_TYPE result', { numberValue: numVal });
                }
              } catch {}
            }
            const numeric = extractBestNumeric(text);
            try {
              console.log('[JSExtractor] XPath test result', { xpath: xp, text, numeric });
            } catch {}
            setTestValue(numeric || text || '');
            setTestStatus(numeric ? 'OK (xpath via Run Analysis)' : (text ? 'Text only (xpath via Run Analysis)' : 'No match (xpath via Run Analysis)'));

            // If not numeric, perform static retry loop before headless
            if (!numeric) {
              const staticRetries = 3;
              const staticRetryDelay = 2000;
              for (let attempt = 1; attempt <= staticRetries; attempt++) {
                try {
                  console.log('[JSExtractor] Static retry', { attempt, delay_ms: staticRetryDelay });
                  await new Promise(r => setTimeout(r, staticRetryDelay));
                  const refetchTs = Date.now();
                  const refetch = await fetch(`/api/metric-source/fetch-html?url=${encodeURIComponent(primaryUrl)}&t=${refetchTs}`, { cache: 'no-store' });
                  const refData = await refetch.json();
                  if (refetch.ok && refData?.ok && typeof refData?.html === 'string') {
                    const refDoc = new DOMParser().parseFromString(refData.html, 'text/html');
                    let txt = evalXPathText(refDoc, xp);
                    if (!txt) {
                      try {
                        const s = refDoc.evaluate(xp, refDoc, null, XPathResult.STRING_TYPE, null) as any;
                        if (typeof s?.stringValue === 'string' && s?.stringValue) txt = String(s.stringValue);
                      } catch {}
                    }
                    if (!txt) {
                      try {
                        const n = refDoc.evaluate(xp, refDoc, null, XPathResult.NUMBER_TYPE, null) as any;
                        if (typeof n?.numberValue === 'number' && Number.isFinite(n?.numberValue)) txt = String(n.numberValue);
                      } catch {}
                    }
                    const num = extractBestNumeric(txt);
                    console.log('[JSExtractor] Static retry result', { attempt, text: txt, numeric: num });
                    if (num) {
                      setTestValue(num);
                      setTestStatus('OK (xpath via static retry)');
                      break;
                    }
                  }
                } catch {}
              }
            }

            // If numeric not found, attempt headless extraction with initial delay and retries
            if (!numeric) {
              try {
                const selector = data.css_selector || data.sources?.[0]?.css_selector || '';
                const waitMs = 4000; // allow dynamic content to populate
                const retries = 5;    // retry attempts if value not numeric
                const retryDelay = 2000; // 2s between retries
                console.log('[JSExtractor] Headless retry with waits', { wait_ms: waitMs, retries, retry_delay_ms: retryDelay });
                const headlessRes = await fetch('/api/debug/pull-metric', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    url: primaryUrl,
                    xpath: xp || undefined,
                    css_selector: selector || undefined,
                    wait_ms: waitMs,
                    wait_for_xpath: Boolean(xp),
                    wait_for_selector: Boolean(selector && !xp),
                    retries,
                    retry_delay_ms: retryDelay,
                  })
                });
                const headless = await headlessRes.json();
                console.log('[JSExtractor] Headless retry payload', headless);
                if (headlessRes.ok && headless?.ok && headless?.value) {
                  setTestValue(String(headless.value));
                  setTestStatus('OK (headless w/ waits + retries)');
                } else {
                  setTestStatus('No match after headless retries');
                }
              } catch (e3) {
                console.log('[JSExtractor] Headless retry failed', e3);
              }
            }
          } else {
            setTestStatus('fetch-html failed during Run Analysis');
          }
        } else {
          try { console.log('[JSExtractor] Missing primaryUrl or xpath for immediate test'); } catch {}
        }
      } catch (e2) {
        try { console.log('[JSExtractor] Immediate XPath test failed', e2); } catch {}
      }
      // Auto-save locator if Market ID is provided
      if (marketId) {
        void saveLocator(data);
      }
    } catch (err: any) {
      setError(err?.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateXPath = async () => {
    try {
      setGenError(null);
      setGenResult(null);
      const urls = parseUrls(urlsInput);
      if (!metric || urls.length === 0) {
        setGenError('Metric and at least one URL are required');
        return;
      }
      setGenLoading(true);
      const url = urls[0];
      const res = await fetch('/api/metric-source/generate-xpath', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric, url, hintText: description || undefined })
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Generator failed');
      }
      setGenResult({ url, xpath: data.xpath || null, css_selector: data.css_selector || null, numeric_value: data.numeric_value || null, quote: data.quote || null, confidence: data.confidence, reasoning: data.reasoning, context_snippet: data.context_snippet || null });
    } catch (e: any) {
      setGenError(e?.message || 'Failed to generate XPath');
    } finally {
      setGenLoading(false);
    }
  };

  const testGenerated = async () => {
    if (!genResult || !genResult.url) { setTestStatus('Generate first'); return; }
    const fake: ApiResponse = {
      status: 'completed',
      metric,
      value: genResult.numeric_value || '',
      unit: '',
      as_of: new Date().toISOString(),
      confidence: typeof genResult.confidence === 'number' ? genResult.confidence : 0,
      asset_price_suggestion: genResult.numeric_value || '',
      reasoning: genResult.reasoning || undefined,
      primary_source_url: genResult.url,
      css_selector: genResult.css_selector || null,
      xpath: genResult.xpath || null,
      html_snippet: null,
      js_extractor: null,
      sources: [],
    };
    await testLocator(fake);
  };

  const copyToClipboard = async (text?: string | null) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      alert('Copied to clipboard');
    } catch {}
  };

  const derivePollInput = () => {
    if (!result) return null;
    const primaryUrl = result.primary_source_url || result.sources?.[0]?.url || null;
    const extractor = result.js_extractor || result.sources?.[0]?.js_extractor || null;
    const selector = result.css_selector || result.sources?.[0]?.css_selector || null;
    const xpath = result.xpath || result.sources?.[0]?.xpath || null;
    if (!primaryUrl) return null;
    return { url: primaryUrl, js_extractor: extractor || undefined, css_selector: selector || undefined, xpath: xpath || undefined };
  };

  const startPolling = () => setPolling(true);
  const stopPolling = () => setPolling(false);

  // Poll every 15s when enabled
  if (typeof window !== 'undefined') {
    // minimal effect-like behavior without importing useEffect twice
    // eslint-disable-next-line react-hooks/rules-of-hooks
    // useEffect here would be standard; inline guard keeps dependencies simple
  }

  // Real useEffect for polling
  // eslint-disable-next-line react-hooks/rules-of-hooks
  React.useEffect(() => {
    if (!polling) return;
    const input = derivePollInput();
    if (!input) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const cacheBust = Date.now();
        const res = await fetch(`/api/debug/fetch-html?url=${encodeURIComponent(input.url)}&t=${cacheBust}`, {
          cache: 'no-store'
        });
        const data = await res.json();
        if (!data?.ok) return;

        const html: string = data.html || '';
        const selector = input.css_selector;
        const xpath = (input as any).xpath as string | undefined;
        const extractor = input.js_extractor;

        function extractBestNumeric(text: string, baseline?: number): string {
          const raw = String(text || '');
          const tokens = raw.match(/[+\-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g) || [];
          const nums = tokens
            .map(tok => ({ tok, n: Number(tok.replace(/,/g, '')) }))
            .filter(x => Number.isFinite(x.n));
          if (nums.length === 0) return '';
          let chosen = nums[0];
          if (typeof baseline === 'number' && Number.isFinite(baseline)) {
            chosen = nums.reduce((best, cur) => {
              return Math.abs(cur.n - baseline) < Math.abs(best.n - baseline) ? cur : best;
            }, chosen);
          } else {
            chosen = nums.reduce((best, cur) => (Math.abs(cur.n) > Math.abs(best.n) ? cur : best), chosen);
          }
          return String(chosen.n);
        }

        let extracted = '';
        const baseline = ((): number | undefined => {
          try {
            const seed = (liveValue ?? result?.value) as string | undefined;
            if (!seed) return undefined;
            return Number(String(seed).replace(/,/g, ''));
          } catch { return undefined; }
        })();

        function evalXPathText(doc: Document, xp: string): string {
          try {
            const result = doc.evaluate(xp, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const node = result.singleNodeValue as Node | null;
            if (!node) return '';
            const text = (node as any).textContent || '';
            return text ? String(text) : '';
          } catch { return ''; }
        }

        // Prefer XPath first
        if (xpath) {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const text = evalXPathText(doc, xpath);
            extracted = extractBestNumeric(text, baseline);
          } catch {}
        }

        // Next: CSS selector extraction
        if (!extracted && selector) {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const el = doc.querySelector(selector);
            const text = el ? (el.textContent || '') : '';
            extracted = extractBestNumeric(text, baseline);
          } catch {}
        }

        // Fallback to running js_extractor against a parsed document context
        if (!extracted && extractor) {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const fn = new Function('document', `return (${extractor});`);
            const val = fn(doc);
            if (typeof val === 'string') extracted = extractBestNumeric(val, baseline);
            else if (val != null) extracted = extractBestNumeric(String(val), baseline);
          } catch {}
        }

        if (!cancelled) {
          setLiveValue(extracted);
          setLiveAsOf(String(data.fetched_at || new Date().toISOString()));
        }
      } catch {}
    };

    // immediate and then interval
    void tick();
    const id = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [polling, result?.primary_source_url, result?.js_extractor, result?.css_selector, result?.xpath]);

  return (
    <div suppressHydrationWarning style={{ maxWidth: 900, margin: '24px auto', padding: 16 }}>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Debug: JS Extractor</h2>

      <form onSubmit={handleSubmit} style={{ border: '1px solid #222', padding: 16, borderRadius: 8, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          {/* Preset box */}
          <div style={{ border: '1px dashed #333', borderRadius: 8, padding: 10, background: '#0b0b0b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>Quick preset</div>
              <button
                type="button"
                onClick={() => {
                  setMarketId('d64c9294-5949-4e4c-b000-f67a9f699084');
                  setMetric('World Population');
                  setDescription('Resolve World Population');
                  setUrlsInput('https://www.worldometers.info/world-population/');
                  setError(null);
                  setTestStatus(null);
                  setSaveStatus(null);
                }}
                style={{ padding: '6px 10px', border: '1px solid #333', background: '#1f2937', color: '#fff', borderRadius: 6 }}
              >
                Autofill World Population
              </button>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6 }}>Market ID (UUID)</label>
            <input
              suppressHydrationWarning
              type="text"
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
              placeholder="e.g. 2b9a4c3d-..."
              style={{ width: '100%', padding: 8, background: '#111', color: '#fff', border: '1px solid #333', borderRadius: 6 }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6 }}>Metric</label>
            <input suppressHydrationWarning
              type="text"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              placeholder="e.g. NICKEL"
              style={{ width: '100%', padding: 8, background: '#111', color: '#fff', border: '1px solid #333', borderRadius: 6 }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6 }}>Description</label>
            <input suppressHydrationWarning
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should the AI resolve?"
              style={{ width: '100%', padding: 8, background: '#111', color: '#fff', border: '1px solid #333', borderRadius: 6 }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6 }}>URLs (newline or comma-separated)</label>
            <textarea suppressHydrationWarning
              value={urlsInput}
              onChange={(e) => setUrlsInput(e.target.value)}
              rows={4}
              placeholder={'https://example.com/page-1\nhttps://example.com/page-2'}
              style={{ width: '100%', padding: 8, background: '#111', color: '#fff', border: '1px solid #333', borderRadius: 6 }}
            />
          </div>
          <div>
            <button type="submit" disabled={loading} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #2a5fff', background: loading ? '#222' : '#2a5fff', color: '#fff' }}>
              {loading ? 'Analyzing…' : 'Run Analysis'}
            </button>
            <button
              type="button"
              onClick={handleGenerateXPath}
              disabled={genLoading}
              style={{ marginLeft: 8, padding: '8px 12px', borderRadius: 6, border: '1px solid #8b5cf6', background: genLoading ? '#222' : '#8b5cf6', color: '#fff' }}
            >
              {genLoading ? 'Generating…' : 'Generate XPath (first URL)'}
            </button>
          </div>
        </div>
      </form>

      {(genError || genResult) && (
        <div style={{ border: '1px solid #2b2340', padding: 16, borderRadius: 8, marginBottom: 16, background: '#0f0b14' }}>
          <div style={{ fontSize: 13, color: '#c084fc', marginBottom: 8 }}>AI XPath Generator</div>
          {genError && (
            <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 8 }}>⚠️ {genError}</div>
          )}
          {genResult && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#888' }}>URL</div>
                <div style={{ color: '#60a5fa', fontSize: 12, wordBreak: 'break-all' }}>{genResult.url || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#888' }}>Sample Value</div>
                <div style={{ color: '#4ade80', fontSize: 14, fontWeight: 600 }}>{genResult.numeric_value || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#888' }}>XPath</div>
                <div style={{ color: '#fff', fontSize: 12, wordBreak: 'break-word' }}>{genResult.xpath || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#888' }}>CSS Selector</div>
                <div style={{ color: '#fff', fontSize: 12, wordBreak: 'break-word' }}>{genResult.css_selector || '—'}</div>
              </div>
              {genResult.reasoning && (
                <div style={{ gridColumn: '1 / span 2' }}>
                  <div style={{ fontSize: 12, color: '#888' }}>Reasoning</div>
                  <div style={{ color: '#e5e7eb', fontSize: 12, whiteSpace: 'pre-wrap' }}>{genResult.reasoning}</div>
                </div>
              )}
              {genResult.context_snippet && (
                <div style={{ gridColumn: '1 / span 2' }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Context Snippet</div>
                  <pre style={{ background: '#0b0b0b', color: '#cbd5e1', padding: 12, borderRadius: 6, overflowX: 'auto', fontSize: 11 }}>
{genResult.context_snippet}
                  </pre>
                </div>
              )}
              <div style={{ gridColumn: '1 / span 2', border: '1px solid #333', borderRadius: 6, padding: 12 }}>
                <div style={{ fontSize: 12, color: '#888' }}>Live (Generated XPath/CSS) — polls every 15s</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginTop: 6 }}>
                  <div style={{ color: '#f59e0b', fontSize: 18, fontWeight: 600 }}>{(genLive.value ?? genHeadlessValue) ?? '—'}</div>
                  {(genLive.asOf || genHeadlessAsOf) && (
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>as of {genLive.asOf || genHeadlessAsOf}</div>
                  )}
                  {genLive.isLoading && (
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>loading…</div>
                  )}
                  {(genLive.error || genHeadlessErr) && (
                    <div style={{ fontSize: 11, color: '#fca5a5' }}>⚠ {genLive.error || genHeadlessErr}</div>
                  )}
                  {genHeadlessValue && !genLive.value && (
                    <div style={{ fontSize: 11, color: '#34d399' }}>(headless)</div>
                  )}
                </div>
              </div>
              <div style={{ gridColumn: '1 / span 2', display: 'flex', gap: 8 }}>
                <button onClick={testGenerated} style={{ padding: '6px 10px', border: '1px solid #333', background: '#2563eb', color: '#fff', borderRadius: 6 }}>Test Generated</button>
                <button onClick={() => copyToClipboard(genResult.xpath || '')} style={{ padding: '6px 10px', border: '1px solid #333', background: '#111', color: '#fff', borderRadius: 6 }}>Copy XPath</button>
                <button onClick={() => copyToClipboard(genResult.css_selector || '')} style={{ padding: '6px 10px', border: '1px solid #333', background: '#111', color: '#fff', borderRadius: 6 }}>Copy CSS</button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: '#ff6b6b', fontSize: 12, marginBottom: 12 }}>⚠️ {error}</div>
      )}

      {result && (
        <div style={{ border: '1px solid #222', padding: 16, borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>Metric</div>
              <div style={{ color: '#fff', fontSize: 14 }}>{result.metric}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>Value</div>
              <div style={{ color: '#4ade80', fontSize: 18, fontWeight: 600 }}>{result.value}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>Unit</div>
              <div style={{ color: '#fff', fontSize: 14 }}>{result.unit}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>As of</div>
              <div style={{ color: '#fff', fontSize: 14 }}>{result.as_of}</div>
            </div>
          </div>

          <hr style={{ borderColor: '#222', margin: '12px 0' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={polling ? stopPolling : startPolling} style={{ padding: '6px 10px', border: '1px solid #333', background: polling ? '#222' : '#2a5fff', color: '#fff', borderRadius: 6 }}>
              {polling ? 'Stop Live Polling' : 'Start Live Polling (15s)'}
            </button>
            {liveValue && (
              <div style={{ fontSize: 12, color: '#888' }}>Last polled: {liveAsOf}</div>
            )}

            <button
              onClick={async () => {
                if (!result) { setTestStatus('Run analysis first'); return; }
                await testLocator(result);
              }}
              style={{ padding: '6px 10px', border: '1px solid #333', background: '#2563eb', color: '#fff', borderRadius: 6 }}
            >
              Test Extractor
            </button>
            {testStatus && (
              <span style={{ fontSize: 12, color: testStatus === 'OK' ? '#34d399' : '#fca5a5' }}>{testStatus}{testValue ? ` (${testValue})` : ''}</span>
            )}

            <button
              onClick={async () => {
                try {
                  setSaveStatus(null);
                  if (!result) { setSaveStatus('Run analysis first'); return; }
                  if (!marketId) { setSaveStatus('Market ID required'); return; }
                  await saveLocator(result);
                } catch (e: any) {
                  setSaveStatus(e?.message || 'Failed to save');
                }
              }}
              style={{ padding: '6px 10px', border: '1px solid #333', background: '#059669', color: '#fff', borderRadius: 6 }}
            >
              Save to Supabase
            </button>

            {saveStatus && (
              <span style={{ fontSize: 12, color: saveStatus === 'Saved' ? '#34d399' : '#fca5a5' }}>{saveStatus}</span>
            )}
          </div>

          {liveValue && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#888' }}>Live Value (15s)</div>
                <div style={{ color: '#f59e0b', fontSize: 18, fontWeight: 600 }}>{liveValue}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#888' }}>Initial Value</div>
                <div style={{ color: '#4ade80', fontSize: 18, fontWeight: 600 }}>{result.value}</div>
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Primary Source URL</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <a href={result.primary_source_url || '#'} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', fontSize: 12 }}>
              {result.primary_source_url || '—'}
            </a>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>CSS Selector</div>
              <div style={{ color: '#fff', fontSize: 12, wordBreak: 'break-word' }}>{result.css_selector || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>XPath</div>
              <div style={{ color: '#fff', fontSize: 12, wordBreak: 'break-word' }}>{result.xpath || '—'}</div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>HTML Snippet</div>
            <pre style={{ background: '#0b0b0b', color: '#cbd5e1', padding: 12, borderRadius: 6, overflowX: 'auto', fontSize: 11 }}>
{result.html_snippet || '—'}
            </pre>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, color: '#888' }}>JS Extractor (IIFE)</div>
              <button onClick={() => copyToClipboard(result.js_extractor)} style={{ padding: '4px 8px', border: '1px solid #333', borderRadius: 6, background: '#111', color: '#ddd', fontSize: 11 }}>Copy</button>
            </div>
            <pre style={{ background: '#0b0b0b', color: '#cbd5e1', padding: 12, borderRadius: 6, overflowX: 'auto', fontSize: 11 }}>
{result.js_extractor || '—'}
            </pre>
          </div>

          {Array.isArray(result.sources) && result.sources.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>All Sources</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {result.sources.map((s, idx) => (
                  <div key={idx} style={{ border: '1px solid #222', borderRadius: 6, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', fontSize: 12 }}>{s.url}</a>
                      <span style={{ fontSize: 11, color: '#888' }}>match {Math.round(s.match_score * 100)}%</span>
                    </div>
                    {!!s.css_selector && (
                      <div style={{ fontSize: 11, color: '#bbb', marginBottom: 4 }}>CSS: {s.css_selector}</div>
                    )}
                    {!!s.xpath && (
                      <div style={{ fontSize: 11, color: '#bbb', marginBottom: 4 }}>XPath: {s.xpath}</div>
                    )}
                    {!!s.js_extractor && (
                      <details>
                        <summary style={{ fontSize: 11, color: '#bbb', cursor: 'pointer' }}>Show JS Extractor</summary>
                        <pre style={{ background: '#0b0b0b', color: '#cbd5e1', padding: 12, borderRadius: 6, overflowX: 'auto', fontSize: 11 }}>
{s.js_extractor}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


