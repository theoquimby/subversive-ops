import type { HelpEntry } from "../types";

/** The staff home ("Today"), the Me page and working without signal. */
export const staffHome: HelpEntry[] = [
  {
    id: "my.today",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Today",
    body: "Your day on one screen: your next shift with a countdown and who's on with you, one-tap tools for the floor, anything waiting on you, and news from the team. It's the first thing you see when you open the app.",
    article: `Open the app and you land here.

- **Next shift** — the time, your position, how long until you start (or how long is left), and who else is on. Tap **All my shifts** for the rest.
- **Quick actions** — scan a keg, the prep list, log waste, start a count, leave a shift note, the tap list. The ones you use most come first.
- **For you** — documents to sign, certificates to upload, training steps, and shifts teammates want to give away. Tap one to do it.
- **From the team** — announcements and kudos from your managers.`,
    tour: "today",
    related: ["my.nextShift", "my.todo", "my.quick", "my.setup"],
    keywords: ["home", "today", "start", "dashboard", "next shift"],
  },
  {
    id: "my.nextShift",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Your next shift",
    body: "When you start, your position and a live countdown. During the shift it shows how long is left. Underneath: everyone whose shift overlaps yours. Tap All my shifts to see the rest, swap one or pick one up.",
    related: ["my.page", "my.swaps"],
    keywords: ["countdown", "who's on", "crew", "schedule"],
  },
  {
    id: "my.todo",
    area: "my",
    route: "/my",
    audience: "all",
    title: "For you",
    body: "Things only you can do, most urgent first: documents to read and sign, certificates that are missing or about to expire, training steps, and shifts teammates want to give away. When it's empty, you're all caught up.",
    related: ["my.documents", "my.training", "my.openShifts"],
    keywords: ["to do", "sign", "upload", "certificate", "swap"],
  },
  {
    id: "my.quick",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Quick actions",
    body: "One tap to the floor tools: scan a keg, the prep list, log waste, start a count, a shift note and the tap list. Kitchen staff see prep first; the bar sees the keg scanner first.",
    related: ["kegs.scan", "prep.page", "waste.page", "count.home", "notes.page"],
    keywords: ["shortcut", "scan", "prep", "waste", "count", "note"],
  },
  {
    id: "my.setup",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Add to Home Screen and alerts",
    body: "On iPhone, open the app in Safari, tap Share, then Add to Home Screen. Open it from there and tap Turn on notifications to hear about new schedules, swaps and changes, even with the app closed.",
    related: ["my.notifications", "app.phone"],
    keywords: ["install", "home screen", "app", "push", "notifications", "iphone", "android"],
  },
  {
    id: "my.me",
    area: "my",
    route: "/my/me",
    audience: "all",
    title: "Me",
    body: "Your documents to read and sign, your certificates and training checklists, notes your managers shared, answers about policies, and which notifications you get. In More at the bottom of the screen.",
    related: ["my.documents", "my.training", "my.notifications"],
    keywords: ["profile", "documents", "training", "certificates", "settings"],
  },
  {
    id: "my.offline",
    area: "my",
    route: "/my",
    audience: "all",
    title: "No signal? Keep going",
    body: "Counts, waste, prep ticks and keg scans are saved on your phone when there's no signal (the walk-in) and sent by themselves when you're back. A cloud icon means it's waiting; a green tick means it's in.",
    related: ["count.autosave", "waste.page", "prep.page", "kegs.scan"],
    keywords: ["offline", "walk-in", "no signal", "queue", "waiting to send"],
  },
];
