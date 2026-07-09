// Recurring "upcoming events" Discord digest. When a wing enables it, we keep
// ONE message in the events channel refreshed with the next ~30 days of events
// (editing in place — no re-ping). Complements the per-event sign-up panels.

import { getEventsInRange } from '../db/events.js';
import { getWing, getDigestWings, setWingDigestMessageId } from '../db/index.js';
import { publishDigest, editDigest } from './opsbotBridge.js';
import { getBaseUrl } from '../config.js';

function buildDigestPayload(wing) {
  const now = Date.now();
  const events = getEventsInRange(wing.id, now, now + 30 * 86400000)
    .filter((e) => e.start_at >= now - 3600000)
    .sort((a, b) => a.start_at - b.start_at)
    .slice(0, 20)
    .map((e) => ({
      title: e.title,
      start_at: e.start_at,
      kind: e.kind,
      squadron_tag: e.squadron_tag || null,
      url: `${getBaseUrl()}/events/${e.id}`,
    }));
  return { title: `📅 Upcoming Events — ${wing.tag || wing.name}`, events };
}

/**
 * Post or refresh a wing's digest message. Edits in place when we already have
 * a message id; re-posts if that message was deleted on Discord. Returns true
 * on success. Never throws.
 */
export async function refreshWingDigest(wingId) {
  const wing = getWing(wingId);
  if (!wing?.ops_bot_url || !wing?.ops_bot_token) return false;
  const payload = buildDigestPayload(wing);
  if (wing.digest_message_id) {
    const r = await editDigest(wing, wing.digest_message_id, payload);
    if (r === true) return true;
    if (r !== 'gone') return false;              // transient failure — keep id, retry next tick
    setWingDigestMessageId(wing.id, null);        // message deleted on Discord — clear + re-post below
  }
  const posted = await publishDigest(wing, payload);
  if (posted) { setWingDigestMessageId(wing.id, posted.message_id); return true; }
  return false;
}

let timer = null;
export function startDigestScheduler({ intervalMs = 30 * 60 * 1000 } = {}) {
  if (timer) return;
  const tick = async () => {
    try {
      for (const w of getDigestWings()) await refreshWingDigest(w.id);
    } catch (err) {
      console.warn('[eventDigest] tick failed:', err.message);
    }
  };
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  tick(); // refresh once on boot
  console.log(`[eventDigest] started (every ${Math.round(intervalMs / 60000)}m)`);
}
