import mongoose from 'mongoose';

export const RUN_STATUSES = ['queued', 'running', 'streaming', 'completed', 'failed', 'canceled'];

const runSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', index: true },
    workflowName: String,
    workflowVersion: Number,
    triggeredBy: { type: String, default: 'manual' }, 
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: RUN_STATUSES, default: 'queued', index: true },
    input: mongoose.Schema.Types.Mixed, 
    prompt: String, 
    output: { type: String, default: '' },
    model: String,
    attempts: { type: Number, default: 0 },
    tokens: { prompt: { type: Number, default: 0 }, completion: { type: Number, default: 0 } },
    costUsd: { type: Number, default: 0 },
    latencyMs: { firstToken: Number, total: Number },
    trace: [{ at: Date, event: String, detail: String }],
    error: String,
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

export const Run = mongoose.model('Run', runSchema);
