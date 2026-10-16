function createModListTranslation(translate, { onChange = () => {}, isVisible = () => false, delayMs = 40, batchSize = 12, concurrency = 2, cacheSize = 512 } = {}) {
 const entries = new Map(), queue = new Set();
 let timer, active = 0, nextId = 0;
 function notify(group) { onChange(group.filter(entry => entries.get(entry.key) === entry)); }
 function prune() {
  for (const [key, entry] of entries) {
   if (entries.size <= cacheSize) break;
   if (['ready', 'error'].includes(entry.status) && !isVisible(entry)) entries.delete(key);
  }
 }
 function drain() {
  clearTimeout(timer); timer = null;
  while (active < concurrency && queue.size) {
   const group = [...queue].slice(0, batchSize);
   group.forEach(entry => { queue.delete(entry); entry.status = 'loading'; });
   active++;
   Promise.resolve().then(() => translate(group.map(entry => entry.original))).then(results => {
    if (!Array.isArray(results) || results.length !== group.length) throw new Error('Invalid list translation');
    group.forEach((entry, index) => { entry.text = results[index]; entry.status = 'ready'; });
   }).catch(() => { group.forEach(entry => { entry.status = 'error'; }); }).finally(() => {
    active--; notify(group); prune(); drain();
   });
  }
 }
 function schedule() { if (!timer) timer = setTimeout(drain, delayMs); }
 function get(item) {
  const original = { name: item.name || '', summary: item.summary || '' }, key = JSON.stringify(original);
  let entry = entries.get(key);
  if (!entry) {
   entry = { id: String(++nextId), key, original, status: 'queued' };
   entries.set(key, entry); queue.add(entry); schedule();
  }
  return entry;
 }
 function retry(id) {
  const entry = [...entries.values()].find(value => value.id === id);
  if (entry?.status !== 'error') return;
  entry.status = 'queued'; queue.add(entry); notify([entry]); schedule();
 }
 function reset() { clearTimeout(timer); timer = null; entries.clear(); queue.clear(); }
 return { get, retry, reset };
}

module.exports = { createModListTranslation };
