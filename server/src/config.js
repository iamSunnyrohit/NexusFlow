import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/ai_orchestrator',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  larp: {
    baseUrl: (process.env.LARPROUTER_BASE_URL || 'https://api.larprouter.com/v1').replace(/\/$/, ''),
    apiKey: process.env.LARPROUTER_API_KEY || '',
    defaultModel: process.env.DEFAULT_MODEL,
  },
  cost: {
    promptPer1M: Number(process.env.COST_PER_1M_PROMPT || 0),
    completionPer1M: Number(process.env.COST_PER_1M_COMPLETION || 0),
  },
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY || 4),
};
