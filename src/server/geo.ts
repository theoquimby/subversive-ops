import "server-only";
import { geoConicConformal, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import counties from "us-atlas/counties-10m.json";
import states from "us-atlas/states-10m.json";
import { lookup } from "zipcodes";
import { FAR_MILES, milesBetween, type LatLon, type PlaceInfo, type Town } from "@/domain/places";

/**
 * Maps for the Customers page, drawn on the server: where a postal code is (the
 * zipcodes package, from the US Census and Canada Post lists), and state and
 * county outlines (us-atlas, from the US Census Bureau) projected to plain SVG
 * paths, so nothing map-shaped goes to the phone but the drawing itself.
 */

/** Where a postal code is, or null when the list doesn't know it (abroad, mistyped). */
export function placeInfo(postal: string): PlaceInfo | null {
  const z = lookup(postal);
  if (!z || typeof z.latitude !== "number" || typeof z.longitude !== "number" || !z.city) return null;
  return { lat: z.latitude, lon: z.longitude, city: z.city, state: z.state, country: z.country };
}

export type MapKey = "near" | "region";

export interface MapView {
  key: MapKey;
  label: string;
  w: number;
  h: number;
  /** Land, filled; borders between states; borders between counties (close-up only). */
  land: string;
  stateLines: string;
  countyLines: string | null;
  /** State names to print, where their middle falls inside the map. */
  stateLabels: { name: string; x: number; y: number }[];
  home: { x: number; y: number };
  /** Every town that falls inside this map, by key. */
  towns: { key: string; x: number; y: number }[];
}

const W = 640;

type StatesTopo = Topology<{ states: GeometryCollection<{ name: string }>; nation: GeometryCollection }>;
type CountiesTopo = Topology<{ counties: GeometryCollection<{ name: string }>; states: GeometryCollection<{ name: string }> }>;
const ST = states as unknown as StatesTopo;
const CO = counties as unknown as CountiesTopo;
const STATE_ABBR: Record<string, string> = {
  Connecticut: "CT", Delaware: "DE", Maine: "ME", Maryland: "MD", Massachusetts: "MA", "New Hampshire": "NH", "New Jersey": "NJ", "New York": "NY",
  Pennsylvania: "PA", "Rhode Island": "RI", Vermont: "VT", Virginia: "VA", "West Virginia": "WV", Ohio: "OH", "District of Columbia": "DC",
};

/** A box around the points, at least `minLat` / `minLon` degrees each side of home. */
function box(home: LatLon, pts: LatLon[], minLat: number, minLon: number, pad: number) {
  let s = home.lat - minLat, n = home.lat + minLat, w = home.lon - minLon, e = home.lon + minLon;
  for (const p of pts) {
    s = Math.min(s, p.lat - pad);
    n = Math.max(n, p.lat + pad);
    w = Math.min(w, p.lon - pad);
    e = Math.max(e, p.lon + pad);
  }
  return { s, n, w, e };
}

function draw(key: MapKey, label: string, home: LatLon, b: { s: number; n: number; w: number; e: number }, towns: readonly Town[], withCounties: boolean): MapView {
  const corners: GeoPermissibleObjects = { type: "MultiPoint", coordinates: [[b.w, b.s], [b.e, b.s], [b.e, b.n], [b.w, b.n], [(b.w + b.e) / 2, b.n], [(b.w + b.e) / 2, b.s]] };
  const proj = geoConicConformal().parallels([b.s + (b.n - b.s) / 4, b.n - (b.n - b.s) / 4]).rotate([-(b.w + b.e) / 2, 0]).fitWidth(W, corners);
  const [[, y0], [, y1]] = geoPath(proj).bounds(corners);
  const h = Math.round(Math.min(Math.max(y1 - y0, 300), 620));
  proj.translate([proj.translate()[0], proj.translate()[1] - y0 + (h - (y1 - y0)) / 2]).clipExtent([[0, 0], [W, h]]);
  const path = geoPath(proj).digits(1);
  const stateFeatures = feature(ST, ST.objects.states).features;
  const land = path(feature(ST, ST.objects.nation)) ?? "";
  const stateLines = path(mesh(ST, ST.objects.states, (a, z) => a !== z)) ?? "";
  const countyLines = withCounties ? (path(mesh(CO, CO.objects.counties, (a, z) => a !== z && String(a.id).slice(0, 2) === String(z.id).slice(0, 2))) ?? "") : null;
  const inside = ([x, y]: [number, number]) => x >= 0 && x <= W && y >= 0 && y <= h;
  const stateLabels = stateFeatures.flatMap((f) => {
    const abbr = STATE_ABBR[f.properties.name];
    if (!abbr) return [];
    const [x, y] = path.centroid(f);
    return Number.isFinite(x) && inside([x, y]) ? [{ name: abbr, x: Math.round(x), y: Math.round(y) }] : [];
  });
  const at = (p: LatLon) => proj([p.lon, p.lat]) as [number, number] | null;
  const hp = at(home) ?? [W / 2, h / 2];
  return {
    key,
    label,
    w: W,
    h,
    land,
    stateLines,
    countyLines,
    stateLabels,
    home: { x: Math.round(hp[0]), y: Math.round(hp[1]) },
    towns: towns.flatMap((t) => {
      const p = at(t);
      return p && inside(p) ? [{ key: t.key, x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10 }] : [];
    }),
  };
}

const memo = new Map<string, MapView[]>();

/**
 * Two maps: close to home (about 50 miles each way, with county lines), and the
 * region (wide enough for every town under `FAR_MILES` away). Kept per set of
 * towns, since drawing every county takes a moment.
 */
export function placeMaps(home: LatLon, towns: readonly Town[]): MapView[] {
  const sig = `${home.lat},${home.lon}|${towns.map((t) => `${t.key}:${t.lat.toFixed(3)},${t.lon.toFixed(3)}`).join(";")}`;
  const hit = memo.get(sig);
  if (hit) return hit;
  const regional = towns.filter((t) => milesBetween(home, t) < FAR_MILES);
  const views = [
    draw("near", "Close to home", home, box(home, [], 0.62, 0.95, 0), towns, true),
    draw("region", "The region", home, box(home, regional, 1.6, 2.2, 0.35), towns, false),
  ];
  if (memo.size > 20) memo.clear();
  memo.set(sig, views);
  return views;
}
