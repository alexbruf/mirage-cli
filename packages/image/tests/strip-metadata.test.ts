import { describe, expect, test } from "bun:test";
import { isJpeg, isPng, isWebp, stripImageMetadata } from "../src/index.ts";

function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}
function bytes(arrs: number[][]): Uint8Array {
  return Uint8Array.from(arrs.flat());
}
function hasSeq(hay: Uint8Array, seq: number[]): boolean {
  outer: for (let i = 0; i + seq.length <= hay.length; i++) {
    for (let j = 0; j < seq.length; j++) if (hay[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
}
const has = (hay: Uint8Array, s: string) => hasSeq(hay, ascii(s));
const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

describe("strip-metadata: format detection", () => {
  test("magic-byte detectors", () => {
    expect(isJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isPng(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(isWebp(bytes([ascii("RIFF"), [0, 0, 0, 0], ascii("WEBP"), [0]]))).toBe(true);
    expect(isJpeg(Uint8Array.from([0x00, 0x01]))).toBe(false);
  });

  test("unknown formats pass through unchanged", () => {
    const txt = Uint8Array.from(ascii("not an image"));
    expect(stripImageMetadata(txt)).toEqual(txt);
  });
});

describe("strip-metadata: JPEG", () => {
  test("drops APP1 (EXIF/XMP), keeps DQT and the scan", () => {
    const app1 = [0xff, 0xe1, 0x00, 0x08, ...ascii("Exif??")]; // 10 bytes, len=8
    const jpeg = bytes([
      [0xff, 0xd8], // SOI
      app1,
      [0xff, 0xdb, 0x00, 0x04, 0x11, 0x22], // DQT (kept)
      [0xff, 0xda, 0x00, 0x03, 0xaa, 0x12, 0x34, 0xff, 0xd9], // SOS..EOI (verbatim)
    ]);
    const out = stripImageMetadata(jpeg);
    expect(has(out, "Exif")).toBe(false); // APP1 gone
    expect(out.length).toBe(jpeg.length - app1.length); // exactly the APP1 removed
    expect(Array.from(out.subarray(0, 2))).toEqual([0xff, 0xd8]); // SOI kept
    expect(hasSeq(out, [0xff, 0xdb, 0x00, 0x04, 0x11, 0x22])).toBe(true); // DQT survives
    expect(Array.from(out.subarray(out.length - 2))).toEqual([0xff, 0xd9]); // EOI survives
  });
});

describe("strip-metadata: PNG", () => {
  test("drops tEXt, keeps IHDR/IDAT/IEND", () => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = [0, 0, 0, 13, ...ascii("IHDR"), ...new Array(13).fill(7), 0, 0, 0, 0];
    const text = [0, 0, 0, 4, ...ascii("tEXt"), ...ascii("test"), 0, 0, 0, 0];
    const idat = [0, 0, 0, 2, ...ascii("IDAT"), 0x9c, 0x01, 0, 0, 0, 0];
    const iend = [0, 0, 0, 0, ...ascii("IEND"), 0, 0, 0, 0];
    const png = bytes([sig, ihdr, text, idat, iend]);
    const out = stripImageMetadata(png);
    expect(has(out, "tEXt")).toBe(false);
    expect(has(out, "test")).toBe(false);
    expect(has(out, "IHDR")).toBe(true);
    expect(has(out, "IDAT")).toBe(true);
    expect(has(out, "IEND")).toBe(true);
    expect(out.length).toBe(png.length - text.length);
  });
});

describe("strip-metadata: WebP", () => {
  test("drops EXIF chunk, clears the VP8X EXIF flag, fixes RIFF size", () => {
    // VP8X flags byte 0x18 = alpha(0x10) | exif(0x08).
    const vp8x = [...ascii("VP8X"), 10, 0, 0, 0, 0x18, ...new Array(9).fill(0)];
    const vp8 = [...ascii("VP8 "), 4, 0, 0, 0, 0x01, 0x02, 0x03, 0x04];
    const exif = [...ascii("EXIF"), 4, 0, 0, 0, ...ascii("EXIF")];
    const body = [...vp8x, ...vp8, ...exif];
    const riffSize = 4 + body.length;
    const webp = bytes([
      ascii("RIFF"),
      [riffSize & 0xff, (riffSize >> 8) & 0xff, 0, 0],
      ascii("WEBP"),
      body,
    ]);
    const out = stripImageMetadata(webp);
    expect(has(out.subarray(12), "EXIF")).toBe(false); // EXIF chunk dropped
    expect(has(out, "VP8X")).toBe(true);
    expect(has(out, "VP8 ")).toBe(true);
    expect(dv(out).getUint8(20)).toBe(0x10); // VP8X EXIF flag cleared
    expect(dv(out).getUint32(4, true)).toBe(out.length - 8); // RIFF size fixed
  });
});
