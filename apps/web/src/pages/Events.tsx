import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, useAction } from '../components/ui';
import { fmtDateTime, fromLocalInput } from '../lib/format';

export default function Events() {
  const { role, isLead, isSuperAdmin, isCampusAdmin, selectedCampusId } = useAuth();
  const eventsUrl = isSuperAdmin && selectedCampusId ? `/events?campus_id=${selectedCampusId}` : '/events';
  const { data, loading, error, reload } = useApi<any>(eventsUrl);
  const [show, setShow] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;

  const canCreate = isSuperAdmin || isCampusAdmin || role === 'admin' || role === 'campus_manager' || isLead;

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Gambade, hackathons, Cross Road and other campus or inter-college events."
        actions={canCreate && <Button onClick={() => setShow(true)}>+ New event</Button>}
      />
      {data.items.length === 0 ? (
        <Empty title="No events yet" text="Create your first event to get started." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.items.map((e: any) => (
            <Link key={e.id} to={`/events/${e.id}`}>
              <Card className="h-full transition-colors hover:border-brand">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display text-xl font-bold">{e.name}</h2>
                    {e.campus_name ? (
                      <span className="text-xs text-brand font-medium">🏛️ {e.campus_name}</span>
                    ) : (
                      <span className="text-xs text-saffron font-medium">🌐 Inter-Campus Event</span>
                    )}
                  </div>
                  <StatusBadge status={e.status} />
                </div>
                <p className="mt-2 text-sm text-ink-60">{fmtDateTime(e.starts_at)}{e.venue ? ` · ${e.venue}` : ''}</p>
                <p className="mt-3 text-sm">{e.registered}/{e.capacity} registered{e.team_size_max > 1 ? ` · teams of ${e.team_size_min}-${e.team_size_max}` : ''}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {e.inter_college ? <Badge tone="warn">Inter-college · duty leave</Badge> : null}
                  {e.registered_me ? <Badge tone="ok">You are registered</Badge> : null}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {show && <NewEvent onClose={() => setShow(false)} onDone={() => { setShow(false); reload(); }} />}
    </>
  );
}

function NewEvent({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { isSuperAdmin, isCampusAdmin, me } = useAuth();
  const campuses = useApi<any>('/campuses');
  const [f, setF] = useState<any>({
    name: '',
    kind: '',
    description: '',
    venue: '',
    starts_at: '',
    registration_deadline: '',
    capacity: 200,
    team_size_min: 1,
    team_size_max: 1,
    inter_college: false,
    inter_campus: false,
    campus_id: isCampusAdmin ? String(me?.user.campus_id || '') : '',
  });

  const { run, busy } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const isInterCampus = isSuperAdmin ? (!f.campus_id || f.inter_campus) : f.inter_campus;
    const body = {
      name: f.name,
      kind: f.kind || undefined,
      description: f.description || undefined,
      venue: f.venue || undefined,
      starts_at: fromLocalInput(f.starts_at),
      registration_deadline: fromLocalInput(f.registration_deadline),
      capacity: Number(f.capacity),
      team_size_min: Number(f.team_size_min),
      team_size_max: Number(f.team_size_max),
      inter_college: f.inter_college,
      inter_campus: isInterCampus,
      campus_id: f.campus_id ? Number(f.campus_id) : (isCampusAdmin ? me?.user.campus_id : undefined),
    };

    if (await run(() => api('/events', { body }), 'Event created. Students were notified.')) {
      onDone();
    }
  };

  return (
    <Modal title="New event" onClose={onClose} wide>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Name">
            <input className="input" value={f.name} onChange={set('name')} required minLength={3} placeholder="e.g. Annual Hackathon 2026" />
          </Field>
        </div>

        {isSuperAdmin && (
          <div className="md:col-span-2">
            <Field label="Campus Scope">
              <select className="input" value={f.campus_id} onChange={set('campus_id')}>
                <option value="">All Campuses (Open Inter-Campus)</option>
                {campuses.data?.items?.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code || c.city})</option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <Field label="Type">
          <input className="input" value={f.kind} onChange={set('kind')} placeholder="Hackathon, Workshop, Tournament" />
        </Field>
        <Field label="Venue">
          <input className="input" value={f.venue} onChange={set('venue')} placeholder="Campus Auditorium / Lab 3" />
        </Field>
        <Field label="Starts">
          <input className="input" type="datetime-local" value={f.starts_at} onChange={set('starts_at')} required />
        </Field>
        <Field label="Registration closes" hint="Defaults to the start time.">
          <input className="input" type="datetime-local" value={f.registration_deadline} onChange={set('registration_deadline')} />
        </Field>
        <Field label="Capacity">
          <input className="input" type="number" min={1} value={f.capacity} onChange={set('capacity')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min team size">
            <input className="input" type="number" min={1} value={f.team_size_min} onChange={set('team_size_min')} />
          </Field>
          <Field label="Max team size">
            <input className="input" type="number" min={1} value={f.team_size_max} onChange={set('team_size_max')} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Description">
            <textarea className="input" value={f.description} onChange={set('description')} rows={3} placeholder="Brief summary of the event format, guidelines, and schedule" />
          </Field>
        </div>
        <div className="md:col-span-2 space-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-[#0E6B63]" checked={f.inter_college} onChange={set('inter_college')} />
            Inter-college event (creates duty leave requests)
          </label>
          {!isSuperAdmin && (
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-[#0E6B63]" checked={f.inter_campus} onChange={set('inter_campus')} />
              Open to all campuses
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 md:col-span-2 border-t border-line pt-3 mt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Create event</Button>
        </div>
      </form>
    </Modal>
  );
}
