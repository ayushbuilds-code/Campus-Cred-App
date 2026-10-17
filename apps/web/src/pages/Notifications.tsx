import { useNavigate } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, useAction } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export default function Notifications() {
  const { data, loading, error, reload } = useApi<any>('/notifications');
  const { refresh } = useAuth();
  const nav = useNavigate();
  const { run } = useAction();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const open = async (n: any) => { if (!n.read) { await api(`/notifications/${n.id}/read`, { method: 'POST' }); refresh(); } if (n.link) nav(n.link); else reload(); };
  return (
    <>
      <PageHeader title="Alerts" actions={data.unread > 0 && <Button variant="secondary" onClick={async () => { await run(() => api('/notifications/read-all', { method: 'POST' })); reload(); refresh(); }}>Mark all as read</Button>} />
      {data.items.length === 0 ? <Empty title="No alerts yet" text="Plan approvals, check-in openings, deadlines and new certificates show up here." /> : (
        <Card className="!p-0"><ul className="divide-y divide-line">{data.items.map((n: any) => (
          <li key={n.id}><button onClick={() => open(n)} className="flex w-full items-start gap-3 p-4 text-left hover:bg-paper"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read ? 'bg-line' : 'bg-saffron'}`} aria-label={n.read ? 'Read' : 'Unread'} /><span className="min-w-0"><span className={`block ${n.read ? '' : 'font-semibold'}`}>{n.title}</span>{n.body && <span className="block text-sm text-ink-60">{n.body}</span>}<span className="mt-0.5 block text-xs text-ink-40">{fmtDateTime(n.created_at)}</span></span></button></li>))}</ul></Card>)}
    </>
  );
}
