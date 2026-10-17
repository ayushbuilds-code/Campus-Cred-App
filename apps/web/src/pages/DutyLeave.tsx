import { FormEvent, useState } from 'react';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Tabs, useAction } from '../components/ui';
import { fmtDate, fmtDateTime } from '../lib/format';

export default function DutyLeave() {
  const { me, role, isLead } = useAuth();
  const [tab, setTab] = useState<'activity' | 'event'>('activity');
  const [requestModal, setRequestModal] = useState(false);

  const { data: actLeaves, loading: l1, error: e1, reload: r1 } = useApi<any>('/activity-leaves');
  const { data: eventLeaves, loading: l2, error: e2, reload: r2 } = useApi<any>('/duty-leaves');

  if ((l1 && !actLeaves) || (l2 && !eventLeaves)) return <Loading />;
  if (e1) return <ErrorBox error={e1} retry={r1} />;
  if (e2) return <ErrorBox error={e2} retry={r2} />;

  return (
    <>
      <PageHeader
        title="Leave Management"
        subtitle="Request and approve leaves for Club Activity Days and inter-college event participation."
        actions={
          role === 'student' && (
            <Button onClick={() => setRequestModal(true)}>Request Club Day Leave</Button>
          )
        }
      />

      <Tabs
        tabs={[
          { id: 'activity', label: 'Club Day Activity Leaves', badge: actLeaves?.items?.filter((x: any) => x.status === 'pending').length },
          { id: 'event', label: 'Inter-College Event Duty Leaves', badge: eventLeaves?.items?.filter((x: any) => x.status === 'pending').length },
        ]}
        value={tab}
        onChange={(v: any) => setTab(v)}
      />

      {tab === 'activity' ? (
        <ActivityLeaves data={actLeaves?.items || []} reload={r1} isLead={isLead} role={role} myId={me?.user?.id} />
      ) : (
        <EventLeaves data={eventLeaves?.items || []} reload={r2} role={role} />
      )}

      {requestModal && (
        <RequestActivityLeaveModal
          memberships={me?.memberships || []}
          onClose={() => setRequestModal(false)}
          onDone={() => { setRequestModal(false); r1(); }}
        />
      )}
    </>
  );
}

