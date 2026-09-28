/**
 * Pending-order book: limit and stop orders that rest until the paper venue's
 * price crosses their trigger, then fill exactly like market orders do.
 * Driven by the marketData tick hub — one check per tick per symbol.
 */
import { admin } from '../db/index.js';
import { withUser } from '../db/index.js';
import { getInstrument } from './instruments.js';
import { quote } from './marketEngine.js';

const MARGIN_FACTOR = { stocks: 1, ipo: 1, crypto: 1, fno: 0.2, forex: 0.1, us: 1 };
const SLIPPAGE_BPS = 3;

let cache = [];
let dirty = true;
export const invalidatePending = () => { dirty = true; };

async function loadPending() {
  if (!dirty) return cache;
  const { rows } = await admin((c) =>
    c.query(`select * from orders where status = 'pending' order by created_at`)
  );
  cache = rows;
  dirty = false;
  return cache;
}

const triggered = (o, price) => {
  if (o.order_type === 'limit') return o.side === 'buy' ? price <= Number(o.limit_price) : price >= Number(o.limit_price);
  if (o.order_type === 'stop') return o.side === 'buy' ? price >= Number(o.stop_price) : price <= Number(o.stop_price);
  return false;
};

async function fillPending(o, touchPrice) {
  const inst = getInstrument(o.symbol);
  if (!inst) return reject(o, 'Instrument no longer listed.');
  const side = o.side;
  const posSide = side === 'buy' ? 'long' : 'short';
  const slip = touchPrice * (SLIPPAGE_BPS / 10_000);
  const fillPrice = side === 'buy' ? touchPrice + slip : touchPrice - slip;

  const stopLoss = o.stop_loss != null ? Number(o.stop_loss) : null;
  const target = o.target != null ? Number(o.target) : null;
  if (stopLoss != null && posSide === 'long' && stopLoss >= fillPrice) return reject(o, 'Stop loss above the long entry price at fill time.');
  if (stopLoss != null && posSide === 'short' && stopLoss <= fillPrice) return reject(o, 'Stop loss below the short entry price at fill time.');

  const qty = Number(o.qty);
  const margin = Math.round(qty * fillPrice * (MARGIN_FACTOR[inst.market] ?? 1) * 100) / 100;

  // Atomic claim: flip pending→filled first so two concurrent ticks can never
  // both fill the same order. If the fill then fails, the order is rejected.
  const claim = await admin((c) =>
    c.query(`update orders set status='filled', filled_price=$2, reason=null where id=$1 and status='pending' returning id`, [o.id, fillPrice])
  );
  if (!claim.rowCount) return 0; // another tick already claimed it

  try {
    await withUser(o.user_id, async (c) => {
      const w = await c.query('select sim_balance from wallets where user_id=$1 for update', [o.user_id]);
      const bal = Number(w.rows[0]?.sim_balance ?? 0);
      if (margin > bal) throw Object.assign(new Error('insufficient'), { code: 'MARGIN' });
      const dup = await c.query(
        `select id from positions where user_id=$1 and symbol=$2 and side=$3 and status='open'`,
        [o.user_id, o.symbol, posSide]
      );
      if (dup.rowCount) throw Object.assign(new Error('duplicate'), { code: 'DUP' });
      await c.query('update wallets set sim_balance = sim_balance - $2 where user_id=$1', [o.user_id, margin]);
      await c.query(
        `insert into positions (user_id, symbol, market, side, qty, entry_price, current_price, stop_loss, target, margin_used, opened_by, status)
         values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'pending','open')`,
        [o.user_id, o.symbol, inst.market, posSide, qty, fillPrice, stopLoss, target, margin]
      );
    });
    console.log(`[pending] filled ${o.side} ${o.qty} ${o.symbol} @ ${fillPrice.toFixed(2)} (${o.order_type} trigger)`);
  } catch (e) {
    if (e.code === 'MARGIN') return reject(o, 'Insufficient simulated cash when the trigger was hit.');
    if (e.code === 'DUP') return reject(o, 'A same-direction position was already open when the trigger hit.');
    throw e;
  }
}

async function reject(o, reason) {
  await admin((c) => c.query(`update orders set status='rejected', filled_price=null, reason=$2 where id=$1`, [o.id, reason]));
  dirty = true;
  console.log(`[pending] rejected ${o.symbol}: ${reason}`);
}

/** Called by the tick hub for every tick of every subscribed symbol. */
export async function checkPending(symbol, price) {
  const pending = await loadPending();
  if (!pending.length) return 0;
  const due = pending.filter((o) => o.symbol === symbol && triggered(o, price));
  for (const o of due) {
    await fillPending(o, price);
    dirty = true;
  }
  return due.length;
}

export const pendingInfo = async () => ({ count: (await loadPending()).length, quoteChecked: Boolean(quote) });
