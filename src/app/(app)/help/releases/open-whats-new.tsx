"use client";

import { Sparkles } from "lucide-react";
import { openWhatsNew } from "@/components/whats-new";
import { Button } from "@/components/ui";

export function OpenWhatsNew() {
  return (
    <Button size="sm" onClick={openWhatsNew}>
      <Sparkles className="size-4" strokeWidth={1.75} /> What&apos;s new
    </Button>
  );
}
