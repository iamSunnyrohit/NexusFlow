import cron from 'node-cron';
import { Workflow } from './models/Workflow.js';
import { createAndEnqueueRun } from './services/runService.js';

let tasks = [];

export async function reloadSchedules() {
  tasks.forEach((t) => t.stop());
  tasks = [];
  const workflows = await Workflow.find({ active: true, 'trigger.type': 'cron' });
  for (const wf of workflows) {
    const expr = wf.trigger.expression;
    if (!cron.validate(expr || '')) continue;
    tasks.push(
      cron.schedule(expr, async () => {
        try {
          const fresh = await Workflow.findById(wf._id);
          if (!fresh?.active) return;
          await createAndEnqueueRun(fresh, {}, { triggeredBy: 'cron' });
          console.log(`[scheduler] triggered "${fresh.name}"`);
        } catch (e) {
          console.error(`[scheduler] "${wf.name}" failed: ${e.message}`);
        }
      })
    );
  }
  console.log(`[scheduler] ${tasks.length} cron workflow(s) scheduled`);
}
