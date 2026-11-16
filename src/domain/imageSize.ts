/**
 * The pixel size of a PNG, JPEG or WebP from its first bytes, so the server
 * checks an uploaded photo itself rather than trusting the size the browser
 * says. Pure; returns null for anything it can't read.
 */

export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const ok = (w: number, h: number) => (w > 0 && h > 0 ? { width: w, height: h } : null);
  // PNG: the IHDR chunk comes first
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const be32 = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    return ok(be32(16), be32(20));
  }
  // JPEG: walk the markers to the first start-of-frame
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd9 || m === 0xda) return null;
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = (b[i + 2] << 8) + b[i + 3];
      const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
      if (sof) {
        if (i + 8 >= b.length) return null;
        return ok((b[i + 7] << 8) + b[i + 8], (b[i + 5] << 8) + b[i + 6]);
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP then a VP8 / VP8L / VP8X chunk
  const tag = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length >= 25 && tag(0, 4) === "RIFF" && tag(8, 4) === "WEBP") {
    const chunk = tag(12, 4);
    if (b.length < 30 && chunk !== "VP8L") return null;
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return ok((b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff);
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8X") return ok(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
  }
  return null;
}
