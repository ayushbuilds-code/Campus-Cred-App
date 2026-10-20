import { FormEvent, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  StatusBadge,
  Tabs,
  Icon,
  useAction,
} from '../components/ui';
import { fmtDateTime, fmtWeekday, ROLE } from '../lib/format';

export default function Admin() {
  const { isSuperAdmin, isCampusAdmin } = useAuth();
  const [tab, setTab] = useState(isSuperAdmin ? 'campuses' : 'calendar');

  if (!isSuperAdmin && !isCampusAdmin) return <Empty title="Administration area restricted to Admins" />;

  const tabs = [
    ...(isSuperAdmin ? [{ id: 'campuses', label: 'Campuses' }] : []),
    { id: 'calendar', label: 'Academic Calendar' },
    { id: 'users', label: 'Users & People' },
    { id: 'clubs', label: 'Clubs' },
    ...(isSuperAdmin ? [{ id: 'settings', label: 'Settings' }] : []),
    { id: 'audit', label: 'Audit Log' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={isSuperAdmin ? 'Institutional Administration (Multi-Campus)' : 'Campus Administration'}
        subtitle={
          isSuperAdmin
            ? 'Manage campuses, assign campus administrators, oversee academic calendars, student rosters, and audit platform activities.'
            : 'Manage academic calendar schedules, student club members, faculty advisors, and clubs within your assigned campus.'
        }
      />

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'campuses' && isSuperAdmin && <CampusesManager />}
      {tab === 'calendar' && <AcademicCalendarManager />}
      {tab === 'users' && <Users />}
      {tab === 'clubs' && <AdminClubs />}
      {tab === 'settings' && isSuperAdmin && <Settings />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

// =========================================================================
// 1. CAMPUSES MANAGER (SUPER ADMIN)
// =========================================================================
function CampusesManager() {
  const { data, loading, error, reload } = useApi<any>('/campuses');
  const [showAdd, setShowAdd] = useState(false);
  const [editCampus, setEditCampus] = useState<any>(null);
  const [assignAdmin, setAssignAdmin] = useState<any>(null);
  const { run } = useAction();

  const deleteCampus = async (c: any) => {
    if (!window.confirm(`Are you sure you want to delete campus "${c.name}"?`)) return;
    if (await run(() => api(`/campuses/${c.id}`, { method: 'DELETE' }), `Campus "${c.name}" deleted`)) {
      reload();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">All Campuses ({data?.items?.length ?? 0})</h2>
          <p className="text-xs text-ink-60">Provision campus environments and assign Campus Administrators.</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>+ Add Campus</Button>
      </div>

      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-ink-60 font-semibold">
                  <th className="py-2.5">Campus Name</th>
                  <th className="py-2.5">Code</th>
                  <th className="py-2.5">Location</th>
                  <th className="py-2.5 text-center">Clubs</th>
                  <th className="py-2.5 text-center">Students</th>
                  <th className="py-2.5">Campus Admin</th>
                  <th className="py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((c: any) => (
                  <tr key={c.id} className="hover:bg-paper-sunken/40">
                    <td className="py-3 font-semibold text-ink text-sm">{c.name}</td>
                    <td className="py-3 font-mono font-bold text-brand">{c.code || '–'}</td>
                    <td className="py-3 text-ink-80">{c.city}{c.state ? `, ${c.state}` : ''}</td>
                    <td className="py-3 text-center font-bold">{c.club_count ?? 0}</td>
                    <td className="py-3 text-center">{c.student_count ?? 0}</td>
                    <td className="py-3">
                      {c.admin_name ? (
                        <div>
                          <span className="font-medium text-ink">{c.admin_name}</span>
                          <span className="block text-[11px] text-ink-60">{c.admin_email}</span>
                        </div>
                      ) : (
                        <span className="text-warn font-semibold">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 text-right space-x-1">
                      <Button small variant="secondary" onClick={() => setAssignAdmin(c)}>
                        Assign Admin
                      </Button>
                      <Button small variant="secondary" onClick={() => setEditCampus(c)}>
                        Edit
                      </Button>
                      <Button small variant="danger" onClick={() => deleteCampus(c)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAdd && (
        <CampusModal
          onClose={() => setShowAdd(false)}
          onDone={() => { setShowAdd(false); reload(); }}
        />
      )}

      {editCampus && (
        <CampusModal
          campus={editCampus}
          onClose={() => setEditCampus(null)}
          onDone={() => { setEditCampus(null); reload(); }}
        />
      )}

      {assignAdmin && (
        <AssignAdminModal
          campus={assignAdmin}
          onClose={() => setAssignAdmin(null)}
          onDone={() => { setAssignAdmin(null); reload(); }}
        />
      )}
    </div>
  );
}

function CampusModal({ campus, onClose, onDone }: { campus?: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: campus?.name || '',
    code: campus?.code || '',
    city: campus?.city || '',
    state: campus?.state || '',
  });
  const { run, busy } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const action = campus
      ? () => api(`/campuses/${campus.id}`, { method: 'PATCH', body: f })
      : () => api('/campuses', { body: f });

    if (await run(action, campus ? 'Campus updated' : 'Campus created')) {
      onDone();
    }
  };

  return (
    <Modal title={campus ? `Edit: ${campus.name}` : 'Create Campus'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Campus Name">
          <input
            className="input text-xs"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            required
            minLength={3}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code / Slug">
            <input
              className="input text-xs uppercase"
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
              placeholder="e.g. BLR"
            />
          </Field>
          <Field label="City">
            <input
              className="input text-xs"
              value={f.city}
              onChange={(e) => setF({ ...f, city: e.target.value })}
              required
            />
          </Field>
        </div>
        <Field label="State / Region">
          <input
            className="input text-xs"
            value={f.state}
            onChange={(e) => setF({ ...f, state: e.target.value })}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" loading={busy}>{campus ? 'Save Changes' : 'Create Campus'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function AssignAdminModal({ campus, onClose, onDone }: { campus: any; onClose: () => void; onDone: () => void }) {
  const users = useApi<any>('/users');
  const [userId, setUserId] = useState('');
  const { run, busy } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    if (await run(() => api(`/campuses/${campus.id}/assign-admin`, { body: { user_id: Number(userId) } }), `Campus Admin assigned to ${campus.name}`)) {
      onDone();
    }
  };

  return (
    <Modal title={`Assign Campus Admin: ${campus.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-ink-60">
          Select a user to appoint as the designated Campus Administrator. They will be granted full administrative oversight of this campus.
        </p>
        <Field label="Select User">
          <select
            className="input text-xs"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
          >
            <option value="">Choose a user...</option>
            {users.data?.items?.map((u: any) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email}) · {ROLE[u.system_role] || u.system_role}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" loading={busy}>Appoint Admin</Button>
        </div>
      </form>
    </Modal>
  );
}

// =========================================================================
// 2. USERS (STRICT CAMPUS ISOLATION)
// =========================================================================
function Users() {
  const { isSuperAdmin, isCampusAdmin, me, selectedCampusId } = useAuth();
  const campuses = useApi<any>('/campuses');

  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [campusFilter, setCampusFilter] = useState(() => (selectedCampusId ? String(selectedCampusId) : ''));

  useEffect(() => {
    setCampusFilter(selectedCampusId ? String(selectedCampusId) : '');
  }, [selectedCampusId]);

  let queryUrl = `/users?q=${encodeURIComponent(q)}&role=${encodeURIComponent(roleFilter)}`;
  const effectiveCampusId = isSuperAdmin ? (campusFilter || (selectedCampusId ? String(selectedCampusId) : '')) : '';
  if (effectiveCampusId) queryUrl += `&campus_id=${effectiveCampusId}`;

  const { data, loading, error, reload } = useApi<any>(queryUrl, [effectiveCampusId, selectedCampusId]);
  const [f, setF] = useState<any>({
    name: '',
    email: '',
    student_code: '',
    system_role: 'student',
    password: '',
    campus_id: selectedCampusId ? String(selectedCampusId) : '',
  });
  const [editingUser, setEditingUser] = useState<any>(null);
  const { run, busy } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      ...f,
      campus_id: isSuperAdmin ? (f.campus_id ? Number(f.campus_id) : undefined) : me?.user.campus_id,
      student_code: f.student_code || undefined,
    };
    if (await run(() => api('/users', { body: payload }), 'User created successfully')) {
      setF({ name: '', email: '', student_code: '', system_role: 'student', password: '', campus_id: '' });
      reload();
    }
  };

  const remove = async (u: any) => {
    if (!window.confirm(`Are you sure you want to delete "${u.name}" (${u.email})?`)) return;
    if (await run(() => api(`/users/${u.id}`, { method: 'DELETE' }), `${u.name} deleted`)) reload();
  };

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_360px]">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
          <CardTitle>People & Directory ({data?.items?.length ?? 0})</CardTitle>
          <div className="flex gap-2">
            {isSuperAdmin && (
              <select
                aria-label="Filter campus"
                className="input !w-auto text-xs"
                value={campusFilter}
                onChange={(e) => setCampusFilter(e.target.value)}
              >
                <option value="">All Campuses</option>
                {campuses.data?.items?.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <select
              aria-label="Filter role"
              className="input !w-auto text-xs"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">All roles</option>
              {Object.entries(ROLE).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        <input
          className="input mb-3 text-xs"
          placeholder="Search by name, email or ID..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search users"
        />

        {loading && !data ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : (
          <ul className="max-h-[34rem] divide-y divide-line overflow-y-auto text-xs">
            {data.items.map((u: any) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="min-w-0 flex-1 basis-48">
                  <span className="font-semibold text-sm text-ink">{u.name}</span>
                  <span className="block truncate text-ink-60">
                    {u.email}{u.student_code ? ` · ${u.student_code}` : ''} · {u.campus_name || 'Global'}
                  </span>
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge>{ROLE[u.system_role] || u.system_role}</Badge>
                  <Button small variant="secondary" onClick={() => setEditingUser(u)}>Edit</Button>
                  <Button small variant="danger" onClick={() => remove(u)}>Delete</Button>
                </div>
              </li>
            ))}
            {data.items.length === 0 && <li className="py-6 text-center text-ink-60">No users found.</li>}
          </ul>
        )}
      </Card>

      {/* Add User Card */}
      <Card>
        <CardTitle>Add Member / Staff</CardTitle>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Full Name">
            <input className="input text-xs" value={f.name} onChange={set('name')} required />
          </Field>
          <Field label="Email Address">
            <input className="input text-xs" type="email" value={f.email} onChange={set('email')} required />
          </Field>

          {isSuperAdmin && (
            <Field label="Campus">
              <select className="input text-xs" value={f.campus_id} onChange={set('campus_id')}>
                <option value="">Select campus...</option>
                {campuses.data?.items?.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          )}

          <Field label="System Role">
            <select className="input text-xs" value={f.system_role} onChange={set('system_role')}>
              {isSuperAdmin && <option value="super_admin">Super Admin</option>}
              {isSuperAdmin && <option value="campus_admin">Campus Admin</option>}
              <option value="faculty_advisor">Faculty Advisor</option>
              <option value="student">Student / Member</option>
            </select>
          </Field>

          {f.system_role === 'student' && (
            <Field label="Student ID / Roll Code">
              <input className="input text-xs" value={f.student_code} onChange={set('student_code')} placeholder="e.g. MSOT26049" />
            </Field>
          )}

          <Field label="Temporary Password" hint="At least 6 characters">
            <input className="input text-xs" type="password" minLength={6} value={f.password} onChange={set('password')} required />
          </Field>

          <Button type="submit" loading={busy} className="w-full">Create User</Button>
        </form>
      </Card>

      {editingUser && (
        <EditUserModal
          user={editingUser}
          isSuperAdmin={isSuperAdmin}
          campuses={campuses.data?.items || []}
          onClose={() => setEditingUser(null)}
          onDone={() => { setEditingUser(null); reload(); }}
        />
      )}
    </div>
  );
}

function EditUserModal({ user, isSuperAdmin, campuses, onClose, onDone }: any) {
  const [f, setF] = useState({
    name: user.name,
    email: user.email,
    student_code: user.student_code || '',
    system_role: user.system_role,
    campus_id: user.campus_id || '',
    password: '',
  });
  const { run, busy } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: any = {
      name: f.name,
      email: f.email,
      student_code: f.student_code || null,
      system_role: f.system_role,
      campus_id: f.campus_id ? Number(f.campus_id) : undefined,
    };
    if (f.password) body.password = f.password;

    if (await run(() => api(`/users/${user.id}`, { method: 'PATCH', body }), 'User details updated')) {
      onDone();
    }
  };

  return (
    <Modal title={`Edit: ${user.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name">
          <input className="input text-xs" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label="Email">
          <input className="input text-xs" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        </Field>
        {isSuperAdmin && (
          <Field label="Campus">
            <select className="input text-xs" value={f.campus_id} onChange={(e) => setF({ ...f, campus_id: e.target.value })}>
              <option value="">None (Global)</option>
              {campuses.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        )}
        {isSuperAdmin && (
          <Field label="Role">
            <select className="input text-xs" value={f.system_role} onChange={(e) => setF({ ...f, system_role: e.target.value })}>
              <option value="super_admin">Super Admin</option>
              <option value="campus_admin">Campus Admin</option>
              <option value="faculty_advisor">Faculty Advisor</option>
              <option value="student">Student</option>
            </select>
          </Field>
        )}
        <Field label="Student ID">
          <input className="input text-xs" value={f.student_code} onChange={(e) => setF({ ...f, student_code: e.target.value })} />
        </Field>
        <Field label="Reset Password" hint="Leave blank to keep current">
          <input className="input text-xs" type="password" minLength={6} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" loading={busy}>Save Changes</Button>
        </div>
      </form>
    </Modal>
  );
}

// =========================================================================
// 3. CLUBS MANAGEMENT
// =========================================================================
function AdminClubs() {
  const { isSuperAdmin, selectedCampusId } = useAuth();
  const queryUrl = isSuperAdmin && selectedCampusId ? `/clubs?campus_id=${selectedCampusId}` : '/clubs';
  const { data, loading, error, reload } = useApi<any>(queryUrl, [selectedCampusId]);
  const { run } = useAction();

  const toggleStatus = async (c: any, status: string) => {
    if (await run(() => api(`/clubs/${c.id}/status`, { body: { status } }), `Club status updated to ${status}`)) {
      reload();
    }
  };

  return (
    <Card>
      <div className="flex justify-between items-center mb-3">
        <CardTitle>Manage Clubs ({data?.items?.length ?? 0})</CardTitle>
        <Link to="/clubs"><Button small>+ Add Club</Button></Link>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : (
        <ul className="divide-y divide-line text-xs">
          {data.items.map((c: any) => (
            <li key={c.id} className="py-2.5 flex items-center justify-between gap-3">
              <div>
                <Link to={`/clubs/${c.id}`} className="font-semibold text-sm text-ink hover:text-brand">
                  {c.name}
                </Link>
                <p className="text-ink-60">{c.campus} · Advisor: {c.advisor_name || 'None'} · {c.member_count} members</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={c.status} />
                {c.status === 'pending' && (
                  <Button small variant="accent" onClick={() => toggleStatus(c, 'approved')}>
                    Approve
                  </Button>
                )}
                {c.status === 'approved' && (
                  <Button small variant="secondary" onClick={() => toggleStatus(c, 'archived')}>
                    Archive
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// =========================================================================
// 4. SETTINGS
// =========================================================================
function Settings() {
  const { data, loading, error, reload } = useApi<any>('/settings');
  const [f, setF] = useState<any>(null);
  const { run, busy } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const s = f ?? data;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api('/settings', { method: 'PUT', body: s }), 'Settings saved')) reload();
  };

  return (
    <Card className="max-w-xl">
      <CardTitle>Global Platform Governance Settings</CardTitle>
      <form onSubmit={submit} className="space-y-4 text-xs mt-3">
        <Field label="Max clubs per student">
          <input
            className="input text-xs"
            type="number"
            min={1}
            max={10}
            value={s.max_clubs_per_student}
            onChange={(e) => setF({ ...s, max_clubs_per_student: Number(e.target.value) })}
          />
        </Field>
        <Field label="Check-in window (minutes)">
          <input
            className="input text-xs"
            type="number"
            min={1}
            value={s.checkin_window_minutes}
            onChange={(e) => setF({ ...s, checkin_window_minutes: Number(e.target.value) })}
          />
        </Field>
        <Button type="submit" loading={busy}>Save Settings</Button>
      </form>
    </Card>
  );
}

// =========================================================================
// 5. AUDIT LOG
// =========================================================================
function Audit() {
  const { isSuperAdmin, selectedCampusId } = useAuth();
  const queryUrl = isSuperAdmin && selectedCampusId ? `/audit?campus_id=${selectedCampusId}` : '/audit';
  const { data, loading, error } = useApi<any>(queryUrl, [selectedCampusId]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <Card>
      <CardTitle>System & Approval Audit Log</CardTitle>
      <ul className="divide-y divide-line text-xs mt-3">
        {data.items?.map((l: any) => (
          <li key={l.id} className="py-2.5 flex items-center justify-between">
            <div>
              <span className="font-mono font-bold text-ink">{l.action}</span>
              <span className="text-ink-60 ml-2">by {l.actor || 'System'}</span>
              {l.reason && <p className="text-ink-80 italic mt-0.5">“{l.reason}”</p>}
            </div>
            <span className="text-ink-60 text-[11px]">{fmtDateTime(l.created_at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// =========================================================================
// 6. ACADEMIC CALENDAR & CLUB DAYS MANAGER
// =========================================================================
function AcademicCalendarManager() {
  const { isSuperAdmin, selectedCampusId } = useAuth();
  const queryUrl = isSuperAdmin && selectedCampusId ? `/club-days?campus_id=${selectedCampusId}` : '/club-days';
  const { data, loading, error, reload } = useApi<any>(queryUrl);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const { run } = useAction();

  const days: any[] = data?.days || [];

  const deleteDay = async (d: any) => {
    if (!window.confirm(`Are you sure you want to remove ${d.date} (${d.title || 'Club Day'}) from the calendar?`)) return;
    if (await run(() => api(`/club-days/${d.id}`, { method: 'DELETE' }), `Date ${d.date} removed`)) {
      reload();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Academic Calendar ({days.length} scheduled dates)
          </h2>
          <p className="text-xs text-ink-60">
            Publish semester dates. Faculty advisors and club presidents use these dates to schedule and plan club activities.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            Import Calendar (CSV)
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            + Add Date One-by-One
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : days.length === 0 ? (
        <Empty
          title="No Academic Calendar Dates"
          text="Import semester dates or add dates one by one to enable club presidents and advisors to plan activities."
          action={
            <div className="flex gap-2 mt-2">
              <Button onClick={() => setShowAdd(true)}>+ Add Date</Button>
              <Button variant="secondary" onClick={() => setShowImport(true)}>Import CSV</Button>
            </div>
          }
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-ink-60 font-semibold">
                  <th className="py-2.5">Date & Day</th>
                  <th className="py-2.5">Event Title</th>
                  <th className="py-2.5">Venue</th>
                  {isSuperAdmin && <th className="py-2.5">Campus</th>}
                  <th className="py-2.5 text-center">Planned Activities</th>
                  <th className="py-2.5">Activity Plan Due</th>
                  <th className="py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {days.map((d: any) => {
                  const actCount = d.activities?.length || 0;
                  return (
                    <tr key={d.id} className="hover:bg-paper-sunken/40">
                      <td className="py-2.5 font-semibold text-ink">
                        {fmtWeekday(d.date)}
                        <span className="block text-[11px] font-mono text-ink-60 font-normal">{d.date}</span>
                      </td>
                      <td className="py-2.5 font-medium text-ink">
                        {d.title || 'Club Day'}
                      </td>
                      <td className="py-2.5 text-ink-60">
                        {d.venue || 'Campus venue'}
                      </td>
                      {isSuperAdmin && (
                        <td className="py-2.5">
                          <span className="font-semibold text-brand text-[11px] bg-brand-sunken px-2 py-0.5 rounded inline-flex items-center gap-1">
                            <Icon name="campus" size={12} /> {d.campus_name || 'Campus'}
                          </span>
                        </td>
                      )}
                      <td className="py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded font-bold ${actCount > 0 ? 'bg-ok/10 text-ok' : 'bg-paper text-ink-60'}`}>
                          {actCount} {actCount === 1 ? 'activity' : 'activities'}
                        </span>
                      </td>
                      <td className="py-2.5 text-ink-60">
                        {fmtWeekday(d.plan_due)}
                      </td>
                      <td className="py-2.5 text-right">
                        <Button
                          small
                          variant="danger"
                          onClick={() => deleteDay(d)}
                          disabled={actCount > 0}
                          title={actCount > 0 ? 'Cannot delete date with planned activities' : 'Delete date'}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAdd && (
        <AdminAddDayModal
          onClose={() => setShowAdd(false)}
          onDone={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}

      {showImport && (
        <AdminImportDaysModal
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function AdminAddDayModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
    if (await run(() => api('/club-days', { body }), 'Date added to academic calendar')) {
      onDone();
    }
  };

  return (
    <Modal title="Add Date to Academic Calendar" onClose={onClose}>
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
        <Field label="Calendar Date">
          <input className="input text-xs" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Event / Club Day Title">
          <input className="input text-xs" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Club Day 1" required />
        </Field>
        <Field label="Venue / Location (Optional)">
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

function AdminImportDaysModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { isSuperAdmin, me, selectedCampusId } = useAuth();
  const campuses = useApi<any>(isSuperAdmin ? '/campuses' : null);
  const [csv, setCsv] = useState('date,title,venue\n2026-11-07,Club Day 1,Main Hall\n2026-11-21,Club Day 2,Seminar Hall\n');
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
    <Modal title="Import Academic Calendar (CSV)" onClose={onClose} wide>
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
