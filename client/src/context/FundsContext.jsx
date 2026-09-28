import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal, Button, Icon } from '../components/ui.jsx';
import { Wallet } from '../lib/api.js';
import { useToast } from './ToastContext.jsx';
import { useAuth } from './AuthContext.jsx';
import { money, n } from '../lib/format.js';

/**
 * A single "add simulated funds" flow, reachable from anywhere money matters:
 * the header balance chip, the dashboard's empty-wallet banner and the order
 * ticket when a position does not fit the available cash.
 *
 * It only ever calls the simulated-wallet endpoint. There is deliberately no
 * variant of this modal that takes a card, UPI id or bank detail — accepting
 * customer money would make this application an unregistered investment
 * business, which is a criminal offence in India. See README.
 */
const Ctx = createContext(null);
export const useFunds = () => useContext(Ctx);

const QUICK = [50, 500, 1000, 5000, 25000, 100000];

export function FundsProvider({ children }) {
  const toast = useToast();
  const { refreshWallet } = useAuth();

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [limits, setLimits] = useState({ min: 50, max: 1000000 });
  const onDoneRef = useRef(null);

  const openAddFunds = useCallback((onDone, preset) => {
    onDoneRef.current = typeof onDone === 'function' ? onDone : null;
    if (preset && Number.isFinite(Number(preset)) && Number(preset) > 0) setAmount(String(Math.round(Number(preset))));
    setOpen(true);
    Wallet.get()
      .then((r) => {
        if (!r?.limits) return;
        setLimits(r.limits);
        // Clamp the pre-fill into the allowed band the moment the real limits
        // arrive — a ticket shortfall can be far above the per-top-up cap, and
        // showing a disabled ₹46Cr field teaches nothing.
        setAmount((a) => {
          const x = Number(a);
          if (!Number.isFinite(x) || x <= 0) return a;
          return String(Math.max(r.limits.min, Math.min(x, r.limits.max)));
        });
      })
      .catch(() => {});
  }, []);

  const close = () => { if (!busy) setOpen(false); };

  const submit = async () => {
    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) return toast.error('Enter an amount', 'How much simulated cash do you want to work with?');
    if (num < limits.min) return toast.error('Below the minimum', `The smallest top-up is ${money(limits.min, 0)} — small on purpose, so sizing mistakes stay cheap.`);
    if (num > limits.max) return toast.error('Above the maximum', `One top-up is capped at ${money(limits.max, 0)}. You can top up again afterwards.`);

    setBusy(true);
    try {
      const r = await Wallet.deposit(num);
      await refreshWallet?.();
      toast.success(
        `Added ${money(num, 0)} of simulated cash`,
        `Paper balance is now ${money(r.wallet?.simBalance ?? num, 0)}. No real money was involved.`
      );
      setOpen(false);
      onDoneRef.current?.();
    } catch (e) {
      toast.error('Could not add funds', e.message);
    } finally {
      setBusy(false);
    }
  };

  const num = Number(amount);
  const invalid = !Number.isFinite(num) || num < limits.min || num > limits.max;

  return (
    <Ctx.Provider value={{ openAddFunds }}>
      {children}

      <Modal
        open={open}
        onClose={close}
        title="Add simulated funds"
        subtitle="Paper rupees to practise position sizing with. Not a payment — nothing real moves."
        size="sm"
        footer={
          <div className="space-y-2.5">
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={close} disabled={busy}>Cancel</Button>
              <Button className="flex-1" icon="plus" loading={busy} disabled={invalid} onClick={submit}>Add funds</Button>
            </div>
            <Link
              to="/app/wallet"
              onClick={close}
              className="block text-center text-[12px] font-bold text-brand-600 transition hover:text-brand-700"
            >
              Wallet, withdrawals & history →
            </Link>
          </div>
        }
      >
        <div className="space-y-3.5">
          <div>
            <span className="label">Amount (₹)</span>
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              min={limits.min}
              max={limits.max}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !invalid) submit(); }}
              className="field tnum text-[17px] font-bold"
            />
            <p className="mt-1.5 text-[11px] text-slate-400">
              Between {money(limits.min, 0)} and {money(limits.max, 0)} per top-up.
              {num < limits.min && num > 0 ? ` Minimum is ${money(limits.min, 0)}.` : ''}
              {num > limits.max ? ` Maximum is ${money(limits.max, 0)}.` : ''}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {QUICK.filter((a) => a >= limits.min && a <= limits.max).map((a) => (
              <button
                key={a}
                onClick={() => setAmount(String(a))}
                className={`rounded-lg px-2 py-2 text-[12px] font-bold transition active:scale-95 ${
                  num === a ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                ₹{a >= 100000 ? '1L' : a >= 1000 ? `${n(a / 1000, 0)}K` : a}
              </button>
            ))}
          </div>

          <p className="flex items-start gap-2 rounded-xl bg-amber-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800">
            <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" stroke={2.2} />
            <span>
              This wallet holds simulated rupees only. The application has no payment gateway and no way to
              receive real money — that is a legal line, not a missing feature.
            </span>
          </p>
        </div>
      </Modal>
    </Ctx.Provider>
  );
}
