/** Loading skeleton — Import a price sheet: one form card. */

import { SkeletonPage, PageHeaderSkeleton, FormSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-48" />
      <FormSkeleton fields={3} className="grid gap-3 sm:grid-cols-3" />
    </SkeletonPage>
  );
}
