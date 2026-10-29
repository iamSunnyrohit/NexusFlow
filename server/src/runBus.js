import { EventEmitter } from 'events';
import { makeRedis } from './redis.js';

const bus = new EventEmitter();
bus.setMaxListeners(0);

let started = false;
export function startRunBus() {
  if (started) return;
  started = true;
  const sub = makeRedis();
  sub.psubscribe('run:*', (err) => err && console.error('psubscribe failed', err));
  sub.on('pmessage', (_pattern, channel, message) => {
    try {
      bus.emit(channel, JSON.parse(message));
    } catch {

    }
  });
}

export const onRunEvent = (runId, fn) => {
  bus.on(`run:${runId}`, fn);
  return () => bus.off(`run:${runId}`, fn);
};
