// Outbound bridge from ReadyRoom -> Ops Bot.
// The wing carries the Ops Bot base URL + outbound token (revealed by the
// squadron admin on Ops Bot's dashboard). When a new event lands here, we
// fire-and-forget a POST so Ops Bot can drop a Discord embed in the
// configured channel.

const TIMEOUT_MS = 8000;

/**
 * Shared fetch for every bridge call: base-URL trim, bearer auth, JSON body,
 * and an 8s abort timeout. Returns the raw Response, or null when the wing
 * isn't wired or the request failed at the network layer (silent — bridge
 * calls never block or fail the local path).
 */
async function opsbotFetch(wing, method, path, payload = undefined) {
  if (!wing?.ops_bot_url || !wing?.ops_bot_token) return null;
  const base = wing.ops_bot_url.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${base}/integrations/readyroom${path}`, {
      method,
      headers: {
        authorization: `Bearer ${wing.ops_bot_token}`,
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err.name !== 'AbortError') console.warn(`[opsbotBridge] ${method} ${path} error:`, err.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function warnNotOk(res, label) {
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  console.warn(`[opsbotBridge] ${label} failed:`, res.status, body?.error || '');
}

/**
 * Publish an event to the wing's Ops Bot, returning the Discord message id
 * (so we can later edit/delete it). Returns null silently on any failure.
 *
 * @param {{ops_bot_url: string|null, ops_bot_token: string|null}} wing
 * @param {{title:string, description?:string, kind?:string, start_at?:number, duration_min?:number, primary_aircraft?:string, squadron_tag?:string, url?:string}} payload
 * @returns {Promise<{message_id:string, channel_id:string} | null>}
 */
export async function publishEvent(wing, payload) {
  const res = await opsbotFetch(wing, 'POST', '/publish-event', payload);
  if (!res) return null;
  if (!res.ok) { await warnNotOk(res, 'publish'); return null; }
  const data = await res.json().catch(() => null);
  if (!data?.message_id) return null;
  return { message_id: String(data.message_id), channel_id: String(data.channel_id || '') };
}

/**
 * Edit an already-published embed. Same payload shape as publishEvent.
 * @returns {Promise<boolean>} true on success, false on any failure (silent)
 */
export async function editEvent(wing, messageId, payload) {
  if (!messageId) return false;
  const res = await opsbotFetch(wing, 'PATCH', `/publish-event/${encodeURIComponent(messageId)}`, payload);
  if (!res) return false;
  if (!res.ok) { await warnNotOk(res, 'edit'); return false; }
  return true;
}

/**
 * Post the auto-updating "upcoming events" digest. Returns the new message id.
 * @returns {Promise<{message_id:string, channel_id:string} | null>}
 */
export async function publishDigest(wing, payload) {
  const res = await opsbotFetch(wing, 'POST', '/digest', payload);
  if (!res) return null;
  if (!res.ok) { await warnNotOk(res, 'digest post'); return null; }
  const data = await res.json().catch(() => null);
  if (!data?.message_id) return null;
  return { message_id: String(data.message_id), channel_id: String(data.channel_id || '') };
}

/**
 * Refresh (edit) the existing digest message in place. Returns 'gone' if the
 * message was deleted on Discord (caller should re-post), true on success.
 * @returns {Promise<boolean | 'gone'>}
 */
export async function editDigest(wing, messageId, payload) {
  if (!messageId) return false;
  const res = await opsbotFetch(wing, 'PATCH', `/digest/${encodeURIComponent(messageId)}`, payload);
  if (!res) return false;
  if (res.status === 404) return 'gone';   // message deleted on Discord — re-post
  if (!res.ok) { await warnNotOk(res, 'digest edit'); return false; }
  return true;
}

/**
 * Delete a published embed. Treated as success even if the message is already gone.
 * @returns {Promise<boolean>}
 */
export async function deleteEvent(wing, messageId) {
  if (!messageId) return false;
  const res = await opsbotFetch(wing, 'DELETE', `/publish-event/${encodeURIComponent(messageId)}`);
  if (!res) return false;
  if (!res.ok) { await warnNotOk(res, 'delete'); return false; }
  return true;
}
