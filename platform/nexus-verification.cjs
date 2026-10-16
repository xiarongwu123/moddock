const crypto = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');

function verificationRegion() {
 const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
 const body = document.body?.innerText || '';
 const roots = [document];
 for (const root of roots) for (const element of root.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
 const frames = roots.flatMap(root => [...root.querySelectorAll('iframe')]).filter(frame => {
  try { return visible(frame) && ['challenges.cloudflare.com', 'www.google.com', 'www.recaptcha.net', 'newassets.hcaptcha.com'].includes(new URL(frame.src).hostname) && /cloudflare|recaptcha|hcaptcha/i.test(frame.src); } catch { return false; }
 });
 if (!frames.length) return body.length < 2000 && /performing security verification|checking your browser/i.test(body) && !document.querySelector('nav,input[type="password"]') ? { x: 0, y: 0, width: innerWidth, height: innerHeight } : null;
 const boxes = frames.map(frame => frame.getBoundingClientRect()), left = Math.max(0, Math.floor(Math.min(...boxes.map(box => box.left)))), top = Math.max(0, Math.floor(Math.min(...boxes.map(box => box.top))));
 return { x: left, y: top, width: Math.min(innerWidth, Math.ceil(Math.max(...boxes.map(box => box.right)))) - left, height: Math.min(innerHeight, Math.ceil(Math.max(...boxes.map(box => box.bottom)))) - top };
}

class NexusVerification {
 constructor(authorizer) { this.authorizer = authorizer; this.frames = new Map(); }
 entry(jobId) {
  const entry = this.authorizer.active;
  return entry && !entry.done && entry.context.jobId === jobId && entry.state === 'verification_required' && !entry.window.isDestroyed() && (!entry.context.isCurrent || entry.context.isCurrent()) ? entry : null;
 }
 async region(entry) {
  const region = await entry.window.webContents.executeJavaScript(`(${verificationRegion.toString()})()`);
  if (!region || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(region[key])) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1100 || region.y + region.height > 850) return null;
  return region;
 }
 async view(jobId) {
  const entry = this.entry(jobId); if (!entry) return { pending: false };
  const region = await this.region(entry); if (!region || this.entry(jobId) !== entry) return { pending: false };
  const picture = await entry.window.webContents.capturePage(region), bytes = picture.toPNG(), size = picture.getSize();
  const latest = await this.region(entry);
  if (this.entry(jobId) !== entry || !latest || ['x', 'y', 'width', 'height'].some(key => latest[key] !== region[key]) || !bytes.length || bytes.length > 1024 * 1024 || size.width <= 0 || size.height <= 0) return { pending: false };
  for (const [id, frame] of this.frames) if (frame.expires < Date.now() || frame.entry !== entry) this.frames.delete(id);
  while (this.frames.size >= 6) this.frames.delete(this.frames.keys().next().value);
  const revision = crypto.randomUUID(); this.frames.set(revision, { entry, region, ...size, expires: Date.now() + 10000 });
  return { pending: true, revision, width: size.width, height: size.height, image: 'data:image/png;base64,' + bytes.toString('base64') };
 }
 async click(jobId, input) {
  const entry = this.entry(jobId), frame = this.frames.get(input?.revision);
  if (!entry || !frame || frame.entry !== entry || frame.expires < Date.now() || !Number.isSafeInteger(input.x) || !Number.isSafeInteger(input.y) || input.x < 0 || input.y < 0 || input.x >= frame.width || input.y >= frame.height) return false;
  entry.window.show(); entry.window.focus(); entry.window.webContents.focus();
  await wait(0);
  const region = await this.region(entry);
  if (this.entry(jobId) !== entry || this.frames.get(input.revision) !== frame || !region || ['x', 'y', 'width', 'height'].some(key => region[key] !== frame.region[key])) return false;
  this.frames.delete(input.revision);
  const x = region.x + Math.floor(input.x * region.width / frame.width), y = region.y + Math.floor(input.y * region.height / frame.height);
  // Chromium routes these input events into cross-origin child frames.
  const channel = entry.window.webContents.debugger, attached = channel.isAttached();
  if (!attached) channel.attach('1.3');
  try {
   await channel.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, clickCount: 0 });
   if (this.entry(jobId) !== entry) return false;
   await channel.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
   await channel.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
   return true;
  } finally { if (!attached && channel.isAttached()) channel.detach(); }
 }
}
module.exports = { NexusVerification, verificationRegion };
