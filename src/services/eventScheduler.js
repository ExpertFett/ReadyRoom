// Background scheduler: posts events to Discord when their scheduled post time
// arrives. Runs in the always-on web process. Each tick re-queries the DB, so a
// deploy/restart at worst delays a due post by one interval (nothing is lost).

import { getEventsDueForDiscord } from '../db/events.js';
import { publishEventNow } from './eventPublish.js';

let timer = null;

export function startEventScheduler({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  const tick = async () => {
    try {
      const due = getEventsDueForDiscord(Date.now());
      for (const ev of due) {
        const posted = await publishEventNow(ev.id);
        if (posted) console.log(`[eventScheduler] posted event ${ev.id} "${ev.title}" to Discord`);
      }
    } catch (err) {
      console.warn('[eventScheduler] tick failed:', err.message);
    }
  };
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref(); // don't keep the process alive just for this
  tick(); // run once on boot to catch anything already due
  console.log(`[eventScheduler] started (every ${Math.round(intervalMs / 1000)}s)`);
}
