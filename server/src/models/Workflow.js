import mongoose from 'mongoose';

const inputSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: String,
    type: { type: String, enum: ['text', 'json', 'number'], default: 'text' },
    required: { type: Boolean, default: true },
    defaultValue: String,
  },
  { _id: false }
);

const stepSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['llm'], default: 'llm' },
    model: String,
    systemPrompt: { type: String, default: 'You are an operations analyst.' },
    promptTemplate: { type: String, required: true },
    temperature: { type: Number, default: 0.2 },
    maxTokens: { type: Number, default: 1500 },
    outputFormat: { type: String, enum: ['markdown', 'json', 'text'], default: 'markdown' },
  },
  { _id: false }
);

const workflowSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    version: { type: Number, default: 1 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    trigger: {
      type: { type: String, enum: ['manual', 'cron', 'webhook'], default: 'manual' },
      expression: String, // cron expression when type === 'cron'
      webhookToken: String, // secret token when type === 'webhook'
    },
    inputs: [inputSchema],
    steps: [stepSchema],
    retryPolicy: {
      maxAttempts: { type: Number, default: 3 },
    },
    history: [
      {
        version: Number,
        snapshot: mongoose.Schema.Types.Mixed,
        changedBy: mongoose.Schema.Types.ObjectId,
        changedAt: Date,
      },
    ],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Workflow = mongoose.model('Workflow', workflowSchema);
