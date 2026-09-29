import { useState } from 'react';
import {
  Card, Badge, Icon, Button, Input, Alert, SectionTitle, EmptyState, Confirm, usePoll, Skeleton,
} from '../components/ui.jsx';
import { Wallet as WalletApi, Trade } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { money, signed, dateTime, n } from '../lib/format.js';

const QUICK = [50, 500, 5000, 25000, 100000];

export default function Wallet() {
  const toast = useToast();
  const { refreshWallet } = useAuth();
  const [amount, setAmount] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const { data: w, loading, refresh } = usePoll(() => WalletApi.get(), 30000, []);
  const { data: tx, refresh: refreshTx } = usePoll(() => WalletApi.transactions(), 30000, []);
  const { data: port } = usePoll(() => Trade.portfolio(), 30000, []);

  const balance = w?.wallet?.simBalance ?? 0;
  const limits = w?.limits || { min: 50, max: 1000000 };
  const num = Number(amount);
  const invalid = !Number.isFinite(num) || num <= 0;
  const tooSmall = Number.isFinite(num) && num < limits.min;
  const tooBig = Number.isFinite(num) && num > limits.max;
  const overBalance = Number.isFinite(num) && num > balance;

  const act = async (kind) => {
    if (invalid || tooSmall) return;
    setBusy(true);
    try {
      if (kind === 'deposit') {
        const r = await WalletApi.deposit(num);
        toast.success('Simulated funds added', `Balance is now ${money(r.simBalance)}.`);
      } else {
        const r = await WalletApi.withdraw(num);
        toast.info('Simulated funds removed', `Balance is now ${money(r.simBalance)}.`);
      }
      refresh();
      refreshTx();
      refreshWallet();
    } catch (e) {
      toast.error(kind === 'deposit' ? 'Could not add funds' : 'Could not withdraw', e.message);
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    try {
      await WalletApi.reset();
      toast.warn('Paper account reset', 'All positions closed and the simulated balance zeroed.');
      setConfirmReset(false);
      refresh();
      refreshTx();
      refreshWallet();
    } catch (e) {
      toast.error('Reset failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">Wallet</h1>
        <p className="mt-1 text-[13px] text-slate-500">Simulated Indian rupees. Nothing here is real money.</p>
        <p data-testid="wallet-real-money-note" className="mt-2 text-[12px] text-slate-500 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
          <b>To trade real money</b>, funds go directly to <b>your own broker account</b> — this app cannot and never will
          accept deposits (UPI/wallet apps included). Steps live in the <a href="/app/terminal" className="text-blue-600 font-semibold">LIVE · broker</a> tab → “Fund your trading account”.
        </p>
      </div>

      <Alert tone="warn" title="This is a paper wallet">
        Deposits and withdrawals here only change a number in your own database row. There is no payment gateway, no
        bank or UPI connection, no custody of funds and no way to move real money into or out of this application.
      </Alert>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        {/* balance */}
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-brand-100/50 blur-3xl" />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-500">Available simulated cash</p>
                {loading && !w ? (
                  <Skeleton className="mt-2 h-10 w-44" />
                ) : (
                  <p className="tnum mt-1.5 text-[38px] font-extrabold leading-none tracking-tight text-slate-900 sm:text-[44px]">
                    {money(balance, 2)}
                  </p>
                )}
              </div>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
                <Icon name="wallet" className="h-5 w-5" />
              </span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2.5">
              {[
                { l: 'Equity', v: money(port?.equity ?? balance, 0) },
                { l: 'Deployed', v: money(port?.invested ?? 0, 0) },
                { l: 'Total added', v: money(port?.totalSimDeposits ?? 0, 0) },
              ].map((s) => (
                <div key={s.l} className="rounded-xl bg-slate-50 px-3 py-2.5">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{s.l}</p>
                  <p className="tnum mt-0.5 text-[14px] font-bold text-slate-900">{s.v}</p>
                </div>
              ))}
            </div>

            <div className="mt-5">
              <label className="label">Amount (₹)</label>
              <Input
                type="number" min={limits.min} step="1" value={amount} inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
                error={tooSmall ? `Minimum is ₹${limits.min}.` : tooBig ? `Maximum per top-up is ${money(limits.max, 0)}.` : invalid && amount ? 'Enter a valid amount.' : undefined}
                hint={`Between ${money(limits.min, 0)} and ${money(limits.max, 0)} per transaction.`}
              />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {QUICK.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAmount(String(a))}
                    className={`rounded-lg px-3 py-2 text-[12px] font-bold transition active:scale-95 ${
                      num === a ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    ₹{a >= 1000 ? n(a / 1000, a % 1000 ? 1 : 0) + 'K' : a}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <Button
                  size="lg" icon="plus" loading={busy}
                  disabled={invalid || tooSmall || tooBig}
                  onClick={() => act('deposit')}
                >
                  Add funds
                </Button>
                <Button
                  size="lg" variant="secondary" icon="arrowUp" loading={busy}
                  disabled={invalid || tooSmall || overBalance}
                  onClick={() => act('withdraw')}
                >
                  Remove
                </Button>
              </div>
              {overBalance && !tooBig && (
                <p className="mt-2 text-[11.5px] font-semibold text-amber-700">
                  You only have {money(balance)} free — the rest is committed to open positions.
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* transactions */}
        <Card pad={false} className="flex flex-col">
          <div className="p-4 pb-3 sm:p-5 sm:pb-3">
            <SectionTitle
              icon="clock"
              title="Transaction history"
              subtitle="Every simulated movement, newest first"
              action={<Badge tone="neutral">{tx?.transactions?.length ?? 0}</Badge>}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!tx?.transactions?.length ? (
              <EmptyState icon="wallet" title="No transactions yet" message="Add simulated funds to start paper trading." />
            ) : (
              <div className="divide-y divide-slate-100">
                {tx.transactions.map((t) => {
                  const positive = Number(t.amount) > 0;
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                        t.kind === 'deposit' ? 'bg-up-soft text-up-deep' : t.kind === 'withdraw' ? 'bg-down-soft text-down-deep' : 'bg-slate-100 text-slate-500'
                      }`}>
                        <Icon name={t.kind === 'deposit' ? 'plus' : t.kind === 'withdraw' ? 'arrowUp' : 'refresh'} className="h-3.5 w-3.5" stroke={2.4} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold capitalize text-slate-900">{t.kind}</p>
                        <p className="truncate text-[11px] text-slate-500">{t.note || dateTime(t.created_at)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`tnum text-[13px] font-bold ${positive ? 'text-up-deep' : t.kind === 'reset' ? 'text-slate-400' : 'text-down-deep'}`}>
                          {t.kind === 'reset' ? '—' : signed(t.amount)}
                        </p>
                        <p className="tnum text-[10.5px] text-slate-400">bal {money(t.balance_after, 0)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="border-t border-slate-100 p-4 sm:p-5">
            <button
              onClick={() => setConfirmReset(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2.5 text-[12.5px] font-bold text-rose-700 transition hover:bg-rose-50 active:scale-[0.99]"
            >
              <Icon name="refresh" className="h-3.5 w-3.5" /> Reset paper account
            </button>
            <p className="mt-2 text-center text-[11px] leading-snug text-slate-400">
              Closes every open position and zeroes the simulated balance. Your learning history and modules are kept.
            </p>
          </div>
        </Card>
      </div>

      <Confirm
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={doReset}
        busy={busy}
        title="Reset your paper account?"
        message="All open positions will be closed at current simulated prices and your balance set to ₹0. Notes, journal entries and learning progress are not affected."
        confirmLabel="Reset account"
      />
    </div>
  );
}
