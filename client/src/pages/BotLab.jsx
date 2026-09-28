import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, Badge, Icon, Button, Alert, Input, Select, Toggle, SectionTitle, EmptyState,
  Skeleton, Confirm, Modal, Progress, usePoll, Spinner,
} from '../components/ui.jsx';
import { AreaChart } from '../components/Chart.jsx';
import { Bot, Learn } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { money, signed, pct, n, compact, timeAgo, dateTime, titleCase } from '../lib/format.js';

export default function BotLab() {
  const toast = useToast();
  const { data: st, loading, refresh } = usePoll(() => Bot.state(), 30000, []);
  const { data: learn } = usePoll(() => Bot.learning(), 30000, []);
  const { data: mem } = usePoll(() => Bot.memory(30), 30000, []);
  const { data: sig, refresh: refreshSig } = usePoll(() => Bot.signals(10), 45000, []);
  const { data: catalogue } = usePoll(() => Bot.setups(), 600000, []);

  const [bt, setBt] = useState({ symbol: 'RELIANCE', setup: 'trend-pullback', interval: '15m', bars: 400, capital: 100000, riskPerTrade: 1, stopMultiple: 1.5, targetMultiple: 2 });
  const [btResult, setBtResult] = useState(null);
  const [btBusy, setBtBusy] = useState(false);
  const [confirmArm, setConfirmArm] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);

  useEffect(() => {
    if (st?.risk) setBt((b) => ({ ...b, riskPerTrade: st.risk.riskPerTrade }));
  }, [st?.risk?.riskPerTrade]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !st) {
    return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Card className="h-48" /><Card className="h-64" /></div>;
  }

  const doArm = async () => {
    setBusy(true);
    try {
      const r = await Bot.arm(true);
      toast.success('Bot armed', r.message);
      setConfirmArm(false);
      refresh();
    } catch (e) {
      toast.error('Cannot arm yet', e.message);
      setConfirmArm(false);
    } finally {
      setBusy(false);
    }
  };

  const doDisarm = async () => {
    setBusy(true);
    try {
      await Bot.arm(false);
      toast.info('Bot disarmed', 'Open positions are still managed for stops and targets.');
      refresh();
    } catch (e) {
      toast.error('Could not disarm', e.message);
    } finally {
      setBusy(false);
    }
  };

  const doKill = async () => {
    setBusy(true);
    try {
      const r = await Bot.killSwitch(true);
      toast.warn('Kill switch ON', r.message);
      setConfirmKill(false);
      refresh();
    } catch (e) {
      toast.error('Kill switch failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (v) => {
    try {
      await Bot.config({ enabled: v });
      toast.success(v ? 'Bot running' : 'Bot paused', v ? 'It will scan for setups every cycle.' : 'Open positions are still managed.');
      refresh();
    } catch (e) {
      toast.error('Could not change state', e.message);
    }
  };

  const toggleSetup = async (id, disabled) => {
    try {
      await Bot.config({ setups: { [id]: { disabled } } });
      refresh();
    } catch (e) {
      toast.error('Could not update setups', e.message);
    }
  };

  const saveRisk = async (patch) => {
    try {
      await Bot.config(patch);
      refresh();
    } catch (e) {
      toast.error('Could not save', e.message);
    }
  };

  const runBacktest = async () => {
    setBtBusy(true);
    setBtResult(null);
    try {
      const r = await Bot.backtest(bt);
      setBtResult(r);
      toast.info(`Backtest done · ${r.trades} trades`, r.verdict?.text?.slice(0, 90));
    } catch (e) {
      toast.error('Backtest failed', e.message);
    } finally {
      setBtBusy(false);
    }
  };

  const runNow = async () => {
    setRunBusy(true);
    try {
      const r = await Bot.run();
      toast.success('Cycle complete', `${r.exits ?? 0} exits · ${r.entries ?? 0} new entries${r.skipped ? ` · skipped: ${r.skipped}` : ''}`);
      refresh();
      refreshSig();
    } catch (e) {
      toast.error('Cycle failed', e.message);
    } finally {
      setRunBusy(false);
    }
  };

  const armPct = st?.armProgress ? Number(st.armProgress.split('/')[0]) : 0;
  const armTotal = st?.armProgress ? Number(st.armProgress.split('/')[1]) : 13;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">Bot Lab</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-500">
            A deterministic strategy engine that learns from its own closed paper trades. Signals come from indicator
            maths — never from an LLM, which cannot be backtested or audited.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon="play" loading={runBusy} onClick={runNow}>Run a cycle now</Button>
      </div>

      <Alert tone="warn" title="Simulated capital only">
        This bot has no broker connection and no ability to place a real order. There is no order-routing code in this
        project. Every fill is paper, every rupee is pretend.
      </Alert>

      {/* ── control panel ──────────────────────────────────── */}
      <Card>
        <SectionTitle icon="bot" title="Control" subtitle={st?.lastRunAt ? `Last cycle ${timeAgo(st.lastRunAt)}` : 'No cycle run yet'} />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className={`rounded-2xl border p-4 ${st?.armed ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-500">Armed</p>
              <Badge tone={st?.armed ? 'done' : 'neutral'} icon={st?.armed ? 'check' : 'lock'}>{st?.armed ? 'Yes' : 'No'}</Badge>
            </div>
            <p className="mt-2 text-[13px] font-bold text-slate-900">
              {st?.armed ? 'Cleared for paper trading' : `Roadmap ${st?.armProgress ?? '0/13'}`}
            </p>
            {!st?.armed && <Progress value={armPct} max={armTotal} className="mt-2.5" />}
            <div className="mt-3">
              {st?.armed ? (
                <Button size="sm" variant="secondary" className="w-full" icon="lock" loading={busy} onClick={doDisarm}>Disarm</Button>
              ) : (
                <Button size="sm" className="w-full" icon="shield" disabled={!st?.armable} onClick={() => setConfirmArm(true)}>
                  {st?.armable ? 'Arm the bot' : `${st?.missingModules?.length ?? 13} modules left`}
                </Button>
              )}
            </div>
            {!st?.armable && !st?.armed && (
              <Link to="/app/learn" className="mt-2 block text-center text-[11.5px] font-bold text-brand-600 hover:text-brand-700">
                Continue the path →
              </Link>
            )}
          </div>

          <div className={`rounded-2xl border p-4 ${st?.enabled ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-500">Running</p>
              <span className={`h-2.5 w-2.5 rounded-full ${st?.enabled ? 'animate-pulse-soft bg-emerald-500' : 'bg-slate-300'}`} />
            </div>
            <p className="mt-2 text-[13px] font-bold text-slate-900">{st?.enabled ? 'Scanning every cycle' : 'Paused'}</p>
            <p className="mt-1 text-[11.5px] leading-snug text-slate-500">
              Stops and targets are checked continuously whether or not new entries are enabled.
            </p>
            <div className="mt-3">
              <Toggle checked={Boolean(st?.enabled)} onChange={toggleEnabled} disabled={!st?.armed} label={st?.armed ? 'Take new entries' : 'Arm first'} />
            </div>
          </div>

          <div className={`rounded-2xl border p-4 ${st?.killSwitch ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-500">Kill switch</p>
              <Badge tone={st?.killSwitch ? 'down' : 'neutral'}>{st?.killSwitch ? 'ENGAGED' : 'Off'}</Badge>
            </div>
            <p className="mt-2 text-[13px] font-bold text-slate-900">{st?.killSwitch ? 'Everything flattened' : 'Ready'}</p>
            <p className="mt-1 text-[11.5px] leading-snug text-slate-500">
              Engaging closes all open positions immediately and disables the bot.
            </p>
            <div className="mt-3">
              {st?.killSwitch ? (
                <Button size="sm" variant="secondary" className="w-full" icon="play" loading={busy} onClick={async () => { await Bot.killSwitch(false); toast.info('Kill switch released'); refresh(); }}>
                  Release
                </Button>
              ) : (
                <Button size="sm" variant="danger" className="w-full" icon="stop" onClick={() => setConfirmKill(true)}>Engage</Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ── left: risk + setups + signals ─────────────────── */}
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <SectionTitle icon="shield" title="Risk gate" subtitle="Every candidate order passes through this. It can — and should — refuse trades." />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Risk per trade (%)" type="number" step="0.1" min="0.1" max="5" inputMode="decimal"
                defaultValue={st?.risk?.riskPerTrade ?? 1}
                onBlur={(e) => saveRisk({ riskPerTrade: Number(e.target.value) })}
                hint="0.1 – 5% of capital"
              />
              <Input
                label="Daily loss limit (%)" type="number" step="0.5" min="0.5" max="20" inputMode="decimal"
                defaultValue={st?.risk?.maxDailyLoss ?? 3}
                onBlur={(e) => saveRisk({ maxDailyLoss: Number(e.target.value) })}
                hint="No new entries after this"
              />
              <Input
                label="Max open positions" type="number" step="1" min="1" max="10" inputMode="numeric"
                defaultValue={st?.risk?.maxOpenPositions ?? 3}
                onBlur={(e) => saveRisk({ maxOpenPositions: Number(e.target.value) })}
                hint="Caps portfolio heat"
              />
            </div>
            <div className="mt-3.5 rounded-xl bg-slate-50 px-3.5 py-3">
              <p className="text-[11.5px] leading-relaxed text-slate-600">
                <span className="font-bold">Also enforced server-side:</span> no second position in the same symbol,
                notional capped at 34% of capital, size derived from 1.5 × ATR so risk per trade stays constant across
                instruments, and a rejected order is logged rather than silently dropped.
              </p>
            </div>
          </Card>

          <Card pad={false}>
            <div className="p-4 pb-3 sm:p-5 sm:pb-3">
              <SectionTitle
                icon="target"
                title="Setups"
                subtitle={sig?.mlActive ? 'ML filter active on 10 entry features' : `Deterministic only — ML filter needs 15 closed trades (you have ${st?.tradesSeen ?? 0})`}
              />
            </div>
            <div className="divide-y divide-slate-100">
              {(catalogue?.setups || []).map((s) => {
                const learned = st?.setups?.[s.id];
                const disabled = Boolean(learned?.disabled);
                return (
                  <div key={s.id} className="px-4 py-3.5 sm:px-5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13.5px] font-bold text-slate-900">{s.label}</p>
                          {learned?.n > 0 && (
                            <Badge tone={learned.avgR > 0 ? 'up' : 'down'}>
                              {learned.wins ?? 0}W/{learned.losses ?? 0}L · avg {learned.avgR >= 0 ? '+' : ''}{Number(learned.avgR ?? 0).toFixed(2)}R
                            </Badge>
                          )}
                          {learned?.n >= 10 && (
                            <Badge tone={learned.weight > 1 ? 'up' : learned.weight < 0.7 ? 'warn' : 'neutral'}>
                              weight {Number(learned.weight).toFixed(2)}
                            </Badge>
                          )}
                          {disabled && <Badge tone="locked">disabled</Badge>}
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{s.description}</p>
                        {learned?.n > 0 && (
                          <p className="mt-1.5 text-[11px] text-slate-400">
                            {learned.n} sample{learned.n === 1 ? '' : 's'}
                            {learned.n < 10 ? ' — below 10, so the weight stays at 1.00. Adjusting on a tiny sample is just fitting noise.' : ' — weight is now driven by measured expectancy.'}
                          </p>
                        )}
                      </div>
                      <div className="w-28 shrink-0">
                        <Toggle checked={!disabled} onChange={(v) => toggleSetup(s.id, !v)} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card pad={false}>
            <div className="p-4 pb-3 sm:p-5 sm:pb-3">
              <SectionTitle
                icon="zap"
                title="Live signals"
                subtitle="What the engine sees right now across your enabled markets"
                action={<Button size="xs" variant="ghost" icon="refresh" onClick={refreshSig}>Refresh</Button>}
              />
            </div>
            {!sig?.signals?.length ? (
              <EmptyState
                icon="target"
                title="No setup qualifies right now"
                message="This is the correct answer most of the time. A strategy that always finds something to trade has no filter, and no filter means no edge."
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {sig.signals.map((s) => (
                  <Link key={`${s.symbol}-${s.setup}`} to={`/app/trade/${s.symbol}`} className="block px-4 py-3.5 transition hover:bg-slate-50 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={s.side === 'long' ? 'up' : 'down'} icon={s.side === 'long' ? 'arrowUp' : 'arrowDown'}>
                        {s.side.toUpperCase()}
                      </Badge>
                      <span className="text-[13.5px] font-bold text-slate-900">{s.symbol}</span>
                      <Badge tone="neutral">{s.setupLabel}</Badge>
                      <span className="tnum ml-auto text-[13px] font-bold text-slate-800">{money(s.price)}</span>
                      <Badge tone="brand">{Math.round((s.confidence ?? 0) * 100)}%</Badge>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-snug text-slate-600">{s.reason}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-slate-500">
                      <span>RSI <span className="tnum font-semibold text-slate-700">{n(s.indicators.rsi, 1)}</span></span>
                      <span>Trend <span className="font-semibold text-slate-700">{s.indicators.trend}</span></span>
                      <span>ATR <span className="tnum font-semibold text-slate-700">{n(s.indicators.atrPct, 2)}%</span></span>
                      <span>S <span className="tnum font-semibold text-up-deep">{compact(s.indicators.support)}</span></span>
                      <span>R <span className="tnum font-semibold text-down-deep">{compact(s.indicators.resistance)}</span></span>
                      {s.mlScore != null && <span className="font-semibold text-brand-600">ML {s.mlScore}</span>}
                      <span>setup weight {s.setupWeight}</span>
                    </div>
                    {s.patterns?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">{s.patterns.map((p) => <Badge key={p} tone="neutral">{p}</Badge>)}</div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── right: learning ──────────────────────────────── */}
        <div className="space-y-5">
          <Card>
            <SectionTitle icon="layers" title="What it has learned" subtitle={`${learn?.tradesSeen ?? 0} closed paper trades in memory`} />
            <div className="rounded-xl bg-slate-50 px-3.5 py-3">
              <p className="text-[11.5px] leading-relaxed text-slate-600">{learn?.explanation}</p>
            </div>

            {learn?.setups?.length > 0 && (
              <div className="mt-3.5 space-y-2">
                {learn.setups.map((s) => (
                  <div key={s.setup} className="rounded-xl border border-slate-200 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12.5px] font-bold text-slate-800">{titleCase(s.setup)}</p>
                      <Badge tone={s.avgR > 0 ? 'up' : 'down'}>{s.avgR >= 0 ? '+' : ''}{s.avgR}R</Badge>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                      <span className="tnum">{s.wins}W / {s.losses}L · {s.winRate}%</span>
                      <span className="tnum font-bold text-slate-700">weight {Number(s.learnedWeight ?? 1).toFixed(2)}</span>
                    </div>
                    <Progress value={s.winRate} max={100} tone={s.avgR > 0 ? 'up' : 'down'} className="mt-2" />
                  </div>
                ))}
              </div>
            )}

            {learn?.weights?.coefficients && (
              <div className="mt-4 border-t border-slate-100 pt-3.5">
                <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-500">Logistic coefficients</p>
                <div className="mt-2 space-y-1">
                  {learn.featureNames.map((f, i) => {
                    const v = learn.weights.coefficients[i] ?? 0;
                    const w = Math.min(100, Math.abs(v) * 140);
                    return (
                      <div key={f} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 truncate text-[10.5px] font-semibold text-slate-500">{f}</span>
                        <div className="relative h-2 flex-1 rounded-full bg-slate-100">
                          <div className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
                          <div
                            className={`absolute top-0 h-full rounded-full ${v >= 0 ? 'bg-emerald-400' : 'bg-rose-400'}`}
                            style={v >= 0 ? { left: '50%', width: `${w / 2}%` } : { right: '50%', width: `${w / 2}%` }}
                          />
                        </div>
                        <span className="tnum w-12 shrink-0 text-right text-[10px] font-bold text-slate-600">{v.toFixed(3)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10.5px] leading-snug text-slate-400">
                  Updated by one SGD step per closed trade. Visible on purpose — a learning system you cannot inspect is
                  a system you should not trust.
                </p>
              </div>
            )}

            {(learn?.tradesSeen ?? 0) > 0 && (
              <button onClick={() => setConfirmReset(true)} className="mt-3.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-[11.5px] font-bold text-slate-500 transition hover:bg-slate-50">
                Clear learning memory
              </button>
            )}
          </Card>

          <Card pad={false}>
            <div className="p-4 pb-3 sm:p-5 sm:pb-3">
              <SectionTitle icon="clock" title="Recent lessons" subtitle="Generated after each closed trade" />
            </div>
            {!mem?.memory?.length ? (
              <EmptyState icon="book" title="No closed trades yet" message="Close a position — yours or the bot's — and a lesson appears here." />
            ) : (
              <div className="max-h-[26rem] divide-y divide-slate-100 overflow-y-auto">
                {mem.memory.map((m) => (
                  <div key={m.id} className="px-4 py-3 sm:px-5">
                    <div className="flex items-center gap-2">
                      <Badge tone={m.outcome === 'win' ? 'up' : m.outcome === 'loss' ? 'down' : 'neutral'}>
                        {m.outcome.toUpperCase()}
                      </Badge>
                      <span className="text-[12.5px] font-bold text-slate-900">{m.symbol}</span>
                      <span className="tnum text-[11.5px] text-slate-500">{m.r_multiple >= 0 ? '+' : ''}{Number(m.r_multiple).toFixed(2)}R</span>
                      <span className={`tnum ml-auto text-[12px] font-bold ${m.pnl >= 0 ? 'text-up-deep' : 'text-down-deep'}`}>{signed(m.pnl)}</span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-600">{m.lesson}</p>
                    <p className="mt-1 text-[10.5px] text-slate-400">
                      {titleCase(m.setup)} · {m.side} · by {m.opened_by} · {timeAgo(m.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── backtester ─────────────────────────────────────── */}
      <Card>
        <SectionTitle icon="refresh" title="Backtester" subtitle="Replays the exact production signal code over history. Fills on the next bar's open, never the signal bar's close." />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Instrument" value={bt.symbol} onChange={(e) => setBt({ ...bt, symbol: e.target.value.toUpperCase() })} placeholder="RELIANCE" />
          <Select label="Setup" value={bt.setup} onChange={(e) => setBt({ ...bt, setup: e.target.value })}
            options={(catalogue?.setups || []).map((s) => ({ value: s.id, label: s.label }))} />
          <Select label="Timeframe" value={bt.interval} onChange={(e) => setBt({ ...bt, interval: e.target.value })}
            options={[{ value: '5m', label: '5 minutes' }, { value: '15m', label: '15 minutes' }, { value: '1h', label: '1 hour' }, { value: '1D', label: 'Daily' }]} />
          <Input label="Bars" type="number" min="100" max="500" value={bt.bars} inputMode="numeric" onChange={(e) => setBt({ ...bt, bars: Number(e.target.value) })} />
          <Input label="Starting capital (₹)" type="number" min="1000" value={bt.capital} inputMode="numeric" onChange={(e) => setBt({ ...bt, capital: Number(e.target.value) })} />
          <Input label="Risk per trade (%)" type="number" step="0.1" min="0.1" max="5" value={bt.riskPerTrade} inputMode="decimal" onChange={(e) => setBt({ ...bt, riskPerTrade: Number(e.target.value) })} />
          <Input label="Stop (× ATR)" type="number" step="0.1" min="0.5" max="5" value={bt.stopMultiple} inputMode="decimal" onChange={(e) => setBt({ ...bt, stopMultiple: Number(e.target.value) })} />
          <Input label="Target (× stop)" type="number" step="0.1" min="0.5" max="8" value={bt.targetMultiple} inputMode="decimal" onChange={(e) => setBt({ ...bt, targetMultiple: Number(e.target.value) })} />
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <Button icon="play" loading={btBusy} onClick={runBacktest}>Run backtest</Button>
          <span className="text-[11.5px] text-slate-500">Costs and slippage are included at 11 bps per round trip.</span>
        </div>

        {btBusy && (
          <div className="mt-5 flex items-center justify-center gap-3 rounded-2xl bg-slate-50 py-10">
            <Spinner className="h-5 w-5 text-brand-500" />
            <span className="text-[13px] font-semibold text-slate-500">Replaying bars…</span>
          </div>
        )}

        {btResult && !btBusy && (
          <div className="mt-5 space-y-4">
            <div className={`rounded-2xl border p-4 ${
              btResult.verdict.level === 'promising' ? 'border-emerald-200 bg-emerald-50/60'
                : btResult.verdict.level === 'negative' ? 'border-rose-200 bg-rose-50/60'
                : btResult.verdict.level === 'risky' ? 'border-amber-200 bg-amber-50/60'
                : 'border-slate-200 bg-slate-50'
            }`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={btResult.verdict.level === 'promising' ? 'done' : btResult.verdict.level === 'negative' ? 'down' : 'warn'}>
                  {titleCase(btResult.verdict.level)}
                </Badge>
                <span className="text-[12.5px] font-bold text-slate-800">
                  {btResult.symbol} · {btResult.setupLabel} · {btResult.interval} · {btResult.trades} trades
                </span>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-700">{btResult.verdict.text}</p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { l: 'Net P&L', v: signed(btResult.netPnl, 0), tone: btResult.netPnl >= 0 ? 'up' : 'down' },
                { l: 'Return', v: pct(btResult.returnPct), tone: btResult.returnPct >= 0 ? 'up' : 'down' },
                { l: 'Win rate', v: `${btResult.winRate}%` },
                { l: 'Profit factor', v: btResult.profitFactor > 90 ? '∞' : btResult.profitFactor.toFixed(2), tone: btResult.profitFactor >= 1.3 ? 'up' : btResult.profitFactor < 1 ? 'down' : 'flat' },
                { l: 'Max drawdown', v: `${btResult.maxDrawdownPct}%`, tone: btResult.maxDrawdownPct > 20 ? 'down' : 'flat' },
                { l: 'Worst streak', v: `${btResult.longestLossStreak}L`, tone: btResult.longestLossStreak >= 6 ? 'down' : 'flat' },
              ].map((s) => (
                <div key={s.l} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{s.l}</p>
                  <p className={`tnum mt-0.5 text-[15px] font-bold ${s.tone === 'up' ? 'text-up-deep' : s.tone === 'down' ? 'text-down-deep' : 'text-slate-900'}`}>{s.v}</p>
                </div>
              ))}
            </div>

            {btResult.series?.length > 1 && (
              <div className="rounded-2xl border border-slate-200 p-3.5">
                <p className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-slate-500">Equity curve</p>
                <AreaChart series={btResult.series} height={170} />
              </div>
            )}

            {btResult.tradeList?.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <p className="border-b border-slate-100 bg-slate-50 px-3.5 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
                  Last {btResult.tradeList.length} trades
                </p>
                <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                  {btResult.tradeList.slice().reverse().map((t, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2.5 px-3.5 py-2 text-[11.5px]">
                      <Badge tone={t.side === 'long' ? 'up' : 'down'}>{t.side === 'long' ? 'L' : 'S'}</Badge>
                      <span className="tnum text-slate-500">{dateTime(t.exitAt)}</span>
                      <span className="tnum text-slate-700">{money(t.entry)} → {money(t.exit)}</span>
                      <span className="tnum text-slate-400">×{n(t.qty, t.qty < 10 ? 2 : 0)}</span>
                      <Badge tone="neutral">{t.reason.replace(/_/g, ' ')}</Badge>
                      <span className={`tnum ml-auto font-bold ${t.pnl >= 0 ? 'text-up-deep' : 'text-down-deep'}`}>{signed(t.pnl)}</span>
                      <span className={`tnum font-bold ${t.r >= 0 ? 'text-up-deep' : 'text-down-deep'}`}>{t.r >= 0 ? '+' : ''}{t.r}R</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Alert tone="warn">
              {btResult.reminder} Under ~100 trades, a positive result is indistinguishable from luck.
            </Alert>
          </div>
        )}
      </Card>

      <Confirm
        open={confirmArm}
        onClose={() => setConfirmArm(false)}
        onConfirm={doArm}
        busy={busy}
        title="Arm the bot for paper trading?"
        message="It will scan your enabled markets each cycle and open simulated positions that pass the risk gate. It cannot place a real order — there is no broker connection in this application."
        confirmLabel="Arm bot"
        tone="primary"
      />

      <Confirm
        open={confirmKill}
        onClose={() => setConfirmKill(false)}
        onConfirm={doKill}
        busy={busy}
        title="Engage the kill switch?"
        message="Every open position will be closed immediately at current simulated prices and the bot will be disabled. This is the correct response when something looks wrong."
        confirmLabel="Engage kill switch"
      />

      <Confirm
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => { await Bot.resetMemory(); toast.info('Learning memory cleared'); setConfirmReset(false); refresh(); }}
        title="Clear the bot's learning memory?"
        message="All per-setup statistics and logistic weights reset to their defaults. Your trade history in Portfolio is unaffected."
        confirmLabel="Clear memory"
      />
    </div>
  );
}
