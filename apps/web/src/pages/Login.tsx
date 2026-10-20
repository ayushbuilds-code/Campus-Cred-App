import { FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Field, Icon, Stamp, useAction, useToast } from '../components/ui';

export default function Login() {
  const { me, login } = useAuth();
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const { run, busy } = useAction();
  const toast = useToast();

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
        toast.ok(r.devOtp ? `Verification code: ${r.devOtp}` : 'Code sent.');
        if (r.devOtp) setOtp(r.devOtp);
      }
    } else {
      const r = await run(() => api('/auth/otp/verify', { body: { student_code: identifier, otp }, auth: false }));
      if (r) await login(r.token);
    }
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[1.1fr_1fr]">
      {/* Left Brand Panel */}
      <section className="flex flex-col justify-between bg-ink p-6 text-white md:sticky md:top-0 md:h-screen md:p-12">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="CampusCred" className="h-10 w-10 rounded-xl object-cover" />
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
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-semibold text-white/90">
              <Icon name="campus" size={13} /> Bengaluru Campus
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-semibold text-white/90">
              <Icon name="campus" size={13} /> Gazhiabad Campus
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-semibold text-white/90">
              <Icon name="campus" size={13} /> Jaipur Campus
            </span>
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
          <p className="text-xs text-ink-60 mt-1">Authenticate with your campus credentials or select your designated role below.</p>

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
