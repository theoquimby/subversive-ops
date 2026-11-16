import type { HelpEntry } from "../types";

/** Shift checklists: /checklists (everyone) and /checklists/setup (managers). */
export const checklists: HelpEntry[] = [
  {
    id: "checklists.page",
    area: "checklists",
    route: "/checklists",
    tour: "checklists",
    audience: "all",
    title: "Checklists",
    body: "Opening, mid and closing routines. Tick each step as it's done — your name goes next to it — and sign the list at the end.",
    article: `Open it from **Floor → Checklists** (staff find it under More).

- **Today's lists** come first: yours (for your position) on top, then whatever's next for the time of day. Each shows who's on the schedule for it.
- **Tick a step** as you do it. It saves straight away with your name and the time, so two people can work the same list on two phones.
- **The arrow** next to a step opens the page that helps: scan a kicked keg, log waste, write the shift note.
- **Sign off** at the end. If something couldn't be done, sign anyway and add a note saying why.
- **A close after midnight** still counts for that night, until 5am.

Managers also see **Last two weeks**: every list, day by day, and who signed it. A closing list left unfinished shows on the Overview and in the morning brief the next day.`,
    related: ["checklists.today", "checklists.history", "checklists.setup", "checklists.jobs"],
    keywords: ["opening", "closing", "sidework", "side work", "close out", "routine", "sign off", "cleaning list", "duties"],
  },
  {
    id: "checklists.today",
    area: "checklists",
    route: "/checklists",
    audience: "all",
    title: "Today's lists",
    body: "Every list that runs today, with who ticked each step. Yours come first. A closing list stays open until 5am for the night it closes.",
    related: ["checklists.page"],
  },
  {
    id: "checklists.jobs",
    area: "checklists",
    route: "/checklists",
    audience: "all",
    title: "Upkeep due",
    body: "Cleaning and care jobs that came due, like draft lines or the fryer boil-out. Tap Done when it's finished and it's logged with your name.",
    related: ["upkeep.jobs"],
  },
  {
    id: "checklists.history",
    area: "checklists",
    route: "/checklists",
    title: "Last two weeks",
    body: "Each list day by day: filled = signed off, outlined green = all ticked but not signed, amber = partly done, red = nothing ticked. Phones show the last week.",
    related: ["checklists.page"],
  },
  {
    id: "checklists.setup",
    area: "checklists",
    route: "/checklists/setup",
    title: "Set up checklists",
    body: "Name each list, choose opening, mid or closing, the days it runs and the positions it's for, then add the steps.",
    article: `Open it from **Checklists → Set up lists**.

- **The list's name** and **Opening / Mid-shift / Closing** decide where it shows and when.
- **Runs on**: type days like "Fri, Sat", or leave blank for every day.
- **For** a position puts the list at the top for people in that position, and shows who's on the schedule for it. With none picked, it's for everyone.
- **Steps**: type and press Enter. Give one a note on how to do it, a link to an app page, or "Only on" days (say, hood filters on Sundays).
- **Off** hides a list or a step but keeps its history. Delete removes it and its ticks.

We start you with an opening and closing list for the bar and the kitchen. Change them to match how you actually open and close.`,
    related: ["checklists.page"],
    keywords: ["template", "steps", "add step"],
  },
];
