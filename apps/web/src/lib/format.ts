const TZ = 'Asia/Kolkata';
const dateOnly = (d: string) => (d.length === 10 ? new Date(`${d}T00:00:00Z`) : new Date(d));
export const fmtDate = (d?: string | null) => (d ? dateOnly(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: d.length === 10 ? 'UTC' : TZ }) : '');
export const fmtWeekday = (d: string) => dateOnly(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '');
export const fmtTime = (d?: string | null) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '');

export const POSITION: Record<string, string> = {
  president: 'President',
  vice_president: 'Vice President',
  treasurer: 'Treasurer',
  member: 'Member',
  participant: 'Participant',
};

export const ROLE: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Super Admin',
  campus_admin: 'Campus Admin',
  campus_manager: 'Campus Admin',
  faculty_advisor: 'Faculty Advisor',
  advisor: 'Faculty Advisor',
  student: 'Student / Member',
};

export const BUDGET_STATUS_LABELS: Record<string, { label: string; tone: 'neutral' | 'warn' | 'brand' | 'ok' | 'danger' }> = {
  Draft: { label: 'Draft', tone: 'neutral' },
  draft: { label: 'Draft', tone: 'neutral' },
  'Submitted to Advisor': { label: 'Submitted to Advisor', tone: 'warn' },
  submitted_advisor: { label: 'Submitted to Advisor', tone: 'warn' },
  pending_president: { label: 'Submitted to Advisor', tone: 'warn' },
  pending: { label: 'Submitted to Advisor', tone: 'warn' },
  'Advisor Changes Requested': { label: 'Advisor Changes Requested', tone: 'warn' },
  changes_requested: { label: 'Advisor Changes Requested', tone: 'warn' },
  'Advisor Approved': { label: 'Advisor Approved', tone: 'brand' },
  advisor_approved: { label: 'Advisor Approved', tone: 'brand' },
  'Sent to College': { label: 'Sent to College Admin', tone: 'brand' },
  sent_to_college: { label: 'Sent to College Admin', tone: 'brand' },
  pending_admin: { label: 'Sent to College Admin', tone: 'brand' },
  'College Approved': { label: 'College Approved', tone: 'ok' },
  college_approved: { label: 'College Approved', tone: 'ok' },
  approved: { label: 'College Approved', tone: 'ok' },
  'College Rejected': { label: 'College Rejected', tone: 'danger' },
  college_rejected: { label: 'College Rejected', tone: 'danger' },
  rejected: { label: 'College Rejected', tone: 'danger' },
};

export const FORMAT: Record<string, string> = {
  ppt: 'PPT presentation',
  assignment: 'Assignment',
  on_the_spot: 'On-the-spot activity',
};

export const firstName = (n?: string) => (n || '').replace(/^(Dr\.|Prof\.)\s*/, '').split(' ')[0];
export const todayIso = () => new Date().toISOString().slice(0, 10);

export function timeLeft(deadline?: string | null) {
  if (!deadline) return '';
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'Deadline passed';
  const h = Math.floor(ms / 3600000);
  if (h >= 48) return `${Math.floor(h / 24)} days left`;
  if (h >= 1) return `${h} h ${Math.floor((ms % 3600000) / 60000)} min left`;
  return `${Math.max(1, Math.floor(ms / 60000))} min left`;
}

export const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600000); // show IST in the picker
  return d.toISOString().slice(0, 16);
};
export const fromLocalInput = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : undefined);
