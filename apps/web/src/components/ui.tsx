import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState, ButtonHTMLAttributes } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const variants: Record<string, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark disabled:bg-ink-40',
  secondary: 'bg-white text-ink border border-line hover:bg-paper disabled:text-ink-40',
  ghost: 'text-brand hover:bg-brand-tint disabled:text-ink-40',
  danger: 'bg-danger text-white hover:bg-[#8f1d17] disabled:bg-ink-40',
  accent: 'bg-saffron text-ink hover:bg-[#c98700] disabled:bg-ink-40',
};
export function Button({ variant = 'primary', loading, className, children, small, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; loading?: boolean; small?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed', small ? 'min-h-[36px] px-3 text-[13px]' : 'min-h-[44px] px-4 text-sm', variants[variant], className)}>
      {loading && <Spinner size={14} />}{children}
    </button>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-label="Loading" role="img"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}
export const Loading = ({ label = 'Loading' }: { label?: string }) => <div className="flex items-center justify-center gap-2 py-16 text-ink-60"><Spinner /> <span>{label}…</span></div>;
export const ErrorBox = ({ error, retry }: { error: string; retry?: () => void }) => (
  <div role="alert" className="rounded-xl border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
    <p className="font-semibold">That did not load</p><p className="mt-1">{error}</p>
    {retry && <Button variant="secondary" small className="mt-3" onClick={retry}>Try again</Button>}
  </div>
);
export const Empty = ({ title, text, action }: { title: string; text?: string; action?: ReactNode }) => (
  <div className="rounded-xl border border-dashed border-line bg-white/60 p-8 text-center">
    <p className="font-display text-lg font-semibold">{title}</p>
    {text && <p className="mx-auto mt-1 max-w-md text-sm text-ink-60">{text}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => <section className={cx('rounded-xl border border-line bg-white p-4 md:p-5', className)}>{children}</section>;
export const CardTitle = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-display text-lg font-semibold">{children}</h2>{right}</div>
);

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="font-display text-2xl font-bold md:text-[28px]">{title}</h1>{subtitle && <p className="mt-1 text-sm text-ink-60">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

const tones: Record<string, string> = {
  neutral: 'bg-paper text-ink-80 border-line', brand: 'bg-brand-tint text-brand-dark border-brand/20', ok: 'bg-ok-tint text-ok border-ok/20',
  warn: 'bg-saffron-tint text-warn border-saffron/40', danger: 'bg-danger-tint text-danger border-danger/20',
};
export const Badge = ({ tone = 'neutral', children }: { tone?: keyof typeof tones; children: ReactNode }) => (
  <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>
);
const STATUS_TONE: Record<string, [string, string]> = {
  draft: ['neutral', 'Draft'], pending: ['warn', 'Waiting for advisor'], approved: ['ok', 'Approved'], changes_requested: ['danger', 'Changes requested'],
  present: ['ok', 'Present'], late: ['warn', 'Late'], absent: ['neutral', 'Absent'], active: ['ok', 'Active'], rejected: ['danger', 'Declined'],
  valid: ['ok', 'Valid'], revoked: ['danger', 'Revoked'], open: ['ok', 'Open'], closed: ['neutral', 'Closed'], completed: ['brand', 'Completed'],
};
export const StatusBadge = ({ status, label }: { status: string; label?: string }) => { const [t, l] = STATUS_TONE[status] || ['neutral', status]; return <Badge tone={t as any}>{label || l}</Badge>; };

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1 block text-sm font-semibold">{label}</span>{children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-60">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-danger">{error}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 md:items-center md:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 safe-bottom md:rounded-2xl', wide ? 'md:max-w-2xl' : 'md:max-w-lg')}>
        <div className="mb-4 flex items-start justify-between gap-3"><h2 className="font-display text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 flex h-10 w-10 items-center justify-center rounded-lg text-xl text-ink-60 hover:bg-paper">×</button></div>
        {children}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string; badge?: number }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold', value === t.id ? 'border-brand text-brand' : 'border-transparent text-ink-60 hover:text-ink')}>
          {t.label}{!!t.badge && <span className="ml-1.5 rounded-full bg-saffron px-1.5 text-xs text-ink">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- toasts ----
type Toast = { id: number; kind: 'ok' | 'error'; text: string };
const ToastCtx = createContext<{ ok: (t: string) => void; error: (t: string) => void }>({ ok() {}, error() {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ ok: (t) => push('ok', t), error: (t) => push('error', t) }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => <div key={t.id} role="status" className={cx('pointer-events-auto max-w-md rounded-lg px-4 py-3 text-sm font-medium text-white', t.kind === 'ok' ? 'bg-ink' : 'bg-danger')}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// Run an async action with toast feedback + loading state.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (success) toast.ok(success); return r; }
    catch (e: any) { toast.error(e.message || 'Something went wrong'); return undefined; }
    finally { setBusy(false); }
  }, [toast]);
  return { run, busy };
}

// The "verified" stamp: the one memorable visual of the product. Used on certificates, the verify page and the check-in result.
export function Stamp({ tone = 'ok', label = 'Verified', sub = 'CampusCred', size = 120, color: override }: { tone?: 'ok' | 'danger' | 'neutral'; label?: string; sub?: string; size?: number; color?: string }) {
  const color = override || (tone === 'ok' ? '#0E6B63' : tone === 'danger' ? '#B3261E' : '#5B6B6F');
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label} style={{ transform: 'rotate(-10deg)' }}>
      <circle cx="60" cy="60" r="54" fill="none" stroke={color} strokeWidth="3" />
      <circle cx="60" cy="60" r="46" fill="none" stroke={color} strokeWidth="1.2" />
      <text x="60" y="58" textAnchor="middle" fontFamily="Bricolage Grotesque Variable, sans-serif" fontWeight="800" fontSize="20" fill={color}>{label}</text>
      <text x="60" y="76" textAnchor="middle" fontFamily="Figtree Variable, sans-serif" fontSize="10" fill={color}>{sub}</text>
    </svg>
  );
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const d: Record<string, string> = {
    home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    users: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v3M14 20h3M20 20h1',
    award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.2 13.9L7 22l5-3 5 3-1.2-8.1',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
    chart: 'M3 3v18h18M7 14l4-4 3 3 5-6',
    flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
    wallet: 'M3 7a2 2 0 0 1 2-2h14v4M3 7v12a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2zM16 14h2',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    menu: 'M3 6h18M3 12h18M3 18h18',
    clip: 'M9 2h6v4H9zM7 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M8 12h8M8 16h6',
    send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    campus: 'M3 21h18M5 21V10l7-5 7 5v11M9 21v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4M9 10h.01M15 10h.01',
    globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 0c-2.5 3-4 6.5-4 10s1.5 7 4 10m0-20c2.5 3 4 6.5 4 10s-1.5 7-4 10M2 12h20',
    briefcase: 'M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm5 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2',
    clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5v5l3.5 2',
    check: 'M20 6L9 17l-5-5',
    close: 'M18 6L6 18M6 6l12 12',
    external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d={d[name] || d.more} /></svg>;
}
