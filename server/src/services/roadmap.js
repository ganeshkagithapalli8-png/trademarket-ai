/**
 * The 14-step path. This is the gate: the bot cannot be armed for live
 * paper-trading until every module below is completed.
 *
 * Order is deliberate — basics → price action → structure → risk → one strategy
 * → backtesting → code → data → ML → build → backtest the bot → paper trade →
 * improve/monitor → only then *consider* live trading (which this app does not
 * do at all).
 */

export const ROADMAP = [
  {
    id: 'trading-basics',
    step: 1,
    title: 'Learn Trading Basics',
    tagline: 'What a market actually is, and who is on the other side of your order.',
    minutes: 25,
    lessons: [
      { id: 'b1', title: 'Investing vs trading', body: 'An investor buys a claim on future cash flows and holds for years. A trader buys a price movement and holds for minutes to weeks. Neither is superior, but they use different tools and — critically — different risk budgets. Almost every blown account comes from a trader holding a losing position with an investor\'s excuse ("it\'ll come back").' },
      { id: 'b2', title: 'Orders, bids and the spread', body: 'Every exchange is an auction. The bid is what buyers will pay, the ask is what sellers want; the gap is the spread, and you pay it twice — once entering, once leaving. A market order takes liquidity now at whatever price exists. A limit order offers a price and waits. On illiquid instruments the spread alone can exceed your entire expected profit.' },
      { id: 'b3', title: 'Long vs short', body: 'Long = buy now, sell later; you profit when price rises, and your maximum loss is the amount invested. Short = sell borrowed units first, buy back later; you profit when price falls, but your maximum loss is theoretically unlimited because price can rise without bound. This asymmetry is the single most important fact about derivatives.' },
      { id: 'b4', title: 'Leverage and margin', body: 'Leverage multiplies both directions equally. 10× leverage means a 10% adverse move wipes out 100% of your margin. Brokers close you out before you go negative — that is a margin call, and it happens at the worst possible price. SEBI requires brokers to collect upfront margin precisely so retail traders cannot silently over-leverage.' },
      { id: 'b5', title: 'Costs that eat strategies', body: 'Brokerage, STT, exchange transaction charges, GST, stamp duty, SEBI turnover fee and slippage. For intraday equity in India these typically total 0.05–0.15% per round trip. A strategy that "works" at 0.03% average edge is, after costs, a guaranteed loser. Always subtract costs before believing any backtest.' },
    ],
    quiz: [
      { q: 'You short a stock at ₹500. What is your maximum possible loss?', options: ['₹500 per share', 'Unlimited in principle', 'Zero, since you sold first', '25% of ₹500'], answer: 1, why: 'A short position loses as price rises, and price has no upper bound. This is why shorts need hard stops.' },
      { q: 'With 10× leverage, roughly what adverse move wipes out your margin?', options: ['50%', '25%', '10%', '1%'], answer: 2, why: 'Leverage is symmetric: 10% against you at 10× is −100% of the margin posted.' },
      { q: 'A backtest shows a 0.04% average edge per round trip. Indian intraday costs are ~0.10%. What is the realistic outcome?', options: ['Profitable, but slowly', 'Break-even', 'A net loser', 'Depends on the win rate'], answer: 2, why: 'Costs exceed the edge. No win rate rescues a negative expectancy — it only changes the shape of the loss curve.' },
    ],
  },
  {
    id: 'candlesticks',
    step: 2,
    title: 'Candlesticks + Price Action',
    tagline: 'Reading who won the battle inside a time bar.',
    minutes: 30,
    lessons: [
      { id: 'c1', title: 'Anatomy of a candle', body: 'Open, high, low, close. The body is |close − open|; the wicks are the ground that was taken and then given back. A long lower wick after a fall means sellers pushed price down and buyers absorbed everything — that is information about intent, not a prediction.' },
      { id: 'c2', title: 'Single-candle signals', body: 'Doji (body ≈ 0): indecision, meaningful only after a strong run. Hammer (long lower wick, small body at the top): rejection of lower prices. Shooting star / hanging man (long upper wick): rejection of higher prices. Marubozu (almost no wicks): one side controlled the entire bar.' },
      { id: 'c3', title: 'Two- and three-candle patterns', body: 'Bullish engulfing: a green body that fully contains the prior red body. Bearish engulfing: the mirror. Morning star / evening star: a large candle, a small indecisive one, then a large candle in the new direction. These are probabilistic edges at best — published hit rates for candlestick patterns hover barely above 50%.' },
      { id: 'c4', title: 'Context beats pattern', body: 'A hammer in the middle of a range is noise. A hammer at a tested support level, on rising volume, against an uptrend, is a signal. Pattern recognition without location is the most common beginner trap — the chart is a sentence, and a pattern is only one word.' },
    ],
    quiz: [
      { q: 'A candle has a very small body and a long lower wick after a downtrend. This is called:', options: ['Shooting star', 'Hammer', 'Marubozu', 'Spinning top'], answer: 1, why: 'Long lower wick, small body near the high, after a decline = hammer, showing rejection of lower prices.' },
      { q: 'What makes a candlestick pattern meaningful rather than noise?', options: ['The size of the candle', 'Its location relative to structure and trend', 'The timeframe', 'Volume being low'], answer: 1, why: 'Context — support/resistance, trend direction and volume — is what converts a shape into evidence.' },
      { q: 'Published hit rates for standalone candlestick patterns are roughly:', options: ['85–90%', '70–75%', 'Barely above 50%', 'Under 30%'], answer: 2, why: 'Alone they are close to a coin flip. Any real edge comes from filters, location and risk/reward asymmetry.' },
    ],
  },
  {
    id: 'support-resistance',
    step: 3,
    title: 'Support / Resistance + Trends',
    tagline: 'Structure — the map you trade against.',
    minutes: 30,
    lessons: [
      { id: 's1', title: 'Defining a trend', body: 'Higher highs and higher lows = uptrend. Lower highs and lower lows = downtrend. Neither = range. This is Dow\'s definition and it remains the most robust one because it is falsifiable: the trend is over the moment the sequence breaks.' },
      { id: 's2', title: 'Drawing levels that mean something', body: 'Use zones, not lines — price reverses in an area where multiple touches cluster. Prefer levels formed on higher timeframes; a daily level beats a 5-minute level. A level tested three or more times is weaker, not stronger: each test consumes resting orders.' },
      { id: 's3', title: 'Polarity: resistance becomes support', body: 'When a ceiling breaks and holds on the retest, it becomes a floor. Trapped short-sellers now need price to stay up to avoid losses, and their covering is what makes the retest hold. The same logic mirrors on breakdowns.' },
      { id: 's4', title: 'Moving averages as dynamic levels', body: 'The 20/50/200 EMAs act as trending support/resistance. Price above a rising 200-EMA in an uptrend = pullback territory. The 9/21 EMA cross is the standard short-term momentum trigger — and it whipsaws constantly in ranges, which is exactly why module 5 pairs it with a filter.' },
    ],
    quiz: [
      { q: 'Which sequence defines an uptrend?', options: ['Higher highs and higher lows', 'Lower highs and lower lows', 'Equal highs and equal lows', 'High volume and small candles'], answer: 0, why: 'Higher highs and higher lows. The trend is invalidated the moment a prior low breaks.' },
      { q: 'A resistance level breaks. What is the classic confirmation?', options: ['Immediately buy the breakout', 'Wait for a retest that holds as support', 'Wait for volume to fall', 'Sell it'], answer: 1, why: 'The retest-and-hold (polarity flip) confirms the break and gives a defined invalidation point, unlike chasing.' },
      { q: 'Why do support/resistance zones beat single lines?', options: ['They look cleaner', 'Orders cluster across a price area, not one exact tick', 'Exchanges publish them', 'They reduce lag'], answer: 1, why: 'Real order flow sits in bands. Treating a level as a zone prevents being stopped out by normal noise.' },
    ],
  },
  {
    id: 'risk-management',
    step: 4,
    title: 'Risk Management',
    tagline: 'The only module that is genuinely non-negotiable.',
    minutes: 35,
    lessons: [
      { id: 'r1', title: 'Position sizing from risk', body: 'Decide the rupee amount you will lose if the trade fails — say 1% of capital. Then size = riskAmount ÷ (entry − stop). Never the reverse. This single formula makes every trade cost the same whether it is a volatile F&O contract or a sleepy large-cap.' },
      { id: 'r2', title: 'The ruin maths', body: 'A 50% loss needs a 100% gain to recover. A 90% loss needs 900%. Consecutive 5% losses at full size end an account in weeks. Drawdown is asymmetric and brutal, which is why professionals obsess over the downside and treat upside as a by-product.' },
      { id: 'r3', title: 'Risk:reward and expectancy', body: 'Expectancy = (winRate × avgWin) − (lossRate × avgLoss). At 1:2 risk/reward you can be right only 34% of the time and still break even. At 1:1 you need over 50%. Most retail traders invert this — taking 1:0.5 with a 60% win rate, which has negative expectancy.' },
      { id: 'r4', title: 'Correlation and portfolio heat', body: 'Three long positions in HDFC Bank, ICICI Bank and Bank Nifty futures are one trade, sized 3×. Cap total open risk ("portfolio heat") at 3–6% of capital regardless of how many positions you hold.' },
      { id: 'r5', title: 'Daily loss limit and the kill switch', body: 'Set a hard daily stop — commonly 2–3% of capital — after which you do not trade again that day. Losses cluster emotionally: the third loss of the day is revenge, not analysis. The simulator enforces this and refuses new entries once the limit is hit.' },
    ],
    quiz: [
      { q: 'Capital ₹100,000, risk 1% per trade, entry ₹500, stop ₹490. How many shares?', options: ['20', '100', '200', '1,000'], answer: 1, why: 'Risk amount = ₹1,000. Risk per share = ₹10. Size = 1000 ÷ 10 = 100 shares.' },
      { q: 'At 1:2 risk/reward, what win rate breaks even (ignoring costs)?', options: ['50%', '40%', 'About 33%', '25%'], answer: 2, why: 'Expectancy = 0 when winRate×2 = (1−winRate)×1 → winRate ≈ 33.3%.' },
      { q: 'You lose 40% of your capital. What gain recovers it?', options: ['40%', '55%', 'About 67%', '80%'], answer: 2, why: '₹100 → ₹60 needs +₹40 on ₹60 = 66.7%. Drawdown recovery is always worse than the drawdown.' },
    ],
  },
  {
    id: 'one-strategy',
    step: 5,
    title: 'Learn ONE Trading Strategy',
    tagline: 'Depth over breadth. One edge, understood completely.',
    minutes: 30,
    lessons: [
      { id: 'o1', title: 'Why one strategy', body: 'Ten half-learned strategies produce ten sets of mistakes and no statistics. One strategy traded 100 times produces a measurable expectancy you can actually improve. Specialisation is the only realistic edge a retail participant has over institutions.' },
      { id: 'o2', title: 'The trend-pullback strategy (used by the simulator bot)', body: 'Regime filter: price above the 50-period SMA and 9-EMA above 21-EMA. Trigger: RSI(14) dips below 40 then crosses back above it during the pullback. Entry: on the trigger candle\'s close. Stop: 1.5 × ATR(14) below entry, or below the nearest swing low — whichever is tighter. Target: 2 × the stop distance. Skip: if the entry candle closes beyond 60% of its range away from support.' },
      { id: 'o3', title: 'Writing it down so it is falsifiable', body: 'A strategy is only real if a stranger could execute it identically. Specify the instrument, timeframe, regime filter, exact trigger, stop rule, target rule, position size, session window and — most importantly — the conditions under which you will NOT take the trade.' },
      { id: 'o4', title: 'Known failure modes', body: 'Trend-pullback dies in ranges: the EMA cross whipsaws and RSI resets produce repeated small losses. It also underperforms around events (earnings, RBI policy, budget) when gaps jump the stop. Expect 5–8 consecutive losses in a choppy quarter — that is normal, not broken.' },
    ],
    quiz: [
      { q: 'In the simulator\'s trend-pullback strategy, where does the stop go?', options: ['A fixed 2% below entry', '1.5 × ATR(14) below entry, or the nearest swing low if tighter', 'At the 200 EMA', 'There is no stop; targets only'], answer: 1, why: 'ATR-based stops adapt to each instrument\'s volatility, which is what keeps risk per trade constant.' },
      { q: 'When does a trend-pullback strategy typically lose money?', options: ['In strong trends', 'In sideways, chopping markets', 'On high volume days', 'Never'], answer: 1, why: 'Without a trend, every pullback "resumption" signal fails. That is why the regime filter exists.' },
      { q: 'How many strategies should a beginner run live at once?', options: ['One, deeply understood', 'Three for diversification', 'Five', 'As many as possible'], answer: 0, why: 'You need enough identical samples to measure expectancy. Spreading across strategies destroys that.' },
    ],
  },
  {
    id: 'backtesting',
    step: 6,
    title: 'Backtesting',
    tagline: 'Prove it on history before you risk anything.',
    minutes: 35,
    lessons: [
      { id: 'k1', title: 'What a backtest can and cannot tell you', body: 'It can show whether a rule set had positive expectancy on past data and how painful the drawdowns were. It cannot prove the edge persists. Markets are non-stationary — a rule that worked 2019–2021 may be arbitraged away by the time you deploy it.' },
      { id: 'k2', title: 'The five ways to lie to yourself', body: '(1) Lookahead bias — using a value not knowable at decision time, e.g. the day\'s close to decide that morning\'s entry. (2) Survivorship bias — testing only on stocks that exist today. (3) Overfitting — tuning parameters until the past looks perfect. (4) Ignoring costs and slippage. (5) Testing too few trades: 30 samples tells you almost nothing.' },
      { id: 'k3', title: 'In-sample vs out-of-sample', body: 'Optimise on one period (in-sample), then validate on a later period the parameters never saw (out-of-sample). If performance collapses out-of-sample, you overfit. Walk-forward analysis repeats this on rolling windows and is the standard for anything serious.' },
      { id: 'k4', title: 'Metrics that matter, in order', body: 'Number of trades (need ≥100), max drawdown, profit factor (gross profit ÷ gross loss; >1.3 is respectable), expectancy per trade, Sharpe/Sortino, and the longest losing streak — because the streak, not the average, is what makes people quit or oversize.' },
    ],
    quiz: [
      { q: 'You decide a long entry using the day\'s closing price, executed at that same close. What is the problem?', options: ['Nothing, that is standard', 'Lookahead bias — the close is not knowable when the entry is placed', 'Survivorship bias', 'Overfitting'], answer: 1, why: 'You used information unavailable at decision time. Enter on the NEXT bar\'s open instead.' },
      { q: 'What is the minimum trade count before a backtest means much?', options: ['10', '30', 'Around 100+', '5'], answer: 2, why: 'Statistical significance needs volume. With 20 trades, luck dominates skill entirely.' },
      { q: 'A strategy shows a profit factor of 1.05 after costs. Verdict?', options: ['Excellent', 'Marginally positive and almost certainly not robust', 'Negative', 'Needs more leverage'], answer: 1, why: 'A 5% gross margin over costs vanishes under any small change in slippage or regime.' },
    ],
  },
  {
    id: 'python-basics',
    step: 7,
    title: 'Python Basics',
    tagline: 'The language of the tooling you will actually use.',
    minutes: 40,
    lessons: [
      { id: 'p1', title: 'Why Python', body: 'It is the lingua franca of quant finance: pandas, NumPy, scikit-learn, vectorbt, backtrader, and every Indian broker SDK (kiteconnect, upstox-python, smartapi) ship Python clients first. You do not need to be a software engineer — you need to read data, loop over it, and plot it.' },
      { id: 'p2', title: 'The core you need', body: 'Variables and types; lists and dicts; for/while loops; if/elif/else; functions with default arguments; list comprehensions; try/except; f-strings; and importing modules. That is genuinely enough to write a backtester.' },
      { id: 'p3', title: 'Virtual environments and packages', body: '`python -m venv .venv`, activate it, then `pip install pandas numpy matplotlib`. Isolating dependencies prevents the version conflicts that break half of all beginner projects. Commit a requirements.txt so the environment is reproducible.' },
      { id: 'p4', title: 'A minimal backtest loop', body: 'Load a price series, compute an indicator column, iterate rows, track a position variable, apply the entry/exit rules, accumulate P&L into a list, then plot the equity curve. Roughly 40 lines. Every professional system is that same loop with better data and more careful accounting.' },
    ],
    quiz: [
      { q: 'Which command installs pandas into the active environment?', options: ['npm install pandas', 'pip install pandas', 'apt install pandas', 'python pandas.py'], answer: 1, why: 'pip is Python\'s package installer. npm is for Node.js.' },
      { q: 'What does `python -m venv .venv` do?', options: ['Runs a backtest', 'Creates an isolated virtual environment', 'Installs Python', 'Deletes cached packages'], answer: 1, why: 'It creates a self-contained environment so project dependencies never conflict globally.' },
      { q: 'In a backtest loop, what does the `position` variable typically hold?', options: ['The account password', 'Current exposure: flat, long, or short', 'The broker name', 'The number of CPU cores'], answer: 1, why: 'Position state drives P&L accounting: flat → no exposure; long/short → mark-to-market each bar.' },
    ],
  },
  {
    id: 'pandas-numpy',
    step: 8,
    title: 'Pandas + NumPy',
    tagline: 'Turning raw price data into testable features.',
    minutes: 40,
    lessons: [
      { id: 'n1', title: 'Series and DataFrame', body: 'A Series is a labelled 1-D array; a DataFrame is a table of them sharing an index. For OHLCV data the index is the timestamp and the columns are open/high/low/close/volume. Almost every bug in beginner quant code is an index misalignment.' },
      { id: 'n2', title: 'Vectorised indicator calculation', body: '`df["sma20"] = df["close"].rolling(20).mean()` computes a moving average for every row in one call. `df["ret"] = df["close"].pct_change()` gives returns. `.shift(1)` moves a column down one row — the single most important function for avoiding lookahead bias.' },
      { id: 'n3', title: 'NumPy for the maths', body: 'Arrays, broadcasting, and functions like np.log, np.exp, np.std, np.cumsum. `np.cumsum(returns)` builds an equity curve. NumPy operates in compiled C loops, so it is 100× faster than a Python for-loop over the same data.' },
      { id: 'n4', title: 'Cleaning real data', body: 'Handle NaNs from rolling windows (`.dropna()` or `.bfill()`), remove zero/negative prices, align two series with `.reindex()`, resample timeframes with `.resample("1D").agg({...})`, and watch for timezone issues — Indian market data is IST, crypto is usually UTC.' },
    ],
    quiz: [
      { q: 'Which line correctly computes a 20-period simple moving average?', options: ['df["close"].mean(20)', 'df["close"].rolling(20).mean()', 'df.rolling(20)["close"]', 'np.mean(df, 20)'], answer: 1, why: '`.rolling(window).mean()` is the pandas idiom; it produces NaN for the first 19 rows.' },
      { q: 'What is `.shift(1)` mainly used for?', options: ['Sorting rows', 'Avoiding lookahead bias by aligning a signal to the next bar', 'Removing duplicates', 'Converting to numpy'], answer: 1, why: 'A signal computed on bar t can only be acted on at bar t+1. shift(1) enforces that.' },
      { q: 'Why is vectorised NumPy/pandas code much faster than a Python loop?', options: ['It uses multiple CPU cores by default', 'Operations run in compiled C over contiguous arrays', 'It skips error checking', 'It caches to disk'], answer: 1, why: 'The interpreter overhead per element disappears; work happens in tight compiled loops.' },
    ],
  },
  {
    id: 'machine-learning',
    step: 9,
    title: 'Machine Learning',
    tagline: 'What ML can honestly do for a retail trader — and what it cannot.',
    minutes: 45,
    lessons: [
      { id: 'm1', title: 'Framing it as classification', body: 'Predict not the price but a label: "was the next N-bar return above +1 ATR?" Features are lagged returns, RSI, ATR%, distance to support/resistance, trend flag, hour-of-day. This turns an impossible forecasting problem into an ordinary binary classification one.' },
      { id: 'm2', title: 'Why financial ML is harder than it looks', body: 'Financial data has an extremely low signal-to-noise ratio, is non-stationary, and is serially correlated. Standard random train/test splits leak information across time — you must use time-based splits and purged/embargoed cross-validation. A model with 99% accuracy here is almost certainly leaking.' },
      { id: 'm3', title: 'Models, simplest first', body: 'Logistic regression gives you coefficients you can read and debug. Gradient-boosted trees (LightGBM/XGBoost) usually win on tabular market features. Deep learning rarely justifies its complexity for a single-instrument retail strategy. Always compare against a dumb baseline: "always predict the majority class."' },
      { id: 'm4', title: 'Overfitting and feature importance', body: 'With 30 features and 500 rows you will fit noise. Regularise (L1/L2), limit tree depth, and check that the important features make economic sense. If the model relies on a feature you cannot explain, do not trade it.' },
      { id: 'm5', title: 'What the simulator\'s bot actually uses', body: 'A small online logistic scorer trained on the bot\'s own closed paper trades, combined with per-setup frequency statistics. Deliberately simple: at retail sample sizes, a transparent model you understand beats a complex one you cannot debug.' },
    ],
    quiz: [
      { q: 'Why must financial ML use time-based splits instead of random ones?', options: ['It is faster', 'Random splits leak future information into training', 'Libraries require it', 'It reduces memory use'], answer: 1, why: 'Adjacent rows are correlated. A random split lets the model memorise neighbours, inflating accuracy.' },
      { q: 'A market model reports 99% accuracy. Your first reaction?', options: ['Deploy it', 'Suspect lookahead or label leakage', 'Add more features', 'Reduce the learning rate'], answer: 1, why: 'Real market prediction accuracy is barely above chance. 99% means the data pipeline is broken.' },
      { q: 'What is the best first model to try?', options: ['A transformer', 'An LSTM', 'Logistic regression with a few interpretable features', 'A deep CNN'], answer: 2, why: 'Simple, fast, debuggable, and it gives you a real baseline. Complexity only earns its place after that.' },
    ],
  },
  {
    id: 'build-bot',
    step: 10,
    title: 'Build the AI Trading Bot',
    tagline: 'Architecture: deterministic execution, no LLM in the order path.',
    minutes: 45,
    lessons: [
      { id: 'bb1', title: 'The golden architectural rule', body: 'An LLM must never generate a live order. It is non-deterministic, has no calibrated probability, cannot be backtested, and cannot be audited. The correct split: a deterministic rules/ML engine decides and sizes trades; an LLM explains, summarises and critiques afterwards. That is exactly how this app is built.' },
      { id: 'bb2', title: 'Components', body: 'Data ingest → indicator computation → signal generator → risk gate (size, heat, daily limit, kill switch) → order builder → execution → position manager (stops/targets/trailing) → logger → performance analyser. Each is independently testable. Coupling them is how bots blow up silently.' },
      { id: 'bb3', title: 'The risk gate is the most important component', body: 'Every order passes through it. It enforces max risk per trade, max portfolio heat, max open positions, daily loss limit, instrument whitelist, and a kill switch. If the gate says no, nothing trades — regardless of how confident the signal looks.' },
      { id: 'bb4', title: 'Idempotency and failure handling', body: 'Network calls fail. Retries must not double-submit an order — use a client-side order id the exchange deduplicates on. Persist state before acting, handle partial fills, and log everything with timestamps. A bot that cannot recover from a restart mid-position is dangerous.' },
    ],
    quiz: [
      { q: 'Should an LLM decide live order parameters?', options: ['Yes, it is more adaptive', 'No — execution must be deterministic and auditable', 'Only for crypto', 'Only for small sizes'], answer: 1, why: 'LLMs are non-deterministic and uncalibrated. Use them for explanation and review, never for order generation.' },
      { q: 'What is the risk gate responsible for?', options: ['Finding better entries', 'Refusing orders that breach size, heat or daily-loss limits', 'Predicting volatility', 'Choosing the broker'], answer: 1, why: 'It is the last line of defence and the reason a bad signal becomes a small loss instead of a catastrophic one.' },
      { q: 'Why does order submission need idempotency keys?', options: ['To reduce latency', 'So a retry after a timeout cannot create a duplicate order', 'For encryption', 'To compress payloads'], answer: 1, why: 'Network timeouts leave you unsure whether the order landed. A dedupe key makes retries safe.' },
    ],
  },
  {
    id: 'backtest-bot',
    step: 11,
    title: 'Backtest the Bot',
    tagline: 'The same rules, run over history, with costs included.',
    minutes: 35,
    lessons: [
      { id: 'bt1', title: 'Replay, don\'t reimplement', body: 'Run the exact production decision code over historical bars. A separate backtest implementation will diverge from live behaviour and teach you nothing about the real bot.' },
      { id: 'bt2', title: 'Model the frictions', body: 'Include commission, exchange fees, slippage (a few bps, or one tick), and bid-ask spread. Fill at the NEXT bar\'s open, never the signal bar\'s close. Reject fills you could not realistically have got — limit orders inside the bar\'s range only.' },
      { id: 'bt3', title: 'Stress it', body: 'Vary the parameters ±20% and check the result degrades gracefully rather than collapsing (a sharp peak means overfitting). Test on 2020 crash, 2021 melt-up, and a flat year separately. Monte-Carlo shuffle the trade order to see the drawdown distribution you could have faced.' },
      { id: 'bt4', title: 'Reading the report', body: 'Trades, win rate, profit factor, expectancy, max drawdown, longest losing streak, average holding time, and performance by regime. If any single trade contributes most of the profit, you do not have a strategy — you have one lucky event.' },
    ],
    quiz: [
      { q: 'Where should a backtest fill an order generated on bar t?', options: ['Bar t\'s close', 'Bar t+1\'s open', 'Bar t\'s high', 'Wherever is most favourable'], answer: 1, why: 'Filling at the signal bar\'s close is lookahead bias. The next open is the earliest honest execution.' },
      { q: 'A parameter sweep shows a sharp performance peak at exactly RSI=37. What does that suggest?', options: ['A robust edge', 'Overfitting', 'Low volatility', 'Correct costs'], answer: 1, why: 'Robust strategies have broad plateaus. Sharp peaks are fitted noise.' },
      { q: 'Why shuffle trade order in a Monte-Carlo test?', options: ['To increase returns', 'To estimate the distribution of drawdowns you could have faced', 'To reduce costs', 'To test the API'], answer: 1, why: 'The realised sequence is one draw from many. Shuffling reveals how bad the path risk really is.' },
    ],
  },
  {
    id: 'paper-trade',
    step: 12,
    title: 'Paper Trade',
    tagline: 'Where this app lives. Minimum 60–90 days, minimum 100 trades.',
    minutes: 30,
    lessons: [
      { id: 'pt1', title: 'What paper trading proves', body: 'It validates the plumbing — data, signals, sizing, stops, logging — and it trains your process discipline. It does NOT validate your psychology, because nothing real is at stake. Treat it as an engineering test, not an emotional rehearsal.' },
      { id: 'pt2', title: 'Run it like it is real', body: 'Fixed capital, fixed risk per trade, no manual overrides, no "just this once" exceptions, every trade journaled. The moment you intervene by hand the sample stops measuring the system and starts measuring your impulses.' },
      { id: 'pt3', title: 'Sample size and patience', body: 'Aim for at least 100 trades or 60–90 calendar days, whichever comes later. Fewer than that and win rate estimates have error bars wider than the edge itself. Review weekly, change nothing mid-sample.' },
      { id: 'pt4', title: 'What the simulator tracks for you', body: 'Every closed position is written to trade memory with its entry-time features, setup label, R-multiple and outcome. The bot then recomputes per-setup expectancy and adjusts its own entry filters — a real, inspectable feedback loop rather than a black box.' },
    ],
    quiz: [
      { q: 'What paper trading CANNOT validate?', options: ['Signal logic', 'Position sizing', 'Your emotional response to real losses', 'Logging and reporting'], answer: 2, why: 'With no real money at stake, fear and greed are absent — the two things that break most traders.' },
      { q: 'Minimum sensible paper-trading sample before drawing conclusions?', options: ['10 trades', '25 trades', 'About 100 trades or 60–90 days', '500 trades'], answer: 2, why: 'Below ~100 samples, the confidence interval on win rate is too wide to distinguish skill from luck.' },
      { q: 'Mid-sample you spot a losing streak and want to change a parameter. Correct action?', options: ['Change it immediately', 'Finish the sample, then change it deliberately', 'Double the size to recover', 'Stop paper trading'], answer: 1, why: 'Changing rules mid-sample invalidates the statistics. Losing streaks are expected, not evidence of a broken system.' },
    ],
  },
  {
    id: 'improve-monitor',
    step: 13,
    title: 'Improve + Monitor',
    tagline: 'Continuous review, drift detection, and disciplined iteration.',
    minutes: 30,
    lessons: [
      { id: 'im1', title: 'The review cadence', body: 'Daily: check open risk and that the kill switch works. Weekly: per-setup expectancy, slippage versus assumption, any rule you broke. Monthly: full re-backtest on fresh data, parameter stability check, cost review.' },
      { id: 'im2', title: 'Detecting decay', body: 'Regimes change and edges die. Watch a rolling 30-trade expectancy; if it crosses zero and stays there, the setup is impaired. Compare realised volatility to what the model assumed — persistent divergence means the sizing is wrong even if the direction is right.' },
      { id: 'im3', title: 'Change one variable at a time', body: 'If you alter the entry filter, the stop multiplier and the size in the same week, you learn nothing. Version your strategy, log the version with every trade, and compare versions on equal samples.' },
      { id: 'im4', title: 'Monitoring that catches real failures', body: 'Alert on: no trades for N sessions (data feed dead), position without a stop (bug), daily loss limit breached, P&L diverging from expected by more than 3 ATR, and any order rejected. Silent failure costs far more than loud failure.' },
    ],
    quiz: [
      { q: 'A rolling 30-trade expectancy has been negative for six weeks. Best response?', options: ['Increase size to recover', 'Treat the setup as impaired and stop trading it', 'Ignore it — sample too small', 'Switch to a new untested strategy'], answer: 1, why: 'Persistent negative expectancy is decay, not noise. Stop, re-backtest, and only resume with evidence.' },
      { q: 'Why version your strategy and tag every trade with the version?', options: ['For tax records', 'So performance comparisons are between equal, known rule sets', 'To speed up execution', 'The exchange requires it'], answer: 1, why: 'Without versioning you cannot attribute a performance change to a rule change.' },
      { q: 'Which alert matters most operationally?', options: ['A winning trade', 'An open position with no stop attached', 'A news headline', 'A rising RSI'], answer: 1, why: 'That is a bug with unlimited downside. Everything else on the list is routine.' },
    ],
  },
  {
    id: 'live-considerations',
    step: 14,
    title: 'Only Then Consider Live Trading',
    tagline: 'The legal and practical reality — and why this app stops at the line.',
    minutes: 35,
    lessons: [
      { id: 'lv1', title: 'The prerequisites are legal, not technical', body: 'In India you must be 18+, KYC-verified, and hold an account with a SEBI-registered broker. Retail algo orders must route through that broker\'s approved API infrastructure — direct exchange access is not available to retail. Registered algos carry a unique Algo ID for traceability, and brokers enforce order-rate thresholds.' },
      { id: 'lv2', title: 'If you ever offer it to other people', body: 'Then you are an algo provider, not a hobbyist. Exchange empanelment applies; black-box logic additionally requires SEBI Research Analyst registration with a maintained research report; and holding or managing client money pulls in PMS/AIF/advisory registration. Crypto custody needs FIU-IND registration; leveraged forex must go through an RBI-authorised dealer. None of this is achievable in an afternoon, and building it without registration is a criminal matter, not a technical one.' },
      { id: 'lv3', title: 'The honest performance expectation', body: 'SEBI\'s own study of retail F&O traders found the overwhelming majority lose money, with average losses material relative to income. Any product promising otherwise is either lying or selling something else. A retail edge, if one exists, is small, fragile and capacity-limited.' },
      { id: 'lv4', title: 'A safe personal path, if you ever choose it', body: 'Your own money, your own broker account, your own API key, a deterministic strategy you wrote and backtested, small fixed risk per trade, a working kill switch, and a human confirming each session\'s arming. Start at one-tenth of your intended size. Money should never sit in an app\'s custody, and no LLM should ever choose an order.' },
      { id: 'lv5', title: 'Why TradeMarket AI stops here', body: 'This application deliberately has no payment gateway, no custody of funds, no broker order-routing code, and no live capital of any kind. That is a design decision, not a missing feature. Complete the first thirteen modules, run the bot on paper for a quarter, and you will know more than most people who do go live.' },
    ],
    quiz: [
      { q: 'Minimum legal age to open a trading/demat account in India?', options: ['16', '18', '21', 'No minimum'], answer: 1, why: '18+ with full KYC. Contracts with minors are void, which is why brokers enforce this.' },
      { q: 'How must a retail algo order reach the exchange?', options: ['Direct exchange connection', 'Through a SEBI-registered broker\'s approved API', 'Via any REST API', 'Through a Telegram bot'], answer: 1, why: 'Retail cannot connect directly. The broker layer provides validation, risk checks and supervision.' },
      { q: 'What is required to hold and trade other people\'s money in India?', options: ['Nothing, if the code is good', 'SEBI registration (PMS / AIF / adviser) and related compliance', 'A GST number', 'A domain name'], answer: 1, why: 'Custody and management of client funds is a regulated activity. Operating unregistered is illegal.' },
    ],
  },
];

