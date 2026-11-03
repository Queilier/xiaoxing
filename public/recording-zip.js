// Standard ZIP (stored entries). Audio is already compressed; no recompression needed.
window.makeRecordingZip = async files => {
  const parts = [], central = []; let offset = 0, centralSize = 0;
  const table = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const header = size => { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; };
  for (const file of files) {
    const name = new TextEncoder().encode(file.name), data = new Uint8Array(await file.body.arrayBuffer());
    let crc = 0xffffffff; for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); crc = (crc ^ 0xffffffff) >>> 0;
    const local = header(30); const v = local.view;
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, name.length, true);
    parts.push(local.bytes, name, data);
    const c = header(46), cv = c.view;
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    central.push(c.bytes, name); centralSize += 46 + name.length; offset += 30 + name.length + data.length;
  }
  const end = header(22), ev = end.view;
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.bytes], { type: 'application/zip' });
};
