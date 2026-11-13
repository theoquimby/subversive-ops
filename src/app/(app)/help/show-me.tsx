"use client";

import { Button } from "@/components/ui";
import { useTour } from "@/components/tour";
import { Check, Play } from "lucide-react";

/** Starts a guided tour (and remembers it was taken). */
export function ShowMe({ tourId, label = "Show me", variant = "primary", size = "md" }: { tourId: string; label?: string; variant?: "primary" | "secondary"; size?: "sm" | "md" }) {
  const { start, isDone } = useTour();
  return (
    <Button variant={variant} size={size} onClick={() => start(tourId)}>
      {isDone(tourId) ? <Check className="size-3.5" strokeWidth={2.5} /> : <Play className="size-3.5" strokeWidth={2} />}
      {label}
    </Button>
  );
}
