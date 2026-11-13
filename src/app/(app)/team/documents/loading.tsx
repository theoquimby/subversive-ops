/** Loading skeleton — Documents: upload form, then the library table. */

import { SkeletonPage, PageHeaderSkeleton, SectionSkeleton, FormSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-36" description={2} />
      <SectionSkeleton><FormSkeleton fields={4} /></SectionSkeleton>
      <SectionSkeleton><TableSkeleton rows={5} cols={["3fr", "1fr", "1fr", "1fr", "0.6fr"]} row="h-[3.1rem]" /></SectionSkeleton>
    </SkeletonPage>
  );
}
