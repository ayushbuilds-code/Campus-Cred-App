import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Tabs, useAction } from '../components/ui';
import { fmtDate, POSITION } from '../lib/format';

export default function ClubDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isSuperAdmin, isCampusAdmin } = useAuth();
  const { data, loading, error, reload } = useApi<any>(`/clubs/${id}`);
  const [tab, setTab] = useState('members');
  const { run } = useAction();
  const reqs = useApi<any>(data?.can.manage ? `/clubs/${id}/requests` : null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { club, advisor, members, can, my } = data;
  const canEditClub = can.admin || can.edit_club || can.manage;
  const tabs = [
    { id: 'members', label: 'Members' },
    ...(can.manage ? [{ id: 'requests', label: 'Join requests', badge: reqs.data?.items.length }, { id: 'announce', label: 'Announce' }] : []),
    ...(can.view_budget ? [{ id: 'budget', label: 'Budget' }] : []),
    ...(canEditClub ? [{ id: 'settings', label: 'Settings' }] : []),
  ];

  const deleteClub = async () => {
    if (!window.confirm(`Are you sure you want to delete "${club.name}"? This permanently deletes the club, all activities, attendance, and memberships.`)) return;
    if (await run(() => api(`/clubs/${club.id}`, { method: 'DELETE' }), 'Club deleted')) {
      navigate('/clubs');
    }
  };

  return (
    <>
      <p className="mb-2 text-sm"><Link to="/clubs" className="font-semibold text-brand">{isSuperAdmin || isCampusAdmin ? '← All clubs' : '← My Club'}</Link></p>
      <PageHeader title={club.name} subtitle={`${club.campus} · ${club.member_count}/${club.capacity} members · Advisor: ${advisor?.name || 'not assigned'}`}
        actions={<>{club.status !== 'approved' && <StatusBadge status={club.status} label={club.status === 'pending' ? 'Awaiting campus manager approval' : 'Archived'} />}
          {can.approve_club && club.status === 'pending' && <Button variant="accent" onClick={async () => { if (await run(() => api(`/clubs/${club.id}/status`, { body: { status: 'approved' } }), 'Club approved')) reload(); }}>Approve club</Button>}
          {can.admin && <Button variant="danger" onClick={deleteClub}>Delete club</Button>}
          {my.status === 'active' && my.position === 'member' && <Button variant="secondary" onClick={async () => { if (await run(() => api(`/clubs/${club.id}/leave`, { method: 'POST' }), 'You left the club')) reload(); }}>Leave club</Button>}</>} />
      <Card className="mb-4">
        <p className="text-[15px]">{club.description}</p>
        {club.meeting_rules && <p className="mt-2 text-sm text-ink-60"><span className="font-semibold text-ink">Meeting rules:</span> {club.meeting_rules}</p>}
      </Card>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'members' && <Members data={data} reload={reload} />}
      {tab === 'requests' && <Requests clubId={club.id} data={reqs} onChange={() => { reqs.reload(); reload(); }} />}
      {tab === 'announce' && <Announce clubId={club.id} />}
      {tab === 'budget' && <ClubBudget clubId={club.id} canRequest={can.budget} />}
      {tab === 'settings' && <Settings club={club} advisor={advisor} canAdmin={can.admin} onSaved={reload} />}
    </>
  );
}

