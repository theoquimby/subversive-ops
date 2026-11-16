import { describe, expect, it } from "vitest";
import { imageSize } from "../imageSize";

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("imageSize", () => {
  it("reads a PNG", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii("IHDR"), ...be32(2000), ...be32(1125), 8, 6, 0, 0, 0]);
    expect(imageSize(png)).toEqual({ width: 2000, height: 1125 });
  });

  it("reads a JPEG, past the markers before the frame", () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 8, ...[0x04, 0x65], ...[0x07, 0xd0], 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    const jpg = new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
    expect(imageSize(jpg)).toEqual({ width: 2000, height: 1125 });
  });

  it("reads each kind of WebP", () => {
    const riff = (chunk: string, body: number[]) => new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii(chunk), ...le24(body.length), 0, ...body]);
    // lossy: frame tag (3), start code, 14-bit width and height
    expect(imageSize(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(1600), ...le16(900)]))).toEqual({ width: 1600, height: 900 });
    // extended: flags (4), then width-1 and height-1 in 24 bits each
    expect(imageSize(riff("VP8X", [0, 0, 0, 0, ...le24(1999), ...le24(1124)]))).toEqual({ width: 2000, height: 1125 });
    // lossless: signature 0x2f, then 14-bit width-1 and height-1 packed
    const w = 1599;
    const h = 899;
    const bits = w | (h << 14);
    expect(imageSize(riff("VP8L", [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255]))).toEqual({ width: 1600, height: 900 });
  });

  it("says null for anything else", () => {
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});
