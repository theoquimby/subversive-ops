import type { HelpEntry } from "../types";

/** The Feedback button on every page, and the managers' feedback inbox. */
export const feedback: HelpEntry[] = [
  {
    id: "feedback.button",
    area: "basics",
    title: "Send feedback",
    body: "Tap Feedback (beside Help) on any page to send an idea, a problem, a question or something you love. The page you're on goes with it, and you can add a photo or screenshot.",
    article: `Something's wrong, missing, confusing or great? Say so from the page you're on — no need to remember it for later.

### Where it is
- **On a computer:** **Feedback** at the bottom of the sidebar, just above Help.
- **On a phone:** the speech-bubble button in the top bar, or **More → Send feedback**.

### Sending one
1. Pick what it is: **Idea**, **Problem**, **Question** or **Love it**.
2. Write it the way you'd text it. The page you're on, the time, your phone or computer and the app version go along by themselves.
3. Add a photo or a screenshot if it helps (it's shrunk before sending).
4. Tap **Send**.

No signal in the walk-in? It's kept on your phone and sends by itself when you're back online.

### Seeing what happened
**Your feedback** (the second tab in the same sheet) lists everything you've sent, with where it stands — New, Planned, Done or Won't do — and any reply from a manager.`,
    keywords: ["feedback", "idea", "bug", "problem", "suggestion", "request", "report", "question", "screenshot", "tell"],
    audience: "all",
    related: ["app.whatsNew"],
  },
  {
    id: "settings.feedback",
    area: "settings",
    route: "/settings/feedback",
    title: "Feedback inbox",
    body: "Every note sent from the Feedback button, with who sent it, the page it came from and any photo. Set a status, write a reply the sender sees, and copy notes for Claude.",
    article: `Everything the team sends from the **Feedback** button lands here. It opens on what still needs you: **New** and **Planned**.

### Working through it
- Tap a note to open it: the full text, the photo, the page it came from (tap to go there), the device and app version.
- Set its **status** — New, Planned, Done or Won't do — and write a **reply or plan**. The sender sees both under **Your feedback**.
- Tick several and use **Set status** to move them together.
- Filter by status, kind, who and page area, search the words, sort any column, or download the list as a spreadsheet.

### Copy for Claude
**Copy for Claude** copies the notes shown (or just the ones you tick) as one tidy Markdown list: the kind, who and their role, the date, the page, the note itself, any reply, and whether a photo is waiting here. Paste it straight into a Claude Code session.

### Heads-up
New notes show as one quiet line in the morning brief and as a count beside **Feedback** in Settings. Nothing is pushed to your phone.`,
    keywords: ["feedback", "inbox", "ideas", "bugs", "requests", "triage", "claude", "reply"],
    related: ["feedback.button", "settings.feedback.copy"],
  },
  {
    id: "settings.feedback.inbox",
    area: "settings",
    route: "/settings/feedback",
    title: "The feedback list",
    body: "One row per note, newest first, showing New and Planned until you change the Status filter. Tap a row to read it, reply and set its status; tick rows to change several at once.",
    related: ["settings.feedback"],
  },
  {
    id: "settings.feedback.copy",
    area: "settings",
    route: "/settings/feedback",
    title: "Copy for Claude",
    body: "Copies the notes shown (or the ones you tick) as a Markdown list — kind, who, date, page, the note, any reply, and whether there's a photo — ready to paste into Claude Code.",
    keywords: ["claude", "copy", "markdown", "digest", "export"],
    related: ["settings.feedback"],
  },
];
