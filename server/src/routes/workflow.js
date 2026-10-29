import { Router } from 'express';
import crypto from 'crypto';
import cron from 'node-cron';
import { Workflow } from '../models/Workflow.js';
import { Run } from '../models/Run.js';
import { audit } from '../models/AuditLog.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createAndEnqueueRun } from '../services/runService.js';
import { reloadSchedules } from '../scheduler.js';

const router = Router();

function validateWorkflow(body) {
  if (!body.name?.trim()) return 'Name is required';
  if (!Array.isArray(body.steps) || !body.steps[0]?.promptTemplate?.trim())
    return 'At least one LLM step with a prompt template is required';
  if (body.trigger?.type === 'cron' && !cron.validate(body.trigger.expression || ''))
    return 'Invalid cron expression';
  return null;
}

const pick = (b) => ({
  name: b.name,
  description: b.description,
  trigger: b.trigger,
  inputs: b.inputs,
  steps: b.steps,
  retryPolicy: b.retryPolicy,
  active: b.active,
});

router.get('/', requireAuth, async (_req, res) => {
  res.json(await Workflow.find({}, '-history').sort({ updatedAt: -1 }));
});

router.get('/:id', requireAuth, async (req, res) => {
  const wf = await Workflow.findById(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });
  res.json(wf);
});

router.post('/', requireAuth, requireRole('editor'), async (req, res) => {
  const err = validateWorkflow(req.body);
  if (err) return res.status(400).json({ error: err });
  const data = pick(req.body);
  if (data.trigger?.type === 'webhook') data.trigger.webhookToken = crypto.randomBytes(16).toString('hex');
  const wf = await Workflow.create({ ...data, createdBy: req.user.id });
  audit(req.user.id, 'workflow.create', String(wf._id), { name: wf.name });
  await reloadSchedules();
  res.status(201).json(wf);
});

router.put('/:id', requireAuth, requireRole('editor'), async (req, res) => {
  const err = validateWorkflow(req.body);
  if (err) return res.status(400).json({ error: err });
  const wf = await Workflow.findById(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });

  const { history, ...snapshot } = wf.toObject();
  wf.history.push({ version: wf.version, snapshot, changedBy: req.user.id, changedAt: new Date() });
  Object.assign(wf, pick(req.body));
  if (wf.trigger?.type === 'webhook' && !wf.trigger.webhookToken)
    wf.trigger.webhookToken = crypto.randomBytes(16).toString('hex');
  wf.version += 1;
  await wf.save();
  audit(req.user.id, 'workflow.update', String(wf._id), { version: wf.version });
  await reloadSchedules();
  res.json(wf);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await Workflow.findByIdAndDelete(req.params.id);
  audit(req.user.id, 'workflow.delete', req.params.id);
  await reloadSchedules();
  res.status(204).end();
});

router.post('/:id/run', requireAuth, requireRole('editor'), async (req, res) => {
  const wf = await Workflow.findById(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });
  try {
    const run = await createAndEnqueueRun(wf, req.body?.input || {}, { triggeredBy: 'manual', userId: req.user.id });
    audit(req.user.id, 'run.trigger', String(run._id), { workflowId: String(wf._id) });
    res.status(202).json({ runId: run._id, status: run.status });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:id/runs', requireAuth, async (req, res) => {
  res.json(
    await Run.find({ workflowId: req.params.id }, '-prompt -output -trace').sort({ createdAt: -1 }).limit(50)
  );
});

export default router;

export const webhookRouter = Router();
webhookRouter.post('/:id/:token', async (req, res) => {
  const wf = await Workflow.findById(req.params.id);
  if (!wf || wf.trigger?.type !== 'webhook' || wf.trigger.webhookToken !== req.params.token || !wf.active)
    return res.status(404).json({ error: 'Not found' });
  try {
    const run = await createAndEnqueueRun(wf, req.body || {}, { triggeredBy: 'webhook' });
    res.status(202).json({ runId: run._id });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
