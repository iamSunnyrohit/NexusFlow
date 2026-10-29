import { Router } from 'express';
import { Run } from '../models/Run.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/runs', requireAuth, async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const since = new Date(Date.now() - days * 86400000);
  const match = { createdAt: { $gte: since } };

  const [totals] = await Run.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        canceled: { $sum: { $cond: [{ $eq: ['$status', 'canceled'] }, 1, 0] } },
        promptTokens: { $sum: '$tokens.prompt' },
        completionTokens: { $sum: '$tokens.completion' },
        costUsd: { $sum: '$costUsd' },
        avgFirstToken: { $avg: '$latencyMs.firstToken' },
        avgTotal: { $avg: '$latencyMs.total' },
      },
    },
  ]);

  const firstTokens = await Run.find({ ...match, 'latencyMs.firstToken': { $gt: 0 } }, 'latencyMs.firstToken')
    .lean();
  const sorted = firstTokens.map((r) => r.latencyMs.firstToken).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;

  const byDay = await Run.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        runs: { $sum: 1 },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        costUsd: { $sum: '$costUsd' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const byModel = await Run.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$model',
        runs: { $sum: 1 },
        avgTotal: { $avg: '$latencyMs.total' },
        costUsd: { $sum: '$costUsd' },
      },
    },
    { $sort: { runs: -1 } },
  ]);

  const t = totals || { total: 0, completed: 0, failed: 0, canceled: 0 };
  const finished = t.completed + t.failed;
  res.json({
    days,
    totals: t,
    successRate: finished ? t.completed / finished : null,
    medianFirstTokenMs: median,
    byDay,
    byModel,
  });
});

export default router;
