// Pure-JS, workerd-safe provenance-metadata stripper. No image codec, no WASM:
// it walks the container and drops the metadata segments/chunks at the byte
// level, leaving the pixel data byte-for-byte intact (lossless, no re-encode).
//
// Removes EXIF, XMP, and C2PA "Content Credentials" (the readable/cryptographic
// "made by ChatGPT/Gemini" provenance) from JPEG, PNG, and WebP. It does NOT
// remove invisible in-pixel watermarks such as Google SynthID — those are not
// metadata and survive any strip; removing them is out of scope.

function dataView(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function fourCC(dv: DataView, o: number): string {
  return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
}

export function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

export function isPng(b: Uint8Array): boolean {
  return (
    b.length > 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

export function isWebp(b: Uint8Array): boolean {
  if (b.length <= 12) return false;
  const dv = dataView(b);
  return fourCC(dv, 0) === "RIFF" && fourCC(dv, 8) === "WEBP";
}

/**
 * JPEG: keep SOI + the frame/scan, drop APP1..APP15 (EXIF/XMP/ICC/C2PA-JUMBF)
 * and COM comments. APP0 (JFIF) is kept. Everything from SOS onward (the
 * entropy-coded scan) is copied verbatim.
 */
function stripJpeg(buf: Uint8Array): Uint8Array {
  const dv = dataView(buf);
  const parts: Uint8Array[] = [buf.subarray(0, 2)]; // SOI
  let i = 2;
  while (i + 1 < buf.length) {
    if (dv.getUint8(i) !== 0xff) break; // not at a marker; keep what we have
    const marker = dv.getUint8(i + 1);
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // SOS (start of scan) or EOI: copy the rest of the file unchanged.
    if (marker === 0xda || marker === 0xd9) {
      parts.push(buf.subarray(i));
      i = buf.length;
      break;
    }
    if (i + 3 >= buf.length) {
      parts.push(buf.subarray(i));
      break;
    }
    const len = dv.getUint16(i + 2, false); // includes the 2 length bytes
    const segEnd = i + 2 + len;
    if (segEnd > buf.length) {
      parts.push(buf.subarray(i)); // truncated; keep as-is
      break;
    }
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe; // APP1-15 + COM
    if (!drop) parts.push(buf.subarray(i, segEnd));
    i = segEnd;
  }
  return concat(parts);
}

// PNG ancillary chunks worth keeping for faithful rendering. Everything not in
// here is dropped, which covers tEXt/zTXt/iTXt (incl. XMP), eXIf, iCCP, tIME,
// and the C2PA chunk (caBX) without needing to enumerate every metadata type.
const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "tRNS",
  "IDAT",
  "IEND",
  "gAMA",
  "cHRM",
  "sRGB",
  "pHYs",
  "bKGD",
  "sBIT",
]);

function stripPng(buf: Uint8Array): Uint8Array {
  const dv = dataView(buf);
  const parts: Uint8Array[] = [buf.subarray(0, 8)]; // signature
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = dv.getUint32(i, false);
    const type = fourCC(dv, i + 4);
    const chunkEnd = i + 12 + len; // length(4) + type(4) + data(len) + crc(4)
    if (chunkEnd > buf.length) {
      parts.push(buf.subarray(i)); // truncated; keep tail
      break;
    }
    if (PNG_KEEP.has(type)) parts.push(buf.subarray(i, chunkEnd));
    if (type === "IEND") break;
    i = chunkEnd;
  }
  return concat(parts);
}

// WebP image/structural chunks to keep. Drop everything else (EXIF, XMP, and
// any C2PA chunk). ICCP (colour profile) is kept so colours don't shift.
const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP"]);

function stripWebp(buf: Uint8Array): Uint8Array {
  const dv = dataView(buf);
  const parts: Uint8Array[] = [];
  let i = 12; // after "RIFF" <size> "WEBP"
  while (i + 8 <= buf.length) {
    const cc = fourCC(dv, i);
    const size = dv.getUint32(i + 4, true);
    const padded = i + 8 + size + (size & 1); // chunks are padded to even length
    if (padded > buf.length) {
      parts.push(buf.subarray(i)); // truncated; keep tail
      i = buf.length;
      break;
    }
    if (WEBP_KEEP.has(cc)) {
      if (cc === "VP8X") {
        // Clear the EXIF (0x08) and XMP (0x04) presence flags since we drop them.
        const chunk = buf.slice(i, padded);
        chunk[8] = (chunk[8] ?? 0) & ~(0x08 | 0x04);
        parts.push(chunk);
      } else {
        parts.push(buf.subarray(i, padded));
      }
    }
    i = padded;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(buf.subarray(0, 12), 0); // "RIFF" <size> "WEBP"
  out.set(body, 12);
  // RIFF size = everything after the 8-byte "RIFF<size>" header, little-endian.
  dataView(out).setUint32(4, out.length - 8, true);
  return out;
}

/**
 * Strip provenance metadata from an image buffer. Returns the cleaned bytes for
 * JPEG/PNG/WebP; passes any other/unrecognised format through unchanged.
 */
export function stripImageMetadata(buf: Uint8Array): Uint8Array {
  if (isJpeg(buf)) return stripJpeg(buf);
  if (isPng(buf)) return stripPng(buf);
  if (isWebp(buf)) return stripWebp(buf);
  return buf;
}
