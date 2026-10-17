import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, download, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import PlanModal from '../components/PlanModal';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Tabs, useAction, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, fmtTime, fmtWeekday, FORMAT, POSITION, timeLeft } from '../lib/format';

export default function ActivityPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me } = useAuth();
  const { data, loading, error, reload } = useApi<any>(`/activities/${id}`);
  const [modal, setModal] = useState<string | null>(null);
  const { run, busy } = useAction();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { activity: a, can, session, session_open } = data;
  const isAdvisor = a.advisor_id === me?.user.id || me?.user.system_role === 'admin';

  const sendPlan = async () => { if (await run(() => api(`/activities/${a.id}/submit-plan`, { method: 'POST' }), 'Plan sent to the advisor')) reload(); };
  const startCheckin = async (opts: any) => { const r = await run(() => api(`/activities/${a.id}/session`, { body: opts })); if (r) nav(`/run/${r.id}`); };

  return (
    <>
      <p className="mb-2 text-sm"><Link to="/club-days" className="font-semibold text-brand">← Club Days</Link></p>
      <PageHeader title={a.topic} subtitle={`${a.club_name} · ${fmtWeekday(a.date)} · ${FORMAT[a.format]}`} actions={<StatusBadge status={a.status} />} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Plan</CardTitle>
          <dl className="space-y-2 text-sm">
            <div><dt className="font-semibold">Deliverable</dt><dd className="text-ink-80">{a.format === 'on_the_spot' ? 'Nothing to submit. Takes place at the session.' : a.deliverable || 'Not specified'}</dd></div>
            <div><dt className="font-semibold">Venue</dt><dd className="text-ink-80">{a.venue || a.day_venue || 'To be announced'}</dd></div>
            {a.submission_deadline && <div><dt className="font-semibold">Submit by</dt><dd className="text-ink-80">{fmtDateTime(a.submission_deadline)} <Badge tone={data.deadline_passed ? 'neutral' : 'warn'}>{timeLeft(a.submission_deadline)}</Badge></dd></div>}
          </dl>
          {a.advisor_comment && <div className="mt-3 rounded-lg border border-saffron/40 bg-saffron-tint p-3 text-sm"><p className="font-semibold">Advisor’s comment</p><p>{a.advisor_comment}</p></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            {can.edit_plan && <Button variant="secondary" onClick={() => setModal('edit')}>Edit plan</Button>}
            {can.submit_plan && <Button loading={busy} onClick={sendPlan}>Send to advisor</Button>}
            {can.review && <><Button onClick={async () => { if (await run(() => api(`/activities/${a.id}/review`, { body: { decision: 'approve' } }), 'Plan approved')) reload(); }}>Approve plan</Button><Button variant="secondary" onClick={() => setModal('changes')}>Request changes</Button></>}
          </div>
        </Card>

        <Card>
          <CardTitle>Check-in</CardTitle>
          {a.status !== 'approved' ? <p className="text-sm text-ink-60">Check-in opens after the advisor approves the plan.</p> : (
            <div className="space-y-3">
              {session && <p className="text-sm text-ink-80">Session {session_open ? <>is <b className="text-ok">open</b> until {fmtTime(session.closes_at)}</> : <>was <b>closed</b></>}.</p>}
              {!session && !can.run && <p className="text-sm text-ink-60">Check-in has not started yet.</p>}
              {data.my_attendance && <p className="text-sm">Your attendance: <StatusBadge status={data.my_attendance.status} /> {data.my_attendance.flag && <span className="text-ink-60">({data.my_attendance.flag})</span>}</p>}
              <div className="flex flex-wrap gap-2">
                {can.run && session_open && <Link to={`/run/${session.id}`}><Button>Open live screen</Button></Link>}
                {can.run && !session_open && <Button loading={busy} onClick={() => (session ? startCheckin({}) : setModal('start'))}>{session ? 'Reopen check-in' : 'Start check-in'}</Button>}
                {can.check_in && session_open && !data.my_attendance && <Link to="/checkin"><Button variant={can.run ? 'secondary' : 'primary'}>Check in</Button></Link>}
              </div>
            </div>)}
        </Card>
      </div>

      {can.view_all && <Attendance activityId={a.id} canCorrect={can.run || isAdvisor} />}
      {a.format !== 'on_the_spot' && a.status === 'approved' && (data.my_submission || can.submit_work) && <MySubmission data={data} onDone={reload} />}
      {can.view_all && a.format !== 'on_the_spot' && <AllSubmissions activityId={a.id} canEvaluate={can.evaluate} meId={me!.user.id} />}

      {modal === 'edit' && <PlanModal clubs={[{ id: a.club_id, name: a.club_name }]} day={{ id: a.club_day_id, date: a.date }} existing={a} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'changes' && <ChangesModal id={a.id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'start' && <StartModal onClose={() => setModal(null)} onStart={startCheckin} busy={busy} />}
    </>
  );
}

function ChangesModal({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState('');
  const { run, busy } = useAction();
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await run(() => api(`/activities/${id}/review`, { body: { decision: 'changes', comment } }), 'Changes requested')) onDone(); };
  return (
    <Modal title="Request changes" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3"><Field label="What should the coordinators change?"><textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} required /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Send feedback</Button></div></form>
    </Modal>
  );
}

