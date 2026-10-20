import crypto from 'node:crypto';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

// Wrap Pi's own provider function; no second model client or agent loop.
export function meteredStream(stream, { ledger, owner, task = crypto.randomUUID(), onUsage }) {
 return (model, context, options = {}) => {
  const output = createAssistantMessageEventStream();
  void (async () => {
   let reservation, actual, providerId, final, failure, accounted = false;
   try {
    options.signal?.throwIfAborted();
    const upstream = await stream(model, context, { ...options,
     // A cancelled subscriber must not discard the provider's terminal usage.
     signal: AbortSignal.timeout(300000), timeoutMs: 300000, maxRetries: 0,
     onPayload: async payload => {
      options.signal?.throwIfAborted();
      const wire = await options.onPayload?.(payload, model) || payload;
      if (model.api !== 'openai-completions') throw new Error('Metered provider is not supported');
      // Conservative reservation only. Billing always uses the raw provider usage.
      const inputBudget = Buffer.byteLength(JSON.stringify(wire)) + 8192;
      reservation = await ledger.reserve(owner, task, inputBudget, Math.min(options.maxTokens || model.maxTokens, 16384));
      delete wire.max_completion_tokens;
      wire.max_tokens = reservation.outputBudget;
      wire.stream_options = { include_usage: true };
      return wire;
     },
     onProviderStreamEvent: async chunk => {
      if (!providerId && chunk.id) {
       providerId = chunk.id;
       ledger.identify(owner, task, reservation.id, providerId);
      }
      if (chunk.usage) {
       const inputTokens = chunk.usage.prompt_tokens, outputTokens = chunk.usage.completion_tokens;
       if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) throw new Error('Invalid provider usage');
       actual = { inputTokens, outputTokens };
       const usage = ledger.settle(owner, task, reservation.id, actual, providerId);
       accounted = true;
       await onUsage?.(usage);
      }
      await options.onProviderStreamEvent?.(chunk, model);
     },
    });
    for await (const event of upstream) {
     if (event.type === 'done' || event.type === 'error') final = event;
     else if (!options.signal?.aborted) output.push(event);
    }
    if (!reservation || !actual) {
     const code = final?.error?.errorMessage;
     throw Object.assign(new Error('Provider usage unavailable'), { code: ['pro_required', 'ai_credits_exhausted', 'ai_quota_unconfigured'].includes(code) ? code : 'ai_quota_unconfigured' });
    }
   } catch (error) {
    failure = error;
   }
   try {
    if (reservation && actual && !accounted) {
     const usage = ledger.settle(owner, task, reservation.id, actual, providerId);
     await onUsage?.(usage);
    }
    else if (reservation && !accounted) ledger.unresolved(owner, task, reservation.id);
   } catch (error) { failure = error; }
   if (failure || !final) {
    const error = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
     usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
     stopReason: 'error', timestamp: Date.now(), errorMessage: failure?.code || 'ai_quota_unconfigured' };
    output.push({ type: 'error', reason: 'error', error });
   } else output.push(final);
   output.end();
  })().catch(error => output.end({ role: 'assistant', content: [], stopReason: 'error', errorMessage: error.code || 'ai_quota_unconfigured' }));
  return output;
 };
}
