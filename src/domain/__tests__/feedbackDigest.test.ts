import { describe, expect, it } from "vitest";
import { feedbackDigest, type DigestNote } from "../feedbackDigest";

const note = (o: Partial<DigestNote> = {}): DigestNote => ({
  kind: "problem",
  userName: "Zane",
  role: "MANAGER",
  date: "2026-11-14",
  path: "/brewery",
  pageTitle: "Tanks",
  body: "FV2 says day 9 of 14 but we moved it to the brite yesterday.",
  status: "new",
  note: null,
  hasPhoto: false,
  ...o,
});

describe("feedback digest for Claude", () => {
  it("writes one block per note with who, when, where and what", () => {
    const md = feedbackDigest([note()]);
    expect(md).toBe(
      [
        "# Feedback from Subversive Ops (1 note)",
        "",
        "Sent from the Feedback button in the app. Each note names the page it was sent from.",
        "",
        "## 1. Problem · Zane (Manager) · Nov 14, 2026",
        "",
        "- Page: `/brewery` (Tanks)",
        "- Status: New",
        "",
        "> FV2 says day 9 of 14 but we moved it to the brite yesterday.",
        "",
      ].join("\n"),
    );
  });

  it("adds the reply or plan, the photo, and the device when there are any", () => {
    const md = feedbackDigest([note({ note: "Planned for next week.", status: "planned", hasPhoto: true, device: "iPhone · Safari", appVersion: "1.21" })]);
    expect(md).toContain("- Status: Planned");
    expect(md).toContain("- Reply or plan: Planned for next week.");
    expect(md).toContain("- Sent from: iPhone · Safari, app 1.21");
    expect(md).toContain("(photo attached in Ops)");
  });

  it("keeps several lines together as one quote", () => {
    const md = feedbackDigest([note({ body: "Line one\n\nLine three" })]);
    expect(md).toContain("> Line one\n>\n> Line three");
  });

  it("numbers several notes and counts them in the title", () => {
    const md = feedbackDigest([note(), note({ kind: "praise", userName: "Line", role: "STAFF", path: null, pageTitle: null })]);
    expect(md.startsWith("# Feedback from Subversive Ops (2 notes)")).toBe(true);
    expect(md).toContain("## 2. Love it · Line (Staff) · Nov 14, 2026");
    expect(md).toContain("- Page: not recorded");
  });

  it("says who when the person is gone, and handles a page with no title", () => {
    const md = feedbackDigest([note({ userName: null, role: null, pageTitle: "" })]);
    expect(md).toContain("· Someone ·");
    expect(md).toContain("- Page: `/brewery`\n");
  });

  it("says so when there's nothing to copy", () => {
    expect(feedbackDigest([])).toBe("# Feedback from Subversive Ops\n\nNo notes.\n");
  });
});
