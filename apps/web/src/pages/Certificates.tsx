import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, useAction, useToast } from '../components/ui';
import { fmtDate } from '../lib/format';

export default function Certificates() {
  const { me, role } = useAuth();
  const { data, loading, error, reload } = useApi<any>('/certificates');
  const [issuing, setIssuing] = useState(false);
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const canIssue = role === 'admin' || (me?.advisor_clubs.length ?? 0) > 0;
  const dl = async (id: string) => { try { await download(`/certificates/${id}/file`, `${id}.pdf`); } catch (e: any) { toast.error(e.message); } };
  const copy = async (id: string) => { await navigator.clipboard?.writeText(`${window.location.origin}/verify/${id}`); toast.ok('Verification link copied'); };
  const certs = data.items.filter((c: any) => c.kind !== 'transcript');
  return (
    <>
      <PageHeader title="Certificates" subtitle="Each certificate has a QR code and a link anyone can use to verify it." actions={canIssue && <Button onClick={() => setIssuing(true)}>Issue achievement certificate</Button>} />
      {role !== 'student' && certs.length === 0 ? <Empty title="Certificates you issue appear on each student’s profile" text="Participation certificates are created automatically when scores are published." /> : certs.length === 0 ? <Empty title="No certificates yet" text="Attend a Club Day, submit your work and get scored, and your participation certificate is issued automatically." /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {certs.map((c: any) => (
            <Card key={c.id}>
              <div className="flex items-start justify-between gap-2"><Badge tone={c.kind === 'achievement' ? 'warn' : 'brand'}>{c.kind === 'achievement' ? 'Achievement' : 'Participation'}</Badge><StatusBadge status={c.status} /></div>
              <h2 className="mt-2 font-display text-lg font-bold">{c.title}</h2>
              <p className="text-sm text-ink-60">{[c.club_name, c.event_name].filter(Boolean).join(' · ')} · {fmtDate(c.issued_at)}</p>
              <p className="mt-1 font-mono text-xs text-ink-60">{c.id}</p>
              <div className="mt-3 flex flex-wrap gap-2"><Button small onClick={() => dl(c.id)}>Download PDF</Button><Button small variant="secondary" onClick={() => copy(c.id)}>Copy verify link</Button><Link to={`/verify/${c.id}`}><Button small variant="ghost">Open</Button></Link></div>
            </Card>))}
        </div>)}
      {canIssue && <Revoke />}
      {issuing && <Issue onClose={() => setIssuing(false)} onDone={() => { setIssuing(false); reload(); }} />}
    </>
  );
}

function Issue({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { me, role } = useAuth();
  const allClubs = useApi<any>(role === 'admin' ? '/clubs' : null);
  const clubs = role === 'admin' ? (allClubs.data?.items || []) : me!.advisor_clubs;
  const [clubId, setClubId] = useState<string>(String(me?.advisor_clubs[0]?.id ?? ''));
  const club = useApi<any>(clubId ? `/clubs/${clubId}` : null);
  const [userId, setUserId] = useState(''); const [title, setTitle] = useState(''); const [detail, setDetail] = useState('');
  const { run, busy } = useAction();
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await run(() => api('/certificates', { body: { user_id: Number(userId), club_id: Number(clubId), title, detail: detail || undefined } }), 'Certificate issued')) onDone(); };
  return (
    <Modal title="Issue an achievement certificate" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Club"><select className="input" value={clubId} onChange={(e) => { setClubId(e.target.value); setUserId(''); }} required><option value="">Choose a club</option>{clubs.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Student"><select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} required><option value="">Choose a member</option>{club.data?.members?.map((m: any) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></Field>
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} placeholder="Best Contributor, October" /></Field>
        <Field label="Citation (optional)"><textarea className="input" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={300} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Issue certificate</Button></div>
      </form>
    </Modal>
  );
}

function Revoke() {
  const [id, setId] = useState(''); const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  return (
    <Card className="mt-6"><CardTitle>Revoke a certificate</CardTitle>
      <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/certificates/${id.trim()}/revoke`, { body: { reason } }), 'Certificate revoked. The verification page now says so.')) { setId(''); setReason(''); } }} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Field label="Certificate ID"><input className="input font-mono" value={id} onChange={(e) => setId(e.target.value)} placeholder="CC-2026-XXXXXXXX" required /></Field>
        <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></Field>
        <Button type="submit" variant="danger" loading={busy}>Revoke</Button></form>
    </Card>
  );
}
