const { deflateSync, crc32 } = require('node:zlib');
// Pure host-side encoding; usable by packaged clients without AI credentials/modules.
function textureImage(pixels) {
 if (!Array.isArray(pixels) || pixels.length !== 16 || pixels.some(row => !Array.isArray(row) || row.length !== 16)) throw new Error('AI 贴图需为 16 × 16 像素');
 const data = Buffer.alloc(16 * 65);
 pixels.forEach((row, y) => row.forEach((value, x) => { if (typeof value !== 'string' || !/^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(value)) throw new Error('AI 贴图颜色无效'); Buffer.from(value.slice(1) + (value.length === 7 ? 'ff' : ''), 'hex').copy(data, y * 65 + 1 + x * 4); }));
 const header = Buffer.alloc(13); header.writeUInt32BE(16); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 6;
 const chunk = (type, bytes) => { const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([size, name, bytes, crc]); };
 return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
module.exports = { textureImage };
