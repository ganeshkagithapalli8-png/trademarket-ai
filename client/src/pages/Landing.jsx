import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo, Icon, Button, Badge } from '../components/ui.jsx';
import { SimBanner } from '../components/SimBanner.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Auth } from '../lib/api.js';

const PATH = [
  'Trading Basics', 'Candlesticks + Price Action', 'Support / Resistance + Trends', 'Risk Management',
  'One Trading Strategy', 'Backtesting', 'Python Basics', 'Pandas + NumPy', 'Machine Learning',
  'Build the AI Bot', 'Backtest the Bot', 'Paper Trade', 'Improve + Monitor', 'Only Then Consider Live',
];

const FEATURES = [
  { icon: 'book', title: 'A 14-module path, gated', body: 'You cannot skip ahead. Risk Management unlocks derivatives; the first thirteen modules unlock the bot. The sequencing is the product.' },
  { icon: 'bot', title: 'A bot that actually learns', body: 'Every closed trade is written to memory with its entry-time features. Per-setup expectancy is recomputed and an online logistic scorer filters future entries. Inspectable, not a black box.' },
  { icon: 'shield', title: 'Risk gate before every order', body: 'Position size from risk %, portfolio heat cap, max open positions, daily loss limit, kill switch. The gate can refuse a trade — and routinely does.' },
  { icon: 'chart', title: 'Five markets on paper', body: 'Indian equities, F&O, IPO/GMP, crypto and INR forex pairs. Realistic candles, ATR stops, slippage and cost assumptions on every simulated fill.' },
  { icon: 'spark', title: 'Gemini as a tutor, not a trader', body: 'Summarise notes, coach your journal, brief you on the news, read a chart. The AI key stays on the server and the AI never generates an order.' },
  { icon: 'news', title: 'Live headlines', body: 'Moneycontrol, ET Markets and CoinDesk feeds pulled server-side and refreshed continuously, with an AI briefing on demand.' },
];

