import { cx } from "@/components/ui";
import type { CertStatus } from "@/domain/certs";
import Link from "next/link";

const TONE: Record<CertStatus, string> = {
  valid: "bg-good-bg text-good",
  expiring: "bg-warn-bg text-warn",
  expired: "bg-bad-bg text-bad",
  missing: "bg-bad-bg text-bad",
  "not-required": "bg-surface-2 text-muted",
};

/** Small status chip on the Team grid that opens this person's row in the training matrix. */
export function CertChip({ employeeId, chip }: { employeeId: string; chip?: { status: CertStatus; label: string } | null }) {
  if (!chip || chip.status === "not-required") return null;
  return (
    <Link
      href={`/team/training?person=${employeeId}`}
      title="Training & certificates"
      className={cx("relative inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap transition-opacity duration-120 after:absolute after:-inset-2 after:content-[''] hover:opacity-80", TONE[chip.status])}
    >
      {chip.label}
    </Link>
  );
}
