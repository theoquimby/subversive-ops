/** Loading skeleton — Import sheets: the tabbed upload card. */

import { SkeletonPage, PageHeaderSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-56" description={2} />
      <div className="rounded-xl border border-border bg-surface">
        <div className="grid grid-cols-3 border-b border-border">{Array.from({ length: 3 }, (_, i) => <div key={i} className="flex h-11 items-center justify-center"><Bone className="h-3 w-24" /></div>)}</div>
        <div className="p-4"><Bone className="h-3 w-80 max-w-full" /><Bone className="mt-4 h-16 w-full rounded-xl" /><Bone className="mt-4 h-9 w-28 rounded-lg" /></div>
      </div>
    </SkeletonPage>
  );
}
