"use client";

import { Button } from "@/components/ui";
import { Printer } from "lucide-react";

export function PrintButton() {
  return <Button variant="primary" size="lg" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>;
}
