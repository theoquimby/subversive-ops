import { describe, expect, it } from "vitest";
import { bookingClashes, type ClashBooking } from "../privateEvents";

const spaces = [
  { name: "Patio", buyout: false, capacity: 40 },
  { name: "Back room", buyout: false, capacity: 30 },
  { name: "Whole taproom", buyout: true, capacity: 150 },
];
const b = (o: Partial<ClashBooking> = {}): ClashBooking => ({ id: "x", title: "Smith party", date: "2026-12-05", space: "Patio", startTime: "18:00", endTime: "21:00", type: "PARTY", stage: "CONFIRMED", ...o });

describe("bookingClashes", () => {
  it("finds the same space on the same date with times that overlap", () => {
    expect(bookingClashes(b({ id: "new", startTime: "20:00", endTime: "23:00" }), [b()], spaces).map((c) => c.id)).toEqual(["x"]);
  });
  it("lets back-to-back bookings through", () => {
    expect(bookingClashes(b({ id: "new", startTime: "21:00", endTime: "23:00" }), [b()], spaces)).toEqual([]);
  });
  it("ignores other spaces, other dates, lost bookings and itself", () => {
    const others = [b({ id: "a", space: "Back room" }), b({ id: "b", date: "2026-12-06" }), b({ id: "c", stage: "LOST" }), b({ id: "new" })];
    expect(bookingClashes(b({ id: "new" }), others, spaces)).toEqual([]);
  });
  it("counts a booking with no times as taking the whole day", () => {
    expect(bookingClashes(b({ id: "new", startTime: null, endTime: null }), [b()], spaces)).toHaveLength(1);
    expect(bookingClashes(b({ id: "new" }), [b({ startTime: "17:00", endTime: null })], spaces)).toHaveLength(1);
  });
  it("runs a late finish past midnight", () => {
    expect(bookingClashes(b({ id: "new", startTime: "23:00", endTime: "01:00" }), [b({ startTime: "22:00", endTime: "00:30" })], spaces)).toHaveLength(1);
  });
  it("a buyout clashes with any space", () => {
    expect(bookingClashes(b({ id: "new", space: "Whole taproom" }), [b({ space: "Back room" })], spaces)).toHaveLength(1);
    expect(bookingClashes(b({ id: "new", space: "Back room" }), [b({ space: "Whole taproom" })], spaces)).toHaveLength(1);
  });
  it("can't clash without a date or a space", () => {
    expect(bookingClashes(b({ id: "new", date: null }), [b()], spaces)).toEqual([]);
    expect(bookingClashes(b({ id: "new", space: null }), [b()], spaces)).toEqual([]);
  });
});
