/** Loading skeleton — Invoices: four stats and the invoice table. */

import { SkeletonPage, PageHeaderSkeleton, StatRowSkeleton, SectionSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-32" description={2} actions={2} />
      <StatRowSkeleton />
      <SectionSkeleton description={false} action><TableSkeleton rows={6} cols={["2fr", "1fr", "0.8fr", "1fr", "1fr", "0.8fr"]} /></SectionSkeleton>
    </SkeletonPage>
  );
}
