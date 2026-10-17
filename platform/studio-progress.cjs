function createProgressPublisher(emit, { interval = 100, maxChars = 1600 } = {}) {
 let pending, timer;
 const flush = () => {
  clearTimeout(timer); timer = null;
  if (pending) { const value = pending; pending = null; emit(value); }
 };
 return { publish(event) {
  if (!['thinking_delta', 'text_delta'].includes(event.type) || !event.delta) { flush(); emit(event); return; }
  if (pending && (pending.type !== event.type || pending.agent !== event.agent)) flush();
  pending ||= { ...event, delta: '' }; pending.delta += event.delta;
  while (pending?.delta.length >= maxChars) {
   const delta = pending.delta.slice(0, maxChars); pending.delta = pending.delta.slice(maxChars);
   emit({ ...pending, delta }); if (!pending.delta) pending = null;
  }
  if (pending && !timer) { timer = setTimeout(flush, interval); timer.unref?.(); }
 }, flush, close: flush };
}
module.exports = { createProgressPublisher };