function ActivityLeaves({ data, reload, isLead, role, myId }: { data: any[]; reload: () => void; isLead: boolean; role: string; myId: number }) {
  const { run } = useAction();
  const [decideModal, setDecideModal] = useState<{ req: any; approve: boolean } | null>(null);

  const canDecide = isLead || role === 'admin' || role === 'campus_manager' || role === 'advisor';

  return (
    <Card>
      <CardTitle>Club Day Activity Leaves ({data.length})</CardTitle>
      {data.length === 0 ? (
        <Empty
          title="No activity leave requests"
          text="When club members need leave on Club Days, their requests appear here for President and Vice President approval."
        />
      ) : (
        <ul className="divide-y divide-line">
          {data.map((l: any) => {
            const isRequester = l.user_id === myId;
            const canAction = canDecide && !isRequester && l.status === 'pending';

            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">
                      {l.student_name} {l.student_code ? `(${l.student_code})` : ''}
                    </span>
                    <span className="text-sm font-medium text-brand">· {l.club_name}</span>
                  </div>
                  <p className="text-xs text-ink-60">
                    {l.club_day_date ? `Club Day Date: ${l.club_day_date}` : ''}
                    {l.activity_topic ? ` · Activity: ${l.activity_topic}` : ''}
                    {` · Requested ${fmtDate(l.created_at)}`}
                  </p>
                  <p className="text-sm text-ink-80">Reason: “{l.reason}”</p>
                  {l.decision_note && (
                    <p className="text-xs text-ink-60">
                      Coordinator Note ({l.decided_by_name || 'Leader'}): “{l.decision_note}”
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {l.status === 'approved' && <Badge tone="ok">Leave Approved</Badge>}
                  {l.status === 'rejected' && <Badge tone="danger">Leave Declined</Badge>}
                  {l.status === 'pending' && <Badge tone="warn">Pending Coordinator Review</Badge>}

                  {canAction && (
                    <>
                      <Button small onClick={() => setDecideModal({ req: l, approve: true })}>
                        Approve
                      </Button>
                      <Button small variant="secondary" onClick={() => setDecideModal({ req: l, approve: false })}>
                        Decline
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {decideModal && (
        <DecideActivityLeaveModal
          item={decideModal}
          onClose={() => setDecideModal(null)}
          onDone={() => { setDecideModal(null); reload(); }}
        />
      )}
    </Card>
  );
}

function RequestActivityLeaveModal({ memberships, onClose, onDone }: { memberships: any[]; onClose: () => void; onDone: () => void }) {
  const activeClubs = memberships.filter((m) => m.status === 'active');
  const [clubId, setClubId] = useState(String(activeClubs[0]?.club_id || ''));
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();

  const { data: daysData } = useApi<any>('/club-days');
  const [dayId, setDayId] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clubId) return;
    const body: any = {
      club_id: Number(clubId),
      reason,
      club_day_id: dayId ? Number(dayId) : undefined,
    };
    if (await run(() => api('/activity-leaves', { body }), 'Leave request submitted to club president & vice president')) {
      onDone();
    }
  };

  return (
    <Modal title="Request Leave for Club Day Activity" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Club">
          <select className="input" value={clubId} onChange={(e) => setClubId(e.target.value)} required>
            {activeClubs.map((m) => (
              <option key={m.club_id} value={m.club_id}>{m.club_name}</option>
            ))}
          </select>
        </Field>

        {daysData?.days?.length > 0 && (
          <Field label="Club Day Date">
            <select className="input" value={dayId} onChange={(e) => setDayId(e.target.value)}>
              <option value="">Select an upcoming Club Day</option>
              {daysData.days.map((d: any) => (
                <option key={d.id} value={d.id}>{d.date} · {d.title}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Reason for Leave" hint="Explain why you are unable to attend the club day activity">
          <textarea
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
            placeholder="e.g. Lab examination scheduled, academic project presentation clash..."
          />
        </Field>

        <p className="text-xs text-ink-60">
          This request will be sent directly to your club President and Vice President for approval.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Submit Request</Button>
        </div>
      </form>
    </Modal>
  );
}

function DecideActivityLeaveModal({ item, onClose, onDone }: { item: { req: any; approve: boolean }; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const { run, busy } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const actionText = item.approve ? 'Leave request approved' : 'Leave request declined';
    if (await run(() => api(`/activity-leaves/${item.req.id}/decision`, { body: { approve: item.approve, note: note || undefined } }), actionText)) {
      onDone();
    }
  };

  return (
    <Modal title={`${item.approve ? 'Approve' : 'Decline'} Leave Request: ${item.req.student_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm">
          <strong>Club:</strong> {item.req.club_name}<br />
          <strong>Reason:</strong> “{item.req.reason}”
        </p>
        <Field label="Remark / Note (optional)">
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={item.approve ? 'e.g. Approved, excused for lab exam' : 'e.g. Presence mandatory'}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={item.approve ? 'primary' : 'danger'} loading={busy}>
            {item.approve ? 'Approve Leave' : 'Decline Leave'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EventLeaves({ data, reload, role }: { data: any[]; reload: () => void; role: string }) {
  const canDecide = role === 'campus_manager' || role === 'admin';
  const { run } = useAction();

  const decide = async (d: any, approve: boolean) => {
    if (await run(() => api(`/duty-leaves/${d.id}/decision`, { body: { approve } }), approve ? 'Duty leave approved' : 'Duty leave declined')) {
      reload();
    }
  };

  return (
    <Card>
      <CardTitle>Inter-College Event Duty Leaves</CardTitle>
      {data.length === 0 ? (
        <Empty title="No duty leave requests" text="They appear when students register for inter-college events." />
      ) : (
        <ul className="divide-y divide-line">
          {data.map((d: any) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold">{canDecide ? `${d.student} (${d.student_code})` : d.event_name}</p>
                <p className="text-sm text-ink-60">{canDecide ? `${d.event_name} · ` : ''}{fmtDateTime(d.starts_at)}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={d.status} />
                {canDecide && d.status === 'pending' && (
                  <>
                    <Button small onClick={() => decide(d, true)}>Approve</Button>
                    <Button small variant="secondary" onClick={() => decide(d, false)}>Decline</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
