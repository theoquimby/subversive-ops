/** Loading skeleton — Overview (and fallback for any page without its own skeleton): today, needs you, the week. */

import { SkeletonPage, PageHeaderSkeleton, StatRowSkeleton, SectionSkeleton, TableSkeleton, ListSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-36" />
      <div className="mb-6 grid rounded-xl border border-border bg-surface lg:grid-cols-2">
        <div className="p-5 sm:p-6">
          <Bone className="h-3.5 w-28" />
          <Bone className="mt-3 h-11 w-44" />
          <Bone className="mt-4 h-4 w-64 max-w-full" />
          <Bone className="mt-6 h-2.5 w-full" />
          <div className="mt-6 grid grid-cols-2 gap-3"><Bone className="h-9 w-24" /><Bone className="h-9 w-24" /></div>
        </div>
        <div className="hidden p-6 lg:block"><Bone className="h-3.5 w-24" /><Bone className="mt-4 h-44 w-full" /></div>
      </div>
      <SectionSkeleton description={false}><ListSkeleton rows={2} /></SectionSkeleton>
      <div className="mb-3 rounded-xl border border-border bg-surface p-5"><Bone className="h-7 w-32" /><Bone className="mt-4 h-28 w-full" /></div>
      <StatRowSkeleton className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4" />
      <div className="grid gap-x-8 lg:grid-cols-5">
        <SectionSkeleton className="mb-10 lg:col-span-3" action><TableSkeleton rows={5} /></SectionSkeleton>
        <SectionSkeleton className="mb-10 lg:col-span-2" action><ListSkeleton rows={4} /></SectionSkeleton>
      </div>
    </SkeletonPage>
  );
}
