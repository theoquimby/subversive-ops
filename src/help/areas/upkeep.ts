import type { HelpEntry } from "../types";

/** Upkeep: /upkeep — equipment, recurring maintenance and the repair log. */
export const upkeep: HelpEntry[] = [
  {
    id: "upkeep.page",
    area: "upkeep",
    route: "/upkeep",
    tour: "upkeep",
    title: "Upkeep",
    body: "Draft lines, the hood, the walk-in and the rest: what's due, who services it, and what repairs have cost.",
    article: `Open it from **Floor → Upkeep**.

- **Jobs** come round every so often: clean draft lines every 2 weeks, hood cleaning twice a year, the fire extinguishers yearly. Tap **Done** when one's finished and its next due date moves on. **…** logs it with a different date, a cost or a note.
- **Equipment** keeps the make, model, serial, the service company's number and the warranty, so it's to hand when something breaks.
- **Log a repair** records what broke, what it cost and whether it's out of action. Something out of action shows on the Overview and in the brief until you mark it fixed.
- **The log** lists every job done and every repair, newest first.

Jobs marked **Staff can do it** show on everyone's Checklists page when due, so the bar can clean the lines and tick it off.

We start you with the usual jobs for a taproom with a kitchen. The intervals are typical (Brewers Association draft guide, NFPA for the hood and its fire system), not legal advice — check them with your vendors and the fire marshal. Set roughly when each was last done and they start counting down.`,
    related: ["upkeep.jobs", "upkeep.equipment", "upkeep.log", "checklists.jobs"],
    keywords: ["maintenance", "repair", "line cleaning", "draft lines", "beer lines", "hood", "fire suppression", "ansul", "grease trap", "ice machine", "equipment", "warranty", "service"],
  },
  { id: "upkeep.overdue", area: "upkeep", route: "/upkeep", title: "Overdue", body: "Jobs past their due date. They also show on the Overview and in the morning brief." , related: ["upkeep.jobs"] },
  { id: "upkeep.due", area: "upkeep", route: "/upkeep", title: "Due this week", body: "Jobs due today or in the next 7 days." , related: ["upkeep.jobs"] },
  { id: "upkeep.down", area: "upkeep", route: "/upkeep", title: "Down for repair", body: "Repairs logged as out of action and not yet marked fixed." , related: ["upkeep.log"] },
  { id: "upkeep.spend", area: "upkeep", route: "/upkeep", title: "Repairs & service, 12 months", body: "What jobs, repairs and service visits cost over the last year, from the costs in the log. Per piece of equipment in the 12 mo column." , related: ["upkeep.log", "upkeep.equipment"] },
  {
    id: "upkeep.jobs",
    area: "upkeep",
    route: "/upkeep",
    title: "Jobs",
    body: "Each recurring job, most urgent first. Tap Done when it's finished; tap the row to change how often, the equipment, who does it, or the how-to staff see.",
    related: ["upkeep.page", "checklists.jobs"],
  },
  {
    id: "upkeep.equipment",
    area: "upkeep",
    route: "/upkeep",
    title: "Equipment",
    body: "Make, model, serial, the service company and its phone, and the warranty date. Type in any cell; it saves as you go. On a phone, tap the company to call. Brewery tanks get theirs from Upkeep on Brewery setup; a repair that marks one down shows on the Brewery.",
    related: ["upkeep.page"],
  },
  {
    id: "upkeep.log",
    area: "upkeep",
    route: "/upkeep",
    title: "Log",
    body: "Every job done, repair and service visit, newest first. Add or change a cost in place; mark a repair Fixed when it's back in action.",
    related: ["upkeep.page", "upkeep.spend"],
  },
];