function StartModal({ onClose, onStart, busy }: { onClose: () => void; onStart: (o: any) => void; busy: boolean }) {
  const [w, setW] = useState(15); const [late, setLate] = useState(10); const [geo, setGeo] = useState('flag');
  return (
    <Modal title="Start check-in" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onStart({ window_minutes: w, late_after_minutes: late, geo_mode: geo }); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check-in stays open (minutes)"><input className="input" type="number" min={1} max={240} value={w} onChange={(e) => setW(Number(e.target.value))} /></Field>
          <Field label="Mark late after (minutes)"><input className="input" type="number" min={0} max={w} value={late} onChange={(e) => setLate(Number(e.target.value))} /></Field>
        </div>
        <Field label="Location check" hint="Uses the phone’s location to confirm students are on campus."><select className="input" value={geo} onChange={(e) => setGeo(e.target.value)}><option value="flag">Flag students outside campus</option><option value="block">Block students outside campus</option><option value="off">Off</option></select></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Start and show QR</Button></div>
      </form>
    </Modal>
  );
}

function Attendance({ activityId, canCorrect }: { activityId: number; canCorrect: boolean }) {
  const { data, loading, error, reload } = useApi<any>(`/activities/${activityId}/attendance`);
  const [fix, setFix] = useState<any>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const counts = data.roster.reduce((c: any, r: any) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {});
  return (
    <Card className="mt-4">
      <CardTitle right={data.session && <span className="text-sm text-ink-60">{(counts.present || 0) + (counts.late || 0)} of {data.roster.length} checked in</span>}>Attendance</CardTitle>
      {!data.session ? <p className="text-sm text-ink-60">No check-in session yet.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-ink-60"><th className="py-1.5 pr-3 font-semibold">Member</th><th className="pr-3 font-semibold">Status</th><th className="pr-3 font-semibold">Time</th><th className="pr-3 font-semibold">Note</th>{canCorrect && <th />}</tr></thead>
          <tbody className="divide-y divide-line">{data.roster.map((r: any) => (
            <tr key={r.user_id}><td className="py-2 pr-3"><span className="font-semibold">{r.name}</span> <span className="text-xs text-ink-60">{POSITION[r.position]}</span></td>
              <td className="pr-3"><StatusBadge status={r.status} /></td><td className="pr-3 text-ink-60">{fmtTime(r.checked_at)}</td>
              <td className="pr-3 text-xs text-ink-60">{r.correction_reason ? `Corrected: ${r.correction_reason}` : r.flag || ''}</td>
              {canCorrect && <td className="text-right"><Button small variant="ghost" onClick={() => setFix(r)}>Correct</Button></td>}</tr>))}</tbody></table></div>)}
      {fix && <CorrectModal sessionId={data.session.id} row={fix} onClose={() => setFix(null)} onDone={() => { setFix(null); reload(); }} />}
    </Card>
  );
}

