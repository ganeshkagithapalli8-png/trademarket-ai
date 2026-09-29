/**
 * LivePanel — the FENCED real-money door: orders route to the user's OWN
 * Zerodha (Kite Connect) account. The app never holds funds.
 *
 * Every fence is visible in the UI, not just enforced server-side:
 *  • live mode OFF by default, explicit enable with an 18+ / own-money warning
 *  • every order passes through a review modal (confirm:true)
 *  • daily loss limit + per-order notional cap shown before you trade
 *  • PANIC kill switch cancels open broker orders and drops to paper
 *  • full audit trail of live order attempts
 *  • honest banner: "LIVE · your Zerodha account · your money"
 */
import { useCallback, useEffect, useState } from 'react';
import { Live } from '../lib/api.js';

const REDIRECT = 'https://trademarket-api.onrender.com/api/live/callback';

export default function LivePanel({ symbol = 'RELIANCE' }) {
  const [st, setSt] = useState(null);
  const [orders, setOrders] = useState([]);
  const [dayPnl, setDayPnl] = useState(null);
  const [notice, setNotice] = useState(null);
  const [modal, setModal] = useState(null); // 'enable' | 'panic' | 'review'
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ symbol, side: 'BUY', qty: 1, product: 'CNC', orderType: 'MARKET', price: '' });

  const refresh = useCallback(async () => {
    try {
      const s = await Live.status();
      setSt(s);
      if (s.session) {
        Live.orders().then((o) => setOrders(o.orders || [])).catch(() => {});
        if (s.active) {
          Live.positions().then((p) => {
            const day = Array.isArray(p?.positions?.day) ? p.positions.day : [];
            setDayPnl(day.reduce((a, x) => a + (Number(x.pnl) || 0), 0));
          }).catch(() => {});
        }
      }
    } catch (e) { setNotice({ kind: 'err', text: e?.message || 'Live status unavailable.' }); }
  }, []);

  useEffect(() => { refresh(); const iv = setInterval(refresh, 20_000); return () => clearInterval(iv); }, [refresh]);
  useEffect(() => { setForm((f) => ({ ...f, symbol })); }, [symbol]);

  const run = async (fn, okText) => {
    setBusy(true); setNotice(null);
    try { const r = await fn(); setNotice({ kind: 'ok', text: okText || r?.notice || 'Done.' }); await refresh(); }
    catch (e) { setNotice({ kind: 'err', text: e?.message || 'Failed.' }); }
    finally { setBusy(false); setModal(null); }
  };

  if (!st) return <div data-testid="live-panel" className="p-4 text-sm text-slate-400">Loading live-routing status…</div>;

  return (
    <div data-testid="live-panel" className="space-y-3">
      {/* status banner */}
      <div className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${st.active ? 'bg-rose-500/10 text-rose-600' : 'bg-slate-500/10 text-slate-500'}`} data-testid="live-status-chip">
        {st.active ? '● LIVE · YOUR ZERODHA ACCOUNT · YOUR MONEY' : '● PAPER DEFAULT — live routing OFF'}
        <span className="font-medium text-[10.5px] opacity-80">
          {st.active ? 'every order needs your confirmation' : 'this app never holds funds'}
        </span>
      </div>

      {/* Funding — money goes to YOUR broker, never into this app */}
      <div data-testid="live-funding" className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
        <p className="text-[11px] font-bold text-slate-600">FUND YOUR TRADING ACCOUNT — AT YOUR BROKER, NOT HERE</p>
        <p className="text-[11.5px] text-slate-500">
          This app never receives or holds money. Add funds in <b>Kite → Funds → Add funds → UPI</b>: enter the UPI ID
          linked to the bank account registered with Zerodha, then approve the <b>collect request that Kite sends</b> to your
          UPI app. Netbanking and NEFT/IMPS also work (NEFT can take up to ~10 hours).
        </p>
        <a data-testid="live-fund-broker" href="https://kite.zerodha.com/funds" target="_blank" rel="noopener noreferrer"
          className="inline-block px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold">Open Kite Funds page ↗</a>
        <p className="text-[10.5px] text-slate-400">
          Zerodha accepts only transfers from bank accounts registered to your Zerodha profile (primary/secondary) —
          <b> digital wallets such as FamPay/PPI apps are not accepted</b>, and transfers started directly from a UPI app
          instead of from Kite are rejected. UPI pay-ins reflect after 7:30 AM if made between 12 AM–7:30 AM; up to 35
          transfers/day; ₹5 lakh per UPI transaction. Trading is 18+ with your own KYC-matched bank account.
        </p>
      </div>

      {!st.configured ? (
        <ol className="list-decimal ml-5 space-y-1.5 text-[12.5px] text-slate-600">
          <li><b>Be 18+</b> and own a Zerodha account with completed KYC (PAN + Aadhaar + bank).</li>
          <li>Sign up at <b>developers.kite.trade</b> → choose the <b>free Personal plan</b> (order placement, portfolio & margins — exactly what this panel uses; live market data stays on our Upstox/Finnhub feeds).</li>
          <li>Create an app with redirect URL <code className="px-1 rounded bg-slate-100">{REDIRECT}</code></li>
          <li>Hand the API key + secret to the builder — they go into server env vars only, never the client.</li>
          <li className="text-slate-400">Fences once live: per-order confirmation, daily loss stop ₹{st.fences?.dailyLossInr?.toLocaleString?.('en-IN')}, per-order cap ₹{st.fences?.maxOrderNotionalInr?.toLocaleString?.('en-IN')}, PANIC kill switch, full audit log. The AI bot can never place live orders.</li>
        </ol>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {!st.session ? (
              <button type="button" data-testid="live-connect" disabled={busy}
                onClick={() => run(async () => { const r = await Live.login(); window.open(r.url, '_blank', 'noopener'); return { notice: 'Kite login opened in a new tab — approve it, then this panel reconnects automatically.' }; })}
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-50">
                {st.expired ? 'Reconnect Zerodha (daily login)' : 'Connect Zerodha (daily login)'}
              </button>
            ) : !st.active ? (
              <button type="button" data-testid="live-enable" disabled={busy} onClick={() => setModal('enable')}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold disabled:opacity-50">Enable LIVE mode…</button>
            ) : (
              <>
                <button type="button" data-testid="live-disable" disabled={busy} onClick={() => run(() => Live.disable(), 'Live mode OFF — back to paper.')}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-xs font-bold disabled:opacity-50">Disable live</button>
                <button type="button" data-testid="live-panic" disabled={busy} onClick={() => setModal('panic')}
                  className="px-3 py-1.5 rounded-lg bg-rose-700 text-white text-xs font-bold disabled:opacity-50">PANIC — cancel open orders & stop</button>
              </>
            )}
            {st.session ? (
              <button type="button" disabled={busy} onClick={() => run(() => Live.logout(), 'Zerodha session removed.')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50">Disconnect session</button>
            ) : null}
          </div>

          {st.active ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {/* order ticket */}
              <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                <p className="text-[11px] font-bold text-slate-500">LIVE ORDER TICKET — NSE only · your confirmation required</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="space-y-0.5"><span className="text-slate-400">Symbol</span>
                    <input data-testid="live-symbol" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 font-semibold" /></label>
                  <label className="space-y-0.5"><span className="text-slate-400">Side</span>
                    <select data-testid="live-side" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200">
                      <option>BUY</option><option>SELL</option>
                    </select></label>
                  <label className="space-y-0.5"><span className="text-slate-400">Qty</span>
                    <input data-testid="live-qty" type="number" min="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200" /></label>
                  <label className="space-y-0.5"><span className="text-slate-400">Product</span>
                    <select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200">
                      <option value="CNC">CNC (delivery)</option><option value="MIS">MIS (intraday)</option>
                    </select></label>
                  <label className="space-y-0.5"><span className="text-slate-400">Type</span>
                    <select data-testid="live-type" value={form.orderType} onChange={(e) => setForm({ ...form, orderType: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200">
                      <option>MARKET</option><option>LIMIT</option>
                    </select></label>
                  {form.orderType === 'LIMIT' ? (
                    <label className="space-y-0.5"><span className="text-slate-400">Limit price</span>
                      <input data-testid="live-price" type="number" step="0.05" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200" /></label>
                  ) : null}
                </div>
                <button type="button" data-testid="live-order-submit" disabled={busy} onClick={() => setModal('review')}
                  className="w-full px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold disabled:opacity-50">Review live order…</button>
                <p className="text-[10.5px] text-slate-400">Day P&L fence: {dayPnl == null ? '—' : `₹${Math.round(dayPnl).toLocaleString('en-IN')}`} of −₹{st.fences?.dailyLossInr?.toLocaleString?.('en-IN')} stop · MARKET orders carry 0.5% protection</p>
              </div>
              {/* audit */}
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-[11px] font-bold text-slate-500 mb-1.5">LIVE AUDIT TRAIL (your broker orders via this app)</p>
                <div data-testid="live-audit" className="space-y-1 max-h-40 overflow-y-auto text-[11px]">
                  {orders.length ? orders.slice(0, 12).map((o, i) => (
                    <div key={i} className="flex gap-2 items-baseline">
                      <span className="text-slate-400 shrink-0">{new Date(o.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className={`font-bold ${o.status === 'placed' ? 'text-emerald-600' : o.status === 'rejected' || o.status === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>{o.status}</span>
                      <span className="font-semibold">{o.side} {o.qty} {o.symbol}</span>
                      <span className="text-slate-400 truncate">{o.detail}</span>
                    </div>
                  )) : <p className="text-slate-400">No live orders yet — paper trades never appear here.</p>}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {notice ? <p data-testid="live-notice" className={`text-[11.5px] font-semibold ${notice.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{notice.text}</p> : null}

      {/* modals */}
      {modal === 'enable' ? (
        <Modal title="Enable LIVE real-money mode?" tone="rose">
          <p className="text-[12.5px] text-slate-600 space-y-1">
            Orders will be sent to <b>your own Zerodha account</b> using <b>your money</b>.<br />
            You confirm every order. Daily loss stop: −₹{st.fences?.dailyLossInr?.toLocaleString?.('en-IN')}. Per-order cap: ₹{st.fences?.maxOrderNotionalInr?.toLocaleString?.('en-IN')}.<br />
            The AI bot stays paper-only — it can never place live orders.<br />
            You must be 18+ (verified on your profile).
          </p>
          <Actions onCancel={() => setModal(null)} onOk={() => run(() => Live.enable(), 'LIVE mode ON — confirm every order carefully.')} okLabel="I am 18+ — enable LIVE" busy={busy} testid="live-confirm-enable" />
        </Modal>
      ) : null}
      {modal === 'panic' ? (
        <Modal title="Pull the kill switch?" tone="rose">
          <p className="text-[12.5px] text-slate-600">Cancels every OPEN order at your broker right now and drops back to paper mode.</p>
          <Actions onCancel={() => setModal(null)} onOk={() => run(() => Live.panic(), 'Kill switch pulled — live mode OFF.')} okLabel="PANIC — cancel & stop" busy={busy} testid="live-confirm-panic" />
        </Modal>
      ) : null}
      {modal === 'review' ? (
        <Modal title="Confirm REAL-MONEY order" tone="rose">
          <div className="text-[13px] font-bold text-slate-800 space-y-0.5">
            <p>{form.side} {form.qty} {form.symbol} · {form.product} · {form.orderType}{form.orderType === 'LIMIT' ? ` @ ₹${form.price}` : ' (with 0.5% market protection)'}</p>
            <p className="text-[11.5px] font-semibold text-rose-600">This spends REAL money from your Zerodha account. Paper mode is unaffected.</p>
          </div>
          <Actions onCancel={() => setModal(null)}
            onOk={() => run(() => Live.order({ symbol: form.symbol, side: form.side, qty: Number(form.qty), product: form.product, orderType: form.orderType, price: form.price ? Number(form.price) : undefined, confirm: true }))}
            okLabel="Place live order" busy={busy} testid="live-confirm-order" />
        </Modal>
      ) : null}
    </div>
  );
}

const Modal = ({ title, tone = 'slate', children }) => (
  <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
    <div className={`w-full max-w-md rounded-2xl bg-white p-4 space-y-3 border-t-4 ${tone === 'rose' ? 'border-rose-600' : 'border-slate-400'}`}>
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      {children}
    </div>
  </div>
);

const Actions = ({ onCancel, onOk, okLabel, busy, testid }) => (
  <div className="flex justify-end gap-2">
    <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
    <button type="button" data-testid={testid} disabled={busy} onClick={onOk} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold disabled:opacity-50">{okLabel}</button>
  </div>
);
