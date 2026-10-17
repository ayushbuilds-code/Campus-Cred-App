import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { fmtWeekday, fromLocalInput, toLocalInput } from '../lib/format';
import { Button, Field, Modal, useAction } from './ui';

export default function PlanModal({ clubs, day, existing, onClose, onSaved }: { clubs: { id: number; name: string }[]; day: { id: number; date: string }; existing?: any; onClose: () => void; onSaved: (id: number) => void }) {
  const [clubId, setClubId] = useState<number>(existing?.club_id ?? clubs[0]?.id);
  const [topic, setTopic] = useState(existing?.topic ?? '');
  const [format, setFormat] = useState(existing?.format ?? 'ppt');
  const [deliverable, setDeliverable] = useState(existing?.deliverable ?? '');
  const [venue, setVenue] = useState(existing?.venue ?? '');
  const [deadline, setDeadline] = useState(toLocalInput(existing?.submission_deadline));
  const { run, busy } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api('/activities', { body: { club_id: clubId, club_day_id: day.id, topic, format, deliverable: format === 'on_the_spot' ? undefined : deliverable || undefined, venue: venue || undefined, submission_deadline: format === 'on_the_spot' ? undefined : fromLocalInput(deadline) } }), 'Plan saved');
    if (r) onSaved(r.id);
  };
  return (
    <Modal title={`Plan for ${fmtWeekday(day.date)}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {!existing && clubs.length > 1 && <Field label="Club"><select className="input" value={clubId} onChange={(e) => setClubId(Number(e.target.value))}>{clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Topic"><input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} minLength={3} required placeholder="e.g. Pitch deck teardown" /></Field>
        <Field label="Format"><select className="input" value={format} onChange={(e) => setFormat(e.target.value)}><option value="ppt">PPT presentation</option><option value="assignment">Assignment</option><option value="on_the_spot">On-the-spot activity (nothing to submit)</option></select></Field>
        {format !== 'on_the_spot' && <>
          <Field label="Deliverable" hint="What members must submit."><input className="input" value={deliverable} onChange={(e) => setDeliverable(e.target.value)} placeholder="A 5-slide PPT with one clear takeaway" /></Field>
          <Field label="Submission deadline" hint="Leave empty for 48 hours after the Club Day (11:59 pm IST)."><input className="input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field></>}
        <Field label="Venue"><input className="input" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Seminar hall 2" /></Field>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save plan</Button></div>
      </form>
    </Modal>
  );
}
