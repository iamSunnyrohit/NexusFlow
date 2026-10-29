import mongoose from 'mongoose';
import { Worker } from 'bullmq';
import { config } from './config.js';
import { makeRedis, runChannel, cancelKey } from './redis.js';
import { QUEUE_NAME } from './queue.js';
import { Run } from './models/Run.js';
import { Workflow } from './models/Workflow.js';
import { renderTemplate } from './utils/template.js';
import { redactString } from './utils/redact.js';
import { streamChat, completeOnce } from './services/larprouter.js';

const redis = makeRedis();
const pub = makeRedis();

const publish = (runId, type, payload = {}) =>
  pub.publish(runChannel(runId), JSON.stringify({ type, ...payload }));

const outKey = (runId) => `run:${runId}:output`;
const estimateTokens = (s) => Math.ceil((s || '').length / 4);
const cost = (p, c) =>
  (p * config.cost.promptPer1M + c * config.cost.completionPer1M) / 1_000_000;

async function setStatus(run, status, event, detail) {
  run.status = status;
  run.trace.push({ at: new Date(), event: event || status, detail });
  await run.save();
  await publish(run._id, 'status', { status });
}

const stripFences = (s) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
const isValidJson = (s) => {
  try {
    JSON.parse(stripFences(s));
    return true;
  } catch {
    return false;
  }
};

