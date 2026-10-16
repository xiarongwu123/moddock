const { test } = require('node:test');
const assert = require('node:assert/strict');
const { authorizationRequestAllowed } = require('../platform/nexus-browser-policy.cjs');

test('authorization pages retain Nexus and human verification frames while blocking unrelated child sites', () => {
 for (const url of ['https://www.nexusmods.com/frame', 'https://users.nexusmods.com/auth/sign_in', 'https://challenges.cloudflare.com/turnstile/frame', 'https://www.google.com/recaptcha/api2/anchor', 'https://www.recaptcha.net/recaptcha/api2/anchor', 'https://newassets.hcaptcha.com/captcha', 'about:blank', 'about:srcdoc']) {
  assert.equal(authorizationRequestAllowed({ url, resourceType: 'subFrame' }), true, url);
 }
 for (const url of ['https://advertisement.test/player', 'https://nexusmods.com.advertisement.test/frame', 'https://advertisement.test/nexusmods.com', 'http://www.nexusmods.com/frame', 'https://user:password@www.nexusmods.com/frame', 'https://www.nexusmods.com:8443/frame', 'invalid']) {
  assert.equal(authorizationRequestAllowed({ url, resourceType: 'subFrame' }), false, url);
 }
});

test('child frame filtering preserves authorization scripts, styles, images, and API traffic', () => {
 for (const resourceType of ['mainFrame', 'script', 'stylesheet', 'image', 'xhr', 'media', 'other']) {
  assert.equal(authorizationRequestAllowed({ url: 'https://cdn.example.test/resource', resourceType }), true, resourceType);
 }
});
