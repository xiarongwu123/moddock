// Replace this adapter with the account API when it is available.
// No account, password, session or authorization is persisted here.
const PREVIEW_CODE = '246810';
const CODE_TTL = 5 * 60 * 1000;
const RESEND_WAIT = 60 * 1000;
const normalizeEmail = value => String(value || '').trim().toLowerCase();
function validateCredentials(email, password, registration = false) {
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))) throw new Error('请输入有效的邮箱地址');
 if (!password) throw new Error('请输入密码');
 if (password.length > 64) throw new Error('密码最多 64 位');
 if (registration && (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password))) throw new Error('密码需为 8–64 位，包含字母和数字');
}
function createPreviewAuth(now = Date.now) {
 let challenge = null;
 const profile = email => ({ email: normalizeEmail(email), name: normalizeEmail(email).split('@')[0], mode: 'preview' });
 return {
  mode: 'preview',
  async login({ email, password }) {
   validateCredentials(email, password);
   return profile(email);
  },
  async sendCode({ email, password }) {
   validateCredentials(email, password, true);
   if (challenge?.email === normalizeEmail(email) && now() < challenge.resendAt) throw new Error('请等待倒计时结束后重新获取验证码');
   challenge = { id: crypto.randomUUID(), email: normalizeEmail(email), expiresAt: now() + CODE_TTL, resendAt: now() + RESEND_WAIT, verified: false };
   return { ...challenge, previewCode: PREVIEW_CODE };
  },
  async verifyCode({ email, challengeId, code }) {
   if (!challenge || challenge.id !== challengeId || challenge.email !== normalizeEmail(email)) throw new Error('邮箱已变更，请重新获取验证码');
   if (now() >= challenge.expiresAt) throw new Error('验证码已过期，请重新获取');
   if (code !== PREVIEW_CODE) throw new Error('验证码不正确，请重新输入');
   challenge.verified = true;
   return { verified: true };
  },
  async register({ email, password, challengeId }) {
   validateCredentials(email, password, true);
   if (!challenge?.verified || challenge.id !== challengeId || challenge.email !== normalizeEmail(email) || now() >= challenge.expiresAt) throw new Error('请先完成邮箱验证码校验');
   challenge = null;
   return profile(email);
  },
  reset() { challenge = null; },
 };
}
module.exports = { createPreviewAuth, validateCredentials, PREVIEW_CODE };
