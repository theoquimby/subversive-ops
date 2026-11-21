// The zipcodes package ships no types; this is the one call Ops makes.
declare module "zipcodes" {
  export interface ZipInfo {
    zip: string;
    latitude: number;
    longitude: number;
    city: string;
    state: string;
    country: string;
  }
  export function lookup(zip: string | number): ZipInfo | undefined;
  const zipcodes: { lookup: typeof lookup };
  export default zipcodes;
}
