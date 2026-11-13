/** Loading skeleton — Weekly brief: a narrow column of cards. */

import { SkeletonPage, Bone, TextLine, ListSkeleton, BlockSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <div className="mx-auto max-w-3xl">
        <TextLine className="w-40" line="h-4" bone="h-2.5" />
        <TextLine className="w-72 max-w-full rounded-lg" line="mt-2 h-10" bone="h-8" />
        <TextLine className="w-[90%]" line="mt-2 h-6" bone="h-3.5" />
        <TextLine className="mb-8 w-[60%]" line="h-6" bone="h-3.5" />
        <BlockSkeleton className="mb-4 h-32" />
        <ListSkeleton rows={5} row="h-11" meta={false} className="mb-4" />
        <Bone className="h-48 w-full rounded-xl" />
      </div>
    </SkeletonPage>
  );
}
