import type { ReactNode } from 'react';

/**
 * Styling wrapper for server-rendered article bodies. Article components author
 * plain semantic HTML (`<h2>`, `<p>`, `<ul>`, `<a>`…) and this applies the
 * Sophisticated Minimal design-system typography via Tailwind descendant
 * variants — keeping the crawlable DOM clean and the markup portable.
 */
export default function Prose({ children }: { children: ReactNode }) {
  return (
    <div
      className="
        text-[15.5px] leading-[1.75] text-t-fg-muted
        [&>*+*]:mt-5
        [&>p:first-child]:text-[18px] [&>p:first-child]:leading-8 [&>p:first-child]:text-t-fg-sub
        [&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:text-[1.35rem] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-t-fg [&_h2]:scroll-mt-24
        [&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-t-fg
        [&_p]:text-t-fg-muted
        [&_strong]:font-semibold [&_strong]:text-t-fg
        [&_em]:text-t-fg-sub
        [&_a]:font-medium [&_a]:text-t-accent [&_a]:underline [&_a]:decoration-t-stroke-hover [&_a]:underline-offset-[3px] [&_a]:transition-colors [&_a]:duration-200 hover:[&_a]:text-t-accent-hover hover:[&_a]:decoration-t-accent
        [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2.5 [&_ul]:marker:text-t-accent
        [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2.5 [&_ol]:marker:font-mono [&_ol]:marker:text-t-fg-muted
        [&_li]:text-t-fg-muted [&_li]:pl-1.5
        [&_blockquote]:border-l-2 [&_blockquote]:border-t-accent [&_blockquote]:pl-4 [&_blockquote]:text-t-fg-sub [&_blockquote]:italic
        [&_hr]:my-10 [&_hr]:border-t-stroke-sub
        [&_code]:rounded [&_code]:bg-t-inset [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-t-fg
      "
    >
      {children}
    </div>
  );
}