async function execute(job) {
  const { runId, input } = job.data;
  const run = await Run.findById(runId);
  if (!run) return;
  const wf = await Workflow.findById(run.workflowId);
  if (!wf) throw Object.assign(new Error('Workflow no longer exists'), { fatal: true });
  const step = wf.steps[0];
  const model = step.model || config.larp.defaultModel;
  const attempt = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts || 1;

  if (await redis.get(cancelKey(runId))) {
    run.completedAt = new Date();
    await setStatus(run, 'canceled', 'canceled', 'Canceled before start');
    await publish(runId, 'done', { status: 'canceled' });
    return;
  }

  await redis.del(outKey(runId));
  if (attempt > 1) await publish(runId, 'reset');
  run.output = '';
  run.attempts = attempt;
  run.model = model;
  run.startedAt = run.startedAt || new Date();
  const prompt = renderTemplate(step.promptTemplate, input);
  run.prompt = redactString(prompt); // never persist raw secrets/PII
  await setStatus(run, 'running', 'running', `Attempt ${attempt}/${maxAttempts}`);

  const controller = new AbortController();
  const hardTimeout = setTimeout(() => controller.abort(new Error('timeout')), 620_000);
  let canceled = false;
  const cancelPoll = setInterval(async () => {
    if (await redis.get(cancelKey(runId))) {
      canceled = true;
      controller.abort();
    }
  }, 500);

  const t0 = Date.now();
  let firstTokenMs = null;
  let output = '';
  let lastFlush = 0;

  try {
    const { usage } = await streamChat({
      model,
      temperature: step.temperature,
      maxTokens: step.maxTokens,
      signal: controller.signal,
      messages: [
        { role: 'system', content: step.systemPrompt || 'You are an operations analyst.' },
        { role: 'user', content: prompt },
      ],
      onDelta: async (delta) => {
        if (firstTokenMs === null) {
          firstTokenMs = Date.now() - t0;
          await Run.updateOne(
            { _id: runId },
            { status: 'streaming', 'latencyMs.firstToken': firstTokenMs }
          );
          await publish(runId, 'status', { status: 'streaming' });
          await publish(runId, 'metrics', { firstTokenMs });
        }
        const offset = output.length;
        output += delta;
        // APPEND then PUBLISH: a reconnecting client's snapshot always covers earlier tokens.
        await redis.append(outKey(runId), delta);
        await publish(runId, 'token', { delta, offset });
        if (Date.now() - lastFlush > 1000) {
          lastFlush = Date.now();
          await Run.updateOne({ _id: runId }, { output }); // periodic flush (awaited: no race with final write)
        }
      },
    });

    let promptTokens = usage?.prompt_tokens ?? estimateTokens(prompt);
    let completionTokens = usage?.completion_tokens ?? estimateTokens(output);

    // Optional JSON validation with one repair attempt
    if (step.outputFormat === 'json' && !isValidJson(output)) {
      await publish(runId, 'error', { message: 'Output was not valid JSON; attempting repair', retry: false });
      const repaired = await completeOnce({
        model,
        signal: controller.signal,
        messages: [
          { role: 'system', content: 'Return ONLY valid JSON. No prose, no code fences.' },
          { role: 'user', content: `Fix this into valid JSON:\n\n${output}` },
        ],
      });
      if (!isValidJson(repaired.text)) throw Object.assign(new Error('Model returned invalid JSON'), { fatal: false });
      output = stripFences(repaired.text);
      await redis.set(outKey(runId), output);
      await publish(runId, 'reset');
      await publish(runId, 'token', { delta: output, offset: 0 });
      promptTokens += repaired.usage?.prompt_tokens || 0;
      completionTokens += repaired.usage?.completion_tokens || 0;
    }

    const totalMs = Date.now() - t0;
    await Run.updateOne(
      { _id: runId },
      {
        output,
        status: 'completed',
        tokens: { prompt: promptTokens, completion: completionTokens },
        costUsd: cost(promptTokens, completionTokens),
        latencyMs: { firstToken: firstTokenMs, total: totalMs },
        completedAt: new Date(),
        error: null,
        $push: { trace: { at: new Date(), event: 'completed', detail: `${totalMs}ms` } },
      }
    );
    await publish(runId, 'metrics', {
      firstTokenMs,
      totalMs,
      tokens: promptTokens + completionTokens,
      costUsd: cost(promptTokens, completionTokens),
    });
    await publish(runId, 'done', { status: 'completed' });
    await redis.expire(outKey(runId), 3600);
  } catch (err) {
    if (canceled) {
      await Run.updateOne(
        { _id: runId },
        {
          output,
          status: 'canceled',
          completedAt: new Date(),
          'latencyMs.total': Date.now() - t0,
          $push: { trace: { at: new Date(), event: 'canceled', detail: 'Canceled by user' } },
        }
      );
      await publish(runId, 'done', { status: 'canceled' });
      await redis.expire(outKey(runId), 3600);
      return; // do not throw: no retry
    }

    const isLast = attempt >= maxAttempts || err.fatal;
    const message = err.name === 'AbortError' || err.message === 'timeout' ? 'Model timeout' : err.message;
    await Run.updateOne(
      { _id: runId },
      {
        output,
        error: message,
        status: isLast ? 'failed' : 'queued',
        ...(isLast && { completedAt: new Date() }),
        $push: { trace: { at: new Date(), event: isLast ? 'failed' : 'retrying', detail: `${message} (attempt ${attempt}/${maxAttempts})` } },
      }
    );
    await publish(runId, 'error', { message, retry: !isLast });
    if (isLast) {
      await publish(runId, 'done', { status: 'failed', error: message });
      await redis.expire(outKey(runId), 3600);
      return; // final failure recorded; nothing more for BullMQ to retry
    }
    await publish(runId, 'status', { status: 'queued' });
    throw err; // BullMQ applies exponential backoff and retries
  } finally {
    clearTimeout(hardTimeout);
    clearInterval(cancelPoll);
  }
}

await mongoose.connect(config.mongoUri);
const worker = new Worker(QUEUE_NAME, execute, {
  connection: makeRedis(),
  concurrency: config.workerConcurrency,
});
worker.on('failed', (job, err) => console.warn(`[worker] job ${job?.id} attempt failed: ${err.message}`));
worker.on('error', (err) => console.error('[worker] error', err));
console.log(`Worker started (concurrency ${config.workerConcurrency})`);

const shutdown = async () => {
  await worker.close();
  await mongoose.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
