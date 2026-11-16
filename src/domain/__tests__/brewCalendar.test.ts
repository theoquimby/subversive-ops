import { describe, expect, it } from "vitest";
import { breweryEvents, buildICalendar, calendarWindow, foldLine, icsEscape, type CalBrew } from "../brewCalendar";

const octets = (s: string) => new TextEncoder().encode(s).length;

describe("iCalendar text", () => {
  it("escapes backslashes, semicolons, commas and newlines", () => {
    expect(icsEscape("a\\b; c, d\nnext\r\nline")).toBe("a\\\\b\\; c\\, d\\nnext\\nline");
  });

  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:Brew")).toBe("SUMMARY:Brew");
  });

  it("folds long lines at 75 octets with a leading space on each continuation", () => {
    const line = `DESCRIPTION:${"x".repeat(200)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBe(3);
    expect(octets(parts[0])).toBe(75);
    for (const p of parts.slice(1)) {
      expect(p.startsWith(" ")).toBe(true);
      expect(octets(p)).toBeLessThanOrEqual(75);
    }
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
  });

  it("never splits a character across a fold", () => {
    const line = `SUMMARY:${"Märzen → brite ".repeat(12)}`;
    const parts = foldLine(line).split("\r\n");
    for (const p of parts) expect(octets(p)).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
    expect(parts.join("")).not.toContain("�");
  });
});

describe("buildICalendar", () => {
  const ics = buildICalendar(
    [{ uid: "b1.brew@subversive-ops", date: "2026-11-19", title: "Brew: NY Nectar, 26-031", description: "FV2; 7 bbl" }],
    { name: "Subversive brewery", stamp: new Date("2026-11-16T15:04:05Z") },
  );
  const lines = ics.split("\r\n");

  it("is a calendar with CRLF line ends", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("X-WR-CALNAME:Subversive brewery");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes all-day events ending the next day, with a stable UID and escaped text", () => {
    expect(lines).toContain("BEGIN:VEVENT");
    expect(lines).toContain("UID:b1.brew@subversive-ops");
    expect(lines).toContain("DTSTAMP:20261116T150405Z");
    expect(lines).toContain("DTSTART;VALUE=DATE:20261119");
    expect(lines).toContain("DTEND;VALUE=DATE:20261120");
    expect(lines).toContain("SUMMARY:Brew: NY Nectar\\, 26-031");
    expect(lines).toContain("DESCRIPTION:FV2\\; 7 bbl");
  });

  it("ends an event on the first of the next month or year when needed", () => {
    const x = buildICalendar([{ uid: "u", date: "2026-12-31", title: "Release" }], { name: "B", stamp: new Date("2026-11-16T00:00:00Z") });
    expect(x).toContain("DTEND;VALUE=DATE:20270101");
  });
});

describe("breweryEvents", () => {
  const window = { from: "2026-10-16", to: "2027-05-16" };
  const planned: CalBrew = {
    id: "b1",
    code: "26-031",
    name: "NY Nectar",
    status: "PLANNED",
    brewOn: "2026-11-19",
    dryHopOn: "2026-11-26",
    fvTransferOn: null,
    tapOn: "2026-12-19",
    tapLocked: true,
    lockedReason: "Holiday release",
    packagedOn: null,
    stays: [
      { tankName: "FV2", kind: "FERMENTER", start: "2026-11-19", end: "2026-12-08" },
      { tankName: "BBT1", kind: "BRITE", start: "2026-12-08", end: "2026-12-09" },
    ],
  };

  it("gives a planned brew its brew day, dry hop, transfer, packaging and release", () => {
    const ev = breweryEvents([planned], window);
    expect(ev.map((e) => [e.date, e.title])).toEqual([
      ["2026-11-19", "Brew: NY Nectar (26-031)"],
      ["2026-11-26", "Dry hop: NY Nectar"],
      ["2026-12-08", "Transfer to BBT1: NY Nectar"],
      ["2026-12-09", "Package: NY Nectar"],
      ["2026-12-19", "Release (locked): NY Nectar"],
    ]);
    expect(ev[0].description).toContain("FV2");
    expect(ev[4].description).toContain("Holiday release");
  });

  it("keeps the same UIDs when the dates move", () => {
    const a = breweryEvents([planned], window).map((e) => e.uid);
    const moved = { ...planned, brewOn: "2026-11-23", stays: planned.stays.map((s) => ({ ...s, start: s.start.replace("11-19", "11-23") })) };
    expect(breweryEvents([moved], window).map((e) => e.uid)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });

  it("adds a lager's fermenter move, and uses the packaged day once packaged", () => {
    const lager: CalBrew = { ...planned, id: "b2", name: "Märzen", status: "PACKAGED", dryHopOn: null, fvTransferOn: "2026-11-02", tapLocked: false, lockedReason: null, tapOn: "2026-12-01", packagedOn: "2026-11-25", stays: [{ tankName: "FV1", kind: "FERMENTER", start: "2026-10-20", end: "2026-11-23" }, { tankName: "BBT2", kind: "BRITE", start: "2026-11-23", end: "2026-11-25" }], brewOn: "2026-10-20" };
    const ev = breweryEvents([lager], window);
    expect(ev.map((e) => e.title)).toEqual(["Brew: Märzen (26-031)", "Fermenter move: Märzen", "Transfer to BBT2: Märzen", "Package: Märzen", "Release: Märzen"]);
  });

  it("leaves out dumped brews and anything outside the window", () => {
    expect(breweryEvents([{ ...planned, status: "DUMPED" }], window)).toEqual([]);
    expect(breweryEvents([planned], { from: "2026-12-01", to: "2026-12-10" }).map((e) => e.date)).toEqual(["2026-12-08", "2026-12-09"]);
  });

  it("packages a brew still in its tank on the day it's due out", () => {
    const inTank: CalBrew = { ...planned, status: "FERMENTING", tapLocked: false, stays: [{ tankName: "FV2", kind: "FERMENTER", start: "2026-11-01", end: null }] };
    expect(breweryEvents([inTank], window).some((e) => e.title.startsWith("Package"))).toBe(false);
  });

  it("covers the last month and the next six", () => {
    expect(calendarWindow("2026-11-16")).toEqual({ from: "2026-10-16", to: "2027-05-16" });
    expect(calendarWindow("2026-03-31")).toEqual({ from: "2026-02-28", to: "2026-09-30" });
  });
});