function Members({ data, reload }: { data: any; reload: () => void }) {
  const { club, members, can } = data;
  const { me } = useAuth();
  const [adding, setAdding] = useState(false);
  const { run } = useAction();
  const canEdit = can.admin || can.manage_members || can.manage || me?.advisor_clubs.some((c: any) => c.id === club.id);
  if (!members) return <Empty title="Members are visible to club members" text="Join the club to see who else is in it." />;
  const setPos = async (m: any, position: string) => { if (await run(() => api(`/memberships/${m.membership_id}`, { method: 'PATCH', body: { position } }), 'Position updated')) reload(); };
  const remove = async (m: any) => {
    if (!window.confirm(`Are you sure you want to remove ${m.name} from ${club.name}?`)) return;
    if (await run(() => api(`/memberships/${m.membership_id}`, { method: 'DELETE' }), `${m.name} removed from club`)) reload();
  };

  return (
    <Card>
      <CardTitle right={canEdit && <Button small onClick={() => setAdding(true)}>Add member</Button>}>{members.length} members</CardTitle>
      <ul className="divide-y divide-line">
        {members.map((m: any) => (
          <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span><span className="font-semibold">{m.name}</span><span className="ml-2 text-xs text-ink-60">{m.student_code}</span></span>
            <div className="flex items-center gap-2">
              {canEdit ? (
                <>
                  <select aria-label={`Position of ${m.name}`} className="input !min-h-[36px] !w-auto !py-0 text-sm" value={m.position} onChange={(e) => setPos(m, e.target.value)}>
                    {Object.entries(POSITION).filter(([k]) => k !== 'participant').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <Button small variant="danger" onClick={() => remove(m)}>Remove</Button>
                </>
              ) : (
                <Badge tone={m.position === 'member' ? 'neutral' : 'brand'}>{POSITION[m.position]}</Badge>
              )}
            </div>
          </li>))}
      </ul>
      {adding && <AddMember clubId={club.id} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </Card>
  );
}

function AddMember({ clubId, onClose, onDone }: { clubId: number; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const students = useApi<any>(`/users?role=student&q=${encodeURIComponent(q)}`);
  const [position, setPosition] = useState('member');
  const { run } = useAction();
  const add = async (u: any) => { if (await run(() => api(`/clubs/${clubId}/members`, { body: { user_id: u.id, position } }), `${u.name} added`)) onDone(); };
  return (
    <Modal title="Add a member" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Position"><select className="input" value={position} onChange={(e) => setPosition(e.target.value)}>{['member', 'treasurer', 'vice_president', 'president'].map((p) => <option key={p} value={p}>{POSITION[p]}</option>)}</select></Field>
        <Field label="Find a student"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or student ID" /></Field>
        <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {students.data?.items.map((u: any) => <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm"><span>{u.name} <span className="text-ink-60">{u.student_code}</span></span><Button small variant="secondary" onClick={() => add(u)}>Add</Button></li>)}
          {students.data?.items.length === 0 && <li className="px-3 py-4 text-sm text-ink-60">No students match.</li>}
        </ul>
      </div>
    </Modal>
  );
}

function Requests({ clubId, data, onChange }: { clubId: number; data: any; onChange: () => void }) {
  const { run } = useAction();
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  const decide = async (r: any, approve: boolean) => { if (await run(() => api(`/memberships/${r.id}/decision`, { body: { approve } }), approve ? `${r.name} joined` : 'Request declined')) onChange(); };
  return (
    <Card>
      <CardTitle>Join requests <span className="text-sm font-normal text-ink-60">({data.data.active}/{data.data.capacity} places used)</span></CardTitle>
      {data.data.items.length === 0 ? <Empty title="No pending requests" /> : (
        <ul className="divide-y divide-line">{data.data.items.map((r: any) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span><span className="font-semibold">{r.name}</span><span className="block text-xs text-ink-60">{r.student_code} · asked {fmtDate(r.created_at)}</span></span>
            <span className="flex gap-2"><Button small onClick={() => decide(r, true)}>Approve</Button><Button small variant="secondary" onClick={() => decide(r, false)}>Decline</Button></span></li>))}</ul>)}
      <span hidden>{clubId}</span>
    </Card>
  );
}

function Announce({ clubId }: { clubId: number }) {
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const { run, busy } = useAction();
  const send = async (e: FormEvent) => { e.preventDefault(); const r = await run(() => api(`/clubs/${clubId}/announce`, { body: { title, body } })); if (r) { setTitle(''); setBody(''); } return r; };
  const [sent, setSent] = useState<number | null>(null);
  return (
    <Card><CardTitle>Announce to all members</CardTitle>
      <form onSubmit={async (e) => { const r = await send(e); if (r) setSent(r.sent_to); }} className="space-y-3">
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} /></Field>
        <Field label="Message"><textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} required minLength={2} /></Field>
        <Button type="submit" loading={busy}>Send announcement</Button>
        {sent != null && <p className="text-sm text-ok">Sent to {sent} members. They see it under Alerts, and by email when email delivery is connected.</p>}
      </form>
    </Card>
  );
}

function ClubBudget({ clubId, canRequest }: { clubId: number; canRequest: boolean }) {
  const b = useApi<any>('/budget');
  const [f, setF] = useState({ title: '', amount_inr: '', purpose: '', sheet_link: '' });
  const { run, busy } = useAction();
  const items = (b.data?.items || []).filter((x: any) => x.club_id === clubId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api(`/clubs/${clubId}/budget`, { body: { title: f.title, amount_inr: Number(f.amount_inr), purpose: f.purpose || undefined, sheet_link: f.sheet_link || undefined } }), 'Fund request submitted')) {
      setF({ title: '', amount_inr: '', purpose: '', sheet_link: '' });
      b.reload();
    }
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {canRequest && (
        <Card>
          <CardTitle right={<Link to="/budget" className="text-sm font-semibold text-brand">Full Budget Manager →</Link>}>Request funds</CardTitle>
          <form onSubmit={submit} className="space-y-3">
            <Field label="What is it for?"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} placeholder="Event equipment, hackathon prizes..." /></Field>
            <Field label="Amount (₹)"><input className="input" type="number" min={1} value={f.amount_inr} onChange={(e) => setF({ ...f, amount_inr: e.target.value })} required /></Field>
            <Field label="Sheet link (Google Sheet / Excel costing breakdown)"><input className="input" type="url" value={f.sheet_link} onChange={(e) => setF({ ...f, sheet_link: e.target.value })} placeholder="https://docs.google.com/spreadsheets/..." /></Field>
            <Field label="Details & Purpose"><textarea className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="Specify requirements, event date, justification" /></Field>
            <Button type="submit" loading={busy}>Submit fund request</Button>
          </form>
        </Card>
      )}
      <Card>
        <CardTitle right={<Link to="/budget" className="text-sm font-semibold text-brand">View details</Link>}>Club requests ({items.length})</CardTitle>
        {items.length === 0 ? <p className="text-sm text-ink-60">No budget requests yet.</p> : (
          <ul className="divide-y divide-line">
            {items.map((x: any) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div>
                  <span className="font-semibold text-ink">{x.title}</span>
                  <span className="block text-xs text-ink-60">₹{x.amount_inr.toLocaleString('en-IN')} · {x.requester_name || x.requester}</span>
                  {x.sheet_link && <a href={x.sheet_link} target="_blank" rel="noreferrer" className="text-xs text-brand underline">View Sheet Breakdown</a>}
                </div>
                <div className="text-right flex items-center gap-1.5">
                  <Badge tone={x.status === 'College Approved' || x.status === 'approved' ? 'ok' : x.status === 'College Rejected' || x.status === 'rejected' ? 'danger' : 'warn'}>
                    {x.normalized_status || x.status}
                  </Badge>
                  <Link to="/budget" className="text-xs text-brand hover:underline">Details →</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Settings({ club, advisor, canAdmin, onSaved }: { club: any; advisor: any; canAdmin: boolean; onSaved: () => void }) {
  const advisors = useApi<any>('/users?role=advisor');
  const [f, setF] = useState<any>({
    name: club.name,
    category: club.category || '',
    description: club.description || '',
    meeting_rules: club.meeting_rules || '',
    capacity: club.capacity,
    advisor_id: advisor?.id || '',
  });
  const { run, busy } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const payload: any = {
      name: f.name,
      category: f.category,
      description: f.description,
      meeting_rules: f.meeting_rules,
      capacity: Number(f.capacity),
    };
    if (canAdmin) {
      payload.advisor_id = f.advisor_id ? Number(f.advisor_id) : null;
    }
    if (await run(() => api(`/clubs/${club.id}`, { method: 'PATCH', body: payload }), 'Club updated')) onSaved();
  };
  return (
    <Card><CardTitle>Club settings</CardTitle>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Name"><input className="input" value={f.name} onChange={set('name')} required /></Field>
        <Field label="Capacity" hint={`Cannot be lower than the current ${club.member_count} members.`}><input className="input" type="number" min={1} value={f.capacity} onChange={set('capacity')} /></Field>
        {canAdmin ? (
          <Field label="Faculty advisor"><select className="input" value={f.advisor_id} onChange={set('advisor_id')}><option value="">None</option>{advisors.data?.items.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        ) : (
          <Field label="Faculty advisor" hint="Can only be reassigned by college admin."><input className="input bg-paper-sunken cursor-not-allowed" disabled value={advisor?.name || 'Not assigned'} /></Field>
        )}
        <Field label="Category"><input className="input" value={f.category} onChange={set('category')} /></Field>
        <div className="md:col-span-2"><Field label="Description"><textarea className="input" value={f.description} onChange={set('description')} /></Field></div>
        <div className="md:col-span-2"><Field label="Meeting rules"><textarea className="input" value={f.meeting_rules} onChange={set('meeting_rules')} /></Field></div>
        <div><Button type="submit" loading={busy}>Save changes</Button></div>
      </form>
    </Card>
  );
}
