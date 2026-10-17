import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  StatusBadge,
  useAction,
} from '../components/ui';

export default function Clubs() {
  const { me, isSuperAdmin, isCampusAdmin, isAdvisor, isStudent, selectedCampusId, refresh } = useAuth();
  const queryUrl = isSuperAdmin && selectedCampusId ? `/clubs?campus_id=${selectedCampusId}` : '/clubs';
  const { data, loading, error, reload } = useApi<any>(queryUrl);

  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const { run } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;

  const isManager = isSuperAdmin || isCampusAdmin;
  const allItems = data.items || [];
  const items = allItems.filter((c: any) =>
    `${c.name} ${c.category || ''} ${c.campus || ''}`.toLowerCase().includes(q.toLowerCase())
  );

  const approve = async (c: any) => {
    if (await run(() => api(`/clubs/${c.id}/status`, { body: { status: 'approved' } }), `${c.name} approved`)) {
      reload();
    }
  };

  const pageTitle = isManager
    ? (isSuperAdmin ? 'Clubs Management' : 'Campus Clubs Management')
    : (items.length > 1 ? 'My Clubs' : 'My Club');

  const pageSubtitle = isManager
    ? (isSuperAdmin
        ? 'Overseeing student organizations, assigned advisors, and membership capacities across all campuses.'
        : `Manage clubs, assign faculty advisors, and oversee club memberships for ${me?.campus?.name || 'your campus'}.`)
    : (isAdvisor
        ? 'Clubs assigned to you for faculty oversight, activity reviews, and budget approvals.'
        : 'Your active club memberships, leadership roles, and club portals.');

  return (
    <div className="space-y-6">
      <PageHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        actions={isManager && <Button onClick={() => setShowNew(true)}>+ New Club</Button>}
      />

      {/* Search Bar & Scope Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink-60">
            {isManager
              ? `Total Managed Clubs: ${allItems.length}`
              : `Active Clubs: ${allItems.length}`}
          </span>
          {!isManager && allItems.length > 0 && (
            <span className="text-[11px] bg-ok/10 text-ok px-2 py-0.5 rounded font-medium">
              Assigned & Joined
            </span>
          )}
        </div>

        {allItems.length > 2 && (
          <input
            className="input !w-72 text-xs"
            placeholder="Search your clubs..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search clubs"
          />
        )}
      </div>

      {items.length === 0 ? (
        <Empty
          title={isManager ? 'No clubs found' : 'No Club Assigned'}
          text={
            isManager
              ? 'No clubs match your filter or search query. Click "+ New Club" to create one.'
              : isAdvisor
                ? 'You are not currently assigned to any club. Campus administrators assign faculty advisors to clubs.'
                : 'You are not currently an active member of any club. Please contact your Campus Administrator to be added to a club.'
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((c: any) => {
            let roleTone: 'ok' | 'brand' | 'warn' | 'neutral' = 'neutral';
            let roleLabel = 'Member';
            if (isAdvisor || c.my_position === 'advisor' || c.advisor_id === me?.user?.id) {
              roleLabel = 'Faculty Advisor';
              roleTone = 'warn';
            } else if (c.my_position === 'president') {
              roleLabel = 'President';
              roleTone = 'brand';
            } else if (c.my_position === 'vice_president') {
              roleLabel = 'Vice President';
              roleTone = 'brand';
            } else if (c.my_position === 'treasurer') {
              roleLabel = 'Treasurer';
              roleTone = 'brand';
            } else if (c.my_status === 'active') {
              roleLabel = 'Active Member';
              roleTone = 'ok';
            }

            return (
              <Card key={c.id} className="flex flex-col justify-between hover:border-line-dark transition-all">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link to={`/clubs/${c.id}`} className="font-display text-lg font-bold text-ink hover:text-brand">
                        {c.name}
                      </Link>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] font-semibold text-brand bg-brand-sunken px-2 py-0.2 rounded">
                          🏛️ {c.campus}
                        </span>
                        {c.category && (
                          <span className="text-[11px] text-ink-60">· {c.category}</span>
                        )}
                      </div>
                    </div>

                    {isManager ? (
                      c.status !== 'approved' ? (
                        <StatusBadge status={c.status} label={c.status === 'pending' ? 'Pending Approval' : 'Archived'} />
                      ) : (
                        <Badge tone="ok">Approved</Badge>
                      )
                    ) : (
                      <Badge tone={roleTone}>{roleLabel}</Badge>
                    )}
                  </div>

                  <p className="mt-2.5 text-xs text-ink-80 line-clamp-2 leading-relaxed">
                    {c.description || 'No description provided.'}
                  </p>

                  {c.meeting_rules && (
                    <p className="mt-2 text-[11px] text-ink-60 bg-paper-sunken p-1.5 rounded border border-line/60">
                      📅 <span className="font-semibold text-ink">Schedule:</span> {c.meeting_rules}
                    </p>
                  )}

                  <p className="mt-3 text-xs text-ink-60 border-t border-line/60 pt-2">
                    Advisor: <span className="font-medium text-ink">{c.advisor_name || 'Not assigned'}</span> ·{' '}
                    <span className="font-medium text-ink">{c.member_count}</span>/{c.capacity} members
                  </p>
                </div>

                <div className="mt-4 flex gap-2 border-t border-line/60 pt-3">
                  {c.status === 'pending' && isManager && (
                    <Button small variant="accent" onClick={() => approve(c)}>
                      Approve Club
                    </Button>
                  )}
                  <Link to={`/clubs/${c.id}`} className="ml-auto">
                    <Button small variant="secondary">Open Club Portal →</Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showNew && (
        <NewClubModal
          onClose={() => setShowNew(false)}
          onDone={() => {
            setShowNew(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function NewClubModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { isSuperAdmin, me } = useAuth();
  const campuses = useApi<any>('/campuses');
  const advisors = useApi<any>('/users?role=advisor');

  const [f, setF] = useState<any>({
    name: '',
    category: 'Technology',
    description: '',
    meeting_rules: '',
    capacity: 25,
    advisor_id: '',
    campus_id: me?.campus?.id || '',
  });

  const { run, busy } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      ...f,
      capacity: Number(f.capacity),
      advisor_id: f.advisor_id ? Number(f.advisor_id) : null,
      campus_id: isSuperAdmin ? (f.campus_id ? Number(f.campus_id) : undefined) : me?.campus?.id,
      category: f.category || undefined,
      description: f.description || undefined,
      meeting_rules: f.meeting_rules || undefined,
    };

    if (await run(() => api('/clubs', { body }), 'Club created successfully!')) {
      onDone();
    }
  };

  return (
    <Modal title="Create New Campus Club" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Club Name">
          <input className="input text-xs" value={f.name} onChange={set('name')} required minLength={2} placeholder="e.g. Robotics Club" />
        </Field>

        {isSuperAdmin && (
          <Field label="Campus">
            <select className="input text-xs" value={f.campus_id} onChange={set('campus_id')} required>
              <option value="">Select campus...</option>
              {campuses.data?.items?.map((ca: any) => (
                <option key={ca.id} value={ca.id}>{ca.name} ({ca.city})</option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <input className="input text-xs" value={f.category} onChange={set('category')} placeholder="e.g. Technology" />
          </Field>
          <Field label="Member Capacity">
            <input className="input text-xs" type="number" min={1} value={f.capacity} onChange={set('capacity')} required />
          </Field>
        </div>

        <Field label="Faculty Advisor">
          <select className="input text-xs" value={f.advisor_id} onChange={set('advisor_id')}>
            <option value="">Assign later</option>
            {advisors.data?.items?.map((a: any) => (
              <option key={a.id} value={a.id}>{a.name} ({a.campus_name || 'Advisor'})</option>
            ))}
          </select>
        </Field>

        <Field label="Description">
          <textarea className="input text-xs" rows={2} value={f.description} onChange={set('description')} placeholder="What does this club do?" />
        </Field>

        <Field label="Meeting Rules & Schedule">
          <textarea className="input text-xs" rows={2} value={f.meeting_rules} onChange={set('meeting_rules')} placeholder="When and where the club meets (e.g. Saturdays 14:00 - 16:00)" />
        </Field>

        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Create Club</Button>
        </div>
      </form>
    </Modal>
  );
}
