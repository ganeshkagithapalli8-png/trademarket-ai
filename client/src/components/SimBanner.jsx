import { useState } from 'react';
import { Icon } from './ui.jsx';

/**
 * Persistent honesty banner. This is a design decision, not decoration:
 * anyone who lands here should be able to tell within two seconds that no real
 * money is involved. Dismissible per session, never removed from the codebase.
 */
export function SimBanner({ compact = false }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem('tm_simbanner') === '1';
    } catch {
      return false;
    }
  });

  if (hidden) return null;

  const hide = () => {
    try {
      sessionStorage.setItem('tm_simbanner', '1');
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <div className="border-b border-amber-200/70 bg-gradient-to-r from-amber-50 via-amber-50/90 to-orange-50">
      <div className="mx-auto flex max-w-7xl items-center gap-2.5 px-3 py-2 sm:px-5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-amber-500 text-white">
          <Icon name="shield" className="h-3.5 w-3.5" stroke={2.4} />
        </span>
        <p className="min-w-0 flex-1 text-[11.5px] font-semibold leading-snug text-amber-900 sm:text-[12.5px]">
          {compact ? (
            <>Paper trading — simulated money only.</>
          ) : (
            <>
              <span className="font-extrabold">Paper trading simulator.</span> Every rupee here is simulated. No deposits,
              no broker connection, no live orders, no investment advice. 18+ only.
            </>
          )}
        </p>
        <button
          onClick={hide}
          aria-label="Dismiss"
          className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-amber-700/60 transition hover:bg-amber-100 hover:text-amber-900"
        >
          <Icon name="x" className="h-3.5 w-3.5" stroke={2.6} />
        </button>
      </div>
    </div>
  );
}

export default SimBanner;
