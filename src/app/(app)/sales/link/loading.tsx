/** Loading skeleton — Link your sales: coverage bar and item cards. */

import { Bone, PageHeaderSkeleton, SectionSkeleton, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-40" />
      <div className="mb-8 rounded-xl border border-border bg-surface p-5"><Bone className="h-6 w-64" /><Bone className="mt-4 h-2.5 w-full" /><Bone className="mt-3 h-3 w-80 max-w-full" /></div>
      <SectionSkeleton>
        <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <div key={i} className="rounded-xl border border-border bg-surface p-4"><Bone className="h-4 w-48" /><Bone className="mt-2 h-3 w-64 max-w-full" /><Bone className="mt-4 h-14 w-full" /></div>)}</div>
      </SectionSkeleton>
    </SkeletonPage>
  );
}
