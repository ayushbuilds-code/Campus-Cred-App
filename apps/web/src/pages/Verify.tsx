import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { Button, Card, Field, Icon, Loading, Stamp, useAction } from '../components/ui';
import { fmtDate } from '../lib/format';

// Public page: no sign-in. Anyone with a certificate ID (or its QR code) can check it.
export default function Verify() {
  const { id } = useParams();
  const nav = useNavigate();
  const [typed, setTyped] = useState('');
  const { data, loading, error } = useApi<any>(id ? `/public/verify/${encodeURIComponent(id)}` : null);
  return (
    <div className="min-h-screen bg-paper">
      <header className="flex items-center justify-between bg-ink px-4 py-3 text-white md:px-10"><Link to="/" className="flex items-center gap-2"><img src="/favicon.svg" alt="" className="h-7 w-7" /><span className="font-display text-lg font-bold">CampusCred</span></Link><span className="text-sm text-white/70">Certificate verification</span></header>
      <main className="mx-auto max-w-2xl p-4 md:p-8">
        {!id ? (
          <Card><h1 className="font-display text-2xl font-bold">Verify a certificate</h1><p className="mt-1 text-sm text-ink-60">Enter the certificate ID printed on it, or scan its QR code.</p>
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); nav(`/verify/${typed.trim()}`); }} className="mt-4 flex gap-2"><input className="input font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="CC-2026-XXXXXXXX" required /><Button type="submit">Check</Button></form></Card>
        ) : loading ? <Loading label="Checking" /> : error || !data?.found ? (
          <Card className="text-center"><div className="flex justify-center"><Stamp tone="neutral" label="Not found" sub="No such ID" size={130} /></div><h1 className="mt-2 font-display text-2xl font-bold">We have no record of this certificate</h1><p className="mt-1 text-ink-60">{error || 'No certificate with that ID was issued by CampusCred.'} Check the ID for typing mistakes.</p><Link to="/verify" className="mt-4 inline-block font-semibold text-brand">Try another ID</Link></Card>
        ) : <Result c={data} />}
      </main>
    </div>
  );
}

function Result({ c }: { c: any }) {
  const revoked = c.status === 'revoked', ok = !revoked && c.record_intact;
  return (
    <>
      <Card className="text-center">
        <div className="flex justify-center"><Stamp tone={ok ? 'ok' : 'danger'} label={revoked ? 'Revoked' : ok ? 'Verified' : 'Check failed'} sub={ok ? 'CampusCred' : 'Invalid'} size={140} /></div>
        <h1 className="mt-2 font-display text-2xl font-bold">{revoked ? 'This certificate has been revoked' : ok ? 'This certificate is genuine' : 'This record does not match its fingerprint'}</h1>
        {revoked && <p className="mt-1 text-danger">Reason: {c.revoked_reason}</p>}
        {!c.record_intact && <p className="mt-1 text-danger">The stored record was changed after it was issued.</p>}
      </Card>
      <Card className="mt-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[['Awarded to', c.holder], ['Certificate', c.title], ['Club', c.club], ['Event', c.event], ['Issued on', fmtDate(c.issued_at)], ['Issued by', c.issued_by]].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-ink-60">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
          {c.detail && <div className="sm:col-span-2"><dt className="text-ink-60">Citation</dt><dd>{c.detail}</dd></div>}
          <div className="sm:col-span-2"><dt className="text-ink-60">Certificate ID</dt><dd className="font-mono">{c.id}</dd></div>
          <div className="sm:col-span-2"><dt className="text-ink-60">Record fingerprint (SHA-256)</dt><dd className="break-all font-mono text-xs">{c.content_hash}</dd></div>
        </dl>
      </Card>
      <FileCheck id={c.id} />
    </>
  );
}

function FileCheck({ id }: { id: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<any>(null);
  const { run, busy } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!file) return;
    const fd = new FormData(); fd.append('file', file); fd.append('id', id);
    const r = await run(() => api('/public/verify-file', { form: fd, auth: false })); if (r) setRes(r);
  };
  return (
    <Card className="mt-4">
      <h2 className="font-display text-lg font-bold">Check a PDF you were given</h2>
      <p className="mt-1 text-sm text-ink-60">Upload the PDF to confirm it is exactly the file CampusCred issued. Even a one-letter change fails the check.</p>
      <form onSubmit={submit} className="mt-3 space-y-3"><Field label="Certificate PDF"><input className="input !py-2" type="file" accept="application/pdf,.pdf" onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null); }} required /></Field><Button type="submit" loading={busy}>Check this file</Button></form>
      {res && <div role="status" className={`mt-3 rounded-lg p-3 text-sm font-semibold flex items-center gap-2 ${res.match ? 'bg-ok-tint text-ok' : 'bg-danger-tint text-danger'}`}><span className="inline-flex shrink-0"><Icon name={res.match ? 'check' : 'close'} size={16} /></span>{res.message}</div>}
    </Card>
  );
}
