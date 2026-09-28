/** Shared UI kit. Inline SVG icons only — no icon fonts, no network requests. */

import { useEffect, useRef, useState } from 'react';

// ── icons ───────────────────────────────────────────────────────────────────

const PATHS = {
  home: 'M3 10.5L12 3l9 7.5M5 9.5V21h14V9.5',
  chart: 'M3 3v18h18M7 15l3.5-4.5 3 3L21 6',
  book: 'M4 4.5A2.5 2.5 0 016.5 2H20v18H6.5A2.5 2.5 0 004 22V4.5zM4 17.5A2.5 2.5 0 016.5 15H20',
  bot: 'M12 2v3M5 10a7 7 0 0114 0v6a3 3 0 01-3 3H8a3 3 0 01-3-3v-6zM9 12h.01M15 12h.01M2 13v3M22 13v3',
  wallet: 'M3 7.5A2.5 2.5 0 015.5 5H18v3M3 7.5V18a2 2 0 002 2h14a2 2 0 002-2v-3M3 7.5h16.5A1.5 1.5 0 0121 9v3h-4a2 2 0 000 4h4',
  news: 'M4 5h13v14H5a1 1 0 01-1-1V5zM17 8h3v9a2 2 0 01-2 2M7 9h7M7 12h7M7 15h4',
  note: 'M6 2h9l5 5v15H6V2zM15 2v5h5M9 13h7M9 17h5',
  journal: 'M5 3h11l3 3v15H5V3zM9 3v18M12 9h4M12 13h4',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5',
  edit: 'M11 4H4v16h16v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
  lock: 'M5 11h14v10H5V11zM8 11V7a4 4 0 118 0v4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  alert: 'M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
  refresh: 'M21 12a9 9 0 11-3-6.7M21 3v6h-6',
  play: 'M6 3l14 9-14 9V3z',
  stop: 'M6 6h12v12H6z',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  target: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z',
  layers: 'M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
  expand: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
};

export function Icon({ name, className = 'h-5 w-5', stroke = 1.9 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function Logo({ className = 'h-9 w-9' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tm-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6090FA" />
          <stop offset="100%" stopColor="#2551EB" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#tm-logo)" />
      <path d="M7 21.5l4.6-6.6 3.7 3.6L21 10l4 5.4" stroke="white" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21" cy="10" r="2" fill="white" />
    </svg>
  );
}

// ── primitives ──────────────────────────────────────────────────────────────

const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm shadow-brand-600/25 disabled:bg-brand-300',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm shadow-rose-600/25 disabled:bg-rose-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm shadow-emerald-600/25 disabled:bg-emerald-300',
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 active:bg-brand-200 border border-brand-100',
  // For placement on dark or gradient surfaces. A real variant, not a
  // className override: overriding the variant's colour utilities from the
  // call site loses to them in Tailwind's cascade order.
  onDark: 'bg-white text-brand-700 hover:bg-brand-50 active:bg-brand-100 shadow-lg shadow-black/10',
};

const SIZES = {
  xs: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-lg',
  sm: 'h-9 px-3.5 text-[13.5px] gap-1.5 rounded-xl',
  md: 'h-11 px-5 text-[14.5px] gap-2 rounded-xl',
  lg: 'h-13 px-6 text-[15.5px] gap-2 rounded-2xl py-3.5',
  icon: 'h-9 w-9 rounded-xl justify-center',
};

export function Button({ variant = 'primary', size = 'md', icon, iconRight, loading, className = '', children, ...props }) {
  return (
    <button
      className={`inline-flex max-w-full min-w-0 items-center justify-center font-semibold transition-all duration-150 select-none
        disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.985] focus-visible:outline-none
        focus-visible:ring-4 focus-visible:ring-brand-500/20 ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`}
      {...props}
      disabled={props.disabled || loading}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon ? <Icon name={icon} className={size === 'xs' || size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} className="h-4 w-4" /> : null}
    </button>
  );
}

