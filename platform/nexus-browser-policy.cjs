const verificationHosts = new Set(['challenges.cloudflare.com', 'www.google.com', 'www.recaptcha.net', 'newassets.hcaptcha.com', 'hcaptcha.com']);

function authorizationRequestAllowed({ url, resourceType }) {
 if (resourceType !== 'subFrame') return true;
 if (url === 'about:blank' || url === 'about:srcdoc') return true;
 try {
  const target = new URL(url);
  return target.protocol === 'https:' && !target.username && !target.password && !target.port &&
   (target.hostname === 'nexusmods.com' || target.hostname.endsWith('.nexusmods.com') || verificationHosts.has(target.hostname));
 } catch { return false; }
}

module.exports = { authorizationRequestAllowed };
