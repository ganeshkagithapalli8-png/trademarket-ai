/**
 * Instrument universe for the SIMULATED market engine.
 *
 * Every field below is a modelling parameter for a synthetic price series.
 * Nothing here is a real security, a real quote, or an offer to trade.
 * Fills produced by this app are paper fills against simulated liquidity.
 */

export const MARKETS = {
  stocks: {
    id: 'stocks',
    label: 'Indian Stocks',
    currency: 'INR',
    blurb: 'Cash-segment equities (NSE-style symbols). Simulated.',
    accent: 'from-indigo-500 to-blue-500',
    sessionHours: [9.25, 15.5], // IST-ish trading window used for volume shaping
  },
  fno: {
    id: 'fno',
    label: 'Futures & Options',
    currency: 'INR',
    blurb: 'Index & stock derivatives on paper. Gated: 18+ and Risk Management module.',
    accent: 'from-rose-500 to-orange-500',
    sessionHours: [9.25, 15.5],
    gated: ['risk-management'],
  },
  ipo: {
    id: 'ipo',
    label: 'IPO / GMP',
    currency: 'INR',
    blurb: 'Simulated new-issue listing pops and grey-market premium decay.',
    accent: 'from-emerald-500 to-teal-500',
    sessionHours: [9.25, 15.5],
  },
  crypto: {
    id: 'crypto',
    label: 'Crypto',
    currency: 'INR',
    blurb: '24×7 crypto quoted in INR. Optional live CoinGecko prices.',
    accent: 'from-amber-500 to-yellow-500',
    sessionHours: [0, 24],
  },
  forex: {
    id: 'forex',
    label: 'Forex',
    currency: 'INR',
    blurb: 'INR pairs, simulated. Real forex trading in India must go through an RBI-authorised dealer.',
    accent: 'from-sky-500 to-cyan-500',
    sessionHours: [9.25, 15.5],
    gated: ['risk-management'],
  },
};

/**
 * seed  – stable per-symbol PRNG seed (keeps the series reproducible)
 * base  – reference price in INR
 * vol   – annualised volatility used to derive the daily sigma
 * drift – annualised drift
 * lot   – lot size (1 for equities/crypto; contract lot for F&O)
 */
