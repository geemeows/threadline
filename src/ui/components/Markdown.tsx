// Markdown renderer for chat transcript prose (#88). Agent turns and user
// bubbles arrive as markdown and used to render as literal `whitespace-pre-wrap`
// text. This renders them with react-markdown + remark-gfm (tables, task lists,
// strikethrough, autolinks) and rehype-sanitize (GitHub schema — no raw HTML),
// so it is safe to point at untrusted agent output.
//
// Streaming-safe: react-markdown re-parses on every render, so a growing `text`
// prop just re-renders in place. The transcript's per-item React key is owned by
// SessionPane's `itemKey`, unchanged by this component, so the scroller's
// stick-to-bottom tracking (#89) is unaffected — only this item's inner DOM grows.
//
// Tailwind v4's preflight strips element defaults, so every block/inline element
// is styled explicitly here rather than relying on a typography plugin.

import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/** Fenced/indented code blocks are `<pre><code>`; inline code is a bare `<code>`.
 *  We detect a block by a `language-*` class or a multi-line body (bare ``` fences
 *  carry no language class) and hand block styling to `<pre>`, leaving inline code
 *  as a compact pill. */
function isBlockCode(className: string | undefined, children: ReactNode): boolean {
  if (className && /language-/.test(className)) return true
  return typeof children === 'string' && children.includes('\n')
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('space-y-2 break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          h1: ({ children }) => <h1 className="mt-1 text-[15px] font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-1 text-[14px] font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-1 text-[13px] font-semibold">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-1 text-[13px] font-semibold">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 leading-relaxed">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 leading-relaxed">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-[var(--mint)] underline decoration-[var(--mint-line)] underline-offset-2 hover:decoration-[var(--mint)]"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="opacity-70">{children}</del>,
          hr: () => <hr className="border-[var(--border2)]" />,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[var(--mint-line)] pl-3 text-[var(--fg2)]">{children}</blockquote>
          ),
          // Block container mirrors the tool-call <pre> treatment (SessionPane ToolBlock).
          pre: ({ children }) => (
            <pre className="max-h-96 overflow-auto rounded-md border bg-background px-2.5 py-2 font-mono text-xs whitespace-pre text-foreground">
              {children}
            </pre>
          ),
          code: ({ className: codeClass, children, ...props }: ComponentPropsWithoutRef<'code'>) =>
            isBlockCode(codeClass, children) ? (
              <code className={codeClass} {...props}>
                {children}
              </code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{children}</code>
            ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[var(--border2)] px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border border-[var(--border2)] px-2 py-1">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