export const MODULE_IDS = ROADMAP.map((m) => m.id);

export const getModule = (id) => ROADMAP.find((m) => m.id === id) || null;
export const getModuleByStep = (n) => ROADMAP.find((m) => m.step === n) || null;

/**
 * A module is unlocked when every earlier module is completed.
 * Module 14 unlocks the *knowledge*, never live trading — the app has none.
 */
export function roadmapWithStatus(progress = {}) {
  return ROADMAP.map((m, idx) => {
    const own = progress[m.id] || {};
    const priorComplete = ROADMAP.slice(0, idx).every((p) => progress[p.id]?.status === 'completed');
    let status = own.status || 'locked';
    if (status === 'locked' && priorComplete) status = 'available';
    if (status !== 'completed' && !priorComplete && idx > 0) status = 'locked';
    return {
      ...m,
      status,
      quizScore: own.quiz_score ?? null,
      quizAttempts: own.quiz_attempts ?? 0,
      lessonsRead: own.lessons_read ?? [],
      completedAt: own.completed_at ?? null,
    };
  });
}

/** The bot may only run once modules 1–13 are done. Module 14 is knowledge. */
export const BOT_ARMABLE_MODULES = ROADMAP.filter((m) => m.step <= 13).map((m) => m.id);

/** Extra gates on top of the roadmap, per market. */
export const MARKET_GATES = {
  fno: ['risk-management'],
  forex: ['risk-management'],
  stocks: [],
  ipo: [],
  crypto: [],
};
