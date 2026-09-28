import { useState } from 'react';
import { Card, Badge, Icon, Button, Textarea, Select, Modal, Confirm, EmptyState, Skeleton, Alert, usePoll } from '../components/ui.jsx';
import { Content, AI, Market } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { dateTime, renderMarkdown, timeAgo } from '../lib/format.js';

const EMOTIONS = [
  { id: 'calm', label: 'Calm', tone: 'done', icon: 'shield' },
  { id: 'neutral', label: 'Neutral', tone: 'neutral', icon: 'info' },
  { id: 'fear', label: 'Fear', tone: 'warn', icon: 'alert' },
  { id: 'greed', label: 'Greed', tone: 'warn', icon: 'star' },
  { id: 'anger', label: 'Anger', tone: 'down', icon: 'zap' },
  { id: 'hope', label: 'Hope', tone: 'brand', icon: 'target' },
];

const blank = { symbol: '', side: 'long', emotion: 'neutral', followedPlan: 'yes', rating: 3, body: '' };

export default function Journal() {
  const toast = useToast();
  const { data, loading, refresh } = usePoll(() => Content.journal(), 60000, []);
  const { data: aiStatus } = usePoll(() => AI.status(), 600000, []);
  const { data: instruments } = usePoll(() => Market.instruments('all'), 600000, []);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [feedbackFor, setFeedbackFor] = useState(null);
  const [filter, setFilter] = useState('all');

  const entries = (data?.entries || []).filter((e) => (filter === 'all' ? true : filter === 'offplan' ? e.followed_plan === false : e.emotion === filter));

  const offPlan = (data?.entries || []).filter((e) => e.followed_plan === false).length;
  const total = (data?.entries || []).length;

  const save = async () => {
    if (form.body.trim().length < 10) return toast.error('Write a bit more', 'A one-line journal entry cannot teach you anything. Describe what you did and why.');
    setBusy(true);
    try {
      await Content.createJournal({
        body: form.body.trim(),
        symbol: form.symbol ? form.symbol.toUpperCase() : null,
        side: form.side || null,
        emotion: form.emotion,
        followedPlan: form.followedPlan === 'yes' ? true : form.followedPlan === 'no' ? false : null,
        rating: Number(form.rating),
        aiFeedback: Boolean(aiStatus?.configured),
      });
      toast.success('Journal entry saved', aiStatus?.configured ? 'AI coaching feedback is attached.' : undefined);
      setOpen(false);
      setForm(blank);
      refresh();
    } catch (e) {
      toast.error('Could not save', e.message);
    } finally {
      setBusy(false);
    }
  };

  const feedback = async (entry) => {
    setFeedbackFor(entry.id);
    try {
      await Content.journalFeedback(entry.id);
      toast.success('Feedback generated');
      refresh();
    } catch (e) {
      toast.error('Could not generate feedback', e.message);
    } finally {
      setFeedbackFor(null);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await Content.deleteJournal(deleting.id);
      toast.info('Entry deleted');
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error('Could not delete', e.message);
    } finally {
      setBusy(false);
    }
  };

  const tone = (e) => EMOTIONS.find((x) => x.id === e)?.tone || 'neutral';
  const iconOf = (e) => EMOTIONS.find((x) => x.id === e)?.icon || 'info';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">Trade journal</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            The habit that separates people who improve from people who just keep trading.
          </p>
        </div>
        <Button size="sm" icon="plus" onClick={() => { setForm(blank); setOpen(true); }}>New entry</Button>
      </div>

      {total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { l: 'Entries', v: total, icon: 'journal' },
            { l: 'Off-plan', v: offPlan, icon: 'alert', tone: offPlan > total * 0.3 ? 'down' : 'flat' },
            { l: 'Plan adherence', v: total ? `${Math.round(((total - offPlan) / total) * 100)}%` : '—', icon: 'shield', tone: offPlan > total * 0.3 ? 'down' : 'up' },
            { l: 'Avg rating', v: total ? (data.entries.reduce((s, e) => s + (Number(e.rating) || 0), 0) / data.entries.filter((e) => e.rating).length || 0).toFixed(1) : '—', icon: 'star' },
          ].map((s) => (
            <Card key={s.l}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{s.l}</p>
                <Icon name={s.icon} className="h-3.5 w-3.5 text-slate-400" />
              </div>
              <p className={`tnum mt-1.5 text-[21px] font-extrabold leading-none ${s.tone === 'down' ? 'text-down-deep' : s.tone === 'up' ? 'text-up-deep' : 'text-slate-900'}`}>{s.v}</p>
            </Card>
          ))}
        </div>
      )}

      {offPlan > 0 && offPlan >= total * 0.4 && total >= 3 && (
        <Alert tone="warn" title="You are drifting from your plan">
          {offPlan} of {total} entries say you did not follow your own rules. That is the single most common reason
          paper results do not transfer — the system is fine, the execution is not.
        </Alert>
      )}

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {[{ id: 'all', label: `All ${total}` }, { id: 'offplan', label: `Off-plan ${offPlan}` }, ...EMOTIONS.map((e) => ({ id: e.id, label: e.label }))]
          .filter((f) => f.id === 'all' || f.id === 'offplan' || (data?.entries || []).some((e) => e.emotion === f.id))
          .map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-xl px-3.5 py-2 text-[12.5px] font-bold transition ${
                filter === f.id ? 'bg-slate-900 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
      </div>

      {loading && !data ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-32" />)}</div>
      ) : entries.length === 0 ? (
        <Card pad={false}>
          <EmptyState
            icon="journal"
            title={total ? 'Nothing matches that filter' : 'No journal entries yet'}
            message={total ? 'Try a different filter.' : 'Log one entry after every session. What did you plan, what did you actually do, and what was the gap between them?'}
            action={!total && <Button size="sm" icon="plus" onClick={() => setOpen(true)}>Write your first entry</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <Card key={e.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={tone(e.emotion)} icon={iconOf(e.emotion)}>{e.emotion}</Badge>
                {e.symbol && <Badge tone="brand">{e.symbol}</Badge>}
                {e.side && <Badge tone={e.side === 'long' ? 'up' : 'down'}>{e.side}</Badge>}
                <Badge tone={e.followed_plan === true ? 'done' : e.followed_plan === false ? 'down' : 'neutral'} icon={e.followed_plan === true ? 'check' : e.followed_plan === false ? 'x' : 'info'}>
                  {e.followed_plan === true ? 'Followed plan' : e.followed_plan === false ? 'Deviated' : 'Unspecified'}
                </Badge>
                {e.rating && (
                  <span className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Icon key={i} name="star" className={`h-3 w-3 ${i < e.rating ? 'text-amber-400' : 'text-slate-200'}`} stroke={0} fill={i < e.rating ? 'currentColor' : 'none'} />
                    ))}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[11px] text-slate-400">{timeAgo(e.created_at)}</span>
                <button onClick={() => setDeleting(e)} aria-label="Delete" className="grid h-7 w-7 place-items-center rounded-lg text-slate-300 transition hover:bg-rose-50 hover:text-rose-600">
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </div>

              <p className="mt-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700">{e.body}</p>

              {e.ai_feedback && (
                <div className="mt-3.5 rounded-xl border border-brand-100 bg-brand-50/50 px-3.5 py-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-700">
                    <Icon name="spark" className="h-3 w-3" /> Coach feedback
                  </p>
                  <div className="text-[12.5px] leading-relaxed text-slate-700" dangerouslySetInnerHTML={{ __html: renderMarkdown(e.ai_feedback) }} />
                </div>
              )}

              <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <span className="text-[11px] text-slate-400">{dateTime(e.created_at)}</span>
                <Button size="xs" variant="soft" icon="spark" loading={feedbackFor === e.id} disabled={!aiStatus?.configured} onClick={() => feedback(e)}>
                  {e.ai_feedback ? 'Refresh feedback' : 'Get coaching'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New journal entry"
        subtitle="Be honest. An entry that flatters you teaches you nothing."
        size="lg"
        footer={
          <div className="flex gap-2 [&>*]:min-w-0">
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button className="flex-1" icon="check" loading={busy} onClick={save}>Save entry</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 grid-tight sm:grid-cols-2">
            <Select
              label="Instrument (optional)"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            >
              <option value="">— none —</option>
              {(instruments?.instruments || []).map((i) => (
                <option key={i.symbol} value={i.symbol}>{i.symbol} · {i.name}</option>
              ))}
            </Select>
            <Select label="Direction" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}
              options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} />
          </div>

          <div>
            <span className="label">How did you feel?</span>
            <div className="grid grid-cols-3 gap-2 grid-tight sm:grid-cols-6">
              {EMOTIONS.map((em) => (
                <button
                  key={em.id}
                  onClick={() => setForm({ ...form, emotion: em.id })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-[11.5px] font-bold transition active:scale-95 ${
                    form.emotion === em.id ? 'border-brand-400 bg-brand-50 text-brand-700 ring-2 ring-brand-500/10' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Icon name={em.icon} className="h-4 w-4" />
                  {em.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Did you follow your plan?" value={form.followedPlan} onChange={(e) => setForm({ ...form, followedPlan: e.target.value })}
              options={[{ value: 'yes', label: 'Yes, exactly as written' }, { value: 'no', label: 'No, I deviated' }, { value: 'unsure', label: 'Not sure' }]} />
            <div>
              <span className="label">Self rating · {form.rating}/5</span>
              <input
                type="range" min="1" max="5" step="1" value={form.rating}
                onChange={(e) => setForm({ ...form, rating: e.target.value })}
                className="mt-2.5 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600"
              />
              <div className="mt-1 flex justify-between text-[10.5px] font-semibold text-slate-400">
                <span>Poor</span><span>Excellent</span>
              </div>
            </div>
          </div>

          <Textarea
            label="What happened?" rows={7} value={form.body} maxLength={20000}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="Planned a pullback entry above the 50 SMA with a 1.5 × ATR stop. Price dipped and I moved the stop down instead of accepting the loss — that was fear, not analysis. The trade recovered, which is the worst possible outcome because it rewards the mistake."
            hint={form.body.trim().length < 10 ? `${form.body.trim().length}/10 characters minimum` : `${form.body.length} characters`}
            error={form.body && form.body.trim().length < 10 ? 'Write at least a sentence or two.' : undefined}
          />

          {aiStatus?.configured && (
            <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-slate-600">
              <Icon name="spark" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
              Gemini will attach coaching feedback automatically. It reflects your behavioural pattern back to you — it
              will not tell you what to trade.
            </p>
          )}
        </div>
      </Modal>

      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        busy={busy}
        title="Delete this entry?"
        message="It will be permanently removed from your journal."
        confirmLabel="Delete entry"
      />
    </div>
  );
}
