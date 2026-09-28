import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Stat, Badge, Icon, Button, Tabs, EmptyState, Skeleton, SectionTitle, Confirm, usePoll } from '../components/ui.jsx';
import { AreaChart, AllocationBar } from '../components/Chart.jsx';
import { Trade } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { money, signed, pct, n, compact, dateTime, timeAgo, qtyStr } from '../lib/format.js';

export default function Portfolio() {
  const toast = useToast();
  const { refreshWallet } = useAuth();
  const [tab, setTab] = useState('open');
  const [closing, setClosing] = useState(null);

  const { data: p, loading } = usePoll(() => Trade.portfolio(), 20000, []);
  const { data: closedData, refresh: refreshClosed } = usePoll(() => Trade.positions('closed'), 30000, []);
  const { data: orders } = usePoll(() => Trade.orders(), 30000, []);

  const open = p?.openPositions || [];
  const closed = closedData?.positions || [];

  const grossWin = closed.filter((c) => c.realizedPnl > 0).reduce((s, c) => s + c.realizedPnl, 0);
  const grossLoss = Math.abs(closed.filter((c) => c.realizedPnl <= 0).reduce((s, c) => s + c.realizedPnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
  const avgWin = closed.filter((c) => c.realizedPnl > 0).length ? grossWin / closed.filter((c) => c.realizedPnl > 0).length : 0;
  const avgLoss = closed.filter((c) => c.realizedPnl <= 0).length ? grossLoss / closed.filter((c) => c.realizedPnl <= 0).length : 0;

  let streak = 0;
  let worst = 0;
  for (const c of [...closed].reverse()) {
    if (c.realizedPnl <= 0) { streak++; worst = Math.max(worst, streak); } else streak = 0;
  }

  const doClose = async () => {
    if (!closing) return;
    try {
      const r = await Trade.close(closing.id);
      toast.success('Position closed', `Realised ${signed(r.pnl)}.`);
      setClosing(null);
      refreshWallet();
      refreshClosed();
    } catch (e) {
      toast.error('Could not close', e.message);
      setClosing(null);
    }
  };

  if (loading && !p) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Card key={i} className="h-[92px]" />)}</div>
        <Card className="h-[220px]" />
      </div>
    );
  }

  const ret = p?.returnPct ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">Portfolio</h1>
          <p className="mt-1 text-[13px] text-slate-500">Simulated holdings, realised results and the equity curve.</p>
        </div>
        <Link to="/app/markets"><Button size="sm" icon="plus">New position</Button></Link>
      </div>

      {/* equity hero */}
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-brand-100/50 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-500">Paper equity</p>
            <p className="tnum mt-1 text-[34px] font-extrabold leading-none tracking-tight text-slate-900 sm:text-[42px]">
              {money(p?.equity ?? 0, 0)}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Badge tone={ret >= 0 ? 'up' : 'down'} icon={ret >= 0 ? 'arrowUp' : 'arrowDown'}>
                {signed((p?.equity ?? 0) - (p?.totalSimDeposits ?? 0), 0)} · {pct(ret)}
              </Badge>
              <Badge tone="neutral">on {money(p?.totalSimDeposits ?? 0, 0)} simulated deposits</Badge>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-right">
            {[
              { l: 'Cash', v: money(p?.cash ?? 0, 0) },
              { l: 'Deployed', v: money(p?.invested ?? 0, 0) },
              { l: 'Unrealised', v: signed(p?.unrealizedPnl ?? 0, 0), tone: (p?.unrealizedPnl ?? 0) >= 0 ? 'up' : 'down' },
            ].map((s) => (
              <div key={s.l}>
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{s.l}</p>
                <p className={`tnum mt-0.5 text-[14px] font-bold ${s.tone === 'up' ? 'text-up-deep' : s.tone === 'down' ? 'text-down-deep' : 'text-slate-900'}`}>{s.v}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={signed(p?.dayPnl ?? 0, 0)} sub={`${p?.dayTrades ?? 0} closed today`} tone={(p?.dayPnl ?? 0) >= 0 ? 'up' : (p?.dayPnl ?? 0) < 0 ? 'down' : 'flat'} icon="clock" />
        <Stat label="Realised" value={signed(p?.realizedPnl ?? 0, 0)} sub={`${p?.closedTrades ?? 0} closed trades`} tone={(p?.realizedPnl ?? 0) >= 0 ? 'up' : (p?.realizedPnl ?? 0) < 0 ? 'down' : 'flat'} icon="target" />
        <Stat label="Win rate" value={`${p?.winRate ?? 0}%`} sub={profitFactor ? `PF ${profitFactor > 90 ? '∞' : profitFactor.toFixed(2)}` : 'No closed trades'} icon="zap" />
        <Stat label="Worst streak" value={`${worst} losses`} sub={avgLoss ? `avg loss ${money(avgLoss, 0)}` : '—'} tone={worst >= 5 ? 'down' : 'flat'} icon="alert" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle icon="chart" title="Equity curve" subtitle="Cumulative realised P&L by day (IST)" />
          <AreaChart series={p?.equityCurve || []} height={210} />
        </Card>

        <Card>
          <SectionTitle icon="layers" title="Exposure" subtitle={`${open.length} open position${open.length === 1 ? '' : 's'}`} />
          {p?.allocation?.length ? (
            <>
              <AllocationBar segments={p.allocation.map((a) => ({ label: a.label, pct: a.pct }))} />
              <div className="mt-4 space-y-2">
                {p.allocation.map((a) => (
                  <div key={a.market} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-[12px] font-semibold text-slate-600">{a.label}</span>
                    <span className="tnum text-[12px] font-bold text-slate-800">{money(a.value, 0)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState icon="layers" title="No open exposure" message="Everything is in cash right now." />
          )}
          {closed.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
              <div className="rounded-xl bg-up-soft px-3 py-2.5">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-up-deep/70">Avg win</p>
                <p className="tnum mt-0.5 text-[14px] font-bold text-up-deep">{money(avgWin, 0)}</p>
              </div>
              <div className="rounded-xl bg-down-soft px-3 py-2.5">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-down-deep/70">Avg loss</p>
                <p className="tnum mt-0.5 text-[14px] font-bold text-down-deep">{money(avgLoss, 0)}</p>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card pad={false}>
        <div className="p-4 pb-3 sm:p-5 sm:pb-3">
          <Tabs
            tabs={[
              { id: 'open', label: 'Open', icon: 'layers', count: open.length },
              { id: 'closed', label: 'Closed', icon: 'check', count: closed.length },
              { id: 'orders', label: 'Order log', icon: 'clock', count: orders?.orders?.length ?? 0 },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'open' && (
          open.length === 0 ? (
            <EmptyState icon="chart" title="No open positions" message="Browse the markets or let the bot find setups once it is armed." action={<Link to="/app/markets"><Button size="sm">Browse markets</Button></Link>} />
          ) : (
            <div className="divide-y divide-slate-100">
              {open.map((pos) => (
                <div key={pos.id} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tone={pos.side === 'long' ? 'up' : 'down'} icon={pos.side === 'long' ? 'arrowUp' : 'arrowDown'}>
                      {pos.side.toUpperCase()}
                    </Badge>
                    <Link to={`/app/trade/${pos.symbol}`} className="text-[14px] font-bold text-slate-900 hover:text-brand-600">{pos.symbol}</Link>
                    {pos.openedBy === 'bot' && <Badge tone="brand" icon="bot">bot</Badge>}
                    <span className="tnum text-[12px] text-slate-500">{qtyStr(pos.qty)} @ {money(pos.entryPrice)}</span>
                    <div className="ml-auto flex items-center gap-3">
                      <div className="text-right">
                        <p className={`tnum text-[14px] font-bold ${pos.unrealizedPnl >= 0 ? 'text-up-deep' : 'text-down-deep'}`}>{signed(pos.unrealizedPnl)}</p>
                        <p className={`tnum text-[11px] font-semibold ${pos.unrealizedPct >= 0 ? 'text-up-deep/80' : 'text-down-deep/80'}`}>{pct(pos.unrealizedPct)}</p>
                      </div>
                      <Button size="xs" variant="danger" icon="x" onClick={() => setClosing(pos)}>Close</Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-slate-500">
                    <span>Mark <span className="tnum font-semibold text-slate-700">{money(pos.currentPrice)}</span></span>
                    <span>Stop <span className="tnum font-semibold text-amber-600">{pos.stopLoss ? money(pos.stopLoss) : 'none'}</span></span>
                    <span>Target <span className="tnum font-semibold text-brand-600">{pos.target ? money(pos.target) : 'none'}</span></span>
                    <span>Margin <span className="tnum font-semibold text-slate-700">{money(pos.marginUsed, 0)}</span></span>
                    <span>Opened {timeAgo(pos.openedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'closed' && (
          closed.length === 0 ? (
            <EmptyState icon="check" title="No closed trades yet" message="Once you close a position it lands here — and in the bot's learning memory." />
          ) : (
            <div className="divide-y divide-slate-100">
              {closed.slice(0, 60).map((pos) => (
                <div key={pos.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[10.5px] font-bold ${pos.realizedPnl >= 0 ? 'bg-up-soft text-up-deep' : 'bg-down-soft text-down-deep'}`}>
                    {pos.side === 'long' ? 'L' : 'S'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-slate-900">{pos.symbol}</p>
                    <p className="tnum text-[11px] text-slate-500">
                      {qtyStr(pos.qty)} · {money(pos.entryPrice)} → {money(pos.exitPrice)} · {pos.exitReason?.replace(/_/g, ' ') || 'closed'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`tnum text-[13px] font-bold ${pos.realizedPnl >= 0 ? 'text-up-deep' : 'text-down-deep'}`}>{signed(pos.realizedPnl)}</p>
                    <p className="text-[10.5px] text-slate-400">{dateTime(pos.closedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'orders' && (
          (orders?.orders?.length ?? 0) === 0 ? (
            <EmptyState icon="clock" title="No orders yet" message="Every fill and rejection is logged here for review." />
          ) : (
            <div className="divide-y divide-slate-100">
              {orders.orders.slice(0, 60).map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 sm:px-5">
                  <Badge tone={o.status === 'filled' ? (o.side === 'buy' ? 'up' : 'down') : 'warn'}>
                    {o.status === 'filled' ? o.side.toUpperCase() : o.status.toUpperCase()}
                  </Badge>
                  <span className="text-[12.5px] font-bold text-slate-800">{o.symbol}</span>
                  <span className="tnum text-[11.5px] text-slate-500">
                    {qtyStr(o.qty)}{o.filled_price ? ` @ ${money(o.filled_price)}` : ''}
                  </span>
                  {o.opened_by === 'bot' && <Badge tone="brand" icon="bot">bot</Badge>}
                  <span className="ml-auto shrink-0 text-[10.5px] text-slate-400">{timeAgo(o.created_at)}</span>
                  {o.reason && <p className="w-full truncate text-[11px] text-slate-500">{o.reason}</p>}
                </div>
              ))}
            </div>
          )
        )}
      </Card>

      <Confirm
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        onConfirm={doClose}
        title={`Close ${closing?.symbol}?`}
        message={`You will realise ${signed(closing?.unrealizedPnl ?? 0)}. This trade also feeds the bot's learning memory.`}
        confirmLabel="Close position"
      />
    </div>
  );
}
