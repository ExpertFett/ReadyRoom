import { VERSION } from '../version.js';

const FEATURES = [
  { t: 'Wing → squadron → pilot', b: 'A real org tree — wings, squadrons, and member profiles with rank, billet, status and airframes.' },
  { t: 'Qualifications & currency', b: 'Define your wing’s quals and track who’s qualified, in training, or expired — per pilot.' },
  { t: 'Mission ops & sign-ups', b: 'Build missions with flights, callsigns, aircraft and seats. Pilots claim slots; you see the fill.' },
  { t: 'Sortie logbook', b: 'Server telemetry auto-attributes to the right pilot by their in-game name — logbooks fill themselves.' },
  { t: 'Squadron access', b: 'Host a mission and invite other squadrons, or keep it in-house. You control who can sign up.' },
  { t: 'Better together', b: 'Pairs with the DCS:OPT Ops Bot (Discord) and the Mizmaker planner — but stands completely on its own.' },
];

const STEPS = [
  { n: '1', t: 'Build your wing', b: 'Add your squadrons, the roster, and your qualifications.' },
  { n: '2', t: 'Plan & sign up', b: 'Spin up a mission, set the flights, let pilots claim slots.' },
  { n: '3', t: 'Fly & track', b: 'Sorties flow in from the server and land in each pilot’s logbook.' },
];

const INTEGRATIONS = [
  {
    t: 'DCS World',
    b: 'A lightweight in-game hook streams sorties to your wing — pilot name, airframe, flight time. ReadyRoom matches each one to a roster member via claimed pilot aliases, so logbooks fill themselves. Carrier landings log to the LSO board with grade, wire, AOA and ball call.',
  },
  {
    t: 'DCS:OPT Ops Bot (Discord)',
    b: 'Two-way bridge with your squadron Discord. Create an event in ReadyRoom → an embed lands in your events channel automatically; edit or delete it and the embed updates. Sortie telemetry from the bot mirrors into ReadyRoom in the same beat. Configured self-serve per guild — no Railway access required.',
  },
  {
    t: 'DCS:OPT Mizmaker',
    b: 'Import a .miz from the Mizmaker planner straight into a ReadyRoom mission. Coalitions, groups and client slots are parsed into ready-made flights — pilots sign up against the actual slots you flew on.',
  },
  {
    t: 'Spreadsheet roster',
    b: 'Bulk-import your roster from CSV — callsigns, names, ranks, billets, modex, capabilities and Discord IDs. Re-uploads are idempotent: matched pilots are updated in place, new ones are added. Dry-run preview before you commit.',
  },
];

export default function Landing() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');

  return (
    <div className="landing">
      <section className="landing-hero">
        <img src="/logo.png" alt="DCS:OPT — ReadyRoom" className="landing-logo" />
        <div><span className="landing-beta">BETA</span></div>
        <p className="landing-tagline">Squadron operations for DCS World — from roster to ramp.</p>
        <p className="landing-sub">
          Run your wing, plan the ops, and let the logbook keep itself.
          Built for groups, squadrons, and wings.
        </p>
        <div className="landing-cta">
          <a className="btn-discord" href="/auth/login"><DiscordMark /> Log In with Discord</a>
        </div>
        {error && <p className="error" style={{ marginTop: 14 }}>Log-in failed ({error}). Try again.</p>}
        <p className="landing-fine">
          Identity only — no email, nothing posted. <a href="/auth/dev-login">Dev login</a> (local only)
        </p>
      </section>

      <section className="landing-grid">
        {FEATURES.map((f) => (
          <div key={f.t} className="landing-feature">
            <div className="ft-title">{f.t}</div>
            <div className="ft-body">{f.b}</div>
          </div>
        ))}
      </section>

      <section className="landing-how">
        <h2>HOW IT WORKS</h2>
        <div className="landing-steps">
          {STEPS.map((s) => (
            <div key={s.n} className="landing-step">
              <div className="step-n">{s.n}</div>
              <div className="ft-title">{s.t}</div>
              <div className="ft-body">{s.b}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-how">
        <h2>INTEGRATIONS</h2>
        <p className="landing-sub" style={{ marginBottom: 22 }}>
          ReadyRoom stands on its own — but it gets meaningfully better when paired with the rest of the
          DCS:OPT family. Everything below is opt-in and configured from inside the app.
        </p>
        <div className="landing-grid" style={{ marginTop: 0 }}>
          {INTEGRATIONS.map((i) => (
            <div key={i.t} className="landing-feature">
              <div className="ft-title">{i.t}</div>
              <div className="ft-body">{i.b}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-hero" style={{ paddingTop: 24, paddingBottom: 48 }}>
        <p className="landing-tagline" style={{ marginTop: 0 }}>Ready to run your wing from one place?</p>
        <div className="landing-cta">
          <a className="btn-discord" href="/auth/login"><DiscordMark /> Log In with Discord</a>
        </div>
      </section>

      <footer className="landing-footer">
        READY<span className="tag">ROOM</span> — a DCS:OPT tool · VMFA-224(AW) Skunkworks
        <span className="landing-ver">{VERSION}</span>
      </footer>
    </div>
  );
}

/** Inline Discord glyph so we don't pull in an icon dependency. */
function DiscordMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.946 2.419-2.157 2.419Z" />
    </svg>
  );
}
