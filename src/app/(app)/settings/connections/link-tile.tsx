import { ChevronRight, type LucideIcon } from "lucide-react";
import { HelpZone } from "@/components/help";
import { Badge, Card, cx, LinkButton, type Tone } from "@/components/ui";
import { areaStyle, type Area } from "@/lib/areas";

/**
 * A Connections tile for a connection managed on its own page (Google,
 * Instagram & Facebook): looks like the other tiles, but its button is a link.
 * No hooks, so server components can render it.
 */
export function LinkTile({ help, tour, icon: Icon, area, title, turnsOn, tone, label, detail, time, href }: { help: string; tour: string; icon: LucideIcon; area: Area; title: string; turnsOn: string; tone: Tone; label: string; detail: string; time: string; href: string }) {
  const done = tone === "good";
  const dot = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", neutral: "bg-muted" }[tone];
  return (
    <HelpZone id={help} className="h-full min-w-0">
      <Card className="flex h-full flex-col p-5" data-tour={tour}>
        <div className="flex items-start justify-between gap-3">
          <span aria-hidden style={areaStyle(area)} className="grid size-9 shrink-0 place-items-center rounded-[0.65rem] bg-area/10 text-area ring-1 ring-area/15 ring-inset">
            <Icon className="size-[1.1rem]" strokeWidth={1.9} />
          </span>
          <Badge tone={tone} className="gap-1.5">
            <span className={cx("size-1.5 rounded-full", dot)} />
            {label}
          </Badge>
        </div>
        <div className="mt-3 text-base font-semibold">{title}</div>
        <p className="mt-1 text-sm text-ink-2">{turnsOn}</p>
        <p className="mt-2 line-clamp-2 text-[0.8rem] text-muted">{detail}</p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className="text-xs text-muted">{done ? "" : time}</span>
          <LinkButton href={href} variant={done ? "secondary" : "primary"}>
            {{ good: "Manage", warn: "Continue", bad: "Fix", neutral: "Set up" }[tone]} <ChevronRight className="size-4" />
          </LinkButton>
        </div>
      </Card>
    </HelpZone>
  );
}
