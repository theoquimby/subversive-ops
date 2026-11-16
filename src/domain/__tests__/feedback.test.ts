import { describe, expect, it } from "vitest";
import { asFeedbackKind, asFeedbackStatus, cleanPageTitle, deviceLabel, feedbackKindLabel, feedbackStatusLabel, feedbackStatusTone, newFeedbackLine, parsePhotoDataUrl, validateFeedback } from "../feedback";

describe("kinds and statuses", () => {
  it("falls back to an idea and to new for anything unknown", () => {
    expect(asFeedbackKind("problem")).toBe("problem");
    expect(asFeedbackKind("bug")).toBe("idea");
    expect(asFeedbackKind(undefined)).toBe("idea");
    expect(asFeedbackStatus("wont")).toBe("wont");
    expect(asFeedbackStatus("closed")).toBe("new");
  });
  it("labels them in plain words", () => {
    expect(feedbackKindLabel("praise")).toBe("Love it");
    expect(feedbackKindLabel("nonsense")).toBe("Idea");
    expect(feedbackStatusLabel("wont")).toBe("Won't do");
    expect(feedbackStatusLabel("planned")).toBe("Planned");
    expect(feedbackStatusTone("done")).toBe("good");
    expect(feedbackStatusTone("new")).toBe("neutral");
  });
});

describe("device", () => {
  it("names the phone and browser in a few words", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Chrome");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0")).toBe("Windows · Edge");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15")).toBe("Mac · Safari");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0")).toBe("Mac · Firefox");
  });
  it("tells an iPad from a Mac by touch, and says when it's the installed app", () => {
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    expect(deviceLabel(ipad, { touch: true })).toBe("iPad · Safari");
    expect(deviceLabel(ipad, { touch: true, installed: true })).toBe("iPad · app");
  });
  it("copes with nothing to go on", () => {
    expect(deviceLabel("")).toBe("Unknown device");
    expect(deviceLabel("curl/8.0")).toBe("Unknown device");
  });
});

describe("page title", () => {
  it("drops the app name the browser tab carries", () => {
    expect(cleanPageTitle("Tanks · Subversive Ops")).toBe("Tanks");
    expect(cleanPageTitle("Subversive Ops")).toBe("");
    expect(cleanPageTitle("  Count  ")).toBe("Count");
  });
});

describe("validating a note", () => {
  it("needs some words", () => {
    expect(validateFeedback({ kind: "idea", body: "   " })).toEqual({ error: "Write a few words first." });
  });
  it("trims and keeps the kind", () => {
    expect(validateFeedback({ kind: "problem", body: "  The tank card is wrong  " })).toEqual({ kind: "problem", body: "The tank card is wrong" });
  });
  it("refuses an essay", () => {
    expect(validateFeedback({ kind: "idea", body: "x".repeat(5001) })).toHaveProperty("error");
  });
});

describe("photo data URLs", () => {
  // A real 1×1 PNG and the first bytes of a JPEG.
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  it("reads a real image", () => {
    const r = parsePhotoDataUrl(png);
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.mime).toBe("image/png");
      expect(r.bytes[0]).toBe(0x89);
    }
  });
  it("refuses something that only claims to be an image", () => {
    expect(parsePhotoDataUrl("data:image/jpeg;base64,aGVsbG8gd29ybGQ=")).toHaveProperty("error");
    expect(parsePhotoDataUrl("data:text/html;base64,PGgxPg==")).toHaveProperty("error");
    expect(parsePhotoDataUrl("hello")).toHaveProperty("error");
  });
  it("refuses one over the size limit", () => {
    expect(parsePhotoDataUrl(png, 10)).toEqual({ error: "That photo is too big. Try again — it's shrunk before sending." });
  });
});

describe("the morning brief line", () => {
  it("counts new notes", () => {
    expect(newFeedbackLine(0)).toBeNull();
    expect(newFeedbackLine(1)).toBe("1 new feedback note");
    expect(newFeedbackLine(3)).toBe("3 new feedback notes");
  });
});
