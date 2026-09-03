/**
 * Minimal PDF text extraction.
 *
 * Enough to pull the text layer out of a published guideline: it walks the
 * object table, expands object streams, decodes each font's ToUnicode CMap and
 * maps the content-stream glyph codes back to characters.
 *
 * It deliberately does no OCR. A PDF of scanned pages has no text layer, and
 * this returns little or nothing — the caller detects that and sends the file
 * to a vision model instead, rather than indexing an empty document.
 */
import zlib from 'node:zlib';

function inflate(buffer) {
  try { return zlib.inflateSync(buffer); } catch { return null; }
}

function collectObjects(data) {
  const objects = new Map();
  const re = /(\d+)\s+(\d+)\s+obj/g;
  const text = data.toString('latin1');
  let match;
  while ((match = re.exec(text)) !== null) {
    const end = text.indexOf('endobj', match.index);
    if (end < 0) continue;
    objects.set(Number(match[1]), data.subarray(match.index + match[0].length, end));
  }
  return objects;
}

function streamOf(body) {
  const text = body.toString('latin1');
  const start = text.search(/stream\r?\n/);
  if (start < 0) return null;
  const from = start + text.slice(start).match(/stream\r?\n/)[0].length;
  const to = text.indexOf('endstream', from);
  if (to < 0) return null;
  const raw = body.subarray(from, to);
  return inflate(raw) ?? raw;
}

function expandObjectStreams(objects) {
  for (const [, body] of [...objects]) {
    const head = body.subarray(0, 400).toString('latin1');
    if (!head.includes('/ObjStm')) continue;
    const data = streamOf(body);
    if (!data) continue;
    const n = Number(head.match(/\/N\s+(\d+)/)?.[1]);
    const first = Number(head.match(/\/First\s+(\d+)/)?.[1]);
    if (!n || !first) continue;
    const header = data.subarray(0, first).toString('latin1').trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i += 1) {
      const num = header[2 * i];
      const offset = header[2 * i + 1];
      const end = i + 1 < n ? header[2 * i + 3] + first : data.length;
      if (!objects.has(num)) objects.set(num, data.subarray(first + offset, end));
    }
  }
}

function parseToUnicode(data) {
  const text = data.toString('latin1');
  const map = new Map();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const target = pair[2];
      let out = '';
      for (let i = 0; i < target.length; i += 4) out += String.fromCharCode(parseInt(target.slice(i, i + 4), 16));
      map.set(parseInt(pair[1], 16), out);
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const row of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(row[1], 16);
      const hi = parseInt(row[2], 16);
      const start = parseInt(row[3], 16);
      for (let i = 0; i <= hi - lo; i += 1) map.set(lo + i, String.fromCharCode(start + i));
    }
  }
  return map;
}

/** Returns { text, pages }. `text` is empty for a scanned document. */
export function extractPdfText(buffer) {
  const objects = collectObjects(buffer);
  expandObjectStreams(objects);

  const fontMaps = new Map();
  for (const [num, body] of objects) {
    const ref = body.toString('latin1').match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!ref) continue;
    const target = objects.get(Number(ref[1]));
    if (!target) continue;
    const data = streamOf(target);
    if (data) fontMaps.set(num, parseToUnicode(data));
  }

  const pages = [];
  for (const [, body] of objects) {
    const head = body.toString('latin1');
    if (!/\/Type\s*\/Page\b/.test(head) || !head.includes('/Contents')) continue;

    let resources = body;
    const resRef = head.match(/\/Resources\s+(\d+)\s+0\s+R/);
    if (resRef) resources = objects.get(Number(resRef[1])) ?? body;

    const fontBlock = resources.toString('latin1').match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? '';
    const lookup = new Map();
    for (const entry of fontBlock.matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
      lookup.set(entry[1], fontMaps.get(Number(entry[2])) ?? new Map());
    }

    let content = Buffer.alloc(0);
    for (const ref of head.matchAll(/\/Contents\s+(\d+)\s+0\s+R/g)) {
      const part = streamOf(objects.get(Number(ref[1])) ?? Buffer.alloc(0));
      if (part) content = Buffer.concat([content, part]);
    }

    const stream = content.toString('latin1');
    let current = new Map();
    const out = [];
    // Only T* emits a break. Td/TD are not treated as spaces: many PDFs position
    // every single glyph with Td, and emitting a space per glyph turns
    // "Shifora" into "S h i f o r a". Real word gaps come from the space
    // characters the document itself encodes.
    const token = /\/(\w+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]*)>\s*Tj|\[([\s\S]*?)\]\s*TJ|\(((?:\\.|[^()\\])*)\)\s*Tj|\bT\*\b|\bTm\b/g;
    let hit;
    while ((hit = token.exec(stream)) !== null) {
      if (hit[1]) { current = lookup.get(hit[1]) ?? new Map(); continue; }
      const decodeHex = (hex) => {
        let text = '';
        for (let i = 0; i < hex.length; i += 4) text += current.get(parseInt(hex.slice(i, i + 4), 16)) ?? '';
        return text;
      };
      if (hit[2] !== undefined) out.push(decodeHex(hit[2]));
      else if (hit[3] !== undefined) {
        for (const piece of hit[3].matchAll(/<([0-9A-Fa-f]*)>/g)) out.push(decodeHex(piece[1]));
      } else if (hit[4] !== undefined) out.push(hit[4].replace(/\\([()\\])/g, '$1'));
      else out.push(' ');   // T*: end of line
    }
    const pageText = out.join('').replace(/\s+/g, ' ').trim();
    if (pageText) pages.push(pageText);
  }

  return { text: pages.join('\n\n'), pages: pages.length };
}
