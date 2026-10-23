// Web font export (.woff, WOFF 1.0): the same tables as the .otf or .ttf,
// each compressed with zlib, so the font can be used on a website with
// @font-face. WOFF2 would need Brotli, which browsers can't compress with;
// zlib is built in (CompressionStream "deflate", also in Node).

const pad4 = (n) => (n + 3) & ~3;

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// An sfnt font (ArrayBuffer of an .otf or .ttf) as a WOFF file.
export async function sfntToWoff(buffer) {
  const view = new DataView(buffer);
  const flavor = view.getUint32(0);
  const count = view.getUint16(4);
  const tables = [];
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    tables.push({
      tag: view.getUint32(at), checksum: view.getUint32(at + 4),
      data: new Uint8Array(buffer, offset, length),
    });
  }
  tables.sort((a, b) => a.tag - b.tag);
  // A table that doesn't get smaller is stored as is.
  for (const t of tables) {
    const packed = await deflate(t.data);
    t.stored = packed.length < t.data.length ? packed : t.data;
  }

  const header = 44, directory = 20 * count;
  let size = header + directory;
  for (const t of tables) size += pad4(t.stored.length);
  const sfntSize = 12 + 16 * count + tables.reduce((sum, t) => sum + pad4(t.data.length), 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x774f4646); // "wOFF"
  dv.setUint32(4, flavor);
  dv.setUint32(8, size);
  dv.setUint16(12, count);
  dv.setUint32(16, sfntSize);
  dv.setUint16(20, 1); // version 1.0 of the WOFF file itself
  // Metadata and private blocks (offsets 24–43) stay empty.

  let offset = header + directory;
  tables.forEach((t, i) => {
    const at = header + i * 20;
    dv.setUint32(at, t.tag);
    dv.setUint32(at + 4, offset);
    dv.setUint32(at + 8, t.stored.length);
    dv.setUint32(at + 12, t.data.length);
    dv.setUint32(at + 16, t.checksum);
    out.set(t.stored, offset);
    offset += pad4(t.stored.length);
  });
  return out.buffer;
}
