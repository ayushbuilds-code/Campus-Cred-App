import { FormEvent, useState } from 'react';
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
  useAction,
} from '../components/ui';
import { fmtDate, fmtDateTime, BUDGET_STATUS_LABELS } from '../lib/format';

type BudgetItem = { item: string; qty: number; unit_cost: number };

const CATEGORIES = [
  'Equipment',
  'Event',
  'Logistics',
  'Marketing & Outreach',
  'Travel & Delegation',
  'Operational',
  'Other',
];

export default function Budget() {
  const {
    me,
    isSuperAdmin,
    isCampusAdmin,
    isAdvisor,
    isTreasurer,
    isLead,
    selectedCampusId,
  } = useAuth();

  const queryUrl = isSuperAdmin && selectedCampusId ? `/budget?campus_id=${selectedCampusId}` : '/budget';
  const { data, loading, error, reload } = useApi<any>(queryUrl);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Modals state
  const [timelineModal, setTimelineModal] = useState<any>(null);
  const [advisorModal, setAdvisorModal] = useState<any>(null);
  const [collegeModal, setCollegeModal] = useState<any>(null);
  const [editModal, setEditModal] = useState<any>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [inspectItems, setInspectItems] = useState<any>(null);

  // New Request Form State (Treasurers)
  const [f, setF] = useState({
    club_id: '',
    title: '',
    category: 'Equipment',
    purpose: '',
    sheet_link: '',
    supporting_docs: '',
    notes: '',
  });
  const [items, setItems] = useState<BudgetItem[]>([{ item: '', qty: 1, unit_cost: 0 }]);
  const [manualAmount, setManualAmount] = useState<string>('');
  const { run, busy } = useAction();

  const activeMems = (me?.memberships || []).filter((m) => m.status === 'active');
  const eligibleClubs = activeMems.filter((m) => m.position === 'treasurer' || m.position === 'president' || m.position === 'vice_president');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;

  const addItem = () => setItems([...items, { item: '', qty: 1, unit_cost: 0 }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, key: keyof BudgetItem, val: any) => {
    const next = [...items];
    next[idx] = { ...next[idx], [key]: val };
    setItems(next);
  };

  const calculatedTotal = items.reduce((acc, cur) => acc + (Number(cur.qty) || 0) * (Number(cur.unit_cost) || 0), 0);
  const totalAmount = calculatedTotal > 0 ? calculatedTotal : Number(manualAmount) || 0;

  // Create Request (as Draft or Submitted)
  const submitRequest = async (submitNow: boolean) => {
    const targetClubId = Number(f.club_id || eligibleClubs[0]?.club_id);
    if (!targetClubId) {
      alert('Please select a club.');
      return;
    }
    if (!f.title.trim()) {
      alert('Please provide a title for the budget request.');
      return;
    }
    if (totalAmount <= 0) {
      alert('Please enter items or a total amount greater than ₹0.');
      return;
    }

    const validItems = items.filter((it) => it.item.trim());
    const payload = {
      title: f.title,
      category: f.category,
      amount_inr: totalAmount,
      purpose: f.purpose || undefined,
      sheet_link: f.sheet_link || undefined,
      supporting_docs: f.supporting_docs || undefined,
      notes: f.notes || undefined,
      items_json: validItems.length > 0 ? JSON.stringify(validItems) : undefined,
      submit_now: submitNow,
    };

    const msg = submitNow
      ? 'Budget request submitted to Faculty Advisor for review!'
      : 'Budget proposal saved as Draft.';

    if (await run(() => api(`/clubs/${targetClubId}/budget`, { body: payload }), msg)) {
      setF({
        club_id: '',
        title: '',
        category: 'Equipment',
        purpose: '',
        sheet_link: '',
        supporting_docs: '',
        notes: '',
      });
      setItems([{ item: '', qty: 1, unit_cost: 0 }]);
      setManualAmount('');
      reload();
    }
  };

  // Advisor Decision
  const handleAdvisorDecision = async (action: 'approve' | 'request_changes' | 'reject') => {
    if (!advisorModal) return;
    if (action === 'request_changes' && !decisionNote.trim()) {
      alert('Please provide feedback explaining what changes are required.');
      return;
    }
    const msg = action === 'approve'
      ? 'Approved and forwarded to College Admin!'
      : action === 'request_changes'
        ? 'Revisions requested. Treasurer notified.'
        : 'Budget request rejected.';

    if (await run(() => api(`/budget/${advisorModal.id}/advisor-decision`, {
      body: { action, notes: decisionNote || undefined },
    }), msg)) {
      setAdvisorModal(null);
      setDecisionNote('');
      reload();
    }
  };

  // College Admin Decision
  const handleCollegeDecision = async (action: 'approve' | 'reject') => {
    if (!collegeModal) return;
    const msg = action === 'approve' ? 'Sanctioned & Approved!' : 'Budget request rejected by College Admin.';

    if (await run(() => api(`/budget/${collegeModal.id}/college-decision`, {
      body: { action, notes: decisionNote || undefined },
    }), msg)) {
      setCollegeModal(null);
      setDecisionNote('');
      reload();
    }
  };

  // Submit Draft directly
  const submitDraft = async (reqId: number) => {
    if (!window.confirm('Submit this draft proposal to your Faculty Advisor for review?')) return;
    if (await run(() => api(`/budget/${reqId}`, { method: 'PATCH', body: { submit_now: true } }), 'Submitted to Faculty Advisor!')) {
      reload();
    }
  };

  // Filter requests
  const filteredItems = (data.items || []).filter((b: any) => {
    const matchesSearch = `${b.title} ${b.club_name} ${b.requester_name || ''} ${b.category || ''}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesStatus = !statusFilter || b.normalized_status === statusFilter;
    const matchesCategory = !categoryFilter || b.category === categoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  });

  const totalPages = Math.ceil(filteredItems.length / pageSize) || 1;
  const paginatedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  const canCreate = isSuperAdmin || isTreasurer || isLead;

  return (
    <div className="space-y-6">
      <PageHeader
        title="College Club Budget & Financial Oversight"
        subtitle="Multi-campus 3-tier budget workflow: Club Treasurer → Faculty Advisor Review → College Administration Sanction."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Left: Requests List with Search & Filters */}
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <div>
                <CardTitle>Budget Requests ({filteredItems.length})</CardTitle>
                <p className="text-xs text-ink-60">Real-time status tracking with complete audit trail.</p>
              </div>
            </div>

            {/* Search & Filter Bar */}
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <input
                className="input text-xs"
                placeholder="Search title, club, requester..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
              <select
                aria-label="Filter status"
                className="input text-xs"
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              >
                <option value="">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Submitted to Advisor">Submitted to Advisor</option>
                <option value="Advisor Changes Requested">Advisor Changes Requested</option>
                <option value="Sent to College">Sent to College Admin</option>
                <option value="College Approved">College Approved</option>
                <option value="College Rejected">College Rejected</option>
              </select>
              <select
                aria-label="Filter category"
                className="input text-xs"
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              >
                <option value="">All Categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Items List */}
            {paginatedItems.length === 0 ? (
              <Empty
                title="No budget requests found"
                text="Try modifying your search or filter parameters, or submit a new proposal."
              />
            ) : (
              <ul className="divide-y divide-line mt-3">
                {paginatedItems.map((b: any) => {
                  const statusInfo = BUDGET_STATUS_LABELS[b.normalized_status] || { label: b.normalized_status, tone: 'neutral' };
                  let parsedItems: BudgetItem[] = [];
                  if (b.items_json) {
                    try { parsedItems = JSON.parse(b.items_json); } catch {}
                  }

                  // Permissions for actions
                  const canAdvisorDecide = (isAdvisor || isSuperAdmin) && (b.normalized_status === 'Submitted to Advisor');
                  const canCollegeDecide = (isCampusAdmin || isSuperAdmin) && (b.normalized_status === 'Sent to College');
                  const isMyRequest = me?.user.id === b.requested_by;
                  const canRevise = isMyRequest && b.normalized_status === 'Advisor Changes Requested';
                  const canSubmitDraft = isMyRequest && b.normalized_status === 'Draft';

                  return (
                    <li key={b.id} className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1.5 flex-1 min-w-[260px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-base text-ink">{b.title}</span>
                            <span className="font-display font-bold text-lg text-brand">
                              ₹{b.amount_inr.toLocaleString('en-IN')}
                            </span>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-paper-sunken border border-line text-ink-80">
                              {b.category || 'Equipment'}
                            </span>
                          </div>

                          <p className="text-xs text-ink-60">
                            <strong>{b.club_name}</strong> ({b.campus_name}) · Requested by {b.requester_name} · {fmtDate(b.created_at)}
                          </p>

                          {b.purpose && (
                            <p className="text-xs text-ink-80 leading-relaxed max-w-xl">{b.purpose}</p>
                          )}

                          {/* Documents and Itemized links */}
                          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                            {b.sheet_link && (
                              <a
                                href={b.sheet_link}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-brand hover:underline inline-flex items-center gap-1"
                              >
                                ↗ Google Sheet
                              </a>
                            )}
                            {b.supporting_docs && (
                              <a
                                href={b.supporting_docs}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-brand hover:underline inline-flex items-center gap-1"
                              >
                                📄 Supporting Docs
                              </a>
                            )}
                            {parsedItems.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setInspectItems(b)}
                                className="font-semibold text-brand hover:underline"
                              >
                                View Costing ({parsedItems.length} items)
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setTimelineModal(b)}
                              className="font-semibold text-ink-60 hover:text-ink underline"
                            >
                              🕒 Approval Timeline & Audit Trail
                            </button>
                          </div>

                          {/* Feedback callouts */}
                          {b.advisor_feedback && (
                            <div className="mt-2 rounded-lg bg-warn-sunken p-2.5 text-xs text-warn-dark border border-warn/20">
                              <p className="font-bold">Faculty Advisor Feedback ({b.advisor_name || 'Advisor'}):</p>
                              <p className="mt-0.5">{b.advisor_feedback}</p>
                            </div>
                          )}

                          {b.college_feedback && (
                            <div className="mt-2 rounded-lg bg-paper-sunken p-2.5 text-xs text-ink border border-line">
                              <p className="font-bold">College Administration Sanction Note ({b.decided_by_name || 'Admin'}):</p>
                              <p className="mt-0.5">{b.college_feedback}</p>
                            </div>
                          )}
                        </div>

                        {/* Status & Action Buttons */}
                        <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-line">
                          <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>

                          {/* Stage 1: Faculty Advisor Review */}
                          {canAdvisorDecide && (
                            <Button
                              small
                              variant="accent"
                              className="w-full sm:w-auto"
                              onClick={() => { setAdvisorModal(b); setDecisionNote(''); }}
                            >
                              Advisor Review →
                            </Button>
                          )}

                          {/* Stage 2: College Admin Final Review */}
                          {canCollegeDecide && (
                            <Button
                              small
                              className="w-full sm:w-auto"
                              onClick={() => { setCollegeModal(b); setDecisionNote(''); }}
                            >
                              College Decision →
                            </Button>
                          )}

                          {/* Draft Submit */}
                          {canSubmitDraft && (
                            <Button small variant="accent" className="w-full sm:w-auto" onClick={() => submitDraft(b.id)}>
                              Submit to Advisor
                            </Button>
                          )}

                          {/* Revisions Needed */}
                          {canRevise && (
                            <Button small variant="secondary" className="w-full sm:w-auto" onClick={() => setEditModal(b)}>
                              Revise Proposal
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-line pt-3 mt-3 text-xs">
                <span className="text-ink-60">Page {page} of {totalPages}</span>
                <div className="flex gap-2">
                  <Button small variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button small variant="secondary" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Right: New Budget Request Form */}
        <div>
          {canCreate ? (
            <Card className="sticky top-20 shadow-sm">
              <CardTitle>Submit Club Budget Proposal</CardTitle>
              <p className="text-xs text-ink-60 mb-3">
                Club Treasurer initiates fund requests. Requests are routed to Faculty Advisor for approval before College Admin review.
              </p>

              <div className="space-y-3.5">
                {eligibleClubs.length > 1 && (
                  <Field label="Club">
                    <select
                      className="input text-xs"
                      value={f.club_id}
                      onChange={(e) => setF({ ...f, club_id: e.target.value })}
                    >
                      {eligibleClubs.map((m) => (
                        <option key={m.club_id} value={m.club_id}>
                          {m.club_name} ({m.position})
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field label="Title / Purpose">
                  <input
                    className="input text-xs"
                    value={f.title}
                    onChange={(e) => setF({ ...f, title: e.target.value })}
                    placeholder="e.g. Annual Hackathon Server & Cloud Credits"
                    required
                  />
                </Field>

                <Field label="Category">
                  <select
                    className="input text-xs"
                    value={f.category}
                    onChange={(e) => setF({ ...f, category: e.target.value })}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </Field>

                {/* Itemized Costing Table */}
                <div className="rounded-xl border border-line bg-paper-sunken p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-ink uppercase tracking-wider">Itemized Breakdown</p>
                    <button type="button" onClick={addItem} className="text-xs font-semibold text-brand hover:underline">
                      + Add Item
                    </button>
                  </div>
                  <div className="space-y-2">
                    {items.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <input
                          className="input flex-1 !py-1 text-xs"
                          placeholder="Requirement / Equipment"
                          value={it.item}
                          onChange={(e) => updateItem(idx, 'item', e.target.value)}
                        />
                        <input
                          className="input !w-14 !py-1 text-xs"
                          type="number"
                          min={1}
                          placeholder="Qty"
                          value={it.qty}
                          onChange={(e) => updateItem(idx, 'qty', Number(e.target.value))}
                        />
                        <input
                          className="input !w-20 !py-1 text-xs"
                          type="number"
                          min={0}
                          placeholder="Unit ₹"
                          value={it.unit_cost || ''}
                          onChange={(e) => updateItem(idx, 'unit_cost', Number(e.target.value))}
                        />
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="text-danger hover:text-danger-dark text-xs font-bold px-1"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-xs">
                    <span className="font-semibold text-ink-60">Items Total:</span>
                    <span className="font-display font-bold text-ink text-sm">
                      ₹{calculatedTotal.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                <Field label="Total Amount (₹)" hint="Auto-calculated from items, or enter manual amount">
                  <input
                    className="input text-xs font-display font-bold"
                    type="number"
                    min={1}
                    value={totalAmount || ''}
                    onChange={(e) => setManualAmount(e.target.value)}
                    required
                  />
                </Field>

                <Field label="Purpose & Justification">
                  <textarea
                    className="input text-xs"
                    rows={2}
                    placeholder="Explain why this equipment or expense is necessary for the club."
                    value={f.purpose}
                    onChange={(e) => setF({ ...f, purpose: e.target.value })}
                  />
                </Field>

                <Field label="Supporting Documents (URL)" hint="Quotation PDF, vendor invoice or contract">
                  <input
                    className="input text-xs"
                    placeholder="https://example.com/quotes/vendor-quote.pdf"
                    value={f.supporting_docs}
                    onChange={(e) => setF({ ...f, supporting_docs: e.target.value })}
                  />
                </Field>

                <Field label="Google Sheets Link" hint="Detailed requirements spreadsheet link">
                  <input
                    className="input text-xs"
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    value={f.sheet_link}
                    onChange={(e) => setF({ ...f, sheet_link: e.target.value })}
                  />
                </Field>

                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    loading={busy}
                    onClick={() => submitRequest(false)}
                  >
                    Save Draft
                  </Button>
                  <Button
                    type="button"
                    variant="accent"
                    className="flex-1"
                    loading={busy}
                    onClick={() => submitRequest(true)}
                  >
                    Submit to Advisor
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="sticky top-20 text-center p-6">
              <p className="font-display text-base font-bold text-ink">Club Budget Oversight</p>
              <p className="text-xs text-ink-60 mt-1">
                Only Club Treasurers and Presidents can create budget requests for their clubs.
                You are viewing the current institutional budget pipeline.
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* =================================================================== */}
      {/* MODAL: Faculty Advisor Decision Modal */}
      {/* =================================================================== */}
      {advisorModal && (
        <Modal title={`Advisor Review: ${advisorModal.title}`} onClose={() => setAdvisorModal(null)}>
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-paper-sunken p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-ink-60">Club:</span>
                <span className="font-semibold text-ink">{advisorModal.club_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-60">Requested Amount:</span>
                <span className="font-display font-bold text-brand text-sm">₹{advisorModal.amount_inr.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-60">Category:</span>
                <span className="font-semibold text-ink">{advisorModal.category}</span>
              </div>
              {advisorModal.purpose && (
                <div className="pt-1 border-t border-line/60">
                  <span className="text-ink-60 block mb-0.5">Purpose:</span>
                  <p className="text-ink-80">{advisorModal.purpose}</p>
                </div>
              )}
            </div>

            <Field label="Advisor Review Feedback / Revisions Required">
              <textarea
                className="input text-xs"
                rows={3}
                placeholder="Add comments for the treasurer or notes for the College Administration."
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
              />
            </Field>

            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
              <Button variant="secondary" onClick={() => setAdvisorModal(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => handleAdvisorDecision('reject')}
              >
                Reject Request
              </Button>
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => handleAdvisorDecision('request_changes')}
              >
                Request Changes
              </Button>
              <Button
                variant="accent"
                loading={busy}
                onClick={() => handleAdvisorDecision('approve')}
              >
                Approve & Forward to College
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* =================================================================== */}
      {/* MODAL: College Admin Decision Modal */}
      {/* =================================================================== */}
      {collegeModal && (
        <Modal title={`Final College Sanction: ${collegeModal.title}`} onClose={() => setCollegeModal(null)}>
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-paper-sunken p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-ink-60">Club & Campus:</span>
                <span className="font-semibold text-ink">{collegeModal.club_name} ({collegeModal.campus_name})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-60">Amount to Disburse:</span>
                <span className="font-display font-bold text-brand text-base">₹{collegeModal.amount_inr.toLocaleString('en-IN')}</span>
              </div>
              {collegeModal.advisor_feedback && (
                <div className="pt-1 border-t border-line/60">
                  <span className="text-ink-60 block mb-0.5">Advisor Recommendation:</span>
                  <p className="text-ink-80 italic">“{collegeModal.advisor_feedback}”</p>
                </div>
              )}
            </div>

            <Field label="Institutional Sanction Note / Disbursement Terms">
              <textarea
                className="input text-xs"
                rows={3}
                placeholder="e.g. Approved in full from FY26 student enrichment allocation. Settle receipts within 14 days."
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="secondary" onClick={() => setCollegeModal(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => handleCollegeDecision('reject')}
              >
                Decline Sanction
              </Button>
              <Button
                loading={busy}
                onClick={() => handleCollegeDecision('approve')}
              >
                Approve & Sanction Funds
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* =================================================================== */}
      {/* MODAL: Visual Approval Timeline & Audit Trail */}
      {/* =================================================================== */}
      {timelineModal && (
        <BudgetTimelineModal
          requestId={timelineModal.id}
          onClose={() => setTimelineModal(null)}
        />
      )}

      {/* =================================================================== */}
      {/* MODAL: Itemized Costing Inspector */}
      {/* =================================================================== */}
      {inspectItems && (
        <Modal title={`Costing Breakdown: ${inspectItems.title}`} onClose={() => setInspectItems(null)}>
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-line text-ink-60 font-semibold">
                    <th className="py-2">Item / Equipment</th>
                    <th className="py-2 text-center">Qty</th>
                    <th className="py-2 text-right">Unit ₹</th>
                    <th className="py-2 text-right">Total ₹</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {JSON.parse(inspectItems.items_json || '[]').map((it: any, i: number) => (
                    <tr key={i}>
                      <td className="py-2 font-medium text-ink">{it.item}</td>
                      <td className="py-2 text-center">{it.qty}</td>
                      <td className="py-2 text-right">₹{Number(it.unit_cost).toLocaleString('en-IN')}</td>
                      <td className="py-2 text-right font-bold text-ink">
                        ₹{(Number(it.qty) * Number(it.unit_cost)).toLocaleString('en-IN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center border-t border-line pt-3 font-display font-bold text-base">
              <span>Total Request Amount:</span>
              <span className="text-brand">₹{inspectItems.amount_inr.toLocaleString('en-IN')}</span>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setInspectItems(null)}>Close</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* =================================================================== */}
      {/* MODAL: Revise Proposal (Treasurer) */}
      {/* =================================================================== */}
      {editModal && (
        <ReviseBudgetModal
          request={editModal}
          onClose={() => setEditModal(null)}
          onDone={() => { setEditModal(null); reload(); }}
        />
      )}
    </div>
  );
}

// Timeline Modal Component
function BudgetTimelineModal({ requestId, onClose }: { requestId: number; onClose: () => void }) {
  const { data, loading, error } = useApi<any>(`/budget/${requestId}/timeline`);

  if (loading) return <Modal title="Approval Timeline" onClose={onClose}><Loading /></Modal>;
  if (error) return <Modal title="Approval Timeline" onClose={onClose}><ErrorBox error={error} /></Modal>;

  return (
    <Modal title={`Approval Audit Trail: ${data.title}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs pb-2 border-b border-line">
          <span>{data.club_name}</span>
          <span className="font-display font-bold text-brand text-sm">₹{data.amount_inr?.toLocaleString('en-IN')}</span>
        </div>

        {data.timeline?.length === 0 ? (
          <p className="text-xs text-ink-60 py-4 text-center">No audit trail records yet.</p>
        ) : (
          <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-line">
            {data.timeline?.map((step: any, i: number) => {
              let dotColor = 'bg-ink-60';
              if (step.action === 'approve') dotColor = 'bg-ok ring-4 ring-ok/20';
              else if (step.action === 'request_changes') dotColor = 'bg-warn ring-4 ring-warn/20';
              else if (step.action === 'reject') dotColor = 'bg-danger ring-4 ring-danger/20';
              else if (step.action === 'submit') dotColor = 'bg-brand ring-4 ring-brand/20';

              const actionLabels: Record<string, string> = {
                draft: 'Draft Created',
                submit: 'Submitted to Faculty Advisor',
                resubmit: 'Revised & Re-submitted to Advisor',
                approve: step.stage === 'faculty_advisor' ? 'Approved by Advisor (Forwarded to College)' : 'Final Approval by College Admin',
                request_changes: 'Changes Requested by Advisor',
                reject: 'Rejected',
              };

              return (
                <div key={step.id || i} className="relative">
                  <span className={`absolute -left-[26px] top-1 h-3.5 w-3.5 rounded-full ${dotColor}`} />
                  <div className="rounded-xl border border-line bg-paper-sunken p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink text-sm">
                        {actionLabels[step.action] || step.action}
                      </span>
                      <span className="text-[11px] text-ink-60">{fmtDateTime(step.created_at)}</span>
                    </div>

                    <p className="text-ink-60 mt-0.5">
                      Actor: <span className="font-medium text-ink">{step.actor_name}</span> ({step.actor_role})
                    </p>

                    {step.notes && (
                      <p className="mt-2 text-ink-80 bg-white p-2 rounded border border-line/60 italic">
                        “{step.notes}”
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-line">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

// Revise Budget Modal
function ReviseBudgetModal({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    title: request.title,
    amount_inr: request.amount_inr,
    purpose: request.purpose || '',
    sheet_link: request.sheet_link || '',
    supporting_docs: request.supporting_docs || '',
    notes: '',
  });
  const { run, busy } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api(`/budget/${request.id}`, {
      method: 'PATCH',
      body: { ...f, submit_now: true },
    }), 'Revised budget proposal re-submitted to Faculty Advisor!')) {
      onDone();
    }
  };

  return (
    <Modal title={`Revise Proposal: ${request.title}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {request.advisor_feedback && (
          <div className="rounded-lg bg-warn-sunken p-3 text-xs text-warn-dark border border-warn/20">
            <p className="font-bold">Advisor's Change Request:</p>
            <p className="mt-0.5">{request.advisor_feedback}</p>
          </div>
        )}

        <Field label="Title">
          <input
            className="input text-xs"
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            required
          />
        </Field>

        <Field label="Amount (₹)">
          <input
            className="input text-xs font-bold"
            type="number"
            value={f.amount_inr}
            onChange={(e) => setF({ ...f, amount_inr: Number(e.target.value) })}
            required
          />
        </Field>

        <Field label="Updated Purpose / Justification">
          <textarea
            className="input text-xs"
            rows={2}
            value={f.purpose}
            onChange={(e) => setF({ ...f, purpose: e.target.value })}
          />
        </Field>

        <Field label="Supporting Documents (Updated URL)">
          <input
            className="input text-xs"
            value={f.supporting_docs}
            onChange={(e) => setF({ ...f, supporting_docs: e.target.value })}
          />
        </Field>

        <Field label="Revision Notes for Advisor">
          <textarea
            className="input text-xs"
            rows={2}
            placeholder="Explain what revisions were made per advisor feedback."
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
            required
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" loading={busy}>Re-submit to Advisor</Button>
        </div>
      </form>
    </Modal>
  );
}
