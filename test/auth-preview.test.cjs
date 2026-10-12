const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPreviewAuth, PREVIEW_CODE } = require('../src/auth/preview.cjs');

test('preview login validates input and returns only a preview profile', async () => {
 const auth = createPreviewAuth();
 await assert.rejects(auth.login({ email: 'invalid', password: 'secret' }), /邮箱/);
 await assert.rejects(auth.login({ email: 'player@example.com', password: '' }), /密码/);
 assert.deepEqual(await auth.login({ email: ' Player@Example.com ', password: 'private-password' }), { email: 'player@example.com', name: 'player', mode: 'preview' });
});
test('registration requires a strong password, verification, matching email and challenge', async () => {
 const auth = createPreviewAuth();
 const credentials = { email: 'player@example.com', password: 'player123' };
 await assert.rejects(auth.sendCode({ ...credentials, password: '12345678' }), /字母和数字/);
 const challenge = await auth.sendCode(credentials);
 await assert.rejects(auth.register({ ...credentials, challengeId: challenge.id }), /校验/);
 await assert.rejects(auth.verifyCode({ ...credentials, challengeId: challenge.id, code: '111111' }), /不正确/);
 await assert.rejects(auth.verifyCode({ ...credentials, email: 'other@example.com', challengeId: challenge.id, code: PREVIEW_CODE }), /邮箱已变更/);
 await auth.verifyCode({ ...credentials, challengeId: challenge.id, code: PREVIEW_CODE });
 assert.equal((await auth.register({ ...credentials, challengeId: challenge.id })).mode, 'preview');
 await assert.rejects(auth.register({ ...credentials, challengeId: challenge.id }), /校验/);
});
test('resend invalidates the old challenge and expiry or reset rejects registration', async () => {
 let now = 1000;
 const auth = createPreviewAuth(() => now);
 const credentials = { email: 'player@example.com', password: 'player123' };
 const old = await auth.sendCode(credentials);
 await assert.rejects(auth.sendCode(credentials), /倒计时/);
 now += 60000;
 const current = await auth.sendCode(credentials);
 await assert.rejects(auth.verifyCode({ ...credentials, challengeId: old.id, code: PREVIEW_CODE }), /重新获取/);
 await auth.verifyCode({ ...credentials, challengeId: current.id, code: PREVIEW_CODE });
 now += 300000;
 await assert.rejects(auth.register({ ...credentials, challengeId: current.id }), /校验/);
 await assert.rejects(auth.verifyCode({ ...credentials, challengeId: current.id, code: PREVIEW_CODE }), /过期/);
 const fresh = await auth.sendCode(credentials);
 await auth.verifyCode({ ...credentials, challengeId: fresh.id, code: PREVIEW_CODE });
 auth.reset();
 await assert.rejects(auth.register({ ...credentials, challengeId: fresh.id }), /校验/);
});
