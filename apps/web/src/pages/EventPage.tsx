import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Loading, PageHeader, StatusBadge, useAction, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export default function EventPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { role, me } = useAuth();
  const { data, loading, error, reload } = useApi<any>(`/events/${id}`);
  const { run, busy } = useAction();
  const toast = useToast();
  const [teamName, setTeamName] = useState(''); const [invite, setInvite] = useState('');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const { event: ev, teams, participants = [], my_registration: mine, session, can, registration_open } = data;
  const myTeam = teams.find((t: any) => t.id === mine?.team_id);
  const teamEvent = ev.team_size_max > 1;
  const individualRegs = participants.filter((p: any) => !p.team_id);
  const isStudent = role === 'student';
  const act = (fn: () => Promise<any>, msg: string) => async () => { if (await run(fn, msg)) reload(); };
  const startCheckin = async () => { const r = await run(() => api(`/events/${ev.id}/session`, { method: 'POST' })); if (r) nav(`/run/${r.id}`); };

  return (
    <>
      <p className="mb-2 text-sm"><Link to="/events" className="font-semibold text-brand">← All events</Link></p>
      <PageHeader title={ev.name} subtitle={`${fmtDateTime(ev.starts_at)}${ev.venue ? ` · ${ev.venue}` : ''} · ${ev.registered}/${ev.capacity} registered`} actions={<StatusBadge status={ev.status} />} />
      {ev.description && <Card className="mb-4"><p>{ev.description}</p>{ev.inter_college ? <p className="mt-2 text-sm text-ink-60">This is an inter-college event. A duty leave request is created automatically when you register, and the campus manager approves it.</p> : null}</Card>}

      <div className="grid gap-4 md:grid-cols-2">
        {isStudent && (
          <Card><CardTitle>Your registration</CardTitle>
            {mine ? (<div className="space-y-3">
              <p className="text-sm"><Badge tone="ok">Registered</Badge> {myTeam ? `in team ${myTeam.name}` : 'as an individual'}</p>
              {mine.result_position && <p className="font-display text-xl font-bold">Result: position {mine.result_position}</p>}
              {myTeam && <div className="rounded-lg bg-paper p-3 text-sm"><p>Invite teammates with this code:</p><p className="font-display text-2xl font-bold tracking-widest">{myTeam.invite_code}</p><p className="text-ink-60">{myTeam.size}/{ev.team_size_max} members{myTeam.size < ev.team_size_min ? `. You need at least ${ev.team_size_min}.` : ''}</p></div>}
              {myTeam && ev.status === 'open' && <Button variant="secondary" onClick={act(() => api(`/events/${ev.id}/teams/leave`, { method: 'POST' }), 'You left the team')}>Leave team</Button>}
              {session && data.my_attendance ? <p className="text-sm">Check-in: <StatusBadge status={data.my_attendance.status} /></p> : session?.status === 'open' && <Link to="/checkin"><Button>Check in now</Button></Link>}
            </div>) : !registration_open ? <p className="text-sm text-ink-60">Registration is closed.</p> : (
              <div className="space-y-4">
                {(!teamEvent || ev.team_size_min <= 1) && <Button loading={busy} onClick={act(() => api(`/events/${ev.id}/register`, { method: 'POST' }), 'You are registered')}>Register{teamEvent ? ' without a team' : ''}</Button>}
                {teamEvent && <>
                  <form onSubmit={async (e: FormEvent) => { e.preventDefault(); if (await run(() => api(`/events/${ev.id}/teams`, { body: { name: teamName } }), 'Team created. Share the invite code.')) { setTeamName(''); reload(); } }} className="space-y-2">
                    <Field label="Create a team"><input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" required minLength={2} /></Field><Button type="submit" loading={busy}>Create team</Button></form>
                  <form onSubmit={async (e: FormEvent) => { e.preventDefault(); if (await run(() => api(`/events/${ev.id}/teams/join`, { body: { invite_code: invite } }), 'You joined the team')) { setInvite(''); reload(); } }} className="space-y-2 border-t border-line pt-4">
                    <Field label="Or join with an invite code"><input className="input uppercase tracking-widest" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="ABC123" required minLength={4} maxLength={12} /></Field><Button type="submit" variant="secondary" loading={busy}>Join team</Button></form></>}
              </div>)}
          </Card>)}

        <Card>
          <CardTitle>
            {teamEvent
              ? `Registered (${ev.registered}) · Teams: ${teams.length} · Individual: ${individualRegs.length}`
              : `Participants (${ev.registered})`}
          </CardTitle>
          {ev.registered === 0
            ? <Empty title="No registrations yet" />
            : (
              <div className="space-y-3">
                {teams.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-60">Teams</p>
                    <ul className="space-y-2">
                      {teams.map((t: any) => (
                        <li key={t.id} className="rounded-lg border border-line p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{t.name}</span>
                            {t.position ? <Badge tone="brand">#{t.position}</Badge> : <span className="text-ink-60">{t.size}/{ev.team_size_max}</span>}
                          </div>
                          <p className="text-ink-60">{t.members.map((m: any) => m.name).join(', ')}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {individualRegs.length > 0 && (
                  <div>
                    {(teamEvent || teams.length > 0) && (
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-60">
                        Individual registrations
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {individualRegs.map((p: any) => (
                        <li key={p.user_id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                          <span className="font-semibold">{p.name}</span>
                          <div className="flex items-center gap-2">
                            {p.student_code && <span className="text-xs text-ink-60">{p.student_code}</span>}
                            {p.result_position && <Badge tone="brand">#{p.result_position}</Badge>}
                            <Badge tone="ok">Individual</Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!teamEvent && teams.length === 0 && individualRegs.length === 0 && (
                  <p className="text-sm text-ink-60">{ev.registered} students registered.</p>
                )}
              </div>
            )}
        </Card>
      </div>

      {can.manage && <Manage ev={ev} teams={teams} session={session} onCheckin={startCheckin} onDone={reload} meId={me!.user.id} toast={toast} />}
    </>
  );
}

function Manage({ ev, teams, session, onCheckin, onDone }: { ev: any; teams: any[]; session: any; onCheckin: () => void; onDone: () => void; meId: number; toast: any }) {
  const regs = useApi<any>(`/events/${ev.id}/registrations`);
  const teamEvent = ev.team_size_max > 1;
  const [pos, setPos] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const rows = teamEvent ? teams.map((t) => ({ key: `t${t.id}`, label: t.name, team_id: t.id, cur: t.position })) : (regs.data?.items || []).map((r: any) => ({ key: `u${r.user_id}`, label: r.name, user_id: r.user_id, cur: r.result_position }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const results = rows.map((r: any) => ({ r, p: Number(pos[r.key] ?? r.cur ?? 0) })).filter((x: any) => x.p > 0).map((x: any) => ({ ...(x.r.team_id ? { team_id: x.r.team_id } : { user_id: x.r.user_id }), position: x.p }));
    if (!results.length) return;
    const r = await run(() => api(`/events/${ev.id}/results`, { body: { results } }));
    if (r) { onDone(); regs.reload(); alert(`Results saved. ${r.certificates_issued} certificates issued.`); }
  };
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <Card><CardTitle>Check-in</CardTitle><p className="mb-3 text-sm text-ink-60">Registered participants scan the rotating QR code to check in. Checked-in participants receive participation certificates when results are published.</p>
        <Button loading={busy} onClick={onCheckin}>{session ? (session.status === 'open' ? 'Open live screen' : 'Reopen check-in') : 'Start check-in'}</Button></Card>
      <Card><CardTitle>Results</CardTitle>
        {rows.length === 0 ? <p className="text-sm text-ink-60">Nobody has registered yet.</p> : (
          <form onSubmit={submit} className="space-y-2">
            <p className="text-sm text-ink-60">Enter the final position (1, 2, 3…). Top three receive achievement certificates.</p>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">{rows.map((r: any) => <li key={r.key} className="flex items-center justify-between gap-3 text-sm"><span className="truncate">{r.label}</span><input aria-label={`Position for ${r.label}`} className="input !min-h-[36px] !w-20 text-center" type="number" min={1} value={pos[r.key] ?? r.cur ?? ''} onChange={(e) => setPos({ ...pos, [r.key]: e.target.value })} /></li>)}</ul>
            <Button type="submit" loading={busy}>Save results and issue certificates</Button></form>)}
      </Card>
    </div>
  );
}
