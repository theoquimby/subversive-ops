/** Loading skeleton — Setup wizard: step bar, intro and feature cards. */

import { SkeletonPage, Bone, TextLine, CardGridSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-2xl">
      <div className="mb-10 grid grid-cols-8 gap-1.5">{Array.from({ length: 8 }, (_, i) => <Bone key={i} className="h-1 rounded-full" />)}</div>
      <TextLine className="w-56 rounded-lg" line="h-10" bone="h-7" />
      <TextLine className="w-[90%]" line="mt-2 h-6" bone="h-3.5" />
      <TextLine className="mb-6 w-[70%]" line="h-6" bone="h-3.5" />
      <CardGridSkeleton count={4} className="grid gap-3 sm:grid-cols-2" height="h-32" />
    </SkeletonPage>
  );
}
