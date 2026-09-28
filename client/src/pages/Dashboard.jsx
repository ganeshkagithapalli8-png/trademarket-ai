import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useFunds } from '../context/FundsContext.jsx';
import { Card, Stat, Badge, Icon, Button, SectionTitle, Skeleton, EmptyState, usePoll, Alert, Progress, Flash } from '../components/ui.jsx';
import { Donut, Sparkline, CandleChart } from '../components/Chart.jsx';
import { Trade, Learn, Bot, Market, AI, Wallet } from '../lib/api.js';
import { money, signed, pct, compact, timeAgo, n, marketSessionState, qtyStr } from '../lib/format.js';

export default function Dashboard() {
  const { user, refreshWallet } = useAuth();
  const { openAddFunds } = useFunds();
  const session = marketSessionState();

  const { data: port, loading: pLoading, refresh: refreshPort } = usePoll(() => Trade.portfolio(), 20000, []);
  const { data: road } = usePoll(() => Learn.roadmap(), 120000, []);
  const { data: bot } = usePoll(() => Bot.state(), 60000, []);
  const { data: sig } = usePoll(() => Bot.signals(5), 12000, []);
  const { data: news } = usePoll(() => Market.news('stocks'), 300000, []);
  const { data: tickers } = usePoll(() => Market.tickers('stocks'), 8000, []);
  const { data: aiStatus } = usePoll(() => AI.status(), 600000, []);

  const first = user?.fullName?.split(' ')[0] || 'there';
  const needsFunds = (port?.cash ?? 0) <= 0 && (port?.totalSimDeposits ?? 0) <= 0;
  const nextModule = road?.modules?.find((m) => m.status !== 'completed');
  const open = port?.openPositions || [];
  const indexTickers = (tickers?.tickers || []).filter((t) => t.symbol === 'NIFTY50' || t.symbol === 'SENSEX');

  return (
    <div className="space-y-5">
      {/* ── header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-semibold text-slate-500">
            {session.isOpen ? 'Market is open' : 'Market is closed'} · IST {session.ist}
          </p>
          <h1 className="mt-0.5 text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[28px]">
            Hello, {first}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/learn"><Button variant="secondary" size="sm" icon="book">Continue learning</Button></Link>
          <Link to="/app/markets"><Button size="sm" icon="chart">Trade markets</Button></Link>
        </div>
      </div>

      {!user?.ageVerified && (
        <Alert tone="warn" title="Age not verified">
          Add your date of birth in{' '}
          <Link to="/app/settings" className="font-bold underline underline-offset-2">Settings</Link> to unlock
          derivatives and forex. Indian trading accounts legally require 18+.
        </Alert>
      )}

      {/* ── equity ─────────────────────────────────────────── */}
      {pLoading && !port ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Card key={i} className="h-[92px]"><Skeleton className="h-3 w-16" /><Skeleton className="mt-3 h-6 w-24" /></Card>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Paper equity" value={money(port?.equity ?? 0, 0)} sub={`${pct(port?.returnPct ?? 0)} all-time`} tone={(port?.returnPct ?? 0) >= 0 ? 'up' : 'down'} icon="layers" className="col-span-2 lg:col-span-1" />
          <Stat label="Free cash" value={money(port?.cash ?? 0, 0)} sub={`${open.length} open position${open.length === 1 ? '' : 's'}`} icon="wallet" />
          <Stat label="Today's P&L" value={signed(port?.dayPnl ?? 0, 0)} sub={`${port?.dayTrades ?? 0} closed today`} tone={(port?.dayPnl ?? 0) >= 0 ? 'up' : (port?.dayPnl ?? 0) < 0 ? 'down' : 'flat'} icon="clock" />
          <Stat label="Unrealised" value={signed(port?.unrealizedPnl ?? 0, 0)} sub={money(port?.invested ?? 0, 0) + ' deployed'} tone={(port?.unrealizedPnl ?? 0) >= 0 ? 'up' : (port?.unrealizedPnl ?? 0) < 0 ? 'down' : 'flat'} icon="chart" />
        </div>
      )}

      {needsFunds && (
        <Card className="border-brand-200 bg-gradient-to-br from-brand-50 to-white">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white shadow-sm">
              <Icon name="wallet" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-bold text-slate-900">Fund your paper wallet to start trading</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600">
                Minimum top-up is ₹50 — of simulated rupees. Nothing real moves, and you can reset the account any time.
              </p>
            </div>
            <Button size="sm" icon="plus" onClick={() => openAddFunds(refreshPort, 100000)}>Add funds</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ── left column ──────────────────────────────────── */}
        <div className="space-y-5 lg:col-span-2">
          {/* learning progress */}
          <Card>
            <SectionTitle
              icon="book"
              title="Your path"
              subtitle={`${road?.summary?.completed ?? 0} of ${road?.summary?.total ?? 14} modules complete`}
              action={<Link to="/app/learn" className="text-[12.5px] font-bold text-brand-600 hover:text-brand-700">Open →</Link>}
            />
            <div className="flex items-center gap-4">
              <Donut value={road?.summary?.completed ?? 0} max={road?.summary?.total ?? 14} label={`${road?.summary?.pct ?? 0}%`} />
              <div className="min-w-0 flex-1">
                {nextModule ? (
                  <>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Up next · module {nextModule.step}</p>
                    <p className="mt-0.5 truncate text-[15px] font-bold text-slate-900">{nextModule.title}</p>
                    <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-slate-500">{nextModule.tagline}</p>
                    <Link to={`/app/learn/${nextModule.id}`} className="mt-2.5 inline-block">
                      <Button size="xs" icon={nextModule.status === 'locked' ? 'lock' : 'play'}>
                        {nextModule.status === 'locked' ? 'Locked' : nextModule.status === 'in_progress' ? 'Resume' : 'Start module'}
                      </Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="text-[15px] font-bold text-slate-900">Path complete 🎉</p>
                    <p className="mt-1 text-[12.5px] leading-snug text-slate-500">
                      All 14 modules done. Module 14 explains exactly why going live is a regulatory question, not a coding one.
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11.5px] font-semibold text-slate-600">Bot arming progress</p>
                <Badge tone={bot?.armable ? 'done' : 'neutral'}>
                  {bot?.armProgress ?? '0/13'}
                </Badge>
              </div>
              <Progress value={Number(bot?.armProgress?.split('/')[0] ?? 0)} max={Number(bot?.armProgress?.split('/')[1] ?? 13)} className="mt-2" />
              <p className="mt-2 text-[11px] leading-snug text-slate-500">
                {bot?.armable
                  ? 'You can arm the bot for paper trading from Bot Lab.'
                  : 'Modules 1–13 must be complete before the bot can be armed. That gate is deliberate.'}
              </p>
            </div>
          </Card>

          {/* open positions */}
          <Card pad={false}>
            <div className="p-4 pb-3 sm:p-5 sm:pb-3">
              <SectionTitle
                icon="layers"
                title="Open positions"
                subtitle={open.length ? `${open.length} live on paper` : 'Nothing open'}
                action={<Link to="/app/portfolio" className="text-[12.5px] font-bold text-brand-600 hover:text-brand-700">All →</Link>}
              />
            </div>
            {open.length === 0 ? (
              <EmptyState
                icon="chart"
                title="No open positions"
                message="Pick an instrument from Markets, or let the bot find setups once you have armed it in Bot Lab."
                action={<Link to="/app/markets"><Button size="sm" icon="plus">Browse markets</Button></Link>}
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {open.slice(0, 5).map((p) => (
                  <Link
                    key={p.id}
                    to={`/app/trade/${p.symbol}`}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 sm:px-5"
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[11px] font-bold ${p.side === 'long' ? 'bg-up-soft text-up-deep' : 'bg-down-soft text-down-deep'}`}>
                      {p.side === 'long' ? 'L' : 'S'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-bold text-slate-900">{p.symbol}</p>
                      <p className="tnum mt-0.5 text-[11.5px] text-slate-500">
                        {qtyStr(p.qty)} @ {money(p.entryPrice)}
                        {p.openedBy === 'bot' && <span className="ml-1.5 text-brand-600">· bot</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`tnum text-[13.5px] font-bold ${p.unrealizedPnl >= 0 ? 'text-up-deep' : 'text-down-deep'}`}>
                        {signed(p.unrealizedPnl, 0)}
                      </p>
                      <p className={`tnum text-[11px] font-semibold ${p.unrealizedPct >= 0 ? 'text-up-deep/80' : 'text-down-deep/80'}`}>
                        {pct(p.unrealizedPct)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* bot signals */}
          <Card pad={false}>
            <div className="p-4 pb-3 sm:p-5 sm:pb-3">
              <SectionTitle
                icon="bot"
                title="Bot signals right now"
                subtitle={sig?.mlActive ? 'ML filter active on entry features' : 'Deterministic setups · ML filter needs 15 closed trades'}
                action={
                  <span className="flex items-center gap-2">
                    {bot?.armed && (
                      <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-emerald-700">
                        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500" /> LIVE
                      </span>
                    )}
                    <Link to="/app/bot" className="text-[12.5px] font-bold text-brand-600 hover:text-brand-700">Bot Lab →</Link>
                  </span>
                }
              />
            </div>
            {!sig?.signals?.length ? (
              <EmptyState
                icon="target"
                title="No setups qualify right now"
                message="That is the correct answer most of the time. A strategy that always finds a trade is a strategy with no filter."
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {sig.signals.map((s) => (
                  <Link key={`${s.symbol}-${s.setup}`} to={`/app/trade/${s.symbol}`} className="animate-slide-in block px-4 py-3 transition hover:bg-slate-50 sm:px-5">
                    <div className="flex items-center gap-3">
                      <Badge tone={s.side === 'long' ? 'up' : 'down'} icon={s.side === 'long' ? 'arrowUp' : 'arrowDown'}>
                        {s.side === 'long' ? 'LONG' : 'SHORT'}
                      </Badge>
                      <p className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-slate-900">{s.symbol}</p>
                      <p className="tnum shrink-0 text-[13px] font-bold text-slate-700">{money(s.price)}</p>
                      <Badge tone="brand">{Math.round((s.confidence ?? 0) * 100)}%</Badge>
                    </div>
                    <p className="mt-1.5 line-clamp-2 pl-0.5 text-[12px] leading-snug text-slate-500">
                      <span className="font-semibold text-slate-600">{s.setupLabel}:</span> {s.reason}
                      {s.mlScore != null && <span className="text-brand-600"> · ML {s.mlScore}</span>}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── right column ─────────────────────────────────── */}
        <div className="space-y-5">
          {/* index snapshot */}
          {indexTickers.length > 0 && (
            <Card pad={false}>
              <div className="p-4 pb-2 sm:p-5 sm:pb-2">
                <SectionTitle icon="zap" title="Indices" subtitle="Simulated prices" />
              </div>
              <div className="space-y-1 px-2 pb-3 sm:px-3">
                {indexTickers.map((t) => (
                  <Link key={t.symbol} to={`/app/trade/${t.symbol}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-slate-900">{t.symbol}</p>
                      <p className={`tnum text-[11.5px] font-semibold ${t.changePct >= 0 ? 'text-up-deep' : 'text-down-deep'}`}>
                        <Flash value={t.price}>{compact(t.price)}</Flash> · {pct(t.changePct)}
                      </p>
                    </div>
                    <Sparkline points={[t.low, t.open, (t.low + t.high) / 2, t.high, t.price]} tone={t.changePct >= 0 ? '#10B981' : '#F43F5E'} />
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {/* news */}
          <Card pad={false}>
            <div className="p-4 pb-3 sm:p-5 sm:pb-3">
              <SectionTitle
                icon="news"
                title="Latest news"
                subtitle={news?.live ? `Live · ${timeAgo(news.fetchedAt)}` : 'Feed unavailable right now'}
                action={<Link to="/app/news" className="text-[12.5px] font-bold text-brand-600 hover:text-brand-700">All →</Link>}
              />
            </div>
            <div className="divide-y divide-slate-100">
              {(news?.items || []).slice(0, 5).map((it, i) => (
                <a
                  key={i}
                  href={it.link || '#'}
                  target={it.link ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  className="block px-4 py-2.5 transition hover:bg-slate-50 sm:px-5"
                >
                  <p className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-slate-800">{it.title}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{it.source} · {timeAgo(it.publishedAt)}</p>
                </a>
              ))}
              {!news?.items?.length && (
                <div className="px-4 py-6 sm:px-5">
                  <Skeleton className="h-3 w-full" /><Skeleton className="mt-2 h-3 w-4/5" /><Skeleton className="mt-4 h-3 w-full" />
                </div>
              )}
            </div>
          </Card>

          {/* AI coach */}
          <Card className="relative overflow-hidden">
            <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-brand-100/60 blur-2xl" />
            <div className="relative">
              <SectionTitle
                icon="spark"
                title="AI coach"
                subtitle={aiStatus?.configured ? 'Gemini is connected on the server' : 'Add GEMINI_API_KEY to enable'}
              />
              <p className="text-[12.5px] leading-relaxed text-slate-600">
                Ask it to explain a concept, summarise a note, coach a journal entry or read a chart. It will never tell
                you what to buy — that is deliberate.
              </p>
              <Link to="/app/coach" className="mt-3.5 block">
                <Button size="sm" className="w-full" icon="spark" disabled={!aiStatus?.configured}>
                  {aiStatus?.configured ? 'Ask the coach' : 'AI not configured'}
                </Button>
              </Link>
            </div>
          </Card>

          {/* quick stats */}
          <Card>
            <SectionTitle icon="target" title="Track record" subtitle="Closed paper trades" />
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: 'Trades', v: port?.closedTrades ?? 0 },
                { l: 'Win rate', v: `${port?.winRate ?? 0}%` },
                { l: 'Realised', v: compact(port?.realizedPnl ?? 0) },
              ].map((s) => (
                <div key={s.l} className="rounded-xl bg-slate-50 px-2 py-2.5 text-center">
                  <p className="tnum text-[15px] font-bold text-slate-900">{s.v}</p>
                  <p className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{s.l}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-snug text-slate-500">
              Under ~100 closed trades these numbers are noise, not signal. Keep going.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
