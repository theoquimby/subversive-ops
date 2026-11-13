/**
 * PDF text without any external service (no "server-only" so tests and demo
 * scripts can use it). Inflates each page content stream and reads its text
 * operators with the pure parser in domain/pdfText.
 */

import { inflateSync } from "node:zlib";
import { textFromContentStream, tidyText } from "@/domain/pdfText";

/** Best-effort text from a PDF: inflate each content stream and read its text operators. */
export function pdfTextLocal(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  const parts: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (raw.slice(m.index - 3, m.index) === "end") continue;
    // The stream's dictionary sits between the object header and the "stream" keyword.
    const head = Math.max(raw.lastIndexOf(" obj", m.index), raw.lastIndexOf("endstream", m.index), 0);
    const dict = raw.slice(head, m.index);
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    re.lastIndex = end + 9;
    // Skip images, fonts and other binary streams; page content streams have no /Subtype.
    if (/\/Subtype|\/Length1|\/FontFile|\/Type\s*\/(XRef|ObjStm|XObject)/.test(dict)) continue;
    let data = buf.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(data, { finishFlush: 2 /* Z_SYNC_FLUSH: tolerate trailing bytes */ });
      } catch {
        continue;
      }
    } else if (/\/Filter/.test(dict)) continue;
    const text = textFromContentStream(data.toString("latin1"));
    if (text) parts.push(text);
  }
  return tidyText(parts.join("\n\n"));
}

