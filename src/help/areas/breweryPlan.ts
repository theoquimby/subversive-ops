import type { HelpEntry } from "../types";

/** Brewery: the floor plan, moving brews between tanks, packaging counts, timing profiles, locked releases, splits and the calendar feed. */
export const breweryPlan: HelpEntry[] = [
  {
    id: "brewery.floorPlan",
    area: "brewery",
    route: "/brewery",
    title: "Floor plan",
    body: "Every tank where it stands, room by room: what's in it, which day it's on and the next thing to do. Tap a tank for its card and actions.",
    article: `Switch between **List** and **Floor plan** at the top of the Tanks page. Your choice is remembered on this phone or computer; until you pick, phones show the list.

Each tank shows its name and size, the beer (with its colour), the day it's on, and the next thing to do:

- **Check: transfer?** once its fermenting days are up.
- **Transfer to brite** for a brew marked conditioning in its fermenter.
- **Package** for a brew in a brite (amber when due, red three days over).
- **Dry hop** on its dry-hop day and the day after.
- **Grav check** from day 7 when there's no FG yet and no reading in the last three days.

Colours: green is fermenting, amber is conditioning in its fermenter, grey is in a brite, dashed is empty.

The **Brew house** shows a brew day under way (tap to resume) or the next planned brew (tap to start its brew day).

Where each tank stands comes from its zone, row and column on [Setup](/brewery/setup). On a phone the plan scrolls sideways inside its box.`,
    keywords: ["floor plan", "layout", "zone", "back wall", "brew house", "map", "tanks"],
    related: ["brewery.tanks", "brewery.moves", "brewery.setup"],
  },
  {
    id: "brewery.moves",
    area: "brewery",
    route: "/brewery",
    title: "Moving a brew between tanks",
    body: "Transfer a brew to a brite, from one fermenter to another, or between brites, with the date, the gravity at the move and a note. Mark conditioning keeps it in its fermenter.",
    article: `On a tank's card, **Transfer** opens every tank in use, brites first:

- **Transfer to brite**: from a fermenter into a brite. The gravity you give is kept as the FG.
- **FV → FV transfer**: into another fermenter (lagers, or to free a tank). A brite already pencilled in stays.
- **BBT → BBT transfer**: between brites.

Each move records the day, the gravity at the move (in °Plato or SG, as the brewery is set) and a note, in the brew's **History** and its gravity readings.

A tank that has a brew in it, or is smaller than the brew, can still be picked: you're asked to confirm first, as in Brew Manager.

**Mark conditioning**: fermenting is done but the beer stays in its fermenter for now. Its next step shows as transfer to brite.`,
    keywords: ["transfer", "brite", "bbt", "fv", "move", "conditioning", "rack"],
    related: ["brewery.tanks", "brewery.packaging"],
  },
  {
    id: "brewery.packaging",
    area: "brewery",
    route: "/brewery",
    title: "Packaging a brew",
    body: "Record the day, final gravity, ½ bbl and ⅙ bbl kegs, can cases, CO₂ and a note. The tank is freed and a keg batch is made to fill kegs from.",
    article: `**Package** on a tank's card asks for the packaging day, the final FG, how many ½ bbl and ⅙ bbl kegs and can cases it made, the CO₂ in volumes and any notes. All of it stays on the brew.

The tank is freed and a keg batch with the brew's code is made. **Fill kegs** (in the message, and on the brew while kegs are still to fill) opens the keg scanner on Many kegs, filling with this beer and batch, so each keg is tied to the brew.`,
    keywords: ["package", "packaging", "kegs", "half barrel", "sixth barrel", "cans", "cases", "co2", "carbonation", "fill"],
    related: ["brewery.moves", "brewery.batches.one"],
  },
  {
    id: "brewery.profiles",
    area: "brewery",
    route: "/brewery/schedule",
    title: "Timing profiles",
    body: "Brew Manager's four timings set each brew's dry hop, transfer, packaging and release days. Transfers land on Mon or Tue and packaging on Wed (or your days on Setup).",
    article: `Days are counted from brew day:

- **Hazy IPA**: dry hop day 7, brite 20, package 23, on tap 30.
- **Sour**: brite 38, package 42, on tap 49.
- **Lager**: fermenter-to-fermenter move 21, brite 49, package 52, on tap 60.
- **Pale / clear IPA**: brite 32, package 35, on tap 42.

A recipe's own dry-hop and release days win over its profile. A recipe with no profile uses its fermenting and conditioning days, and its release is a week after packaging.

**Weekdays.** Transfers move to the nearest transfer day and packaging to the nearest packaging day, up to three days either way (the earlier day when two are as near). By default that's Monday or Tuesday, and Wednesday; change them on [Setup](/brewery/setup). Dry hops and releases aren't moved. Packaging is always after the transfer.

When you plan a brew you can pick a different timing for it; a recipe with no profile gets one suggested from its style.`,
    keywords: ["profile", "hazy", "sour", "lager", "pale", "forecast", "dry hop", "release", "tap day", "snap", "weekday"],
    related: ["brewery.schedule", "brewery.lockedRelease"],
  },
  {
    id: "brewery.lockedRelease",
    area: "brewery",
    route: "/brewery/schedule",
    title: "Locked release days",
    body: "A release tied to an event can be locked. Moving the brew keeps the release day, and the schedule says when the new brew day is too late to make it.",
    article: `Lock a brew's release on the brew's page under **Planned days**, with a reason (Release event, Oktoberfest).

When you move a locked brew on the schedule, its release stays put. If the new brew day doesn't give the beer its full time before the release, the move says so, like "Brew by Nov 19 to keep the release on Dec 19", and offers that day instead.

Locked releases show with a lock on the schedule, in the year view and in the calendar feed.`,
    keywords: ["lock", "locked", "release", "event", "tap date", "deadline"],
    related: ["brewery.profiles", "brewery.schedule"],
  },
  {
    id: "brewery.splits",
    area: "brewery",
    route: "/brewery/batches/[id]",
    title: "Split batches",
    body: "Brew once, then split part into another fermenter as its own beer, like Hoppy American Lager and Golden Lime Lager from one base.",
    article: `On a planned brew or one in a tank, **Split into another fermenter**: pick what the split part becomes, how many barrels it takes, the day, and the fermenter.

The new brew gets the next letter on the code (26-014B), its share of the volume and the ingredient cost, the readings taken so far, its own fermenter from the split day and its own dates from its recipe. Both brews link to each other ("split from 26-014").`,
    keywords: ["split", "split batch", "two beers", "base", "lager"],
    related: ["brewery.batches.one"],
  },
  {
    id: "brewery.calendar",
    area: "brewery",
    route: "/brewery/schedule",
    title: "Brewery calendar",
    body: "Brew days, dry hops, transfers, packaging and releases in Google Calendar (or Apple, Outlook): add the address once and it keeps itself up to date.",
    article: `At the bottom of the schedule, **Add to Google Calendar** opens Google Calendar with the brewery calendar ready to add. Or copy the address and add it under Other calendars, +, From URL.

It covers last month and the next six, as all-day events. When a brew moves, its events move too. Google checks for changes every few hours.

The address has a secret key in it, so anyone with it can read the calendar. **Make a new address** if it's gone further than it should; the old one stops working.`,
    keywords: ["calendar", "google calendar", "ics", "ical", "subscribe", "outlook", "apple"],
    related: ["brewery.schedule"],
  },
];
