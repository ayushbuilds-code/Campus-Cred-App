import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Button, Card, Field, PageHeader, Stamp, StatusBadge } from '../components/ui';

type State = { status: 'idle' | 'loading' | 'ok' | 'error'; msg?: string; result?: any };

function getPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 4000, maximumAge: 60000 });
  });
}

export default function CheckIn() {
  const [params] = useSearchParams();
  const token = params.get('t');
  const [state, setState] = useState<State>({ status: 'idle' });
  const [tab, setTab] = useState<'scan' | 'code'>('scan');
  const [code, setCode] = useState('');
  const sent = useRef(false);

  const send = async (payload: { token?: string; code?: string }) => {
    setState({ status: 'loading' });
    const pos = await getPosition(); // optional: only used to confirm the student is on campus
    try { setState({ status: 'ok', result: await api('/checkin', { body: { ...payload, ...(pos || {}) } }) }); }
    catch (e: any) { setState({ status: 'error', msg: e.message }); }
  };
  useEffect(() => { if (token && !sent.current) { sent.current = true; send({ token }); } }, [token]);

  const reset = () => { setState({ status: 'idle' }); setCode(''); sent.current = true; };

  if (state.status === 'loading') return <Card className="mx-auto mt-10 max-w-md text-center"><p className="font-display text-xl font-bold">Checking you in…</p><p className="mt-1 text-sm text-ink-60">Confirming your location is optional.</p></Card>;
  if (state.status === 'ok') {
    const r = state.result;
    return (
      <Card className="mx-auto mt-6 max-w-md text-center">
        <div className="flex justify-center"><Stamp label={r.status === 'late' ? 'Late' : 'Present'} sub="Checked in" tone="ok" size={140} /></div>
        <h1 className="mt-2 font-display text-2xl font-bold">You are checked in</h1>
        <p className="mt-1 text-ink-80">{r.label}{r.topic ? `: ${r.topic}` : ''}</p>
        <div className="mt-2 flex justify-center gap-2"><StatusBadge status={r.status} /></div>
        {r.flag && r.flag !== 'Late' && <p className="mt-3 rounded-lg bg-saffron-tint p-2 text-sm text-warn">Noted for the coordinator: {r.flag}</p>}
        <Link to="/"><Button className="mt-5 w-full">Done</Button></Link>
      </Card>
    );
  }
  return (
    <>
      <PageHeader title="Check in" subtitle="Scan the QR code on your coordinator’s screen, or type the 6-digit code under it." />
      {state.status === 'error' && <div role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-tint p-4 text-sm text-danger"><p className="font-semibold">Check-in did not go through</p><p className="mt-1">{state.msg}</p></div>}
      <div className="mb-3 inline-flex rounded-lg border border-line bg-white p-1 text-sm font-semibold">
        {(['scan', 'code'] as const).map((t) => <button key={t} onClick={() => { reset(); setTab(t); }} className={`rounded-md px-4 py-1.5 ${tab === t ? 'bg-brand text-white' : 'text-ink-60'}`}>{t === 'scan' ? 'Scan QR' : 'Enter code'}</button>)}
      </div>
      <Card className="max-w-md">
        {tab === 'scan' ? <Scanner onToken={(t) => send({ token: t })} /> : (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); send({ code: code.replace(/\s/g, '') }); }} className="space-y-3">
            <Field label="6-digit code"><input className="input text-center font-display text-3xl font-bold tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000 000" required /></Field>
            <Button type="submit" className="w-full" disabled={code.replace(/\s/g, '').length !== 6}>Check in</Button>
            <p className="text-xs text-ink-60">The code changes every few seconds. Type the one on the screen right now.</p>
          </form>)}
      </Card>
    </>
  );
}

function Scanner({ onToken }: { onToken: (t: string) => void }) {
  const [problem, setProblem] = useState('');
  const started = useRef(false);
  useEffect(() => {
    let scanner: any; let stopped = false;
    (async () => {
      if (started.current) return; started.current = true;
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        scanner = new Html5Qrcode('qr-reader');
        await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (text: string) => {
          if (stopped) return; stopped = true;
          let t = text; try { t = new URL(text).searchParams.get('t') || text; } catch { /* raw token */ }
          scanner.stop().catch(() => {}); onToken(t);
        }, () => {});
      } catch { setProblem('The camera is not available. Allow camera access, or use “Enter code” instead.'); }
    })();
    return () => { stopped = true; started.current = false; scanner?.isScanning && scanner.stop().then(() => scanner.clear()).catch(() => {}); };
  }, []);
  return (<div><div id="qr-reader" className="overflow-hidden rounded-lg bg-ink" style={{ minHeight: 280 }} />{problem && <p role="alert" className="mt-3 text-sm text-danger">{problem}</p>}<p className="mt-3 text-xs text-ink-60">You can also scan with your phone’s normal camera app. It opens this page and checks you in.</p></div>);
}
