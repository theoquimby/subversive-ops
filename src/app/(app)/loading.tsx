/** Loading skeleton — Overview (and fallback for any page without its own skeleton). */

import { SkeletonPage, PageHeaderSkeleton, StatRowSkeleton, SectionSkeleton, TableSkeleton, ListSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-36" />
      <div className="mb-8 rounded-xl border border-border bg-surface p-4">
        <Bone className="h-3.5 w-40" />
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i}><Bone className="h-3 w-16" /><Bone className="mt-2 h-5 w-20" /><Bone className="mt-2 h-2.5 w-28" /></div>)}
        </div>
      </div>
      <StatRowSkeleton className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4" />
      <StatRowSkeleton count={6} className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" />
      <div className="grid gap-x-8 lg:grid-cols-5">
        <SectionSkeleton className="mb-10 lg:col-span-3" action><TableSkeleton rows={5} /></SectionSkeleton>
        <SectionSkeleton className="mb-10 lg:col-span-2" action><ListSkeleton rows={4} /></SectionSkeleton>
      </div>
    </SkeletonPage>
  );
}
