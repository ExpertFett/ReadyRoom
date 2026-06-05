/**
 * Training Library — wing documentation CMS.
 *
 * Mirrors the Deckboss "Docs" tab layout: left sidebar tree of categories
 * (Wing Documents / Squadron Documents / Quals), main area shows the
 * documents in the active category. Click a document to read or edit it.
 *
 * Documents are scoped:
 *   wing                    — global SOPs
 *   squadron + squadron_id  — squadron-specific
 *   qual + qual_id          — per-qualification syllabus / study material
 */

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

export default function Docs() {
  const { me, activeWing } = useMe();
  const [docs, setDocs] = useState(null);
  const [squadrons, setSquadrons] = useState([]);
  const [quals, setQuals] = useState([]);
  const [active, setActive] = useState({ scope: 'wing', scope_id: null }); // active category
  const [openDoc, setOpenDoc] = useState(null); // {id} for read/edit
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!activeWing) return;
    setDocs(await api.get(`/api/wings/${activeWing.id}/documents`));
  };
  useEffect(() => { load(); }, [activeWing]);
  useEffect(() => {
    if (!activeWing) return;
    api.get(`/api/squadrons?wing_id=${activeWing.id}`).then(setSquadrons);
    api.get(`/api/quals?wing_id=${activeWing.id}`).then(setQuals);
  }, [activeWing]);

  if (!activeWing) return <div className="empty">No wing yet.</div>;
  if (docs === null) return <p className="muted">Loading…</p>;

  const inCategory = docs.filter((d) =>
    d.scope === active.scope && (active.scope === 'wing' || d.scope_id === active.scope_id));

  const categoryLabel = active.scope === 'wing' ? 'Wing Documents'
    : active.scope === 'squadron' ? `Squadron: ${squadrons.find((s) => s.id === active.scope_id)?.tag || squadrons.find((s) => s.id === active.scope_id)?.name || '?'}`
    : `Qual: ${quals.find((q) => q.id === active.scope_id)?.code || '?'}`;

  return (
    <div>
      <div className="between">
        <h1>Training Library</h1>
        {me.isAdmin && <button className="primary" onClick={() => { setCreating(true); setOpenDoc(null); }}>+ New document</button>}
      </div>

      <div className="row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
        <aside className="card" style={{ flex: '0 0 240px', maxHeight: 600, overflow: 'auto' }}>
          <Tree squadrons={squadrons} quals={quals} docs={docs}
            active={active} setActive={(c) => { setActive(c); setOpenDoc(null); setCreating(false); }} />
        </aside>

        <section style={{ flex: 1, minWidth: 0 }}>
          {creating ? (
            <DocEditor wing={activeWing} squadrons={squadrons} quals={quals} initial={{ scope: active.scope, scope_id: active.scope_id }}
              onSaved={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />
          ) : openDoc ? (
            <DocViewer id={openDoc.id} isAdmin={me.isAdmin} onClosed={() => setOpenDoc(null)} onChanged={load} />
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>{categoryLabel} <span className="muted small">({inCategory.length})</span></h2>
              {!inCategory.length ? <div className="empty">No documents in this category yet.</div> : (
                <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                  {inCategory.map((d) => (
                    <button key={d.id} className="kpi-tile" style={{ textAlign: 'left', cursor: 'pointer' }}
                      onClick={() => setOpenDoc(d)}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.title}</div>
                      <div className="muted small">
                        {d.content ? `${d.content.length.toLocaleString()} chars` : 'empty'}
                        {' · '}{new Date(d.updated_at).toLocaleDateString()}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Tree({ squadrons, quals, docs, active, setActive }) {
  const countFor = (scope, scope_id) => docs.filter((d) => d.scope === scope && (scope === 'wing' || d.scope_id === scope_id)).length;
  const Item = ({ scope, scope_id, label }) => (
    <div className={`tree-item ${active.scope === scope && active.scope_id === scope_id ? 'active' : ''}`}
      style={{
        padding: '6px 10px', cursor: 'pointer', borderRadius: 4,
        background: active.scope === scope && active.scope_id === scope_id ? 'rgba(76,139,245,0.10)' : 'transparent',
        color: active.scope === scope && active.scope_id === scope_id ? 'var(--accent)' : undefined,
      }}
      onClick={() => setActive({ scope, scope_id })}>
      <span>{label}</span>
      <span className="muted small" style={{ float: 'right' }}>{countFor(scope, scope_id) || ''}</span>
    </div>
  );
  return (
    <div>
      <div className="muted small" style={{ letterSpacing: 1, padding: '4px 10px' }}>WING</div>
      <Item scope="wing" scope_id={null} label="Wing Documents" />

      <div className="muted small" style={{ letterSpacing: 1, padding: '10px 10px 4px' }}>SQUADRONS</div>
      {squadrons.map((s) => <Item key={s.id} scope="squadron" scope_id={s.id} label={s.tag || s.name} />)}

      <div className="muted small" style={{ letterSpacing: 1, padding: '10px 10px 4px' }}>QUALS</div>
      {quals.map((q) => <Item key={q.id} scope="qual" scope_id={q.id} label={q.code} />)}
    </div>
  );
}

function DocViewer({ id, isAdmin, onClosed, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { api.get(`/api/documents/${id}`).then(setDoc); }, [id]);
  if (!doc) return <p className="muted">Loading…</p>;
  const remove = async () => {
    if (!confirm(`Delete "${doc.title}"?`)) return;
    await api.del(`/api/documents/${doc.id}`);
    onClosed();
    onChanged();
  };
  if (editing) {
    return <DocEditor initial={doc} squadrons={[]} quals={[]} wing={null}
      onSaved={(d) => { setDoc(d); setEditing(false); onChanged(); }}
      onCancel={() => setEditing(false)} />;
  }
  return (
    <section className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{doc.title}</h2>
        <div className="row" style={{ gap: 6 }}>
          {isAdmin && <button className="small" onClick={() => setEditing(true)}>Edit</button>}
          {isAdmin && <button className="small danger" onClick={remove}>Delete</button>}
          <button className="small" onClick={onClosed}>Close</button>
        </div>
      </div>
      <p className="muted small">Updated {new Date(doc.updated_at).toLocaleString()}</p>
      <pre style={{
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 12,
        background: 'rgba(0,0,0,0.18)', padding: 14, borderRadius: 4,
        fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5,
      }}>
        {doc.content || <span className="muted">(empty)</span>}
      </pre>
    </section>
  );
}

function DocEditor({ initial, wing, squadrons, quals, onSaved, onCancel }) {
  const [f, setF] = useState({
    title: initial?.title || '',
    content: initial?.content || '',
    scope: initial?.scope || 'wing',
    scope_id: initial?.scope_id || null,
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) return;
    setBusy(true);
    try {
      const saved = initial?.id
        ? await api.put(`/api/documents/${initial.id}`, { title: f.title, content: f.content })
        : await api.post(`/api/wings/${wing.id}/documents`, f);
      onSaved(saved);
    } finally { setBusy(false); }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>{initial?.id ? `Edit ${initial.title}` : 'New document'}</h3>
      {!initial?.id && (
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <label>Scope
            <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value, scope_id: null })}>
              <option value="wing">Wing-wide</option>
              <option value="squadron">Squadron</option>
              <option value="qual">Qualification</option>
            </select>
          </label>
          {f.scope === 'squadron' && (
            <label>Squadron
              <select value={f.scope_id || ''} onChange={(e) => setF({ ...f, scope_id: Number(e.target.value) || null })}>
                <option value="">— pick —</option>
                {squadrons.map((s) => <option key={s.id} value={s.id}>{s.tag || s.name}</option>)}
              </select></label>
          )}
          {f.scope === 'qual' && (
            <label>Qualification
              <select value={f.scope_id || ''} onChange={(e) => setF({ ...f, scope_id: Number(e.target.value) || null })}>
                <option value="">— pick —</option>
                {quals.map((q) => <option key={q.id} value={q.id}>{q.code} · {q.name}</option>)}
              </select></label>
          )}
        </div>
      )}
      <div className="field"><label>Title *</label>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Wing SOP - Section 1: Communications" /></div>
      <div className="field"><label>Content <span className="muted small">(markdown)</span></label>
        <textarea rows={18} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })}
          style={{ fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5 }}
          placeholder="# Wing SOP&#10;&#10;## Purpose&#10;..." /></div>
      <div className="row" style={{ gap: 8 }}>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : initial?.id ? 'Save' : 'Create'}</button>
        <button type="button" className="small" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