export const INSTRUMENTS = [
  // ── Indian equities ─────────────────────────────────────────────
  { symbol: 'RELIANCE', name: 'Reliance Industries', market: 'stocks', sector: 'Energy', base: 2915, vol: 0.24, drift: 0.08, lot: 1, seed: 1001 },
  { symbol: 'TCS', name: 'Tata Consultancy Services', market: 'stocks', sector: 'IT', base: 4120, vol: 0.21, drift: 0.07, lot: 1, seed: 1002 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', market: 'stocks', sector: 'Banking', base: 1685, vol: 0.20, drift: 0.09, lot: 1, seed: 1003 },
  { symbol: 'INFY', name: 'Infosys', market: 'stocks', sector: 'IT', base: 1842, vol: 0.25, drift: 0.05, lot: 1, seed: 1004 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', market: 'stocks', sector: 'Banking', base: 1210, vol: 0.22, drift: 0.11, lot: 1, seed: 1005 },
  { symbol: 'SBIN', name: 'State Bank of India', market: 'stocks', sector: 'Banking', base: 812, vol: 0.28, drift: 0.09, lot: 1, seed: 1006 },
  { symbol: 'ITC', name: 'ITC Limited', market: 'stocks', sector: 'FMCG', base: 468, vol: 0.17, drift: 0.06, lot: 1, seed: 1007 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', market: 'stocks', sector: 'Auto', base: 985, vol: 0.36, drift: 0.10, lot: 1, seed: 1008 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', market: 'stocks', sector: 'Telecom', base: 1544, vol: 0.23, drift: 0.14, lot: 1, seed: 1009 },
  { symbol: 'LT', name: 'Larsen & Toubro', market: 'stocks', sector: 'Infra', base: 3620, vol: 0.24, drift: 0.09, lot: 1, seed: 1010 },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', market: 'stocks', sector: 'FMCG', base: 2480, vol: 0.16, drift: 0.04, lot: 1, seed: 1011 },
  { symbol: 'AXISBANK', name: 'Axis Bank', market: 'stocks', sector: 'Banking', base: 1148, vol: 0.26, drift: 0.08, lot: 1, seed: 1012 },
  { symbol: 'ZOMATO', name: 'Zomato', market: 'stocks', sector: 'Consumer', base: 262, vol: 0.44, drift: 0.16, lot: 1, seed: 1013 },
  { symbol: 'IRCTC', name: 'IRCTC', market: 'stocks', sector: 'Consumer', base: 795, vol: 0.31, drift: 0.07, lot: 1, seed: 1014 },
  { symbol: 'NIFTY50', name: 'Nifty 50 Index', market: 'stocks', sector: 'Index', base: 24850, vol: 0.13, drift: 0.10, lot: 1, seed: 1015, index: true },
  { symbol: 'SENSEX', name: 'BSE Sensex Index', market: 'stocks', sector: 'Index', base: 81400, vol: 0.13, drift: 0.10, lot: 1, seed: 1016, index: true },

  // ── Futures & Options (paper only) ──────────────────────────────
  { symbol: 'NIFTY-FUT', name: 'Nifty 50 Futures (SIM)', market: 'fno', sector: 'Index Derivative', base: 24895, vol: 0.14, drift: 0.10, lot: 25, seed: 2001, expiryDays: 21 },
  { symbol: 'BANKNIFTY-FUT', name: 'Bank Nifty Futures (SIM)', market: 'fno', sector: 'Index Derivative', base: 53240, vol: 0.17, drift: 0.09, lot: 15, seed: 2002, expiryDays: 21 },
  { symbol: 'FINNIFTY-FUT', name: 'Fin Nifty Futures (SIM)', market: 'fno', sector: 'Index Derivative', base: 23610, vol: 0.16, drift: 0.09, lot: 25, seed: 2003, expiryDays: 21 },
  { symbol: 'RELIANCE-FUT', name: 'Reliance Futures (SIM)', market: 'fno', sector: 'Stock Derivative', base: 2924, vol: 0.25, drift: 0.08, lot: 250, seed: 2004, expiryDays: 28 },
  { symbol: 'TATAMOTORS-FUT', name: 'Tata Motors Futures (SIM)', market: 'fno', sector: 'Stock Derivative', base: 991, vol: 0.37, drift: 0.10, lot: 550, seed: 2005, expiryDays: 28 },
  { symbol: 'HDFCBANK-FUT', name: 'HDFC Bank Futures (SIM)', market: 'fno', sector: 'Stock Derivative', base: 1691, vol: 0.21, drift: 0.09, lot: 550, seed: 2006, expiryDays: 28 },

  // ── IPO / GMP ───────────────────────────────────────────────────
  { symbol: 'IPO-NOVAAGRI', name: 'Nova Agritech (SIM IPO)', market: 'ipo', sector: 'New Issue', base: 41, vol: 0.62, drift: 0.22, lot: 3000, seed: 3001, gmp: 14 },
  { symbol: 'IPO-TECHNOS', name: 'Techno Electric (SIM IPO)', market: 'ipo', sector: 'New Issue', base: 628, vol: 0.48, drift: 0.18, lot: 23, seed: 3002, gmp: 190 },
  { symbol: 'IPO-GREENCELL', name: 'GreenCell Express (SIM IPO)', market: 'ipo', sector: 'New Issue', base: 305, vol: 0.55, drift: 0.20, lot: 49, seed: 3003, gmp: 62 },
  { symbol: 'IPO-SAIHOSP', name: 'Sai Hospitals (SIM IPO)', market: 'ipo', sector: 'New Issue', base: 132, vol: 0.50, drift: 0.15, lot: 113, seed: 3004, gmp: 21 },

  // ── Crypto (quoted in INR) ──────────────────────────────────────
  { symbol: 'BTCINR', name: 'Bitcoin / INR', market: 'crypto', sector: 'Crypto', base: 8420000, vol: 0.58, drift: 0.30, lot: 1, seed: 4001, coin: 'bitcoin', live: true, decimals: 0 },
  { symbol: 'ETHINR', name: 'Ethereum / INR', market: 'crypto', sector: 'Crypto', base: 318500, vol: 0.66, drift: 0.26, lot: 1, seed: 4002, coin: 'ethereum', live: true, decimals: 0 },
  { symbol: 'SOLINR', name: 'Solana / INR', market: 'crypto', sector: 'Crypto', base: 15420, vol: 0.85, drift: 0.28, lot: 1, seed: 4003, coin: 'solana', live: true, decimals: 2 },
  { symbol: 'MATICINR', name: 'Polygon / INR', market: 'crypto', sector: 'Crypto', base: 42.6, vol: 0.92, drift: 0.05, lot: 1, seed: 4004, coin: 'matic-network', live: true, decimals: 4 },
  { symbol: 'XRPINR', name: 'XRP / INR', market: 'crypto', sector: 'Crypto', base: 61.4, vol: 0.80, drift: 0.08, lot: 1, seed: 4005, coin: 'ripple', live: true, decimals: 4 },

  // ── Forex (INR pairs, simulated) ────────────────────────────────
  { symbol: 'USDINR', name: 'US Dollar / Indian Rupee', market: 'forex', sector: 'FX', base: 83.42, vol: 0.045, drift: 0.015, lot: 1000, seed: 5001, decimals: 4, live: true },
  { symbol: 'EURINR', name: 'Euro / Indian Rupee', market: 'forex', sector: 'FX', base: 91.18, vol: 0.055, drift: 0.010, lot: 1000, seed: 5002, decimals: 4, live: true },
  { symbol: 'GBPINR', name: 'Pound Sterling / Indian Rupee', market: 'forex', sector: 'FX', base: 107.62, vol: 0.060, drift: 0.008, lot: 1000, seed: 5003, decimals: 4, live: true },
  { symbol: 'JPYINR', name: 'Japanese Yen / Indian Rupee', market: 'forex', sector: 'FX', base: 0.5642, vol: 0.070, drift: -0.005, lot: 10000, seed: 5004, decimals: 4, live: true },
  { symbol: 'EURUSD', name: 'Euro / US Dollar', market: 'forex', sector: 'FX', base: 1.0930, vol: 0.058, drift: 0.000, lot: 1000, seed: 5005, decimals: 5, live: true },
  { symbol: 'XAUUSD', name: 'Gold Spot / USD (SIM)', market: 'forex', sector: 'Commodity', base: 2648.5, vol: 0.14, drift: 0.09, lot: 10, seed: 5006, decimals: 2 },
];

const bySymbol = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

export const getInstrument = (symbol) => bySymbol.get(String(symbol || '').toUpperCase()) || null;

export const listInstruments = (market) => {
  const all = market && market !== 'all' ? INSTRUMENTS.filter((i) => i.market === market) : INSTRUMENTS;
  return all.map((i) => ({
    symbol: i.symbol,
    name: i.name,
    market: i.market,
    sector: i.sector,
    lot: i.lot,
    decimals: i.decimals ?? 2,
    index: !!i.index,
    expiryDays: i.expiryDays ?? null,
  }));
};

export const marketOf = (symbol) => getInstrument(symbol)?.market || null;
