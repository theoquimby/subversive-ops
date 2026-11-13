import type { HelpEntry } from "../types";

/** Training & certifications: /team/training, the My training section on /my, and where it shows up elsewhere. */
export const training: HelpEntry[] = [
  {
    id: "training.page",
    area: "training",
    route: "/team/training",
    tour: "training",
    title: "Training & certificates",
    body: "Who holds which certificate (ATAP, ServSafe, harassment training…), what's about to expire, and onboarding checklists. Staff upload their own cards on My shifts; you verify them here.",
    article: `Open it from **Team → Training**.

- **The tiles** show how many required certificates are in date, and how many are expiring, expired or missing.
- **Certificates** is the matrix: everyone against every certificate type. Tap a cell to add, renew, view or verify.
- **Certificate types** sets what you track, how long each lasts and who needs it.
- **Checklists** are onboarding steps (e.g. "New bartender") staff tick off on My shifts and you sign off.

People and managers get reminders 30 and 7 days before something expires, and when it has. Expiring and expired certificates, missing ones and overdue checklists also show in the weekly brief, and the schedule warns when someone is put on a shift without a certificate their position needs.

The New York presets are starting points, not legal advice — confirm them with the SLA, the county health department and your insurer.`,
    related: ["training.matrix", "training.types", "training.modules", "training.reminders", "training.scheduleRule", "my.training"],
    keywords: ["certification", "certificate", "atap", "servsafe", "food handler", "license", "compliance", "harassment"],
  },
  {
    id: "training.compliant",
    area: "training",
    route: "/team/training",
    title: "Compliant",
    body: "Required certificates that are in date today (expiring ones still count), out of all required ones. Optional certificates never lower it.",
    related: ["training.matrix"],
  },
  {
    id: "training.expiring",
    area: "training",
    route: "/team/training",
    title: "Expiring in 30 days",
    body: "Required certificates that run out within 30 days. The person and managers get a reminder at 30 and 7 days.",
    related: ["training.reminders"],
  },
  {
    id: "training.expired",
    area: "training",
    route: "/team/training",
    title: "Expired",
    body: "Required certificates past their expiry date. Renew them before the person's next shift — the schedule warns if they're on one.",
    related: ["training.scheduleRule", "training.addCert"],
  },
  {
    id: "training.missing",
    area: "training",
    route: "/team/training",
    title: "Missing",
    body: "Certificates someone needs for their position (or everyone needs) with nothing on file. The hint counts cards staff uploaded that still need verifying.",
    related: ["training.verify"],
  },
  {
    id: "training.matrix",
    area: "training",
    route: "/team/training",
    title: "Certificate matrix",
    body: "Green runs past 30 days (showing the month it ends), amber expires within 30 days, red is expired or missing. Faded cells are optional for that person. An amber dot means staff uploaded it and it isn't verified yet.",
    article: `Each row is a person, each column a certificate type. Filter by position, or by status (needs attention, expired, expiring, missing, not verified, all in date).

Tap any cell to open that person's certificate: see the photo or PDF, verify it, add a renewal, or look at the history. On a phone each person is a card listing just what they need.

The number under each column heading is how many of the people who need it have it in date.`,
    related: ["training.addCert", "training.verify", "training.types"],
    keywords: ["grid", "status", "who has"],
  },
  {
    id: "training.addCert",
    area: "training",
    route: "/team/training",
    title: "Add or renew a certificate",
    body: "Snap a photo or drop a PDF, pick the issue date and the expiry fills in from the type's validity. Change it if the card says otherwise. A renewal adds a new record; the old one stays in the history.",
    related: ["training.verify", "training.types"],
    keywords: ["upload", "photo", "renew", "camera"],
  },
  {
    id: "training.verify",
    area: "training",
    route: "/team/training",
    title: "Verify",
    body: "Check the photo against the original card, then tap Mark verified. Cards staff upload start unverified; ones you add yourself are verified unless you switch it off.",
    related: ["my.training.upload"],
  },
  {
    id: "training.types",
    area: "training",
    route: "/team/training",
    title: "Certificate types",
    body: "What you track, how many months each lasts (blank = never expires), and who needs it: tap positions to require it for them, or set Everyone or Minors. Archive a type to stop tracking it but keep the history.",
    article: `- **Valid (months)** — changing it recalculates expiry dates that weren't set by hand.
- **Required for positions** — tap a position chip to switch it on or off.
- **Everyone** — e.g. sexual harassment prevention training, which NY requires every year for every employee.
- **Minors** — e.g. working papers (NY employment certificate) for anyone under 18.
- **Status** — Archived types leave the matrix but keep their certificates.

A type can only be deleted while nobody has a certificate for it.`,
    related: ["training.nyPresets", "training.matrix"],
    keywords: ["validity", "expiry", "months", "required"],
  },
  {
    id: "training.nyPresets",
    area: "training",
    route: "/team/training",
    title: "New York presets",
    body: "Pre-filled: ATAP (3 years, bar and servers), ServSafe Food Handler (3 years, kitchen), Food Protection Manager (5 years, optional), allergen awareness (3 years), first aid/CPR (2 years, optional), harassment prevention (yearly, everyone), working papers (minors). Confirm before relying on them.",
    article: `These are typical for a brewery taproom with a kitchen in Catskill, NY — not legal advice.

- **ATAP** (SLA Alcohol Training Awareness Program) isn't mandatory for every server, but certified staff help the business's defense in an SLA case. Certificates last 3 years.
- **ServSafe Food Handler** — 3 years. The Greene County health department may ask for a certified food protection manager instead or as well.
- **Sexual harassment prevention** — NY Labor Law §201-g: every employee, every year.
- **Working papers** — required for workers under 18; issued by the school.

Check with the SLA, the county health department and your insurer, then change the types to match.`,
    related: ["training.types"],
    keywords: ["new york", "sla", "201-g", "law", "requirements", "minors"],
  },
  {
    id: "training.modules",
    area: "training",
    route: "/team/training",
    tour: "training",
    title: "Checklists",
    body: "Onboarding or skills checklists like “New bartender”: a list of steps, each optionally linked to a document. Assign it, staff tick steps on My shifts, then you sign it off.",
    article: `### Build one
Type a name under **Checklists** and press Enter. Add steps one by one; each can have a short detail and a linked document from **Team → Documents** (the handbook, a recipe card). Reorder with the arrows.

### Assign
Pick **Every bartender** (everyone with that position who doesn't have it yet) or one person, optionally a due date, and press **Assign**.

### Follow and sign off
Each person shows a progress bar. Open the row to tick steps yourself (watched them do it) or change the due date. When everything's ticked it says **Ready to sign off**. Overdue checklists show in the weekly brief.`,
    related: ["training.assign", "training.signoff", "my.training.checklists"],
    keywords: ["onboarding", "checklist", "new hire", "module", "steps"],
  },
  {
    id: "training.assign",
    area: "training",
    route: "/team/training",
    title: "Assign a checklist",
    body: "Pick a whole position or one person and an optional due date. People who already have the checklist are skipped.",
    related: ["training.modules"],
  },
  {
    id: "training.signoff",
    area: "training",
    route: "/team/training",
    title: "Sign off",
    body: "Confirms someone has finished the checklist. Once signed off, it's locked for them. You can sign off early (it asks first) or undo it.",
    related: ["training.modules"],
  },
  {
    id: "training.reminders",
    area: "training",
    route: "/settings/notifications",
    title: "Certificate reminders",
    body: "Each morning, anyone whose certificate expires in 30 or 7 days, or just expired, gets a reminder (if they have a login), and managers get one roundup. Each reminder is sent once.",
    related: ["training.page"],
    keywords: ["notification", "email", "push", "expiry reminder"],
  },
  {
    id: "training.scheduleRule",
    area: "training",
    route: "/schedule",
    title: "Missing certificate on a shift",
    body: "The schedule warns when someone is on a shift in a position that needs a certificate they won't hold in date that day (e.g. a bartender with an expired ATAP). Make it Must fix, Warn or Off in the labor rules.",
    related: ["schedule.compliance", "training.types", "settings.laborRules"],
    keywords: ["uncertified", "compliance", "schedule warning"],
  },
  {
    id: "training.brief",
    area: "training",
    route: "/brief",
    title: "Training in the weekly brief",
    body: "The brief lists expired, expiring and missing certificates and overdue checklists, with a link to the training page.",
    related: ["brief.actions", "training.page"],
  },

  // ---- Staff ------------------------------------------------------------------
  {
    id: "my.training",
    area: "my",
    route: "/my",
    audience: "all",
    title: "My training",
    body: "The certificates your job needs and when they run out, plus any checklists a manager gave you. Upload a photo of a new card here; a manager checks it.",
    related: ["my.training.upload", "my.training.checklists"],
    keywords: ["certificate", "atap", "servsafe", "training", "checklist"],
  },
  {
    id: "my.training.upload",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Upload a certificate",
    body: "Tap Upload, take a photo of the card (or choose a PDF), and pick the date on it. It shows as waiting until a manager verifies it.",
    related: ["my.training"],
    keywords: ["photo", "renew", "upload"],
  },
  {
    id: "my.training.checklists",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Training checklists",
    body: "Tick each step as you learn it. Linked documents open in a new tab. When everything's ticked, a manager signs it off.",
    related: ["my.training", "my.documents"],
    keywords: ["onboarding", "steps"],
  },
];
