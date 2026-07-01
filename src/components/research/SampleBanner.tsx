import { FlaskConical } from 'lucide-react';

/**
 * Visible notice for placeholder research content. Makes it unmistakable that a
 * post is an illustrative sample, not real data — and pairs with the noindex
 * gating so it can never be confused for a published, data-grounded issue.
 */
export default function SampleBanner() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-t-warning/40 bg-t-warning/5 p-4">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-t-warning" />
      <div className="text-[13px] leading-6">
        <p className="font-semibold text-t-fg">Sample — illustrative data only</p>
        <p className="text-t-fg-muted">
          This is a format preview used to validate the rendering skeleton. The
          numbers are placeholders, not live market data, and this page is
          excluded from search indexing.
        </p>
      </div>
    </div>
  );
}
