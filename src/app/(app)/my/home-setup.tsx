"use client";

/**
 * "Make it an app" on the staff Today view: one card that shows only what's
 * left to do on this phone — add to the Home Screen (iPhone steps, or the
 * browser's own Install on Android), then turn on notifications. It hides
 * itself once both are done, or for two weeks after "Not now".
 */

import { usePushDevice } from "@/components/push-toggle";
import { Button, Card } from "@/components/ui";
import { BellRing, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

const SNOOZE_KEY = "staff.homeSetup.snoozedUntil";
const SNOOZE_DAYS = 14;

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const noop = () => () => {};
/** Client-only facts read after hydration (server renders nothing for this card). */
const useClient = () => useSyncExternalStore(noop, () => true, () => false);

function snoozed() {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

export function HomeSetup({ pushReady, vapidKey }: { pushReady: boolean; vapidKey: string | null }) {
  const client = useClient();
  const { state, error, turnOn } = usePushDevice(vapidKey);
  const [hidden, setHidden] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [justOn, setJustOn] = useState(false);

  useEffect(() => {
    setHidden(snoozed());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!client || hidden) return null;
  const needsInstall = isIOS() && !isStandalone();
  const canPush = pushReady && (state === "off" || state === "working");
  if (justOn && state === "on") {
    return (
      <Card className="flex animate-rise-in items-center gap-3 border-good/30 bg-good-bg px-4 py-3 text-sm font-medium text-good motion-reduce:animate-none" role="status">
        <BellRing className="size-4 shrink-0" aria-hidden /> Notifications are on. You&apos;ll hear about schedule changes here.
      </Card>
    );
  }
  if (!needsInstall && !canPush && !install) return null;

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000));
    } catch {
      /* storage blocked: just hide for now */
    }
    setHidden(true);
  };

  return (
    <Card className="relative overflow-hidden p-4 pr-12" data-tour="my.setup">
      <button type="button" onClick={snooze} aria-label="Not now" className="absolute top-1.5 right-1.5 grid size-11 place-items-center rounded-full text-muted active:bg-surface-2">
        <X className="size-4" />
      </button>
      {needsInstall ? (
        <>
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[linear-gradient(140deg,#f59e42_0%,#e2553f_55%,#c2367a_100%)] text-sm font-bold text-white" aria-hidden>S</span>
            <div className="min-w-0">
              <h2 className="text-[0.95rem] font-semibold">Put Subversive on your Home Screen</h2>
              <p className="text-sm text-muted">Opens in one tap, full screen — and lets your phone get shift alerts.</p>
            </div>
          </div>
          <ol className="mt-3 grid gap-2 text-sm text-ink-2">
            <li className="flex items-center gap-2.5 rounded-xl bg-surface-2/70 px-3 py-2.5">
              <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-surface text-xs font-semibold">1</span>
              <span>Tap <Share className="mx-0.5 inline size-4 -translate-y-px text-[#0a84ff]" aria-label="Share" /> at the bottom of Safari</span>
            </li>
            <li className="flex items-center gap-2.5 rounded-xl bg-surface-2/70 px-3 py-2.5">
              <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-surface text-xs font-semibold">2</span>
              <span>Choose <span className="inline-flex items-center gap-1 font-medium text-ink"><SquarePlus className="size-4" aria-hidden />Add to Home Screen</span></span>
            </li>
          </ol>
        </>
      ) : install ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[0.95rem] font-semibold">Install the app</h2>
            <p className="text-sm text-muted">One tap from your home screen, full screen.</p>
          </div>
          <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={async () => { await install.prompt(); const c = await install.userChoice.catch(() => null); if (c?.outcome === "accepted") setInstall(null); }}>
            Install
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-area/12 text-area" aria-hidden><BellRing className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[0.95rem] font-semibold">Get shift alerts on this phone</h2>
            <p className="text-sm text-muted">New schedules, swaps and changes — even with the app closed.</p>
          </div>
          <Button variant="primary" size="lg" className="w-full sm:w-auto" disabled={state === "working"} onClick={async () => { await turnOn(); setJustOn(true); }}>
            {state === "working" ? "One moment…" : "Turn on notifications"}
          </Button>
          {error && <p className="w-full text-sm text-bad" role="alert">{error}</p>}
        </div>
      )}
    </Card>
  );
}
