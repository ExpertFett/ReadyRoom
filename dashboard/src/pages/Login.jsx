export default function Login() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="logo">READY<span className="tag">ROOM</span></div>
        <p className="muted">Squadron operations for the wing.</p>
        {error && <p className="error">Sign-in failed ({error}). Try again.</p>}
        <p style={{ marginTop: 24 }}>
          <a className="btn primary" href="/auth/login" style={{ display: 'inline-block' }}>
            Sign in with Discord
          </a>
        </p>
        <p className="small muted" style={{ marginTop: 16 }}>
          Local dev: <a href="/auth/dev-login">dev login</a> (only when enabled)
        </p>
      </div>
    </div>
  );
}
