const literalText = /```[\s\S]*?```|`[^`\r\n]*`|https?:\/\/[^\s<>"']+|(?:[A-Za-z]:)?(?:[\w.@~-]+[\\/])+[\w.@~-]+|\b[\w-]+\.(?:zip|rar|7z|dll|exe|ini|json|toml|yaml|yml|cfg|esp|esm|pak)\b/;
const protectedText = new RegExp('(' + literalText.source + '|\\b[A-Z][A-Z0-9_-]+\\b)', 'g');
const protectedName = new RegExp('(' + literalText.source + ')', 'g');

function textParts(text, name = false) {
 return String(text).split(name ? protectedName : protectedText).flatMap((part, index) => {
  if (index % 2) return [{ original: part }];
  return part.split(/(\r?\n)/).flatMap(line => (line.match(/[\s\S]{1,3000}/gu) || ['']).map(chunk => {
   const [, before, content, after] = chunk.match(/^(\s*)([\s\S]*?)(\s*)$/);
   return /\p{L}/u.test(content.replace(/\p{Script=Han}/gu, ''))
    ? { original: chunk, before, content, after }
    : { original: chunk };
  }));
 });
}

function createModTranslator(request, { timeoutMs = 20000, cacheSize = 32 } = {}) {
 const cache = new Map(), pending = new Map();
 function batch(texts) {
  return new Promise((resolve, reject) => {
   let settled = false;
   const finish = (error, result) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    if (error) reject(error); else resolve(result);
   };
   const timer = setTimeout(() => finish(new Error('Translation timed out')), timeoutMs);
   try {
    request(texts, result => {
     if (result?.result !== 1 || !Array.isArray(result.text) || result.text.length !== texts.length || result.text.some(text => typeof text !== 'string' || !text.trim())) {
      finish(new Error('Invalid translation response')); return;
     }
     finish(null, result.text);
    }, () => finish(new Error('Translation service unavailable')));
   } catch (error) { finish(error); }
  });
 }
 async function translateFields(values) {
  const fields = values.map(value => textParts(value.text, value.name));
  const texts = [...new Set(fields.flat().map(part => part.content).filter(Boolean))];
  const translated = new Map();
  for (let offset = 0; offset < texts.length;) {
   const group = []; let length = 0;
   while (offset < texts.length && group.length < 32 && length + texts[offset].length <= 12000) {
    length += texts[offset].length; group.push(texts[offset++]);
   }
   const result = await batch(group);
   group.forEach((text, index) => translated.set(text, result[index]));
  }
  return fields.map(parts => parts.map(part => part.content ? part.before + translated.get(part.content) + part.after : part.original).join(''));
 }
 async function translate(item, detail) {
  const original = { description: detail.description || item.summary || '', requirements: detail.requirements || [] };
  const key = JSON.stringify([original, detail.requirementDetails]);
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);
  const work = (async () => {
   // Translate requirement notes separately so dependency names remain searchable.
   const requirements = original.requirements.map((text, index) => {
    const entry = detail.requirementDetails?.[index];
    return entry?.name && text.startsWith(entry.name) ? { name: entry.name, text: text.slice(entry.name.length) } : { name: '', text };
   });
   const output = await translateFields([original.description, ...requirements.map(entry => entry.text)].map(text => ({ text })));
   const result = { description: output[0], requirements: requirements.map((entry, index) => entry.name + output[index + 1]) };
   cache.set(key, result);
   if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
   return result;
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
 }
 async function translateList(items) {
  const output = await translateFields(items.flatMap(item => [{ text: item.name || '', name: true }, { text: item.summary || '' }]));
  return items.map((item, index) => ({ name: output[index * 2], summary: output[index * 2 + 1] }));
 }
 return { translate, translateList };
}

module.exports = { createModTranslator };
