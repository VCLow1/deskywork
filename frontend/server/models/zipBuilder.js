// models/zipBuilder.js — Générateur PKZIP standard sans dépendance (méthode STORE, UTF-8)

const CRC32_TABLE = (() => {
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

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  const dosTime = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Construit un archive ZIP en mémoire à partir de `{ filename, content }[]`.
 * @param {Array<{filename: string, content: Buffer|Uint8Array|string, mtime?: Date}>} entries
 * @returns {Buffer}
 */
function buildZipBuffer(entries = []) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const usedNames = new Set();

  for (const entry of entries) {
    if (!entry || !entry.filename) continue;
    let safeName = String(entry.filename).replace(/[\\/]+/g, '_').trim() || 'document.pdf';
    if (usedNames.has(safeName)) {
      const dot = safeName.lastIndexOf('.');
      let idx = 2;
      while (usedNames.has(dot > 0 ? `${safeName.slice(0, dot)}-${idx}${safeName.slice(dot)}` : `${safeName}-${idx}`)) {
        idx++;
      }
      safeName = dot > 0 ? `${safeName.slice(0, dot)}-${idx}${safeName.slice(dot)}` : `${safeName}-${idx}`;
    }
    usedNames.add(safeName);

    const nameBuf = Buffer.from(safeName, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content || '');
    const crc = crc32(dataBuf);
    const { dosTime, dosDate } = toDosTimeDate(entry.mtime);
    const flags = 0x0800; // UTF-8

    // Local File Header (30 bytes + name)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(flags, 6);
    lfh.writeUInt16LE(0, 8); // compression = 0 (STORE)
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(dataBuf.length, 18);
    lfh.writeUInt32LE(dataBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra len

    localChunks.push(lfh, nameBuf, dataBuf);

    // Central Directory Header (46 bytes + name)
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4); // version made by
    cdh.writeUInt16LE(20, 6); // version needed
    cdh.writeUInt16LE(flags, 8);
    cdh.writeUInt16LE(0, 10); // STORE
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(dataBuf.length, 20);
    cdh.writeUInt32LE(dataBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra
    cdh.writeUInt16LE(0, 32); // comment
    cdh.writeUInt16LE(0, 34); // disk start
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE(0, 38); // external attrs
    cdh.writeUInt32LE(offset, 42);

    centralChunks.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + dataBuf.length;
  }

  const centralDirBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(usedNames.size, 8);
  eocd.writeUInt16LE(usedNames.size, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirBuf, eocd]);
}

module.exports = {
  crc32,
  buildZipBuffer,
};
