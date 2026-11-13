"use client";

import { Button } from "@/components/ui";
import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="print:hidden">
      <Printer className="size-4" /> Print
    </Button>
  );
}
