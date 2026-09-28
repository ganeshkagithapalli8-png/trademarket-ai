import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon, Logo, Badge, Button, Modal } from './ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useFunds } from '../context/FundsContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { money, marketSessionState, n } from '../lib/format.js';
import { SimBanner } from './SimBanner.jsx';

const NAV = [
  { to: '/app', label: 'Dashboard', icon: 'home', end: true },
  { to: '/app/markets', label: 'Markets', icon: 'chart' },
  { to: '/app/portfolio', label: 'Portfolio', icon: 'layers' },
  { to: '/app/learn', label: 'Learn', icon: 'book' },
  { to: '/app/bot', label: 'Bot Lab', icon: 'bot' },
];

const MORE = [
  { to: '/app/wallet', label: 'Wallet', icon: 'wallet', desc: 'Simulated funds' },
  { to: '/app/news', label: 'News', icon: 'news', desc: 'Live headlines' },
  { to: '/app/notes', label: 'Notes', icon: 'note', desc: 'Ideas & summaries' },
  { to: '/app/journal', label: 'Journal', icon: 'journal', desc: 'Trade psychology' },
  { to: '/app/coach', label: 'AI Coach', icon: 'spark', desc: 'Ask anything' },
  { to: '/app/settings', label: 'Settings', icon: 'settings', desc: 'Profile, risk, sessions' },
];

