"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ExternalLink, ImageOff } from "lucide-react";
import { cx, Td, Th, Tr } from "@/components/ui";
import { KIND_LABEL, sortPosts, type PostRow, type PostSort } from "@/domain/onlineChannels";
import { shortDate } from "@/lib/format";

/**
 * A channel's posts with their numbers. Tap a column to sort by it (most
 * first); it opens sorted by reach. On a phone only the column being sorted
 * by shows beside the post.
 */

const n0 = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));

/** The picture, or a quiet placeholder: the channel's image addresses stop working after a while. */
function Thumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken)
    return (
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        <ImageOff className="size-4" />
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-11 shrink-0 rounded-lg bg-surface-2 object-cover ring-1 ring-border" />;
}

export function PostsTable({ posts, reachLabel, hasSaves }: { posts: PostRow[]; /** "Accounts reached" or "People reached". */ reachLabel: string; hasSaves: boolean }) {
  const [by, setBy] = useState<PostSort>("reach");
  const rows = useMemo(() => sortPosts(posts, by), [posts, by]);
  const cols: { key: PostSort; label: string; short: string; get: (p: PostRow) => number | null }[] = [
    { key: "reach", label: reachLabel, short: "Reach", get: (p) => p.reach },
    { key: "views", label: "Views", short: "Views", get: (p) => p.views },
    { key: "interactions", label: hasSaves ? "Likes, comments, saves, shares" : "Reactions, comments, shares", short: "Likes etc.", get: (p) => p.interactions },
  ];
  // On a phone: the column being sorted by. Newest first has no number of its own, so reach shows beside it.
  const onPhone = (key: PostSort) => by === key || (by === "newest" && key === "reach");
  const head = (c: (typeof cols)[number]) => (
    <Th key={c.key} align="right" className={cx(!onPhone(c.key) && "hidden sm:table-cell")}>
      <button type="button" onClick={() => setBy(c.key)} aria-pressed={by === c.key} className={cx("-mx-2 inline-flex min-h-10 items-center gap-1 rounded-md px-2 hover:text-ink sm:min-h-8", by === c.key && "text-ink")}>
        <span className="sm:hidden">{c.short}</span>
        <span className="hidden sm:inline">{c.label}</span>
        <ArrowDown aria-hidden className={cx("size-3.5", by !== c.key && "opacity-0")} />
      </button>
    </Th>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <Th>
              <button type="button" onClick={() => setBy("newest")} aria-pressed={by === "newest"} className={cx("-mx-2 inline-flex min-h-10 items-center gap-1 rounded-md px-2 hover:text-ink sm:min-h-8", by === "newest" && "text-ink")}>
                Post
                <ArrowDown aria-hidden className={cx("size-3.5", by !== "newest" && "opacity-0")} />
              </button>
            </Th>
            {cols.map(head)}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <Tr key={p.id}>
              <Td className="max-w-0 w-full">
                <div className="flex min-w-0 items-center gap-3">
                  <Thumb src={p.thumbnailUrl} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{p.caption ?? <span className="font-normal text-muted">No caption</span>}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span>{KIND_LABEL[p.kind] ?? "Post"}</span>
                      <span>{shortDate(p.day)}</span>
                      {!p.hasNumbers && <span>No numbers yet</span>}
                      {p.permalink && (
                        <a href={p.permalink} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1 underline-offset-2 hover:text-ink hover:underline sm:min-h-0">
                          Open <ExternalLink aria-hidden className="size-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </Td>
              {cols.map((c) => (
                <Td key={c.key} align="right" className={cx("whitespace-nowrap", !onPhone(c.key) && "hidden sm:table-cell", by === c.key && "font-semibold")}>
                  {n0(c.get(p))}
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
