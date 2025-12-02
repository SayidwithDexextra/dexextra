'use client';

export default function Home() {
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif' }}>
      <h3>Dexextra Metric AI Worker</h3>
      <p style={{ color: '#666', fontSize: 14 }}>
        POST /api/metric-ai to start background analysis. GET /api/metric-ai?jobId=... to fetch status.
      </p>
    </div>
  );
}


