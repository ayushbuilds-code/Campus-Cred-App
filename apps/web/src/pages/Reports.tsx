import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, download, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, CardTitle, Empty, ErrorBox, Loading, PageHeader, useAction, useToast } from '../components/ui';
import { fmtWeekday } from '../lib/format';

export default function Reports() {
  const { role, isSuperAdmin, selectedCampusId, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') || new Date().toISOString().slice(0, 7);
  const clubFilter = params.get('club');
  const campusParam = isSuperAdmin && selectedCampusId ? `&campus_id=${selectedCampusId}` : '';
  const { data, loading, error, reload } = useApi<any>(`/reports/monthly?month=${month}${campusParam}`, [month, selectedCampusId]);
  const { run, busy } = useAction();
  const toast = useToast();
  const [csvBusy, setCsvBusy] = useState(false);
  const reports = (data?.reports || []).filter((r: any) => !clubFilter || String(r.club.id) === clubFilter);
  const csv = async () => {
    setCsvBusy(true);
    try {
      await download(
        `/reports/monthly.csv?month=${month}${campusParam}`,
        `club-report-${month}${selectedCampusId ? `-campus-${selectedCampusId}` : ''}.csv`
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCsvBusy(false);
    }
  };

  const selectedCampusName = isSuperAdmin
    ? (selectedCampusId ? (me?.all_campuses?.find((c) => c.id === selectedCampusId)?.name || 'Selected Campus') : 'All Campuses (Consolidated)')
    : (me?.campus?.name || 'Your Campus');

  return (
    <>
      <PageHeader
        title="Monthly club reports"
        subtitle={`Computed from raw attendance and score records for ${selectedCampusName}.`}
        actions={
          <>
            <Button variant="secondary" loading={csvBusy} onClick={csv}>
              Download CSV
            </Button>
            {(role === 'admin' || role === 'super_admin' || role === 'campus_manager' || role === 'campus_admin') && (
              <Button loading={busy} onClick={() => run(() => api('/reports/monthly/generate', { body: { month } }), 'Reports generated and sent to campus managers')}>
                Generate and send
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 max-w-xs"><label className="mb-1 block text-sm font-semibold" htmlFor="month">Month</label><input id="month" className="input" type="month" value={month} onChange={(e) => setParams({ month: e.target.value })} /></div>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : reports.length === 0 ? <Empty title="No clubs to report on" /> : (
        <div className="space-y-4">{reports.map((r: any) => (
          <Card key={r.club.id}>
            <CardTitle right={<span className="text-sm text-ink-60">Advisor: {r.club.advisor || '–'}</span>}>{r.club.name}</CardTitle>
            {r.held === 0 ? <p className="text-sm text-ink-60">No Club Days were held in this month.</p> : (<>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{[['Club Days held', r.held], ['Attendance', `${r.attendance_pct}%`], ['Submissions', r.submissions], ['Submission rate', `${r.submission_rate}%`], ['Average score', r.avg_score ?? '–']].map(([l, v]) => <div key={l as string} className="rounded-lg bg-paper p-3"><p className="font-display text-2xl font-bold">{v}</p><p className="text-xs text-ink-60">{l}</p></div>)}</div>
              <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-ink-60"><th className="py-1.5 font-semibold">Date</th><th className="font-semibold">Topic</th><th className="font-semibold">Checked in</th><th className="font-semibold">Submitted</th><th className="font-semibold">Avg score</th></tr></thead>
                <tbody className="divide-y divide-line">{r.sessions.map((s: any) => <tr key={s.date + s.topic}><td className="py-2">{fmtWeekday(s.date)}</td><td>{s.topic}</td><td>{s.attended}/{s.members} ({s.attendance_pct}%){s.late ? `, ${s.late} late` : ''}</td><td>{s.submissions}</td><td>{s.avg_score ?? '–'}</td></tr>)}</tbody></table></div>
              <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                <div><p className="font-semibold">Top scorers</p>{r.highlights.top_scorers.length ? <ul className="text-ink-80">{r.highlights.top_scorers.map((x: any) => <li key={x.name}>{x.name} ({x.avg})</li>)}</ul> : <p className="text-ink-60">None yet</p>}</div>
                <div><p className="font-semibold">Perfect attendance</p>{r.highlights.perfect_attendance.length ? <p className="text-ink-80">{r.highlights.perfect_attendance.join(', ')}</p> : <p className="text-ink-60">None</p>}</div>
                <div><p className="font-semibold">Certificates issued</p><p className="text-ink-80">{r.highlights.certificates_issued}</p></div>
              </div></>)}
          </Card>))}</div>)}
    </>
  );
}
