/**
 * Zero-dependency ZIP reader/writer & URL-safe Deflate compression helpers.
 * Uses native browser CompressionStream / DecompressionStream ('deflate-raw')
 * for authentic .xmind ZIP compatibility and compact shareable URLs.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function streamTransform(bytes, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    return await streamTransform(bytes, new CompressionStream('deflate-raw'));
  } catch {
    return null;
  }
}

export async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Browser does not support DecompressionStream');
  }
  return await streamTransform(bytes, new DecompressionStream('deflate-raw'));
}

export function bytesToBase64Url(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function compressStringToUrl(str) {
  const raw = new TextEncoder().encode(str);
  const compressed = await deflateRaw(raw);
  if (compressed && compressed.length < raw.length) {
    return 'z.' + bytesToBase64Url(compressed);
  }
  return 'u.' + bytesToBase64Url(raw);
}

export async function decompressStringFromUrl(token) {
  if (!token) throw new Error('Empty payload');
  if (token.startsWith('z.')) {
    const bytes = base64UrlToBytes(token.slice(2));
    const inflated = await inflateRaw(bytes);
    return new TextDecoder().decode(inflated);
  }
  if (token.startsWith('u.')) {
    return new TextDecoder().decode(base64UrlToBytes(token.slice(2)));
  }
  // Fallback raw base64url (e.g. from Bookmarklet without compression)
  return new TextDecoder().decode(base64UrlToBytes(token));
}

/**
 * Create a valid ZIP archive from a map of { filename: string | Uint8Array }.
 */
export async function createZip(files) {
  const enc = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const rawBytes = typeof content === 'string' ? enc.encode(content) : content;
    const checksum = crc32(rawBytes);

    let method = 0;
    let dataBytes = rawBytes;
    const deflated = await deflateRaw(rawBytes);
    if (deflated && deflated.length < rawBytes.length) {
      method = 8;
      dataBytes = deflated;
    }

    // Local file header (30 bytes + name)
    const lh = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(lh);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 flag
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x5421, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, rawBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    new Uint8Array(lh, 30).set(nameBytes);

    localParts.push(new Uint8Array(lh), dataBytes);

    // Central directory header (46 bytes + name)
    const ch = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(ch);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, rawBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    new Uint8Array(ch, 46).set(nameBytes);

    centralParts.push(new Uint8Array(ch));
    offset += 30 + nameBytes.length + dataBytes.length;
  }

  let centralSize = 0;
  for (const p of centralParts) centralSize += p.length;

  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  const count = Object.keys(files).length;
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, new Uint8Array(eocd)], {
    type: 'application/zip'
  });
}

/**
 * Read a ZIP archive (Uint8Array / ArrayBuffer) into { filename: Uint8Array }.
 */
export async function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();

  // Locate End of Central Directory (EOCD)
  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) throw new Error('Invalid ZIP file (missing EOCD)');

  const cdOffset = view.getUint32(eocdPos + 16, true);
  const cdCount = view.getUint16(eocdPos + 10, true);

  const result = {};
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const filename = dec.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    const lNameLen = view.getUint16(localHeaderOffset + 26, true);
    const lExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const slice = bytes.subarray(dataStart, dataStart + compSize);

    if (!filename.endsWith('/')) {
      if (method === 0) {
        result[filename] = slice;
      } else if (method === 8) {
        result[filename] = await inflateRaw(slice);
      }
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return result;
}
