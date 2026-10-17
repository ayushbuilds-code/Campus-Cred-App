import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { download, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Loading, PageHeader, useToast } from '../components/ui';
import { fmtDate, fmtWeekday } from '../lib/format';

export default function Dashboard() {
  const { role } = useAuth();
  const { data: d, loading, error, reload } = useApi<any>('/insights/overview');
  const toast = useToast();
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const wide = d.scope === 'campus';
  const canTranscript = role === 'admin' || role === 'campus_manager' || role === 'advisor';
  const tiles = [['Clubs', d.totals.clubs], [wide ? 'Students' : 'Members', d.totals.students], ['Active members', d.totals.active_members], ['Inactive clubs', d.totals.inactive_clubs], ['No participation', d.totals.zero_participation]];
  const exportCsv = async () => { try { await download('/insights/participation.csv', 'participation-by-student.csv'); } catch (e: any) { toast.error(e.message); } };
  return (
    <>
      <PageHeader title="Participation dashboard" subtitle={wide ? 'All clubs on your campus' : 'Your clubs'} actions={wide && role !== 'advisor' && <Button variant="secondary" onClick={exportCsv}>Export students (CSV)</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">{tiles.map(([l, v]) => <Card key={l as string} className="!p-4"><p className="font-display text-3xl font-bold">{v}</p><p className="text-sm text-ink-60">{l}</p></Card>)}</div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardTitle>Attendance by club (%)</CardTitle>
          {d.clubs.length === 0 ? <Empty title="No data yet" /> : <div className="h-64"><ResponsiveContainer><BarChart data={d.clubs} margin={{ left: -10 }}><CartesianGrid strokeDasharray="3 3" stroke="#D9DED8" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 12 }} /><Tooltip /><Bar isAnimationActive={false} dataKey="attendance_pct" name="Attendance %" fill="#0E6B63" radius={[6, 6, 0, 0]} /><Bar isAnimationActive={false} dataKey="submission_rate" name="Submission %" fill="#E39B0B" radius={[6, 6, 0, 0]} /><Legend /></BarChart></ResponsiveContainer></div>}
        </Card>
        <Card><CardTitle>Attendance across Club Days</CardTitle>
          {d.trend.length === 0 ? <Empty title="No Club Days held yet" /> : <div className="h-64"><ResponsiveContainer><LineChart data={d.trend.map((t: any) => ({ ...t, label: fmtWeekday(t.date) }))} margin={{ left: -10 }}><CartesianGrid strokeDasharray="3 3" stroke="#D9DED8" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 12 }} /><Tooltip /><Line isAnimationActive={false} type="monotone" dataKey="attendance_pct" name="Attendance %" stroke="#0E6B63" strokeWidth={3} dot={{ r: 4 }} /></LineChart></ResponsiveContainer></div>}
        </Card>
      </div>
      <Card className="mt-4"><CardTitle>Clubs</CardTitle>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-ink-60"><th className="py-1.5 font-semibold">Club</th><th className="font-semibold">Members</th><th className="font-semibold">Club Days held</th><th className="font-semibold">Attendance</th><th className="font-semibold">Submitted</th><th className="font-semibold">Avg score</th><th className="font-semibold">Last session</th></tr></thead>
          <tbody className="divide-y divide-line">{d.clubs.map((c: any) => <tr key={c.id}><td className="py-2 font-semibold"><Link className="hover:text-brand" to={`/clubs/${c.id}`}>{c.name}</Link> {c.inactive && <Badge tone="danger">Inactive</Badge>}</td><td>{c.members}</td><td>{c.held}</td><td>{c.attendance_pct}%</td><td>{c.submission_rate}%</td><td>{c.avg_score ?? '–'}</td><td>{c.last_session_date ? fmtDate(c.last_session_date) : 'Never'}</td></tr>)}</tbody></table></div>
      </Card>
      {wide && d.campuses.length > 0 && <Card className="mt-4"><CardTitle>By campus</CardTitle><table className="w-full text-sm"><tbody className="divide-y divide-line">{d.campuses.map((c: any) => <tr key={c.campus}><td className="py-2 font-semibold">{c.campus}</td><td>{c.clubs} clubs</td><td>{c.members} members</td><td>{c.attendance_pct}% attendance</td></tr>)}</tbody></table></Card>}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card><CardTitle>Top contributors</CardTitle>{d.top_contributors.length === 0 ? <p className="text-sm text-ink-60">No activity yet.</p> : <ol className="space-y-1.5 text-sm">{d.top_contributors.map((p: any, i: number) => <li key={p.id} className="flex items-center justify-between"><span><span className="mr-2 inline-block w-5 text-ink-60">{i + 1}.</span>{canTranscript ? <Link className="font-semibold hover:text-brand" to={`/transcript/${p.id}`}>{p.name}</Link> : <span className="font-semibold">{p.name}</span>}</span><span className="text-ink-60">{p.attended} sessions · {p.submissions} submissions{p.events ? ` · ${p.events} events` : ''}</span></li>)}</ol>}<p className="mt-3 text-xs text-ink-60">Points: 1 per session, 2 per submission, 3 per event.</p></Card>
        <Card><CardTitle>Students with zero participation ({d.totals.zero_participation})</CardTitle>{d.zero_participation.length === 0 ? <p className="text-sm text-ok">Everyone has taken part in something.</p> : <ul className="max-h-64 divide-y divide-line overflow-y-auto text-sm">{d.zero_participation.map((p: any) => <li key={p.id} className="flex justify-between py-1.5"><span>{canTranscript ? <Link className="hover:text-brand" to={`/transcript/${p.id}`}>{p.name}</Link> : p.name}</span><span className="text-ink-60">{p.student_code}</span></li>)}</ul>}</Card>
      </div>
    </>
  );
}
