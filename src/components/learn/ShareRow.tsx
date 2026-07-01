'use client';

import { useState } from 'react';
import { Check, Link2, Share2 } from 'lucide-react';

interface ShareRowProps {
  url: string;
  title: string;
}

export default function ShareRow({ url, title }: ShareRowProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    title
  )}&url=${encodeURIComponent(url)}`;

  return (
    <div className="flex items-center gap-2">
      <span className="mr-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-t-fg-muted">
        <Share2 className="h-3.5 w-3.5" />
        Share
      </span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-md border border-t-stroke-sub bg-t-card px-2.5 py-1.5 text-[12px] font-medium text-t-fg-muted transition-colors duration-200 hover:border-t-stroke-hover hover:text-t-fg"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-t-positive" />
            Copied
          </>
        ) : (
          <>
            <Link2 className="h-3.5 w-3.5" />
            Copy link
          </>
        )}
      </button>
      <a
        href={xHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md border border-t-stroke-sub bg-t-card px-2.5 py-1.5 text-[12px] font-medium text-t-fg-muted transition-colors duration-200 hover:border-t-stroke-hover hover:text-t-fg"
      >
        Post on X
      </a>
    </div>
  );
}