function CorrectModal({ sessionId, row, onClose, onDone }: { sessionId: number; row: any; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState(row.status === 'absent' ? 'present' : 'absent'); const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await run(() => api(`/sessions/${sessionId}/attendance`, { body: { user_id: row.user_id, status, reason } }), 'Attendance corrected and logged')) onDone(); };
  return (
    <Modal title={`Correct attendance: ${row.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Mark as"><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option></select></Field>
        <Field label="Reason" hint="Required. It is saved in the audit log with your name."><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder="Phone battery died, was in the hall" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save correction</Button></div>
      </form>
    </Modal>
  );
}

function MySubmission({ data, onDone }: { data: any; onDone: () => void }) {
  const a = data.activity, sub = data.my_submission, ev = data.my_evaluation;
  const [kind, setKind] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null); const [link, setLink] = useState(''); const [note, setNote] = useState('');
  const { run, busy } = useAction();
  const can = data.can.submit_work;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    if (kind === 'file' && file) fd.append('file', file); else fd.append('link_url', link);
    if (note) fd.append('note', note);
    if (await run(() => api(`/activities/${a.id}/submissions`, { form: fd }), sub ? 'Submission updated' : 'Submitted. Your coordinator will score it.')) { setFile(null); setLink(''); onDone(); }
  };
  return (
    <Card className="mt-4">
      <CardTitle>Your submission</CardTitle>
      {sub && <div className="mb-3 rounded-lg bg-paper p-3 text-sm"><p className="font-semibold">{sub.type === 'file' ? sub.original_name : sub.link_url}</p><p className="text-ink-60">Submitted {fmtDateTime(sub.submitted_at)}</p>
        {ev ? <div className="mt-2 border-t border-line pt-2"><p className="font-display text-xl font-bold">{ev.total}/10</p><p className="text-ink-60">Content {ev.content} · Presentation {ev.presentation} · Participation {ev.participation}</p>{ev.comment && <p className="mt-1">“{ev.comment}”</p>}</div> : <p className="mt-1 text-ink-60">Not scored yet.</p>}</div>}
      {can ? (
        <form onSubmit={submit} className="space-y-3">
          <div className="inline-flex rounded-lg border border-line p-1 text-sm font-semibold">{(['file', 'link'] as const).map((k) => <button type="button" key={k} onClick={() => setKind(k)} className={`rounded-md px-3 py-1.5 ${kind === k ? 'bg-brand text-white' : 'text-ink-60'}`}>{k === 'file' ? 'Upload a file' : 'Paste a link'}</button>)}</div>
          {kind === 'file' ? <Field label="File" hint="PDF, PPT/PPTX, DOC/DOCX, PNG, JPG or ZIP, up to 10 MB."><input className="input !py-2" type="file" accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg,.zip" onChange={(e) => setFile(e.target.files?.[0] || null)} required /></Field>
            : <Field label="Link"><input className="input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" required /></Field>}
          <Field label="Note for the evaluator (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          <Button type="submit" loading={busy}>{sub ? 'Replace submission' : 'Submit'}</Button>
        </form>) : <p className="text-sm text-ink-60">The deadline has passed. Ask a coordinator if you need an exception.</p>}
    </Card>
  );
}

function AllSubmissions({ activityId, canEvaluate, meId }: { activityId: number; canEvaluate: boolean; meId: number }) {
  const { data, loading, error, reload } = useApi<any>(`/activities/${activityId}/submissions`);
  const [scoring, setScoring] = useState<any>(null);
  const [tab, setTab] = useState('done');
  const { run, busy } = useAction();
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const unpublished = data.items.filter((s: any) => s.total != null && !s.published).length;
  const publish = async () => { const r = await run(() => api(`/activities/${activityId}/publish-scores`, { method: 'POST' })); if (r) { toast.ok(`Published ${r.published} scores. ${r.certificates_issued} certificate${r.certificates_issued === 1 ? '' : 's'} issued.`); reload(); } };
  const open = async (s: any) => { try { await download(`/submissions/${s.id}/file`, s.original_name); } catch (e: any) { toast.error(e.message); } };
  return (
    <Card className="mt-4">
      <CardTitle right={canEvaluate && <Button small loading={busy} disabled={!data.items.some((s: any) => s.total != null && !s.published)} onClick={publish}>Publish scores{unpublished ? ` (${unpublished})` : ''}</Button>}>Submissions</CardTitle>
      <Tabs tabs={[{ id: 'done', label: `Submitted (${data.items.length})` }, { id: 'missing', label: `Not submitted (${data.missing.length})` }]} value={tab} onChange={setTab} />
      {tab === 'missing' ? (data.missing.length ? <ul className="grid gap-1 text-sm md:grid-cols-2">{data.missing.map((m: any) => <li key={m.user_id}>{m.name}</li>)}</ul> : <Empty title="Everyone has submitted" />) :
        data.items.length === 0 ? <Empty title="No submissions yet" /> : (
          <ul className="divide-y divide-line">{data.items.map((s: any) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="font-semibold">{s.name}</p>
                <p className="truncate text-sm text-ink-60">{s.type === 'file' ? <button className="font-semibold text-brand underline" onClick={() => open(s)}>{s.original_name}</button> : <a className="font-semibold text-brand underline" href={s.link_url} target="_blank" rel="noreferrer noopener">{s.link_url}</a>} · {fmtDate(s.submitted_at)}</p>
                {s.note && <p className="text-sm text-ink-80">“{s.note}”</p>}</div>
              <div className="flex items-center gap-2">{s.total != null ? <><span className="font-display text-lg font-bold">{s.total}</span>{s.published ? <Badge tone="ok">Published</Badge> : <Badge tone="warn">Draft</Badge>}</> : <Badge>Not scored</Badge>}
                {canEvaluate && (s.user_id === meId ? <span className="text-xs text-ink-60">Advisor scores your work</span> : <Button small variant="secondary" onClick={() => setScoring(s)}>{s.total != null ? 'Edit score' : 'Score'}</Button>)}</div>
            </li>))}</ul>)}
      {scoring && <ScoreModal sub={scoring} weights={data.weights} onClose={() => setScoring(null)} onDone={() => { setScoring(null); reload(); }} />}
    </Card>
  );
}

function ScoreModal({ sub, weights, onClose, onDone }: { sub: any; weights: any; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ content: sub.content ?? 7, presentation: sub.presentation ?? 7, participation: sub.participation ?? 7 });
  const [comment, setComment] = useState(sub.comment || '');
  const { run, busy } = useAction();
  const total = Math.round(((v.content * weights.content + v.presentation * weights.presentation + v.participation * weights.participation) / (weights.content + weights.presentation + weights.participation)) * 100) / 100;
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await run(() => api(`/submissions/${sub.id}/evaluation`, { method: 'PUT', body: { ...v, comment: comment || undefined } }), 'Score saved. Publish scores to show it to students.')) onDone(); };
  const slider = (k: 'content' | 'presentation' | 'participation', label: string) => (
    <Field label={`${label} (weight ${weights[k]}%)`}><div className="flex items-center gap-3"><input type="range" min={0} max={10} step={1} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="h-2 flex-1 accent-[#0E6B63]" /><span className="w-8 text-right font-display text-lg font-bold">{v[k]}</span></div></Field>);
  return (
    <Modal title={`Score ${sub.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {slider('content', 'Content')}{slider('presentation', 'Presentation')}{slider('participation', 'Participation')}
        <p className="rounded-lg bg-paper p-3 text-sm">Weighted total: <b className="font-display text-xl">{total}</b> / 10</p>
        <Field label="Comment for the student"><textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save score</Button></div>
      </form>
    </Modal>
  );
}