export default function Landing() {
  const nav = useNavigate();
  const { adopt } = useAuth();
  const toast = useToast();
  const [demoBusy, setDemoBusy] = useState(false);

  // One click from marketing page to a live, funded paper account.
  const startDemo = async () => {
    setDemoBusy(true);
    try {
      const r = await Auth.demo();
      await adopt(r.token, r.user);
      nav('/app');
    } catch (e) {
      toast.error('Could not open the demo', e.message);
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SimBanner />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo className="h-9 w-9" />
          <span className="text-[15px] font-extrabold tracking-tight text-slate-900">
            TradeMarket<span className="text-brand-600"> AI</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/auth" className="hidden sm:block">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link to="/auth?mode=signup">
            <Button size="sm" iconRight="arrowRight">Get started</Button>
          </Link>
        </div>
      </header>

      {/* ── hero ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Badge tone="brand" icon="layers" className="mb-4">
              14 modules · 5 markets · paper trading
            </Badge>
            <h1 className="text-balance text-[34px] font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-[52px]">
              Learn to trade properly.
              <span className="mt-1.5 block bg-gradient-to-r from-brand-600 via-brand-500 to-emerald-500 bg-clip-text text-transparent">
                Prove it before you risk anything.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-slate-600 sm:text-[17px]">
              Most people go straight to live money and lose it. TradeMarket AI makes you walk the whole path first —
              basics, price action, risk, one strategy, backtesting, Python, ML — then builds a bot that learns from
              every win and loss <span className="font-semibold text-slate-800">on simulated rupees</span>.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/auth?mode=signup">
                <Button size="lg" iconRight="arrowRight">Start the path — free</Button>
              </Link>
              <Link to="/auth">
                <Button size="lg" variant="secondary" icon="play">I have an account</Button>
              </Link>
              <Button size="lg" variant="ghost" icon="spark" loading={demoBusy} onClick={startDemo}>
                Explore a funded demo
              </Button>
            </div>
            <p className="mt-2.5 text-[11.5px] text-slate-400">
              The demo opens a paper account with ₹5,00,000 simulated and the full curriculum unlocked — one click, no form.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] font-semibold text-slate-500">
              <span className="flex items-center gap-1.5"><Icon name="check" className="h-3.5 w-3.5 text-emerald-500" stroke={2.8} /> No real money, ever</span>
              <span className="flex items-center gap-1.5"><Icon name="check" className="h-3.5 w-3.5 text-emerald-500" stroke={2.8} /> No broker connection</span>
              <span className="flex items-center gap-1.5"><Icon name="check" className="h-3.5 w-3.5 text-emerald-500" stroke={2.8} /> 18+ only</span>
            </div>
          </div>

          {/* path preview */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-brand-200/40 via-transparent to-emerald-200/30 blur-2xl" />
            <div className="glass-panel relative p-4 sm:p-5">
              <div className="mb-3.5 flex items-center justify-between">
                <p className="text-[13px] font-bold text-slate-800">The path</p>
                <Badge tone="neutral">sequential · gated</Badge>
              </div>
              <ol className="space-y-1">
                {PATH.map((p, i) => {
                  const last = i === PATH.length - 1;
                  return (
                    <li
                      key={p}
                      className={`flex items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-[12.5px] transition ${
                        last ? 'bg-amber-50 font-bold text-amber-900 ring-1 ring-amber-200' : i < 4 ? 'bg-brand-50/70 font-semibold text-brand-900' : 'text-slate-600'
                      }`}
                    >
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10px] font-bold ${
                        last ? 'bg-amber-500 text-white' : i < 4 ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {i + 1}
                      </span>
                      <span className="truncate">{p}</span>
                      {last && <Icon name="lock" className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-600" />}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[11.5px] leading-snug text-slate-500">
                Module 14 is knowledge, not a feature. This app has no live trading — going live in India requires a
                SEBI-registered broker's approved API on your own account, at 18+.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── features ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card group p-5 transition hover:-translate-y-0.5 hover:shadow-lift">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600 transition group-hover:from-brand-500 group-hover:to-brand-700 group-hover:text-white">
                <Icon name={f.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-3.5 text-[15px] font-bold text-slate-900">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── the honest bit ───────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card">
          <div className="grid lg:grid-cols-2">
            <div className="border-b border-slate-100 p-6 sm:p-8 lg:border-b-0 lg:border-r">
              <Badge tone="done" icon="check">What this is</Badge>
              <ul className="mt-4 space-y-2.5">
                {[
                  'A simulated trading environment with realistic candles, slippage and costs',
                  'A structured curriculum with server-side graded quizzes',
                  'A deterministic strategy engine plus a transparent learning layer',
                  'Backtesting with honest fills — next bar open, never the signal bar close',
                  'An AI tutor for explanation, summarisation and journal coaching',
                ].map((t) => (
                  <li key={t} className="flex gap-2.5 text-[13.5px] leading-relaxed text-slate-700">
                    <Icon name="check" className="mt-1 h-4 w-4 shrink-0 text-emerald-500" stroke={2.6} />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-rose-50/40 p-6 sm:p-8">
              <Badge tone="down" icon="x">What this is not</Badge>
              <ul className="mt-4 space-y-2.5">
                {[
                  'Not a place to deposit real money — the wallet is simulated INR only',
                  'Not connected to any broker; there is no order-routing code in the project',
                  'Not investment advice, and the AI is instructed never to give any',
                  'Not a get-rich product — most retail F&O traders lose money',
                  'Not for under-18s; Indian trading accounts legally require 18+',
                ].map((t) => (
                  <li key={t} className="flex gap-2.5 text-[13.5px] leading-relaxed text-slate-700">
                    <Icon name="x" className="mt-1 h-4 w-4 shrink-0 text-rose-500" stroke={2.6} />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-slate-900 px-6 py-12 text-center shadow-lift sm:px-12">
          <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-10 h-72 w-72 rounded-full bg-emerald-400/15 blur-3xl" />
          <h2 className="relative text-balance text-[26px] font-extrabold leading-tight text-white sm:text-[36px]">
            Start at module 1. Finish on paper.
          </h2>
          <p className="relative mx-auto mt-3 max-w-lg text-[14.5px] leading-relaxed text-brand-100">
            Free to use. Your simulated wallet starts at ₹0 and the minimum top-up is ₹50 — of pretend money.
          </p>
          <div className="relative mt-7 flex justify-center">
            <Link to="/auth?mode=signup">
              <Button size="lg" variant="onDark" iconRight="arrowRight">
                Create your account
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white/60">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2.5">
              <Logo className="h-7 w-7" />
              <span className="text-[13.5px] font-bold text-slate-800">TradeMarket AI</span>
            </div>
            <p className="max-w-xl text-[11.5px] leading-relaxed text-slate-500">
              Educational software. Simulated prices and simulated capital. Not a broker, not an investment adviser,
              not registered with SEBI, and not offering any real trading service. Derivatives and leveraged forex carry
              substantial risk of loss. Users must be 18 or older.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
