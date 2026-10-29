import IORedis from 'ioredis';
import { config } from './config.js';

export const makeRedis = () => new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export const runChannel = (runId) => `run:${runId}`;
export const cancelKey = (runId) => `run:${runId}:cancel`;
