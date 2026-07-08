// Publish an event's sign-up panel to the wing's Ops Bot. Shared by the event
// create handler (post-now path) and the background scheduler (post-at-time).
// No-op unless the wing is wired to a bot and not paused.

import { getEvent, getEventSignups, setEventDiscord } from '../db/events.js';
import { getWing, getWingIngestToken } from '../db/index.js';
import { publishEvent as opsbotPublishEvent } from './opsbotBridge.js';
import { getBaseUrl } from '../config.js';

function payloadFor(ev, wing) {
  return {
    readyroom_event_id: ev.id,
    signup_callback_url: `${getBaseUrl()}/ingest/${getWingIngestToken(wing.id)}`,
    title: ev.title, description: ev.description, kind: ev.kind,
    start_at: ev.start_at, roles: ev.roles, taskings: ev.taskings,
    signups: getEventSignups(ev.id),
    url: `${getBaseUrl()}/events/${ev.id}`,
  };
}

/**
 * Publish the event to Discord now. Returns true if a message was posted.
 * Safe to call for an already-posted event — it just won't double-post because
 * the caller/scheduler gates on discord_message_id.
 */
export async function publishEventNow(eventId) {
  const ev = getEvent(eventId);
  if (!ev) return false;
  const wing = getWing(ev.wing_id);
  if (!wing?.ops_bot_url || !wing?.ops_bot_token || wing.discord_paused) return false;
  const r = await opsbotPublishEvent(wing, payloadFor(ev, wing));
  if (r) { setEventDiscord(ev.id, r.channel_id, r.message_id); return true; }
  return false;
}
