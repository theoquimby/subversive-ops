/** Loading skeleton — Events: the add form, then the upcoming table. */

import { SkeletonPage, PageHeaderSkeleton, SectionSkeleton, FormSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-28" description={2} actions={2} />
      <SectionSkeleton><FormSkeleton fields={4} className="grid gap-3 sm:grid-cols-4" /></SectionSkeleton>
      <SectionSkeleton><TableSkeleton rows={8} cols={["1.3fr", "2fr", "1fr", "0.7fr", "0.7fr", "0.5fr", "1.5fr"]} row="h-[2.85rem]" /></SectionSkeleton>
    </SkeletonPage>
  );
}
