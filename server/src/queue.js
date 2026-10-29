import { Queue } from 'bullmq';
import { makeRedis } from './redis.js';

export const QUEUE_NAME = 'workflow-runs';

export const runQueue = new Queue(QUEUE_NAME, { connection: makeRedis() });

export function enqueueRun(runId, attempts = 3, input = {}) {
  return runQueue.add(
    'execute',
    { runId, input },
    {
      jobId: `run_${runId}`,
      attempts,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    }
  );
}
