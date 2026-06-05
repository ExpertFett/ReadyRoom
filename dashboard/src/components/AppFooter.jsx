/**
 * Persistent footer for the logged-in app.
 *
 * Shows version + "who am I" context + sister-tool links to the rest of the
 * DCS:OPT family. Mirrors the Deckboss treatment — a quiet strip at the
 * bottom of every page rather than just on the landing.
 */

const FAMILY_LINKS = [
  { label: 'Mizmaker',  url: 'https://dcsopt.up.railway.app',                          desc: 'Mission planner' },
  { label: 'Ops Bot',   url: 'https://dcsoptbot-production-0c4b.up.railway.app',        desc: 'Discord bot' },
];

export function AppFooter({ me, version }) {
  const member = me?.member;
  const wing = member?.callsign ? `${member.rank || ''} ${member.callsign}`.trim() : (me?.user?.username || '');
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <span className="muted small">
          ReadyRoom <b>{version}</b> · a DCS:OPT tool
        </span>
        <span className="muted small">
          {me ? <>Signed in as <b>{wing}</b></> : 'Not signed in'}
        </span>
        <span className="muted small">
          Family: {FAMILY_LINKS.map((l, i) => (
            <span key={l.label}>
              {i > 0 && ' · '}
              <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.desc}>{l.label}</a>
            </span>
          ))}
          {me?.isAdmin && <> · <a href="/audit-log">Audit log</a></>}
        </span>
      </div>
    </footer>
  );
}