export default function Layout({ children }) {
  const { user, wallet, logout } = useAuth();
  const { openAddFunds } = useFunds();
  const toast = useToast();
  const loc = useLocation();
  const nav = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState(marketSessionState());
  // Seconds-accurate countdown to the next session boundary (IST).
  const countdown = (() => {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const secs = ist.getHours() * 3600 + ist.getMinutes() * 60 + ist.getSeconds();
    const open = 9 * 3600 + 15 * 60;
    const close = 15 * 3600 + 30 * 60;
    const fmt = (s) => {
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
      if (m > 0) return `${m}m ${String(ss).padStart(2, '0')}s`;
      return `${ss}s`;
    };
    if (!clock.isWeekday) return 'opens Mon 09:15 IST';
    if (secs >= open && secs <= close) return `closes in ${fmt(close - secs)}`;
    if (secs < open) return `opens in ${fmt(open - secs)}`;
    return 'opens 09:15 IST';
  })();

  useEffect(() => {
    const t = setInterval(() => setClock(marketSessionState()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setMoreOpen(false);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [loc.pathname]);

  const onMore = MORE.some((m) => loc.pathname.startsWith(m.to));

  const doLogout = async () => {
    await logout();
    toast.info('Signed out', 'Your session on this device was revoked.');
    nav('/auth', { replace: true });
  };

  const isGuest = String(user?.email || '').endsWith('@paper.trademarket');
  const initials = (user?.fullName || user?.email || '?')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-screen">
      {/* ── top bar ─────────────────────────────────────────────── */}
      <header className="glass safe-top sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:h-16 sm:px-5">
          <Link to="/app" className="flex shrink-0 items-center gap-2.5">
            <Logo className="h-8 w-8 sm:h-9 sm:w-9" />
            <span className="hidden text-[15px] font-extrabold tracking-tight text-slate-900 sm:block">
              TradeMarket<span className="text-brand-600"> AI</span>
            </span>
          </Link>

          <div className="ml-1 hidden items-center gap-2 lg:flex">
            <Badge tone={clock.isOpen ? 'up' : 'neutral'} icon={clock.isOpen ? 'zap' : 'clock'}>
              {clock.label} · {countdown}
            </Badge>
            <span className="tnum text-[11.5px] font-semibold text-slate-400">IST {clock.ist}</span>
          </div>

          <div className="flex-1" />

          <div className="hidden items-center gap-1.5 sm:flex">
            <Link
              to="/app/wallet"
              className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 transition hover:border-brand-300 hover:bg-brand-50/60"
              title="Simulated balance"
            >
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <Icon name="wallet" className="h-3.5 w-3.5" />
              </span>
              <span className="tnum text-[13.5px] font-bold text-slate-900">{money(wallet?.simBalance ?? 0, 0)}</span>
              <span className="chip bg-amber-50 text-[9.5px] text-amber-700">SIM</span>
            </Link>
            <button
              onClick={() => openAddFunds()}
              aria-label="Add simulated funds"
              title="Add simulated funds"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 active:scale-95"
            >
              <Icon name="plus" className="h-4 w-4" stroke={2.4} />
            </button>
          </div>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-[12.5px] font-bold text-white shadow-sm transition active:scale-95"
              aria-label="Account menu"
              aria-expanded={menuOpen}
            >
              {initials || <Icon name="settings" className="h-4 w-4" />}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-60 animate-scale-in overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-lift backdrop-blur-xl">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="truncate text-[13.5px] font-bold text-slate-900">{user?.fullName || 'Trader'}</p>
                    <p className="truncate text-[12px] text-slate-500">
                      {isGuest ? 'Guest session · saved in this browser' : user?.email}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {isGuest && <Badge tone="brand" icon="zap">Guest</Badge>}
                      <Badge tone={user?.ageVerified ? 'done' : 'warn'} icon={user?.ageVerified ? 'shield' : 'alert'}>
                        {user?.ageVerified ? '18+ verified' : 'Age unverified'}
                      </Badge>
                      <Badge tone="brand">{n(wallet?.simBalance ?? 0, 0)} SIM</Badge>
                    </div>
                  </div>
                  <div className="p-1.5">
                    <MenuLink to="/app/settings" icon="settings" onClick={() => setMenuOpen(false)}>Settings</MenuLink>
                    <MenuLink to="/app/wallet" icon="wallet" onClick={() => setMenuOpen(false)}>Wallet</MenuLink>
                    <button
                      onClick={() => { setMenuOpen(false); openAddFunds(); }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Icon name="plus" className="h-4 w-4 text-slate-400" /> Add simulated funds
                    </button>
                    <MenuLink to="/app/coach" icon="spark" onClick={() => setMenuOpen(false)}>AI Coach</MenuLink>
                    <button
                      onClick={async () => {
                        setMenuOpen(false);
                        await logout();
                        toast.info('Guest session closed', 'Sign in with email to keep data across devices.');
                        nav('/auth', { replace: true });
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Icon name="lock" className="h-4 w-4 text-slate-400" />
                      Switch to an email account
                    </button>
                    <button
                      onClick={doLogout}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-semibold text-rose-600 transition hover:bg-rose-50"
                    >
                      <Icon name="logout" className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <SimBanner />

      <div className="mx-auto flex max-w-7xl gap-6 px-0 sm:px-5">
        {/* ── desktop sidebar ───────────────────────────────────── */}
        <aside className="sticky top-[7.5rem] hidden h-[calc(100vh-8.5rem)] w-56 shrink-0 flex-col py-5 lg:flex">
          <nav className="space-y-1">
            {NAV.map((item) => (
              <SideLink key={item.to} {...item} />
            ))}
            <p className="px-3 pb-1.5 pt-5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Workspace</p>
            {MORE.map((item) => (
              <SideLink key={item.to} {...item} />
            ))}
          </nav>
          <div className="mt-auto rounded-2xl border border-amber-200/70 bg-amber-50/70 p-3">
            <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-amber-900">
              <Icon name="shield" className="h-3.5 w-3.5" /> Paper trading only
            </p>
            <p className="mt-1 text-[11px] leading-snug text-amber-800/80">
              Simulated rupees. No real money, no broker connection, no live orders. 18+.
            </p>
          </div>
        </aside>

        {/* ── main ──────────────────────────────────────────────── */}
        <main className="min-w-0 flex-1 px-3 pb-28 pt-4 sm:px-0 sm:pb-10 sm:pt-6">{children}</main>
      </div>

      {/* ── mobile bottom nav ───────────────────────────────────── */}
      <nav className="glass safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/70 lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between px-1.5 pt-1.5">
          {NAV.slice(0, 4).map((item) => (
            <BottomLink key={item.to} {...item} />
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition ${
              onMore ? 'text-brand-600' : 'text-slate-400'
            }`}
          >
            <Icon name="menu" className="h-[19px] w-[19px]" stroke={onMore ? 2.4 : 2} />
            <span className="text-[10px] font-semibold leading-none">More</span>
          </button>
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More" size="sm">
        <div className="grid grid-cols-2 gap-2.5">
          {MORE.map((m) => (
            <Link
              key={m.to}
              to={m.to}
              onClick={() => setMoreOpen(false)}
              className={`flex flex-col items-start gap-2 rounded-2xl border p-3.5 transition active:scale-[0.98] ${
                loc.pathname.startsWith(m.to)
                  ? 'border-brand-300 bg-brand-50/70'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className={`grid h-9 w-9 place-items-center rounded-xl ${loc.pathname.startsWith(m.to) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                <Icon name={m.icon} className="h-4.5 w-4.5" />
              </span>
              <span>
                <span className="block text-[13.5px] font-bold text-slate-900">{m.label}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">{m.desc}</span>
              </span>
            </Link>
          ))}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-3.5">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold text-slate-800">{user?.fullName}</p>
              <p className="truncate text-[11.5px] text-slate-500">{user?.email}</p>
            </div>
            <Button variant="secondary" size="sm" icon="logout" onClick={doLogout}>Sign out</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function MenuLink({ to, icon, children, onClick }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
    >
      <Icon name={icon} className="h-4 w-4" />
      {children}
    </Link>
  );
}

function SideLink({ to, label, icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition-all ${
          isActive ? 'bg-white text-brand-700 shadow-card ring-1 ring-brand-100' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon name={icon} className={`h-[18px] w-[18px] ${isActive ? 'text-brand-600' : ''}`} stroke={isActive ? 2.3 : 1.9} />
          {label}
        </>
      )}
    </NavLink>
  );
}

function BottomLink({ to, label, icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition ${
          isActive ? 'text-brand-600' : 'text-slate-400'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon name={icon} className="h-[19px] w-[19px]" stroke={isActive ? 2.4 : 2} />
          <span className="text-[10px] font-semibold leading-none">{label}</span>
        </>
      )}
    </NavLink>
  );
}
