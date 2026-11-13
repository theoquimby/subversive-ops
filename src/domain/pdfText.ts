/**
 * Minimal text extraction from a decoded PDF content stream: the strings shown
 * by Tj, TJ, ' and " with line breaks at Td, TD, T*, Tm and ET. It handles the plain
 * PDFs most word processors export (handbooks, policies). Scanned PDFs or
 * custom font encodings come out empty — the manager can paste the text
 * instead, or Claude reads the PDF when a key is configured.
 */

/** Decode a PDF literal string body (between the outer parentheses). */
export function decodePdfString(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out += c; continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "b" || n === "f") out += "";
    else if (n === "\n" || n === "\r") { if (n === "\r" && s[i + 1] === "\n") i++; }
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? "")) oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += n;
  }
  return out;
}

function decodeHex(h: string): string {
  const clean = h.replace(/[^0-9a-fA-F]/g, "");
  const padded = clean.length % 2 ? `${clean}0` : clean;
  // UTF-16BE with BOM, else single bytes.
  if (padded.toUpperCase().startsWith("FEFF")) {
    let out = "";
    for (let i = 4; i + 3 < padded.length; i += 4) out += String.fromCharCode(parseInt(padded.slice(i, i + 4), 16));
    return out;
  }
  let out = "";
  for (let i = 0; i < padded.length; i += 2) out += String.fromCharCode(parseInt(padded.slice(i, i + 2), 16));
  return out;
}

/** Text shown by one content stream, with a newline wherever the text position jumps lines. */
export function textFromContentStream(content: string): string {
  let out = "";
  let pending: string[] = [];
  let i = 0;
  const n = content.length;
  const flushOperands = () => { pending = []; };
  while (i < n) {
    const c = content[i];
    if (c === "(") {
      let depth = 1;
      let j = i + 1;
      let body = "";
      while (j < n && depth > 0) {
        const ch = content[j];
        if (ch === "\\") { body += ch + (content[j + 1] ?? ""); j += 2; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (depth === 0) break; }
        body += ch;
        j++;
      }
      pending.push(decodePdfString(body));
      i = j + 1;
      continue;
    }
    if (c === "<" && content[i + 1] !== "<") {
      const j = content.indexOf(">", i);
      if (j < 0) break;
      pending.push(decodeHex(content.slice(i + 1, j)));
      i = j + 1;
      continue;
    }
    if (c === "[" ) { i++; continue; }
    if (c === "]") { i++; continue; }
    if (/[A-Za-z'"*]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z'"*]/.test(content[j])) j++;
      const op = content.slice(i, j);
      if (op === "Tj" || op === "TJ") out += pending.join("");
      else if (op === "'" || op === '"') out += `\n${pending.join("")}`;
      else if (op === "Td" || op === "TD" || op === "T*" || op === "Tm" || op === "ET") {
        if (out && !out.endsWith("\n")) out += "\n";
      }
      flushOperands();
      i = j;
      continue;
    }
    if (c === "%") { while (i < n && content[i] !== "\n" && content[i] !== "\r") i++; continue; }
    i++;
  }
  return tidyText(out);
}

/** Collapse runs of spaces and blank lines, and re-join words split across line breaks with a hyphen. */
export function tidyText(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/-\n(?=[a-z])/g, "")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
