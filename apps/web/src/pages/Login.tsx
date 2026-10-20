import { FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, Field, Stamp, useAction, useToast } from '../components/ui';
import { POSITION, ROLE } from '../lib/format';

export default function Login() {
  const { me, login } = useAuth();
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'admin' | 'advisor' | 'treasurer' | 'student'>('all');

  const { run, busy } = useAction();
  const toast = useToast();
  const demo = useApi<any>('/public/demo-accounts');

  if (me) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'password') {
      const r = await run(() => api('/auth/login', { body: { identifier, password }, auth: false }));
      if (r) await login(r.token);
    } else if (!otpSent) {
      const r = await run(() => api('/auth/otp/request', { body: { student_code: identifier }, auth: false }));
      if (r) {
        setOtpSent(true);
        toast.ok(r.devOtp ? `Demo code: ${r.devOtp}` : 'Code sent.');
        if (r.devOtp) setOtp(r.devOtp);
      }
    } else {
      const r = await run(() => api('/auth/otp/verify', { body: { student_code: identifier, otp }, auth: false }));
      if (r) await login(r.token);
    }
  };

  const quick = async (a: any) => {
    const r = await run(() => api('/auth/login', { body: { identifier: a.email, password: demo.data.password || 'Demo@123' }, auth: false }));
    if (r) await login(r.token);
  };

  const accounts: any[] = demo.data?.accounts || [];

  const filterAccounts = (accs: any[]) => {
    if (activeTab === 'admin') return accs.filter((a) => a.system_role === 'super_admin' || a.system_role === 'campus_admin' || a.system_role === 'admin' || a.system_role === 'campus_manager');
    if (activeTab === 'advisor') return accs.filter((a) => a.system_role === 'faculty_advisor' || a.system_role === 'advisor');
    if (activeTab === 'treasurer') return accs.filter((a) => a.position === 'treasurer');
    if (activeTab === 'student') return accs.filter((a) => a.system_role === 'student' && a.position !== 'treasurer');
    return accs;
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[1.1fr_1fr]">
      {/* Left Brand Panel */}
      <section className="flex flex-col justify-between bg-ink p-6 text-white md:sticky md:top-0 md:h-screen md:p-12">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white font-bold text-xl">
            C
          </div>
          <div>
            <span className="font-display text-2xl font-bold tracking-tight">CampusCred</span>
            <span className="block text-[11px] text-white/50 uppercase tracking-widest font-mono">Multi-Campus Management</span>
          </div>
        </div>

        <div className="my-10 md:my-0 space-y-4">
          <div className="mb-4">
            <Stamp label="Institutional" sub="Multi-Campus" size={105} color="#E39B0B" />
          </div>
          <h1 className="max-w-md font-display text-3xl font-extrabold leading-tight md:text-5xl">
            Multi-Campus Club Management & Strict Role-Based Isolation.
          </h1>
          <p className="mt-3 max-w-md text-sm md:text-base text-white/70">
            Isolated environments for Super Admin, Campus Admin, Faculty Advisors, Club Treasurers, and Students with complete 3-tier budget approvals.
          </p>

          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white/90">🏛️ Bengaluru Campus</span>
            <span className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white/90">🏛️ Gazhiabad Campus</span>
            <span className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white/90">🏛️ Jaipur Campus</span>
          </div>
        </div>

        <p className="hidden text-xs text-white/40 md:block font-mono">
          Security: Campus-Level & Club-Level Data Isolation Enforced
        </p>
      </section>

      {/* Right Login / Demo Form */}
      <section className="p-6 md:flex md:flex-col md:justify-center md:p-12 overflow-y-auto">
        <div className="mx-auto w-full max-w-md">
          <h2 className="font-display text-2xl font-bold text-ink">Sign in to your dashboard</h2>
          <p className="text-xs text-ink-60 mt-1">Authenticate with your campus credentials or tap any demo role below.</p>

          <div className="mt-4 inline-flex rounded-lg border border-line bg-white p-1 text-xs font-semibold">
            {(['password', 'otp'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setOtpSent(false); }}
                className={`rounded-md px-3 py-1.5 transition-colors ${mode === m ? 'bg-brand text-white' : 'text-ink-60 hover:text-ink'}`}
              >
                {m === 'password' ? 'Email or ID' : 'Student OTP'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-4 space-y-3">
            <Field label={mode === 'password' ? 'Email or Student ID' : 'Student ID'}>
              <input
                className="input text-xs"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={mode === 'password' ? 'superadmin@campus.edu or MSOT26001' : 'MSOT26001'}
                required
              />
            </Field>

            {mode === 'password' && (
              <Field label="Password">
                <input
                  className="input text-xs"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
            )}

            {mode === 'otp' && otpSent && (
              <Field label="6-digit verification code" hint="Code is valid for 5 minutes.">
                <input
                  className="input text-xs font-mono tracking-widest text-center"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  required
                />
              </Field>
            )}

            <Button type="submit" className="w-full" loading={busy}>
              {mode === 'otp' && !otpSent ? 'Send Verification Code' : 'Sign in'}
            </Button>
          </form>

          {/* Quick Demo Switcher */}
          {accounts.length > 0 && (
            <div className="mt-8 border-t border-line pt-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-display text-sm font-bold text-ink">Demo Accounts (Instant Testing)</h3>
                <span className="text-[11px] text-ink-60 font-mono">Password: Demo@123</span>
              </div>
              <p className="text-xs text-ink-60 mb-3">
                Tap any role to immediately test role-based access control and campus isolation:
              </p>

              {/* Role Filter Tabs */}
              <div className="flex flex-wrap gap-1 mb-2.5">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'admin', label: 'Admins' },
                  { id: 'advisor', label: 'Advisors' },
                  { id: 'treasurer', label: 'Treasurers' },
                  { id: 'student', label: 'Students' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id as any)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${activeTab === t.id ? 'bg-brand text-white' : 'bg-paper-sunken text-ink-60 hover:text-ink'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="grid max-h-72 gap-1.5 overflow-y-auto pr-1">
                {filterAccounts(accounts).map((a) => {
                  let roleTone: 'brand' | 'warn' | 'ok' | 'neutral' = 'neutral';
                  if (a.system_role === 'super_admin' || a.system_role === 'admin') roleTone = 'brand';
                  else if (a.system_role === 'campus_admin' || a.system_role === 'campus_manager') roleTone = 'ok';
                  else if (a.system_role === 'faculty_advisor' || a.system_role === 'advisor') roleTone = 'warn';

                  return (
                    <button
                      key={a.email}
                      onClick={() => quick(a)}
                      className="flex items-center justify-between rounded-xl border border-line bg-white p-2.5 text-left text-xs hover:border-brand hover:shadow-xs transition-all"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="font-semibold text-ink block truncate">{a.name}</span>
                        <span className="block truncate text-[11px] text-ink-60">
                          {a.campus_name || 'All Campuses'} {a.club ? `· ${a.club} (${a.position || 'member'})` : ''}
                        </span>
                      </div>
                      <Badge tone={roleTone}>{ROLE[a.system_role] || a.system_role}</Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="mt-8 text-xs text-ink-60 text-center">
            Verifying credential authenticity?{' '}
            <Link to="/verify" className="font-semibold text-brand underline">
              Verify certificate
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
