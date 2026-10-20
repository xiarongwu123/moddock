const MONTHLY_TOKEN_LIMIT = 1_000_000;
class AIEntitlementError extends Error {
 constructor(code, message) { super(message); this.status = 403; this.code = code; }
}
function hasPro(account, now = Date.now()) {
 const expiry = account?.membership?.expiresAt;
 const feature = account?.features?.find(item => item.key === 'modding.studio');
 return account?.membership?.tier === 'pro' && (expiry == null || Date.parse(expiry) > now) && (!feature || feature.enabled === true && feature.allowed === true);
}
function quotaView(value, now = Date.now()) {
 if (!value || !Number.isSafeInteger(value.limitTokens) || value.limitTokens < 0 || !Number.isSafeInteger(value.usedTokens) || value.usedTokens < 0 || !Number.isFinite(Date.parse(value.periodStart)) || !Number.isFinite(Date.parse(value.periodEnd)) || Date.parse(value.periodStart) > now || Date.parse(value.periodEnd) <= now) return null;
 const limitTokens = Math.min(value.limitTokens, MONTHLY_TOKEN_LIMIT);
 return { limitTokens, usedTokens: value.usedTokens, remainingTokens: Math.max(0, limitTokens - value.usedTokens), periodStart: value.periodStart, periodEnd: value.periodEnd };
}
function requireAI(account, now = Date.now()) {
 const fail = (code, message) => { throw new AIEntitlementError(code, message); };
 if (!hasPro(account, now)) fail('pro_required', 'AI 功能需要有效的 Pro 会员，请查看会员权益。');
 const quota = quotaView(account.aiUsage, now);
 if (!quota) fail('ai_quota_unconfigured', 'AI 额度尚未配置或已过期，请刷新会员信息或联系维护方。');
 if (quota.remainingTokens <= 0) fail('ai_credits_exhausted', '本期 AI token 额度已用完，请等待额度重置或调整套餐。');
 return quota;
}
module.exports = { hasPro, quotaView, requireAI, MONTHLY_TOKEN_LIMIT, AIEntitlementError };