/**
 * Wraps a live value and flashes green/red for a moment whenever it ticks.
 * This is what makes a polling number feel like a market instead of a table.
 */
export function Flash({ value, className = '', children }) {
  const prev = useRef(value);
  const [dir, setDir] = useState(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p == null || value == null || p === value) return undefined;
    setDir(value > p ? 'up' : 'down');
    const t = setTimeout(() => setDir(null), 850);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span
      className={`${className} -mx-1 rounded-md px-1 transition-colors duration-700 ${
        dir === 'up' ? 'bg-up-soft text-up-deep' : dir === 'down' ? 'bg-down-soft text-down-deep' : ''
      }`}
    >
      {children}
    </span>
  );
}

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.22" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className = '', pad = true, children, ...props }) {
  return (
    <div className={`card ${pad ? 'p-4 sm:p-5' : ''} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function SectionTitle({ icon, title, subtitle, action, className = '' }) {
  return (
    <div className={`mb-3 flex items-start justify-between gap-3 ${className}`}>
      <div className="flex items-start gap-2.5">
        {icon && (
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Icon name={icon} className="h-4 w-4" />
          </span>
        )}
        <div>
          <h2 className="text-[15px] font-bold leading-tight text-slate-900 sm:text-base">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-600',
  brand: 'bg-brand-50 text-brand-700',
  up: 'bg-up-soft text-up-deep',
  down: 'bg-down-soft text-down-deep',
  warn: 'bg-amber-50 text-amber-700',
  locked: 'bg-slate-100 text-slate-400',
  done: 'bg-emerald-50 text-emerald-700',
};

export function Badge({ tone = 'neutral', icon, className = '', children }) {
  return (
    <span className={`chip ${BADGE_TONES[tone] || BADGE_TONES.neutral} ${className}`}>
      {icon && <Icon name={icon} className="h-3 w-3" stroke={2.4} />}
      {children}
    </span>
  );
}

export function Input({ label, hint, error, icon, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <span className="relative block">
        {icon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name={icon} className="h-4 w-4" />
          </span>
        )}
        <input
          className={`field ${icon ? 'pl-10' : ''} ${error ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/10' : ''} ${className}`}
          {...props}
        />
      </span>
      {error ? (
        <span className="mt-1.5 flex items-start gap-1 text-[12px] font-medium text-rose-600">
          <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" stroke={2.2} />
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-[12px] leading-snug text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Textarea({ label, hint, error, rows = 4, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <textarea rows={rows} className={`field resize-y ${error ? 'border-rose-300' : ''} ${className}`} {...props} />
      {error ? (
        <span className="mt-1.5 block text-[12px] font-medium text-rose-600">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[12px] leading-snug text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Select({ label, hint, options, className = '', children, ...props }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <select className={`field appearance-none bg-[length:16px] bg-[right_0.85rem_center] bg-no-repeat pr-10 ${className}`}
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")" }}
        {...props}>
        {options ? options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>) : children}
      </select>
      {hint && <span className="mt-1.5 block text-[12px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description, disabled, tone = 'brand' }) {
  const on = tone === 'danger' ? 'bg-rose-500' : tone === 'success' ? 'bg-emerald-500' : 'bg-brand-600';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1.5 text-left transition disabled:opacity-50 ${disabled ? '' : 'hover:bg-slate-50'}`}
    >
      <span className="min-w-0">
        {label && <span className="block text-[13.5px] font-semibold text-slate-800">{label}</span>}
        {description && <span className="mt-0.5 block text-[12px] leading-snug text-slate-500">{description}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${checked ? on : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

export function Stat({ label, value, sub, tone = 'flat', icon, className = '' }) {
  const color = tone === 'up' ? 'text-up-deep' : tone === 'down' ? 'text-down-deep' : 'text-slate-900';
  return (
    <div className={`card p-3.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {icon && <Icon name={icon} className="h-3.5 w-3.5 text-slate-400" />}
      </div>
      <p className={`tnum mt-1.5 text-[19px] font-bold leading-none sm:text-[22px] ${color}`}>{value}</p>
      {sub && <p className={`mt-1.5 text-[12px] font-medium ${tone === 'up' ? 'text-up-deep' : tone === 'down' ? 'text-down-deep' : 'text-slate-500'}`}>{sub}</p>}
    </div>
  );
}

export function Progress({ value, max = 100, tone = 'brand', className = '', showLabel = false }) {
  const p = Math.min(100, Math.max(0, (Number(value) / (max || 1)) * 100));
  const bar = tone === 'up' ? 'bg-emerald-500' : tone === 'down' ? 'bg-rose-500' : 'bg-gradient-to-r from-brand-400 to-brand-600';
  return (
    <div className={className}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${bar}`} style={{ width: `${p}%` }} />
      </div>
      {showLabel && <p className="mt-1 text-right text-[11px] font-semibold text-slate-500 tnum">{Math.round(p)}%</p>}
    </div>
  );
}

export function Alert({ tone = 'info', title, icon, children, className = '' }) {
  const tones = {
    info: 'border-brand-200 bg-brand-50/70 text-brand-900',
    warn: 'border-amber-200 bg-amber-50/70 text-amber-900',
    danger: 'border-rose-200 bg-rose-50/70 text-rose-900',
    success: 'border-emerald-200 bg-emerald-50/70 text-emerald-900',
    neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  const ic = { info: 'info', warn: 'alert', danger: 'alert', success: 'check', neutral: 'info' };
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${tones[tone]} ${className}`}>
      <Icon name={icon || ic[tone]} className="mt-0.5 h-4 w-4 shrink-0" stroke={2.2} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'layers', title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="mt-3.5 text-[15px] font-bold text-slate-800">{title}</p>
      {message && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }) {
  return <div className={`skeleton ${className}`} />;
}

export function Tabs({ tabs, value, onChange, className = '', scrollable = true }) {
  return (
    <div className={`${scrollable ? 'overflow-x-auto no-scrollbar' : ''} ${className}`}>
      <div className="inline-flex min-w-full gap-1 rounded-xl bg-slate-100/90 p-1">
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-all ${
                active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon && <Icon name={t.icon} className="h-3.5 w-3.5" />}
              {t.label}
              {t.count != null && (
                <span className={`tnum rounded-md px-1.5 py-px text-[10.5px] font-bold ${active ? 'bg-brand-50 text-brand-700' : 'bg-slate-200/70 text-slate-500'}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[92vh] w-full ${widths[size]} animate-slide-up flex-col overflow-hidden rounded-t-3xl bg-white shadow-lift sm:rounded-3xl`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-[16px] font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <Icon name="x" className="h-4 w-4" stroke={2.4} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="safe-bottom border-t border-slate-100 bg-slate-50/60 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

/** Bottom-sheet style confirm dialog — the safest pattern on touch devices. */
export function Confirm({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'danger', busy, confirmTestId }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button data-testid={confirmTestId} variant={tone} className="flex-1" onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      }
    >
      <p className="text-[14px] leading-relaxed text-slate-600">{message}</p>
    </Modal>
  );
}

/**
 * Poll a loader on an interval; pauses when the tab is hidden.
 * Pass ms = 0 for a fetch-once hook — an interval of 0 would otherwise clamp
 * to ~4ms in browsers and hammer the API.
 */
export function usePoll(loader, ms = 15000, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const saved = useRef(loader);
  saved.current = loader;

  const run = async (silent = true) => {
    try {
      if (!silent) setLoading(true);
      const d = await saved.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.message || 'Request failed');
      if (!silent) setLoading(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run(false);
    if (!ms || ms < 1000) return undefined; // fetch-once: no polling loop
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') run(true);
    }, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refresh: () => run(false), setData };
}
