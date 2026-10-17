import { useParams } from 'react-router-dom';
import { download, useApi } from '../lib/api';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Loading, PageHeader, StatusBadge, useAction } from '../components/ui';
import { fmtDate, POSITION } from '../lib/format';

export default function Transcript() {
  const { id } = useParams();
  const who = id || 'me';
  const { data: t, loading, error, reload } = useApi<any>(`/students/${who}/transcript`);
  const { run, busy } = useAction();
  if (loading && !t) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const s = t.summary;
  return (
    <>
      <PageHeader title="Co-curricular transcript" subtitle={`${t.student.name} · ${t.student.student_code || ''} · ${t.student.campus || ''}`}
        actions={<Button loading={busy} onClick={() => run(() => download(`/students/${who}/transcript.pdf`, `transcript-${t.student.student_code || who}.pdf`), 'Transcript downloaded')}>Download verified PDF</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Clubs', s.clubs], ['Sessions attended', s.attended], ['Submissions', s.submissions], ['Average score', s.avg_score ?? '–'], ['Certificates', s.certificates]].map(([l, v]) => (
          <Card key={l as string} className="!p-4"><p className="font-display text-3xl font-bold">{v}</p><p className="text-sm text-ink-60">{l}</p></Card>))}
      </div>
      <Card className="mb-4"><CardTitle>Clubs</CardTitle>
        {t.clubs.length === 0 ? <Empty title="No clubs yet" text="Join a club and your attendance and scores build up here." /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-ink-60"><th className="py-1.5 font-semibold">Club</th><th className="font-semibold">Position</th><th className="font-semibold">Attendance</th><th className="font-semibold">Submissions</th><th className="font-semibold">Avg score</th></tr></thead>
            <tbody className="divide-y divide-line">{t.clubs.map((c: any) => <tr key={c.club}><td className="py-2 font-semibold">{c.club}</td><td>{POSITION[c.position]}</td><td>{c.attended}/{c.sessions} ({c.attendance_pct}%)</td><td>{c.submissions}</td><td>{c.avg_score ?? '–'}</td></tr>)}</tbody></table></div>)}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardTitle>Events</CardTitle>{t.events.length === 0 ? <p className="text-sm text-ink-60">No events yet.</p> : <ul className="divide-y divide-line text-sm">{t.events.map((e: any) => <li key={e.name + e.date} className="flex justify-between py-2"><span><span className="font-semibold">{e.name}</span><span className="block text-ink-60">{fmtDate(e.date)} · {e.team || 'Individual'}</span></span>{e.position ? <Badge tone="brand">#{e.position}</Badge> : null}</li>)}</ul>}</Card>
        <Card><CardTitle>Certificates</CardTitle>{t.certificates.length === 0 ? <p className="text-sm text-ink-60">No certificates yet.</p> : <ul className="max-h-72 divide-y divide-line overflow-y-auto text-sm">{t.certificates.map((c: any) => <li key={c.id} className="flex items-start justify-between gap-2 py-2"><span><span className="font-semibold">{c.title}</span><span className="block font-mono text-xs text-ink-60">{c.id} · {fmtDate(c.issued_at)}</span></span><StatusBadge status={c.status} /></li>)}</ul>}</Card>
      </div>
      <p className="mt-4 text-xs text-ink-60">Data fingerprint {t.dataHash}. The PDF carries a QR code that opens a public verification page, so employers can confirm it.</p>
    </>
  );
}
