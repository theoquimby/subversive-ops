import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Tiny renderer for help articles. Supports blank-line paragraphs, "### "
 * headings, "- " bullets, "1. " steps, **bold**, `code` and [links](/path).
 * Deliberately small: help content is ours, not user input.
 */

/** Decides whether an internal link is shown as a link (e.g. staff can't open manager pages). */
type LinkFilter = (href: string) => boolean;

function inline(text: string, key = 0, canLink: LinkFilter = () => true): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2]) out.push(<strong key={k} className="font-semibold text-ink">{m[2]}</strong>);
    else if (m[4]) out.push(<code key={k} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-ink">{m[4]}</code>);
    else if (m[6]) {
      const href = m[7];
      out.push(
        href.startsWith("/") && !canLink(href) ? (
          <span key={k} className="font-medium text-ink">{m[6]}</span>
        ) : href.startsWith("/") ? (
          <Link key={k} href={href} className="font-medium text-ink underline decoration-border-strong underline-offset-[3px] hover:decoration-ink">{m[6]}</Link>
        ) : (
          <a key={k} href={href} className="font-medium text-ink underline decoration-border-strong underline-offset-[3px] hover:decoration-ink" rel="noreferrer" target="_blank">{m[6]}</a>
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function HelpMarkdown({ source, canLink }: { source: string; canLink?: LinkFilter }) {
  const blocks = source.trim().split(/\n\s*\n/);
  return (
    <div className="space-y-4 text-[0.975rem] leading-[1.7] text-ink-2">
      {blocks.map((block, b) => {
        const lines = block.split("\n").map((l) => l.trimEnd());
        if (lines[0].startsWith("### ")) {
          const [head, ...rest] = lines;
          return (
            <div key={b} className="space-y-4 pt-3">
              <h3 className="text-[1.02rem] font-semibold tracking-tight text-ink">{inline(head.slice(4), b, canLink)}</h3>
              {rest.length > 0 && <HelpMarkdown source={rest.join("\n")} canLink={canLink} />}
            </div>
          );
        }
        if (lines.every((l) => /^- /.test(l))) {
          return (
            <ul key={b} className="space-y-1.5 pl-1">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-3"><span aria-hidden className="mt-[0.7em] size-1 shrink-0 rounded-full bg-muted" /><span>{inline(l.slice(2), b * 100 + i, canLink)}</span></li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\d+\. /.test(l))) {
          return (
            <ol key={b} className="space-y-2">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-3">
                  <span className="num mt-[0.2em] grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[0.7rem] font-semibold text-ink">{i + 1}</span>
                  <span>{inline(l.replace(/^\d+\. /, ""), b * 100 + i, canLink)}</span>
                </li>
              ))}
            </ol>
          );
        }
        return <p key={b}>{inline(lines.join(" "), b, canLink)}</p>;
      })}
    </div>
  );
}
