// Outbound bridge from ReadyRoom -> Ops Bot.
// The wing carries the Ops Bot base URL + outbound token (revealed by the
// squadron admin on Ops Bot's dashboard). When a new event lands here, we
// fire-and-forget a POST so Ops Bot can drop a Discord embed in the
// configured channel.

const TIMEOUT_MS = 8000;

/**
 * Publish an event to the wing's Ops Bot, returning the Discord message id
 * (so we can later edit/delete it). Returns null silently on any failure —
 * we never block or fail the local create path.
 *
 * @param {{ops_bot_url: string|null, ops_bot_token: string|null}} wing
 * @param {{title:string, description?:string, kind?:string, start_at?:number, duration_min?:number, primary_aircraft?:string, squadron_tag?:string, url?:string}} payload
 * @returns {Promise<{message_id:string, channel_id:string} | null>}
 */
export async function publishEvent(wing, payload) {
  if (!wing?.ops_bot_url || !wing?.ops_bot_token) return null;
  const base = wing.ops_bot_url.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/integrations/readyroom/publish-event`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${wing.ops_bot_token}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch { /* ignore */ }
      console.warn('[opsbotBridge] publish failed:', res.status, body?.error || '');
      return null;
    }
    const data = await res.json();
    if (!data?.message_id) return null;
    return { message_id: String(data.message_id), channel_id: String(data.channel_id || '') };
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('[opsbotBridge] POST error:', err.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}
