import { useMemo } from "react";

import { renderSafeMarkdown } from "@/shared/security/safe-markdown-utils";

const proseClassName =
  "w-full break-words py-1 text-sm leading-6 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-border [&_img]:my-3 [&_img]:max-h-[32rem] [&_img]:max-w-full [&_img]:rounded-xl [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-secondary [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6";

/** Renders untrusted assistant Markdown through a strict HTML allowlist. */
export function SafeMarkdown({ content }: { content: string }) {
  const renderedHTML = useMemo(() => renderSafeMarkdown(content), [content]);
  if (!renderedHTML)
    return (
      <div className="w-full whitespace-pre-wrap break-words py-1 text-sm leading-6">
        {content}
      </div>
    );
  return (
    <div
      className={proseClassName}
      dangerouslySetInnerHTML={{ __html: renderedHTML }}
    />
  );
}
