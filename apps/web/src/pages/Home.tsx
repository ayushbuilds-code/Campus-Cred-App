import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, useApi } from '../lib/api';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, useAction } from '../components/ui';
import { fmtDate, firstName, BUDGET_STATUS_LABELS } from '../lib/format';

export default function Home() {
  const {
    me,
    isSuperAdmin,
    isCampusAdmin,
    isAdvisor,
    isTreasurer,
    isStudent,
    selectedCampusId,
    setSelectedCampusId,
  } = useAuth();

  const overviewUrl = isSuperAdmin && selectedCampusId ? `/me/overview?campus_id=${selectedCampusId}` : '/me/overview';
  const { data, loading, error, reload } = useApi<any>(overviewUrl);
  const campusesRes = useApi<any>('/campuses');

  const [showAddCampus, setShowAddCampus] = useState(false);
  const [advisorModal, setAdvisorModal] = useState<any>(null);
  const [advisorNote, setAdvisorNote] = useState('');
  const { run, busy } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;

  const d = data;
  const ss = d.staff_stats;
  const ts = d.treasurer_stats;
  const todo = d.todo || {};
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const currentCampusName = isSuperAdmin
    ? (selectedCampusId ? campusesRes.data?.items?.find((c: any) => c.id === selectedCampusId)?.name : 'All Campuses (Consolidated)')
    : (me?.campus?.name || 'Campus');

  // Handle Faculty Advisor 1-click decision
  const handleAdvisorDecision = async (action: 'approve' | 'request_changes' | 'reject') => {
    if (!advisorModal) return;
    if (action === 'request_changes' && !advisorNote.trim()) {
      alert('Please explain what changes are required so the Treasurer can revise.');
      return;
    }
    const successMsg = action === 'approve'
      ? 'Budget approved and forwarded to College Admin'
      : action === 'request_changes'
        ? 'Changes requested. Treasurer has been notified.'
        : 'Budget request rejected.';

    if (await run(() => api(`/budget/${advisorModal.id}/advisor-decision`, {
      body: { action, notes: advisorNote || undefined },
    }), successMsg)) {
      setAdvisorModal(null);
      setAdvisorNote('');
      reload();
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wider font-bold text-brand bg-brand-sunken px-2 py-0.5 rounded">
              {isSuperAdmin ? 'Super Admin Portal' : isCampusAdmin ? 'Campus Admin Portal' : isAdvisor ? 'Faculty Advisor Workspace' : isTreasurer ? 'Club Treasury' : 'Student Portal'}
            </span>
            <span className="text-xs text-ink-60">· {currentCampusName}</span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-extrabold text-ink">
            {greet}, {firstName(me?.user.name)}
          </h1>
          <p className="text-sm text-ink-60 mt-0.5">
            {isSuperAdmin
              ? 'Multi-campus institutional governance, cross-campus club directories, and global fund approval pipelines.'
              : isCampusAdmin
                ? `Managing clubs, students, faculty advisors, and college fund approvals for ${me?.campus?.name}.`
                : isAdvisor
                  ? 'Reviewing club activities, student submissions, and vetting treasurer fund requests.'
                  : isTreasurer
                    ? 'Managing club allocations, requirements costing sheets, and tracking approval workflows.'
                    : 'Your club memberships, certified achievements, and campus updates.'}
          </p>
        </div>

        {isSuperAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setShowAddCampus(true)}>+ Add Campus</Button>
            <Link to="/budget">
              <Button variant="secondary">All Budgets →</Button>
            </Link>
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* 1. SUPER ADMIN VIEW */}
      {/* =================================================================== */}
      {isSuperAdmin && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Card className="!p-4">
              <p className="font-display text-3xl font-bold text-brand">{ss?.total_campuses ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Total Campuses</p>
            </Card>
            <Card className="!p-4">
              <p className="font-display text-3xl font-bold text-brand">{ss?.total_clubs ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Active Clubs</p>
            </Card>
            <Card className="!p-4">
              <p className="font-display text-3xl font-bold text-ink">{ss?.total_students ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Enrolled Students</p>
            </Card>
            <Card className="!p-4">
              <p className="font-display text-3xl font-bold text-ink">{ss?.total_advisors ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Faculty Advisors</p>
            </Card>
            <Card className="!p-4 md:col-span-2 bg-gradient-to-br from-brand/5 to-saffron/10 border-brand/20">
              <p className="font-display text-3xl font-bold text-brand">₹{(ss?.total_budget_approved ?? 0).toLocaleString('en-IN')}</p>
              <p className="text-xs text-ink-60 mt-1">Total Funds Approved Across Campuses</p>
            </Card>
          </div>

          {/* Campuses Overview Cards */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-lg font-bold text-ink">Campuses ({campusesRes.data?.items?.length ?? 0})</h2>
              {selectedCampusId && (
                <button
                  onClick={() => setSelectedCampusId(null)}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Clear Campus Filter (Show All)
                </button>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {campusesRes.data?.items?.map((ca: any) => {
                const isSelected = selectedCampusId === ca.id;
                return (
                  <Card
                    key={ca.id}
                    className={`flex flex-col justify-between transition-all ${isSelected ? 'border-brand ring-2 ring-brand/20 shadow-md' : 'hover:border-line-dark'}`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-brand bg-brand/10 px-2 py-0.5 rounded">
                          {ca.code || 'CAMPUS'}
                        </span>
                        {isSelected && <Badge tone="brand">Active Filter</Badge>}
                      </div>
                      <h3 className="font-display text-lg font-bold text-ink mt-2">{ca.name}</h3>
                      <p className="text-xs text-ink-60">{ca.city}{ca.state ? `, ${ca.state}` : ''}</p>

                      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line/60 pt-3 text-center">
                        <div>
                          <p className="font-display font-bold text-ink">{ca.club_count ?? 0}</p>
                          <p className="text-[10px] text-ink-60">Clubs</p>
                        </div>
                        <div>
                          <p className="font-display font-bold text-ink">{ca.student_count ?? 0}</p>
                          <p className="text-[10px] text-ink-60">Students</p>
                        </div>
                        <div>
                          <p className="font-display font-bold text-ink">{ca.advisor_count ?? 0}</p>
                          <p className="text-[10px] text-ink-60">Advisors</p>
                        </div>
                      </div>

                      <p className="mt-3 text-xs text-ink-60 truncate">
                        Admin: <span className="font-medium text-ink">{ca.admin_name || 'Not assigned'}</span>
                      </p>
                    </div>

                    <div className="mt-4 flex gap-2 border-t border-line/60 pt-3">
                      <Button
                        small
                        variant={isSelected ? 'secondary' : 'primary'}
                        onClick={() => setSelectedCampusId(isSelected ? null : ca.id)}
                        className="flex-1"
                      >
                        {isSelected ? 'Reset View' : 'Focus Campus'}
                      </Button>
                      <Link to="/clubs">
                        <Button small variant="secondary">View Clubs</Button>
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 2. CAMPUS ADMIN VIEW */}
      {/* =================================================================== */}
      {isCampusAdmin && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="!p-4">
              <p className="font-display text-3xl font-bold text-brand">{ss?.total_clubs ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Campus Clubs</p>
            </Card>
            <Card className="!p-4">
              <p className="font-display text-3xl font-bold text-ink">{ss?.total_students ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Campus Students</p>
            </Card>
            <Card className="!p-4">
              <p className="font-display text-3xl font-bold text-ink">{ss?.total_advisors ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Faculty Advisors</p>
            </Card>
            <Card className="!p-4 bg-brand-sunken border-brand/20">
              <p className="font-display text-3xl font-bold text-brand">{todo.pending_college_budgets ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Budgets Awaiting College Review</p>
            </Card>
          </div>

          {todo.pending_college_budgets > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-brand bg-brand-sunken p-4 text-ink">
              <div>
                <p className="font-display text-base font-bold text-brand">
                  {todo.pending_college_budgets} fund request(s) awaiting your final college approval
                </p>
                <p className="text-xs text-ink-60">Advisor-approved requests ready for institutional funding decision.</p>
              </div>
              <Link to="/budget">
                <Button className="w-full sm:w-auto">Review Requests →</Button>
              </Link>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardTitle right={<Link to="/clubs" className="text-xs font-semibold text-brand">Manage All →</Link>}>
                Clubs in {me?.campus?.name}
              </CardTitle>
              {ss?.clubs_list?.length === 0 ? (
                <Empty title="No clubs created yet" text="Create your first club to get started." />
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {ss?.clubs_list?.map((c: any) => (
                    <li key={c.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <Link to={`/clubs/${c.id}`} className="font-semibold text-ink hover:text-brand">
                          {c.name}
                        </Link>
                        <p className="text-xs text-ink-60">Advisor: {c.advisor_name || 'Unassigned'} · {c.member_count} members</p>
                      </div>
                      <StatusBadge status={c.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardTitle>Campus Actions</CardTitle>
              <div className="space-y-3">
                <Link to="/clubs" className="block p-3 rounded-lg border border-line bg-white hover:border-brand">
                  <p className="font-semibold text-sm text-ink">+ Create & Setup Clubs</p>
                  <p className="text-xs text-ink-60">Add new student clubs and assign faculty advisors.</p>
                </Link>
                <Link to="/budget" className="block p-3 rounded-lg border border-line bg-white hover:border-brand">
                  <p className="font-semibold text-sm text-ink">💼 College Budget Disbursals</p>
                  <p className="text-xs text-ink-60">Inspect itemized costing sheets and grant final college sanctions.</p>
                </Link>
                <Link to="/admin" className="block p-3 rounded-lg border border-line bg-white hover:border-brand">
                  <p className="font-semibold text-sm text-ink">👥 Student & Advisor Roster</p>
                  <p className="text-xs text-ink-60">Manage students and advisors registered to this campus.</p>
                </Link>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 3. FACULTY ADVISOR VIEW */}
      {/* =================================================================== */}
      {isAdvisor && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="!p-4">
              <p className="font-display text-3xl font-bold text-brand">{me?.advisor_clubs?.length ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Clubs You Advise</p>
            </Card>
            <Card className="!p-4 bg-warn-sunken border-warn/20">
              <p className="font-display text-3xl font-bold text-warn">{todo.pending_budget ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Budget Proposals Awaiting Review</p>
            </Card>
            <Card className="!p-4">
              <p className="font-display text-3xl font-bold text-ink">{todo.pending_plans?.length ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Activity Plans to Review</p>
            </Card>
            <Card className="!p-4">
              <p className="font-display text-3xl font-bold text-ink">{ss?.total_students ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Students in Your Clubs</p>
            </Card>
          </div>

          {todo.pending_budget > 0 && (
            <Card className="border-warn bg-warn-sunken/30">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-ink">
                    Treasurer Budget Submissions Require Your Approval
                  </h3>
                  <p className="text-xs text-ink-60 mt-0.5">
                    Review costing sheets and either forward to College Admin or request changes.
                  </p>
                </div>
                <Link to="/budget">
                  <Button variant="accent">Open Budget Review Queue →</Button>
                </Link>
              </div>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardTitle>Your Assigned Clubs</CardTitle>
              <ul className="divide-y divide-line text-sm">
                {me?.advisor_clubs?.map((c: any) => (
                  <li key={c.id} className="flex items-center justify-between py-3">
                    <div>
                      <Link to={`/clubs/${c.id}`} className="font-semibold text-ink hover:text-brand">
                        {c.name}
                      </Link>
                      <p className="text-xs text-ink-60">{c.campus_name}</p>
                    </div>
                    <Link to={`/clubs/${c.id}`}>
                      <Button small variant="secondary">View Club Roster</Button>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardTitle>Advisor Quick Review Workflow</CardTitle>
              <div className="rounded-xl border border-line bg-paper-sunken p-4 text-xs space-y-2 text-ink-80">
                <p className="font-semibold text-ink text-sm">3-Tier Multi-Campus Budget Process:</p>
                <div className="flex items-center gap-2">
                  <span className="h-6 w-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center">1</span>
                  <span><strong>Club Treasurer:</strong> Submits budget with itemized breakdown & quotes.</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-6 w-6 rounded-full bg-warn/20 text-warn font-bold flex items-center justify-center">2</span>
                  <span><strong>Faculty Advisor (You):</strong> Inspect items, request revisions if needed, or approve & forward to College.</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-6 w-6 rounded-full bg-ok/20 text-ok font-bold flex items-center justify-center">3</span>
                  <span><strong>College Administration:</strong> Final grant disbursement sanction.</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 4. CLUB TREASURER VIEW */}
      {/* =================================================================== */}
      {isTreasurer && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="!p-4">
              <p className="font-display text-2xl font-bold text-ink">₹{(ts?.total_requested ?? 0).toLocaleString('en-IN')}</p>
              <p className="text-xs text-ink-60 mt-1">Total Requested (₹)</p>
            </Card>
            <Card className="!p-4 bg-ok-sunken border-ok/20">
              <p className="font-display text-2xl font-bold text-ok">₹{(ts?.total_approved ?? 0).toLocaleString('en-IN')}</p>
              <p className="text-xs text-ink-60 mt-1">Approved & Sanctioned</p>
            </Card>
            <Card className="!p-4">
              <p className="font-display text-2xl font-bold text-brand">{ts?.pending_review ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">In Review Pipeline</p>
            </Card>
            <Card className="!p-4 bg-warn-sunken border-warn/20">
              <p className="font-display text-2xl font-bold text-warn">{ts?.changes_requested ?? 0}</p>
              <p className="text-xs text-ink-60 mt-1">Changes Requested</p>
            </Card>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-ink p-4 text-white">
            <div>
              <p className="font-display text-base font-bold">Plan Club Equipment & Event Requirements</p>
              <p className="text-xs text-white/70">Create costing breakdown and submit directly to your Faculty Advisor.</p>
            </div>
            <Link to="/budget">
              <Button variant="accent" className="w-full sm:w-auto">+ New Budget Proposal</Button>
            </Link>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 5. STUDENT / CLUB MEMBER VIEW */}
      {/* =================================================================== */}
      {isStudent && (
        <div className="space-y-6">
          {/* Active Memberships */}
          <Card>
            <CardTitle right={<Link to="/clubs" className="text-xs font-semibold text-brand">My Club →</Link>}>
              Your Club Memberships ({d.memberships.length})
            </CardTitle>
            {d.memberships.length === 0 ? (
              <Empty
                title="You have not joined any club yet"
                text="You are not currently registered in a club. Please contact your Campus Administrator to be enrolled."
                action={<Link to="/clubs"><Button>My Club</Button></Link>}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {d.memberships.map((m: any) => (
                  <div key={m.id} className="rounded-xl border border-line bg-paper-sunken p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-display text-base font-bold text-ink">{m.club_name}</span>
                        <Badge tone={m.position === 'member' ? 'neutral' : 'brand'}>
                          {m.position.replace('_', ' ')}
                        </Badge>
                      </div>
                      <p className="text-xs text-ink-60 mt-1">{m.campus_name}</p>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Link to={`/clubs/${m.club_id}`} className="flex-1">
                        <Button small className="w-full">Club Portal</Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Announcements Feed for Current Campus & Clubs */}
      {d.recent_announcements && d.recent_announcements.length > 0 && (
        <Card>
          <CardTitle>Recent Announcements</CardTitle>
          <div className="divide-y divide-line">
            {d.recent_announcements.map((a: any) => (
              <div key={a.id} className="py-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-ink">{a.title}</span>
                  {a.club_name ? (
                    <Badge tone="brand">{a.club_name}</Badge>
                  ) : (
                    <Badge tone="neutral">{a.campus_name}</Badge>
                  )}
                  <span className="text-[11px] text-ink-60 ml-auto">{fmtDate(a.created_at)}</span>
                </div>
                <p className="text-xs text-ink-80 mt-1 whitespace-pre-line">{a.body}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Add Campus Modal (Super Admin) */}
      {showAddCampus && (
        <AddCampusModal
          onClose={() => setShowAddCampus(false)}
          onDone={() => {
            setShowAddCampus(false);
            campusesRes.reload();
            reload();
          }}
        />
      )}
    </div>
  );
}

function AddCampusModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', code: '', city: '', state: '' });
  const { run, busy } = useAction();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => api('/campuses', { body: f }), `Campus "${f.name}" created successfully`)) {
      onDone();
    }
  };

  return (
    <Modal title="Add New Campus" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Campus Name">
          <input
            className="input"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="e.g. Pune Institute of Science & Technology"
            required
            minLength={3}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code / Slug" hint="Unique 3-4 letters">
            <input
              className="input uppercase"
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
              placeholder="e.g. PUNE"
              maxLength={10}
            />
          </Field>
          <Field label="City">
            <input
              className="input"
              value={f.city}
              onChange={(e) => setF({ ...f, city: e.target.value })}
              placeholder="e.g. Pune"
              required
            />
          </Field>
        </div>
        <Field label="State / Region">
          <input
            className="input"
            value={f.state}
            onChange={(e) => setF({ ...f, state: e.target.value })}
            placeholder="e.g. Maharashtra"
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" loading={busy}>Create Campus</Button>
        </div>
      </form>
    </Modal>
  );
}
