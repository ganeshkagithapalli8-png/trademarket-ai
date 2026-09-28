import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Input, Logo, Icon, Alert, Badge } from '../components/ui.jsx';
import { Auth as AuthApi } from '../lib/api.js';

const today = () => new Date().toISOString().slice(0, 10);
const minDob = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
};

export default function AuthPage() {
  const [params] = useSearchParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { login, signup } = useAuth();
  const toast = useToast();
  const { adopt } = useAuth();
  const [demoBusy, setDemoBusy] = useState(false);

  const startDemo = async () => {
    setDemoBusy(true);
    try {
      const r = await AuthApi.demo();
      await adopt(r.token, r.user);
      nav('/app');
    } catch (e) {
      setError(e.message);
    } finally {
      setDemoBusy(false);
    }
  };

  const [mode, setMode] = useState(params.get('mode') === 'signup' ? 'signup' : 'login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showPw, setShowPw] = useState(false);
  const [form, setForm] = useState({
    email: '', password: '', fullName: '', dateOfBirth: '', confirm: '',
  });

  useEffect(() => {
    setMode(params.get('mode') === 'signup' ? 'signup' : 'login');
  }, [params]);

  useEffect(() => {
    setError(null);
  }, [mode]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const age = useMemo(() => {
    if (!form.dateOfBirth) return null;
    const d = new Date(form.dateOfBirth);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
    return a;
  }, [form.dateOfBirth]);

  const pwStrength = useMemo(() => {
    const p = form.password;
    let s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (/[0-9]/.test(p)) s++;
    if (/[a-zA-Z]/.test(p) && /[^a-zA-Z0-9]/.test(p)) s++;
    return { score: s, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][s] };
  }, [form.password]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    if (mode === 'signup') {
      if (form.fullName.trim().length < 2) return setError('Please enter your full name.');
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(form.email)) return setError('Please enter a valid email address.');
      if (form.password.length < 8) return setError('Password must be at least 8 characters.');
      if (!/[0-9]/.test(form.password) || !/[a-zA-Z]/.test(form.password)) return setError('Password needs at least one letter and one number.');
      if (form.password !== form.confirm) return setError('Passwords do not match.');
      if (!age || age < 18) return setError('You must be 18 or older. Indian trading and demat accounts legally require 18+, so this cannot be lowered.');
    } else if (!form.email || !form.password) {
      return setError('Enter your email and password.');
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        await signup({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          fullName: form.fullName.trim(),
          dateOfBirth: form.dateOfBirth,
        });
        toast.success('Welcome to TradeMarket AI', 'Start at module 1 — the path is sequential for a reason.');
      } else {
        await login({ email: form.email.trim().toLowerCase(), password: form.password });
        toast.success('Signed in', loc.state?.expired ? 'Your previous session had expired.' : undefined);
      }
      nav(loc.state?.from && loc.state.from.startsWith('/app') ? loc.state.from : '/app', { replace: true });
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-200/30 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-emerald-200/25 blur-3xl" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo className="h-9 w-9" />
          <span className="text-[15px] font-extrabold tracking-tight text-slate-900">
            TradeMarket<span className="text-brand-600"> AI</span>
          </span>
        </Link>
        <Link to="/" className="text-[13px] font-semibold text-slate-500 transition hover:text-slate-800">← Home</Link>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-6">
        <div className="mb-5 text-center">
          <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">
            {mode === 'signup'
              ? 'Free, and your wallet is simulated rupees from the very first click.'
              : 'Sign in to pick up where you left off — on any device.'}
          </p>
        </div>

        <div className="glass-panel p-5 sm:p-6">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100/90 p-1">
            {['login', 'signup'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-lg py-2 text-[13.5px] font-bold transition-all ${
                  mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Sign up'}
              </button>
            ))}
          </div>

          {loc.state?.expired && mode === 'login' && (
            <Alert tone="warn" className="mb-4">Your session expired. Sign in again to continue.</Alert>
          )}

          {error && (
            <Alert tone="danger" className="mb-4">
              <span className="break-words">{error}</span>
            </Alert>
          )}

          <Button size="lg" className="w-full" icon="zap" loading={demoBusy} onClick={startDemo} data-testid="guest-button">
            {demoBusy ? 'Opening guest session…' : 'Continue as guest — no email needed'}
          </Button>
          <p className="mt-1.5 text-center text-[11px] leading-snug text-slate-400">
            Instant paper account, saved in this browser. Upgrade to an email account any time.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <span className="divider flex-1" />
            <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-slate-400">or use an email</span>
            <span className="divider flex-1" />
          </div>

          <form onSubmit={submit} className="space-y-3.5" noValidate>
            {mode === 'signup' && (
              <Input
                label="Full name"
                icon="settings"
                placeholder="Priya Sharma"
                autoComplete="name"
                value={form.fullName}
                onChange={set('fullName')}
                maxLength={120}
              />
            )}

            <Input
              label="Email"
              type="email"
              icon="send"
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
              value={form.email}
              onChange={set('email')}
              maxLength={254}
            />

            {mode === 'signup' && (
              <Input
                label="Date of birth"
                type="date"
                max={minDob()}
                value={form.dateOfBirth}
                onChange={set('dateOfBirth')}
                hint={
                  age === null
                    ? 'Required for age verification. You must be 18 or older.'
                    : age < 18
                      ? `That makes you ${age}. The minimum is 18 — Indian trading accounts legally require it.`
                      : `Age ${age} — verified.`
                }
                error={age !== null && age < 18 ? 'You must be 18 or older to use this app.' : undefined}
              />
            )}

            <div>
              <Input
                label="Password"
                type={showPw ? 'text' : 'password'}
                icon="lock"
                placeholder={mode === 'signup' ? 'At least 8 characters, with a number' : 'Your password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={form.password}
                onChange={set('password')}
                maxLength={128}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="flex items-center gap-1 text-[11.5px] font-semibold text-slate-500 transition hover:text-slate-800"
                >
                  <Icon name="eye" className="h-3.5 w-3.5" /> {showPw ? 'Hide' : 'Show'}
                </button>
                {mode === 'signup' && form.password && (
                  <>
                    <div className="flex h-1.5 flex-1 gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className={`h-full flex-1 rounded-full transition-colors ${
                            i < pwStrength.score
                              ? pwStrength.score <= 1 ? 'bg-rose-400' : pwStrength.score === 2 ? 'bg-amber-400' : 'bg-emerald-500'
                              : 'bg-slate-200'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] font-bold text-slate-500">{pwStrength.label}</span>
                  </>
                )}
              </div>
            </div>

            {mode === 'signup' && (
              <Input
                label="Confirm password"
                type={showPw ? 'text' : 'password'}
                icon="lock"
                placeholder="Repeat it"
                autoComplete="new-password"
                value={form.confirm}
                onChange={set('confirm')}
                error={form.confirm && form.confirm !== form.password ? 'Passwords do not match.' : undefined}
                maxLength={128}
              />
            )}

            <Button type="submit" size="lg" className="mt-1 w-full" loading={busy} iconRight={busy ? undefined : 'arrowRight'}>
              {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-3 text-center text-[11px] leading-snug text-slate-400">
            ₹5,00,000 simulated · every market unlocked · nothing real, ever
          </p>

          <p className="mt-4 text-center text-[12.5px] text-slate-500">
            {mode === 'signup' ? 'Already have an account? ' : 'New here? '}
            <button onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')} className="link">
              {mode === 'signup' ? 'Sign in' : 'Create one'}
            </button>
          </p>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3.5 py-3">
            <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" stroke={2.2} />
            <p className="text-[11.5px] leading-relaxed text-amber-900">
              <span className="font-bold">Simulated money only.</span> Your password is hashed with bcrypt and stored
              server-side. No payment details are ever collected, and this app cannot place a real order.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            <Badge tone="neutral">18+ only</Badge>
            <Badge tone="neutral">bcrypt hashed</Badge>
            <Badge tone="neutral">Cross-device sessions</Badge>
            <Badge tone="neutral">No card details</Badge>
          </div>
        </div>
      </main>

      <footer className="relative z-10 px-4 pb-6 text-center">
        <p className="mx-auto max-w-md text-[11px] leading-relaxed text-slate-400">
          Educational software, not a broker or investment adviser. Not registered with SEBI. Prices are simulated.
        </p>
      </footer>
    </div>
  );
}
