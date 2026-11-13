"use client";

import { pushConfig, removePushSubscription, savePushSubscription, sendTestPush, setNotifyPref, type PushConfig } from "@/app/(app)/settings/notifications/actions";
import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button, Card, cx } from "./ui";

/**
 * "Turn on notifications" for this device (web push). Drop it anywhere — it loads its
 * own settings. `variant="card"` (default, for /my) also shows the per-event switches
 * for the signed-in user; `variant="inline"` is just the device toggle.
 */

type DeviceState = "loading" | "unsupported" | "ios-install" | "blocked" | "off" | "on" | "working";

const isIOS = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export function usePushDevice(vapidKey: string | null) {
  const [state, setState] = useState<DeviceState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supported()) return setState(isIOS() && !isStandalone() ? "ios-install" : "unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const sub = await currentSubscription().catch(() => null);
      if (!alive) return;
      setState(sub ? "on" : "off");
      // Keep the server copy fresh (browsers occasionally rotate subscriptions). Once per tab session.
      if (sub) {
        try {
          if (!sessionStorage.getItem("push-synced")) {
            await savePushSubscription(sub.toJSON());
            sessionStorage.setItem("push-synced", "1");
          }
        } catch {
          /* storage blocked — skip the sync */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const turnOn = useCallback(async () => {
    if (!vapidKey) return;
    setError(null);
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) }));
      const r = await savePushSubscription(sub.toJSON());
      if (r.error) throw new Error(r.error);
      setState("on");
    } catch (e) {
      console.error(e);
      setError("Couldn't turn notifications on in this browser. Try again, or use another browser.");
      setState("off");
    }
  }, [vapidKey]);

  const turnOff = useCallback(async () => {
    setError(null);
    setState("working");
    try {
      const sub = await currentSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch (e) {
      console.error(e);
      setError("Couldn't turn notifications off. Try again.");
      setState("on");
    }
  }, []);

  return { state, error, turnOn, turnOff };
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="inline-flex h-10 min-w-10 items-center justify-center disabled:opacity-40 sm:h-8">
      <span className={cx("relative h-5 w-9 rounded-full transition-colors", on ? "bg-ink" : "bg-border-strong")}>
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all", on ? "left-[1.125rem]" : "left-0.5")} />
      </span>
    </button>
  );
}

function DeviceToggle({ config, onChanged }: { config: PushConfig; onChanged?: () => void }) {
  const { state, error, turnOn, turnOff } = usePushDevice(config.vapidPublicKey);
  const [test, setTest] = useState<string | null>(null);
  const [testing, startTest] = useTransition();
  const on = state === "on";

  let note: string | null = null;
  if (!config.pushReady) note = "Push notifications aren't set up yet. Email still works if it's set up.";
  else if (state === "ios-install") note = "On iPhone, add this app to your Home Screen first (Share → Add to Home Screen), then open it from there and turn notifications on.";
  else if (state === "unsupported") note = "This browser can't show notifications.";
  else if (state === "blocked") note = "Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-lg", on ? "bg-ink text-primary-ink" : "bg-surface-2 text-muted")}>{on ? <Bell className="size-4" /> : <BellOff className="size-4" />}</span>
          <div className="min-w-0">
            <div className="text-sm font-medium">{on ? "Notifications are on for this device" : "Notifications on this device"}</div>
            <div className="text-xs text-muted">{on ? "You'll get alerts even when the app is closed." : "Get schedule changes and alerts on this phone or computer."}</div>
          </div>
        </div>
        {config.pushReady && (state === "off" || state === "on" || state === "working" || state === "loading") && (
          <div className="flex items-center gap-2">
            {on && (
              <Button size="sm" variant="ghost" disabled={testing} onClick={() => startTest(async () => { const r = await sendTestPush(); setTest(r.error ?? r.ok ?? null); })}>
                Send a test
              </Button>
            )}
            <Button
              variant={on ? "secondary" : "primary"}
              className="h-10 sm:h-9"
              disabled={state === "working" || state === "loading"}
              onClick={async () => { await (on ? turnOff() : turnOn()); onChanged?.(); }}
            >
              {state === "working" ? "One moment…" : on ? "Turn off" : "Turn on notifications"}
            </Button>
          </div>
        )}
      </div>
      {(note || error || test) && <p className={cx("mt-3 text-sm", error ? "text-bad" : "text-muted")}>{error ?? test ?? note}</p>}
    </div>
  );
}

export function EventSwitches({ config, setConfig }: { config: PushConfig; setConfig: (c: PushConfig) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const flip = async (key: PushConfig["events"][number]["key"], channel: "email" | "push", on: boolean) => {
    const prev = config;
    setConfig({ ...config, events: config.events.map((e) => (e.key === key ? { ...e, [channel]: on } : e)) });
    const r = await setNotifyPref({ event: key, channel, on });
    if (r.error) { setErr(r.error); setConfig(prev); } else setErr(null);
  };
  return (
    <div>
      <div className="grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-x-2 text-sm">
        <div />
        <div className="text-center text-xs font-medium text-muted">Email</div>
        <div className="text-center text-xs font-medium text-muted">Push</div>
        {config.events.map((e) => (
          <div key={e.key} className="contents">
            <div className="min-w-0 py-1.5">
              <div className="font-medium">{e.label}</div>
              <div className="text-xs text-muted">{e.hint}</div>
            </div>
            <div className="flex justify-center"><Switch on={e.email} onChange={(v) => flip(e.key, "email", v)} label={`${e.label} by email`} /></div>
            <div className="flex justify-center"><Switch on={e.push} onChange={(v) => flip(e.key, "push", v)} label={`${e.label} by push`} /></div>
          </div>
        ))}
      </div>
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
    </div>
  );
}

export function PushToggle({ variant = "card", initial }: { variant?: "card" | "inline"; initial?: PushConfig }) {
  const [config, setConfig] = useState<PushConfig | null>(initial ?? null);
  useEffect(() => {
    if (!initial) pushConfig().then(setConfig).catch(() => setConfig(null));
  }, [initial]);
  if (!config) return variant === "card" ? <Card className="h-24 animate-pulse p-4" /> : null;

  if (variant === "inline") return <DeviceToggle config={config} />;
  return (
    <Card className="p-4">
      <DeviceToggle config={config} />
      <div className="mt-4 border-t border-border pt-3">
        <EventSwitches config={config} setConfig={setConfig} />
        <p className="mt-2 text-xs text-muted">
          {!config.emailReady ? "Email isn't set up yet, so for now only push notifications go out." : config.email ? <>Emails go to {config.email}.</> : "Ask a manager to add your email on the Team page to get emails."}
        </p>
      </div>
    </Card>
  );
}
