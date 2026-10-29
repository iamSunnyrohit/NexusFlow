import { Run } from '../models/Run.js';
import { enqueueRun } from '../queue.js';
import { resolveInputs } from '../utils/template.js';
import { redact } from '../utils/redact.js';
import { config } from '../config.js';

export async function createAndEnqueueRun(workflow, rawInput, { triggeredBy = 'manual', userId } = {}) {
  const { values, errors } = resolveInputs(workflow.inputs, rawInput);
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.status = 400;
    throw err;
  }

  const step = workflow.steps[0];
  const run = await Run.create({
    workflowId: workflow._id,
    workflowName: workflow.name,
    workflowVersion: workflow.version,
    triggeredBy,
    userId,
    status: 'queued',
    input: redact(values),
    model: step?.model || config.larp.defaultModel,
    trace: [{ at: new Date(), event: 'queued', detail: `Triggered by ${triggeredBy}` }],
  });

  await enqueueRun(String(run._id), workflow.retryPolicy?.maxAttempts || 3, values);
  return run;
}
