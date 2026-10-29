import { Router } from 'express';
import { Run } from '../models/Run.js';
import { Workflow } from '../models/Workflow.js';
import { audit } from '../models/AuditLog.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { onRunEvent } from '../runBus.js';
import { makeRedis, cancelKey } from '../redis.js';
import { runQueue } from '../queue.js';
import { createAndEnqueueRun } from '../services/runService.js';

const router = Router();
const redis = makeRedis(); 
const TERMINAL = ['completed', 'failed', 'canceled'];

router.get('/', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(await Run.find({}, '-prompt -output -trace').sort({ createdAt: -1 }).limit(limit));
});

router.get('/:id', requireAuth, async (req, res) => {
  const run = await Run.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'Not found' });
  res.json(run);
});

router.get('/:id/stream', requireAuth, async (req, res) => {
  const runId = req.params.id;
  const run = await Run.findById(runId, 'status output error');
  if (!run) return res.status(404).json({ error: 'Not found' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  let snapshotLen = 0;
  let ready = false;
  const pending = [];
  let closed = false;

  const handle = (evt) => {
    const { type, ...payload } = evt;
    if (type === 'reset') snapshotLen = 0; 
    if (type === 'token') {
      const end = payload.offset + payload.delta.length;
      if (end <= snapshotLen) return; 
      if (payload.offset < snapshotLen) {
        payload.delta = payload.delta.slice(snapshotLen - payload.offset);
      }
      snapshotLen = end;
    }
    send(type, { runId, ...payload });
    if (type === 'done') cleanup();
  };

  const off = onRunEvent(runId, (evt) => (ready ? handle(evt) : pending.push(evt)));

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    off();
    res.end();
  }
  req.on('close', cleanup);

  const live = await redis.get(`run:${runId}:output`);
  const current = await Run.findById(runId, 'status output error');
  const output = live ?? current.output ?? '';
  snapshotLen = output.length;

  send('status', { runId, status: current.status });
  if (output) send('token', { runId, delta: output, offset: 0, snapshot: true });

  if (TERMINAL.includes(current.status)) {
    send('done', { runId, status: current.status, error: current.error });
    return cleanup();
  }

  ready = true;
  pending.splice(0).forEach(handle);
});

router.post('/:id/cancel', requireAuth, requireRole('editor'), async (req, res) => {
  const run = await Run.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'Not found' });
  if (TERMINAL.includes(run.status)) return res.status(409).json({ error: `Run already ${run.status}` });

  await redis.set(cancelKey(run._id), '1', 'EX', 3600); // worker polls this flag
  // If it's still waiting in the queue, remove it and mark canceled directly.
  const job = await runQueue.getJob(`run_${run._id}`);
  if (job && (await job.isWaiting())) {
    await job.remove();
    run.status = 'canceled';
    run.completedAt = new Date();
    run.trace.push({ at: new Date(), event: 'canceled', detail: 'Canceled while queued' });
    await run.save();
  }
  audit(req.user.id, 'run.cancel', String(run._id));
  res.json({ ok: true });
});

router.post('/:id/retry', requireAuth, requireRole('editor'), async (req, res) => {
  const old = await Run.findById(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const wf = await Workflow.findById(old.workflowId);
  if (!wf) return res.status(404).json({ error: 'Workflow no longer exists' });
  try {
    const run = await createAndEnqueueRun(wf, req.body?.input || old.input || {}, {
      triggeredBy: 'retry',
      userId: req.user.id,
    });
    audit(req.user.id, 'run.retry', String(run._id), { from: String(old._id) });
    res.status(202).json({ runId: run._id });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:id/export', requireAuth, async (req, res) => {
  const run = await Run.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'Not found' });
  audit(req.user.id, 'run.export', String(run._id), { format: req.query.format || 'md' });
  if (req.query.format === 'json') return res.json(run);
  res.set({
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="run-${run._id}.md"`,
  });
  res.send(`# ${run.workflowName}\n\n_Run ${run._id} · ${run.status} · ${run.model}_\n\n${run.output}\n`);
});

export default router;
