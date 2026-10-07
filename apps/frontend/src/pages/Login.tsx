import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type ApiError } from '../api';
import { useAuth } from '../auth';
import { canAccess, defaultRouteFor, isRole } from '../navigation';
import { Logo } from '../components/Logo';
import { Button, Card } from '../components/ui';

const DEMO_ACCOUNTS = [
  { role: 'Student', email: 'student@classquest.example', password: 'DemoStudent123!' },
  { role: 'Teacher', email: 'teacher@classquest.example', password: 'DemoTeacher123!' },
  { role: 'Admin', email: 'admin@classquest.example', password: 'DemoAdmin123!' },
];

/**
 * Whether to show the static demo-account hint. The backend's DEMO_MODE is not
 * exposed to the browser, so: an explicit build flag (VITE_DEMO_MODE) wins;
 * otherwise infer it from the public /health cloudTarget — DEMO_MODE defaults
 * to on exactly when the target is LocalStack.
 */
function useDemoHint(): boolean {
  const flag = import.meta.env.VITE_DEMO_MODE;
  const [show, setShow] = useState(flag === 'true');
  useEffect(() => {
    if (flag === 'true' || flag === 'false') return;
    let cancelled = false;
    api
      .health()
      .then((h) => !cancelled && setShow(h.cloudTarget === 'localstack'))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [flag]);
  return show;
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const showDemoHint = useDemoHint();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(email, password);
      if (!isRole(r.role)) throw { code: 'ERROR', message: 'Unsupported account role' } satisfies ApiError;
      login({ token: r.token, role: r.role, displayName: r.displayName });
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && canAccess(r.role, from) ? from : defaultRouteFor(r.role), { replace: true });
    } catch (err) {
      setError((err as ApiError).message ?? 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cq-login">
      <section className="cq-login__brand" aria-label="About ClassQuest">
        <div className="cq-login__brand-top">
          <Logo size={36} onDark />
          <span className="cq-sidebar__name">
            Class<span>Quest</span>
          </span>
        </div>
        <div className="cq-login__headline">
          <h2>Learning resources, delivered from the cloud.</h2>
          <p>
            Teachers publish documents, books and videos; students open them securely from anywhere.
            A three-tier AWS architecture prototype running on LocalStack.
          </p>
          <ul className="cq-login__points">
            <li>Resources stored in Amazon S3, opened via time-limited links</li>
            <li>Asynchronous processing through Amazon SQS and a worker tier</li>
            <li>CloudWatch metrics with SNS alerting for operations</li>
          </ul>
        </div>
        <p className="cq-login__foot">INFS803 research prototype · all data is synthetic DEMO/SAMPLE content</p>
      </section>

      <section className="cq-login__panel">
        <div className="cq-login__card">
          <span className="cq-eyebrow">Welcome back</span>
          <h1 className="cq-page-title" style={{ marginTop: 8 }}>Sign in</h1>
          <p className="cq-body" style={{ marginTop: 8 }}>Use your ClassQuest account to continue.</p>

          <form className="cq-login__form" onSubmit={submit} noValidate>
            <div className="cq-field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="you@school.example"
                required
              />
            </div>
            <div className="cq-field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <div className="cq-form-error" role="alert">
                {error}
              </div>
            )}
            <Button type="submit" block disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {showDemoHint && (
            <Card variant="callout" className="cq-demo-hint" aria-label="Demo accounts">
              <strong>Demo accounts (LocalStack prototype)</strong>
              <table>
                <tbody>
                  {DEMO_ACCOUNTS.map((a) => (
                    <tr key={a.email}>
                      <td>{a.role}</td>
                      <td><code>{a.email}</code></td>
                      <td><code>{a.password}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
