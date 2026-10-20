import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import PlanModal from '../components/PlanModal';
import { Badge, Button, Card, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, StatusBadge, useAction } from '../components/ui';
import { fmtWeekday, todayIso } from '../lib/format';

export default function ClubDays() {
  const { me, isSuperAdmin, isCampusAdmin, isAdvisor, isLead, selectedCampusId } = useAuth();
  const nav = useNavigate();
  const queryUrl = isSuperAdmin && selectedCampusId ? `/club-days?campus_id=${selectedCampusId}` : '/club-days';
  const { data, loading, error, reload } = useApi<any>(queryUrl);
  const [planFor, setPlanFor] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPast, setShowPast] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;

  const today = todayIso();
  const days: any[] = data.days || [];
  // the last 7 days stay visible: submissions are due within 48 h and scoring within 5 days of a Club Day
  const recentFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const upcoming = days.filter((d) => d.date >= recentFrom), past = days.filter((d) => d.date < recentFrom).reverse();
  const shown = showPast ? [...upcoming, ...past] : upcoming;
  const manage = (data.managed_clubs as any[]) || [];
  const canManageCalendar = isSuperAdmin || isCampusAdmin;
  const canPlan = isLead || isAdvisor || isCampusAdmin || isSuperAdmin;

  return (
    <>
      <PageHeader
        title="Club Days & Academic Calendar"
        subtitle="Administrators schedule Club Days according to the academic calendar. Faculty advisors and club presidents plan club activities for each date."
        actions={
          canManageCalendar && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                Import Calendar
              </Button>
              <Button onClick={() => setShowAdd(true)}>
                + Add Date
              </Button>
            </div>
          )
        }
      />

      {shown.length === 0 && (
        <Empty
          title="No upcoming Club Days"
          text="A campus admin or super admin can import the academic calendar or add dates one by one. Once dates are added, advisors and presidents can plan club activities."
          action={
            canManageCalendar && (
              <div className="flex gap-2 mt-2">
                <Button onClick={() => setShowAdd(true)}>+ Add Date One-by-One</Button>
                <Button variant="secondary" onClick={() => setShowImport(true)}>Import Calendar</Button>
              </div>
            )
          }
        />
      )}

      <div className="space-y-4">
        {shown.map((d) => {
          const planned = new Set(d.activities.map((a: any) => a.club_id));
          const toPlan = manage.filter((c) => !planned.has(c.id));
          const isToday = d.date === today;
          const isRecent = d.date < today;

          return (
            <Card key={d.id} className={isToday ? 'border-brand ring-1 ring-brand/30' : ''}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-bold">
                    {fmtWeekday(d.date)}
                    {isToday && <span className="ml-2"><Badge tone="brand">Today</Badge></span>}
                    {isRecent && <span className="ml-2"><Badge>Recent</Badge></span>}
                    {d.campus_name && isSuperAdmin && (
                      <span className="ml-2 text-xs font-semibold text-brand bg-brand-sunken px-2 py-0.5 rounded inline-flex items-center gap-1">
                        <Icon name="campus" size={12} /> {d.campus_name}
                      </span>
                    )}
                  </h2>
                  <p className="text-sm text-ink-60">
                    {d.title || 'Club Day'}{d.venue ? ` · ${d.venue}` : ''} · activity plans due {fmtWeekday(d.plan_due)}
                  </p>
                </div>
                {toPlan.length > 0 && canPlan && !isRecent && (
                  <Button small onClick={() => setPlanFor({ day: d, clubs: toPlan })}>
                    Plan activity
                  </Button>
                )}
              </div>

              {d.activities.length === 0 ? (
                <p className="mt-3 text-sm text-ink-60">No activities planned yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {d.activities.map((a: any) => (
                    <li key={a.id}>
                      <Link to={`/activities/${a.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand">
                        <span>
                          <span className="font-semibold">{a.club_name}</span>
                          <span className="block text-sm text-ink-60">{a.topic}</span>
                        </span>
                        <StatusBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {past.length > 0 && (
        <div className="mt-4 text-center">
          <Button variant="ghost" onClick={() => setShowPast(!showPast)}>
            {showPast ? 'Hide earlier Club Days' : `Show ${past.length} earlier Club Days`}
          </Button>
        </div>
      )}

      {planFor && (
        <PlanModal
          day={planFor.day}
          clubs={planFor.clubs}
          onClose={() => setPlanFor(null)}
          onSaved={(id) => nav(`/activities/${id}`)}
        />
      )}

      {showAdd && (
        <AddDay
          onClose={() => setShowAdd(false)}
          onDone={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}

      {showImport && (
        <ImportDays
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function AddDay({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { isSuperAdmin, me, selectedCampusId } = useAuth();
  const campuses = useApi<any>(isSuperAdmin ? '/campuses' : null);
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('Club Day');
  const [venue, setVenue] = useState('');
  const [campusId, setCampusId] = useState<string>(
    String(selectedCampusId || me?.campus?.id || '')
  );
  const { run, busy } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: any = { date, title, venue: venue || undefined };
    if (isSuperAdmin && campusId) body.campus_id = Number(campusId);
    if (await run(() => api('/club-days', { body }), 'Club Day added to calendar')) {
      onDone();
    }
  };

  return (
    <Modal title="Add a Date to Academic Calendar" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {isSuperAdmin && (
          <Field label="Campus">
            <select
              className="input text-xs"
              value={campusId}
              onChange={(e) => setCampusId(e.target.value)}
              required
            >
              <option value="">Select campus...</option>
              {campuses.data?.items?.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.city})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Date">
          <input className="input text-xs" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Title / Event Label">
          <input className="input text-xs" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Club Day 1" required />
        </Field>
        <Field label="Venue (Optional)">
          <input className="input text-xs" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Auditorium / Seminar Hall" />
        </Field>
        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Add Date</Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportDays({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { isSuperAdmin, me, selectedCampusId } = useAuth();
  const campuses = useApi<any>(isSuperAdmin ? '/campuses' : null);
  const [csv, setCsv] = useState('date,title,venue\n2026-11-07,Club Day 1,Main Hall\n2026-11-21,Club Day 2,Seminar Room\n');
  const [campusId, setCampusId] = useState<string>(
    String(selectedCampusId || me?.campus?.id || '')
  );
  const [result, setResult] = useState<any>(null);
  const { run, busy } = useAction();

  const readFile = (f?: File) => {
    if (f) f.text().then(setCsv);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: any = { csv };
    if (isSuperAdmin && campusId) body.campus_id = Number(campusId);
    const r = await run(() => api('/club-days/import', { body }));
    if (r) setResult(r);
  };

  return (
    <Modal title="Import Academic Calendar (Club Days)" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        {isSuperAdmin && (
          <Field label="Target Campus">
            <select
              className="input text-xs"
              value={campusId}
              onChange={(e) => setCampusId(e.target.value)}
              required
            >
              <option value="">Select campus...</option>
              {campuses.data?.items?.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.city})
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="text-xs text-ink-60">
          Upload or paste CSV with format: <code className="rounded bg-paper px-1 font-mono">YYYY-MM-DD,Title,Venue</code>. Dates that already exist are automatically skipped.
        </p>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => readFile(e.target.files?.[0])}
          aria-label="Choose a CSV file"
          className="text-xs text-ink-60"
        />
        <textarea
          className="input font-mono text-xs"
          rows={7}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          aria-label="CSV contents"
        />
        {result && (
          <div className="rounded-lg bg-paper-sunken p-3 text-xs border border-line">
            <p className="font-semibold text-ink flex items-center gap-1.5">
              <span className="text-ok inline-flex"><Icon name="check" size={15} /></span> <b>{result.created}</b> dates added, <b>{result.skipped}</b> already on the calendar.
            </p>
            {result.errors?.map((x: string) => (
              <p key={x} className="text-danger mt-1">{x}</p>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button type="button" variant="secondary" onClick={result ? onDone : onClose}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          <Button type="submit" loading={busy}>
            Import Calendar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
