import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import workflowRoutes, { webhookRouter } from './routes/workflows.js';
import runRoutes from './routes/runs.js';
import metricsRoutes from './routes/metrics.js';
import { startRunBus } from './runBus.js';
import { reloadSchedules } from './scheduler.js';

const app = express();
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/runs', runRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/hooks', webhookRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

await mongoose.connect(config.mongoUri);
startRunBus();
await reloadSchedules();
app.listen(config.port, () => console.log(`API listening on :${config.port}`));
