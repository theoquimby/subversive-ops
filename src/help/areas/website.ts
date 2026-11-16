import type { HelpEntry } from "../types";

/** Website: what guests see on the public site, managed from Ops. */
export const website: HelpEntry[] = [
  {
    id: "website.page",
    area: "website",
    route: "/website",
    title: "Website",
    body: "Everything guests see on the public website, in one place: hours, the notice, the menu, events and inquiries from the form. Save here and the website picks it up within a minute; it never shows costs or anything private.",
    article: `The website reads a few public feeds from Ops. Change something here (or on Events, Kegs → Beers or Settings → Business) and the website shows it on its own.

- **Overview** — what's live now, and whether the website connection works.
- **Hours & notice** — exact opening minutes, kitchen close, the one-line notice, links.
- **Announcements** — short lines in a band under the header on every page, each with its days and colour.
- **Menu** — which menu items and add-ons show, with web names, descriptions and tags. Draft beer comes from the tap list.
- **Events** — pictures, prices, ticket links and late closes for calendar events, and a page of their own for big nights.
- **Inquiries** — private event requests from the website form.
- **Site content** — where each part of the website comes from.

If Ops can't be reached, the website keeps showing its own copy, so nothing breaks.`,
    tour: "website",
    related: ["website.connection", "website.notice", "website.menu.items", "website.events"],
    keywords: ["site", "public website", "drinksubversive", "guests", "online"],
  },
  {
    id: "website.notice",
    area: "website",
    route: "/website/hours",
    title: "Notice",
    body: "One line at the top of every page of the website, for a closure, changed hours or a special night. Pick the last day it shows and it comes down by itself the day after. Take it down any time.",
    related: ["website.hours", "website.page"],
    keywords: ["banner", "announcement", "closed", "message", "alert"],
  },
  {
    id: "website.hours",
    area: "website",
    route: "/website/hours",
    title: "Hours on the website",
    body: "Opening hours come from Settings → Business in whole hours. Type the exact minute here (4:30pm) and when the kitchen stops orders. An exact time that no longer fits the hours is ignored, so the site is never wrong.",
    related: ["website.kitchenClose", "settings.business.hours", "website.notice"],
    keywords: ["opening hours", "open", "close", "minutes", "4:30", "seasonal"],
  },
  {
    id: "website.kitchenClose",
    area: "website",
    route: "/website/hours",
    title: "Kitchen closes",
    body: "When the kitchen stops taking orders, shown on the website as “kitchen til 8:15”. Leave it empty when the kitchen closes with the bar.",
    related: ["website.hours"],
    keywords: ["kitchen", "last orders", "food stops"],
  },
  {
    id: "website.contact",
    area: "website",
    route: "/website/hours",
    title: "Contact and links",
    body: "Name, address, phone and email come from Settings → Business. The order, gift card, map, Instagram, Facebook and band booking links are set here. Anything left empty keeps the website's own.",
    related: ["website.hours"],
    keywords: ["address", "phone", "instagram", "facebook", "order online", "gift card", "social"],
  },
  {
    id: "website.menu.items",
    area: "website",
    route: "/website/menu",
    title: "Menu on the website",
    body: "Menu items and add-ons from Menu costs. Set On website to Yes, then add a web name, one line of description, tags and a badge. Prices come from Menu costs. Select several rows to put them on or off together.",
    related: ["website.menu.sections", "website.menu.beer", "website.menu.preview"],
    keywords: ["menu", "dishes", "food", "description", "vegetarian", "vegan", "online menu"],
  },
  {
    id: "website.menu.on",
    area: "website",
    route: "/website/menu",
    title: "On website",
    body: "Only items set to Yes appear on the website menu. New recipes start as No, so nothing shows until you choose it.",
    related: ["website.menu.items"],
  },
  {
    id: "website.menu.sections",
    area: "website",
    route: "/website/menu",
    title: "Menu sections",
    body: "Each item goes under its category unless you type another section, like Smash burgers. Give each section a heading, an intro line and its place in the order. Drinks other than draft beer sit under Other beverages.",
    related: ["website.menu.items"],
    keywords: ["section", "category", "heading", "order"],
  },
  {
    id: "website.menu.seasonal",
    area: "website",
    route: "/website/menu",
    title: "Seasonal dates",
    body: "Shows from and Shows until keep a special on the website only for its dates, with a Seasonal badge. After the last day it drops off by itself.",
    related: ["website.menu.items"],
    keywords: ["special", "season", "limited", "dates"],
  },
  {
    id: "website.menu.beer",
    area: "website",
    route: "/website/menu",
    title: "Draft beer on the website",
    body: "What's on tap now, from the tap list. Style, ABV, description, color and two pour prices come from Kegs → Beers; a beer missing them shows without its glass and with one price. Turn a beer off here to keep it off the site.",
    related: ["website.menu.family", "taps.beers", "taps.prices"],
    keywords: ["tap list", "beer", "draft", "pours", "abv"],
  },
  {
    id: "website.menu.family",
    area: "website",
    route: "/website/menu",
    title: "Beer family",
    body: "Light, Hoppy, Malty, Farmhouse or Sour: the groups and filters on the website menu. It's guessed from the style; pick one to change it.",
    related: ["website.menu.beer"],
    keywords: ["style", "filter", "hoppy", "sour", "light"],
  },
  {
    id: "website.menu.preview",
    area: "website",
    route: "/website/menu",
    title: "Menu preview",
    body: "The menu exactly as the website receives it, drinks then food. Anything left off, and why, is listed above the table.",
    related: ["website.menu.items"],
  },
  {
    id: "website.events",
    area: "website",
    route: "/website/events",
    title: "Events on the website",
    body: "Games, music, holidays and closures from Events, with what only the website needs: a picture, price, ticket or RSVP link, featured, and a late kitchen or bar close. Private bookings never show. Hide any event here.",
    related: ["website.events.late", "website.events.holidays", "events.upcoming"],
    keywords: ["events", "picture", "image", "tickets", "rsvp", "featured", "price"],
  },
  {
    id: "website.events.page",
    area: "website",
    route: "/website/events/[id]",
    title: "An event's own page",
    body: "For a big night like Oktoberfest: a photo at the top, an intro, up to 8 sections, a schedule and up to 6 links, shown on the event's page on the website below the date and description. Preview shows roughly how it looks. Save and the website has it within a minute.",
    article: `Open **Website → Events**, then **Add page** on the event.

- **Photo at the top**: a landscape photo, at least 1600 px wide. A phone photo or the original from the camera is right; a screenshot or a photo saved from a message is usually too small, and the app says so. It's resized before upload and saved at once.
- **What's in the photo**: one line read aloud to people who can't see it.
- **Intro**: a few sentences, up to 600 characters.
- **Sections**: a heading and some words each. Leave a blank line between paragraphs.
- **Schedule**: a time in any wording (12:00, Noon, All day) and what happens.
- **Links**: tickets, a band's page, a map. They must start with https://.

The page lives at the event's web address, so an announcement can link to it. Change the address on Events → Web address and announcements that link to it follow.`,
    related: ["website.events", "website.events.page.photo", "website.announcements"],
    keywords: ["oktoberfest", "event page", "festival", "schedule", "hero", "photo", "lineup", "featured"],
  },
  {
    id: "website.events.page.photo",
    area: "website",
    route: "/website/events/[id]",
    title: "Photo at the top of an event page",
    body: "Landscape (wider than tall) and at least 1600 px wide, so it stays sharp on a big screen. Use the original from the camera or phone, not a screenshot. It's served from Ops, and the website shows it only from there.",
    related: ["website.events.page"],
    keywords: ["hero", "photo", "image", "picture", "1600"],
  },
  {
    id: "website.announcements",
    area: "website",
    route: "/website/announcements",
    title: "Announcements",
    body: "Short lines in a band under the website's header, on every page: orange for a closure, yellow for a big night, plain for anything else. Pick the days and each comes and goes by itself. The first three that are on today show, in your order. Visitors can close one.",
    article: `Website → **Announcements**.

- **What it says**: up to 140 characters. Under about 90 stays on two lines on a phone.
- **Colour**: Closure (orange), Event (yellow) or Plain.
- **Link**: an event's page on the website, or a full https:// address, with a word or two like Details.
- **Days**: the first and last day it shows (New York time, both included). Leave them empty to show it until you turn it off.
- **Order**: the website shows the first three that are on today. Use the arrows to put the one that matters most first.

A visitor can close a line, and that browser doesn't show it again. Fixing a typo keeps it closed for them. For a new message, tick **Show again to people who closed it** so everyone sees it.

These are for guests. Staff announcements on the home screen are separate and never reach the website.`,
    related: ["website.announcements.band", "website.notice", "website.events.page"],
    keywords: ["banner", "band", "closed", "closure", "thanksgiving", "message", "alert", "notice", "header"],
  },
  {
    id: "website.announcements.band",
    area: "website",
    route: "/website/announcements",
    title: "The band today",
    body: "What the band under the website's header shows today, on a phone: the first three announcements that are on and whose days include today. The website reads them again within five minutes, or at once when the connection is set up.",
    related: ["website.announcements", "website.connection"],
  },
  {
    id: "website.events.kind",
    area: "website",
    route: "/website/events",
    title: "Kind on the site",
    body: "Mark a night as Trivia or Movie so the website files it under Trivia & movies. The forecast keeps using the calendar kind.",
    related: ["website.events"],
  },
  {
    id: "website.events.late",
    area: "website",
    route: "/website/events",
    title: "Late kitchen and bar close",
    body: "For a night that runs late: when the kitchen stops orders and when the bar closes. Leave empty to use the usual hours; an event that ends after closing already keeps the bar open late.",
    related: ["website.events", "website.hours"],
    keywords: ["open late", "game night", "last call"],
  },
  {
    id: "website.events.holidays",
    area: "website",
    route: "/website/events",
    title: "Holidays on the website",
    body: "Whether a Holiday event means you're closed that day. Closures always close the day. Change a single event with Closed that day.",
    related: ["website.events"],
    keywords: ["thanksgiving", "christmas", "closed", "holiday"],
  },
  {
    id: "website.inquiries",
    area: "website",
    route: "/website/inquiries",
    title: "Inquiries from the website",
    body: "Private event requests sent through the website form. Each one lands on Private events as an inquiry, and managers get a notification (Settings → Notifications → Event inquiries). Bots and repeat sends are filtered out.",
    related: ["events.private.table", "website.page"],
    keywords: ["inquiry", "party", "buyout", "contact form", "booking request"],
  },
  {
    id: "website.content",
    area: "website",
    route: "/website/content",
    title: "Site content",
    body: "Where each part of the website comes from: Live from Ops, Ready in Ops (the website still has to read it), or still in the website's own files, like the story and visit notes.",
    related: ["website.page"],
    keywords: ["copy", "about", "text", "story"],
  },
  {
    id: "website.connection",
    area: "website",
    route: "/website",
    title: "Website connection",
    body: "The website reads the Ops feeds every 5 minutes. With its address and a shared secret in Settings → Connections → Website, Ops also tells it to refresh the moment you save. The counts show each feed is working.",
    related: ["settings.connections.website", "website.page"],
    keywords: ["revalidate", "refresh", "feed", "api", "secret", "instant"],
  },
  {
    id: "settings.connections.website",
    area: "settings",
    route: "/settings/connections?open=website",
    title: "Website connection",
    body: "Paste the website's address and the shared secret (the same REVALIDATE_SECRET the website has) so Ops can tell the website to refresh after a save, and so the inquiry form is accepted from the website.",
    related: ["website.connection"],
    keywords: ["revalidate secret", "website url", "vercel"],
  },
];
