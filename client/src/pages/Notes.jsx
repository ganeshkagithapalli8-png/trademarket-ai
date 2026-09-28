import { useState } from 'react';
import { Card, Badge, Icon, Button, Input, Textarea, Modal, Confirm, EmptyState, Skeleton, SectionTitle, usePoll, Alert } from '../components/ui.jsx';
import { Content, AI } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { dateTime, renderMarkdown, timeAgo } from '../lib/format.js';

const blank = { title: '', description: '', tags: '' };

export default function Notes() {
  const toast = useToast();
  const { data, loading, refresh } = usePoll(() => Content.notes(), 60000, []);
  const { data: aiStatus } = usePoll(() => AI.status(), 600000, []);

  const [editing, setEditing] = useState(null); // null | 'new' | note object
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [summarising, setSummarising] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [q, setQ] = useState('');

  const notes = (data?.notes || []).filter((x) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return x.title.toLowerCase().includes(t) || (x.description || '').toLowerCase().includes(t) || (x.tags || []).some((g) => g.includes(t));
  });

  const openNew = () => { setForm(blank); setEditing('new'); };
  const openEdit = (note) => {
    setForm({ title: note.title, description: note.description || '', tags: (note.tags || []).join(', ') });
    setEditing(note);
  };

  const save = async () => {
    if (form.title.trim().length < 1) return toast.error('Add a title', 'Notes need a title so you can find them later.');
    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8),
      };
      if (editing === 'new') {
        await Content.createNote({ ...payload, generateSummary: Boolean(aiStatus?.configured) && payload.description.length > 40 });
        toast.success('Note saved', 'Your ideas are stored in Supabase against your account.');
      } else {
        await Content.updateNote(editing.id, payload);
        toast.success('Note updated');
      }
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error('Could not save', e.message);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await Content.deleteNote(deleting.id);
      toast.info('Note deleted');
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error('Could not delete', e.message);
    } finally {
      setBusy(false);
    }
  };

  const summarize = async (note) => {
    setSummarising(note.id);
    try {
      const r = await Content.summarizeNote(note.id);
      toast.success('Summary generated', `Using ${r.model}`);
      setExpanded(note.id);
      refresh();
    } catch (e) {
      toast.error('Could not summarise', e.message);
    } finally {
      setSummarising(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">Notes</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Trade ideas, strategy rules and study notes — with an AI summary on demand.
          </p>
        </div>
        <Button size="sm" icon="plus" onClick={openNew}>New note</Button>
      </div>

      {!aiStatus?.configured && (
        <Alert tone="warn" title="AI summaries are off">
          Add <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px]">GEMINI_API_KEY</code> to
          server/.env and restart the API. Notes still save normally — the summary is optional.
        </Alert>
      )}

      <Card>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes and tags…" className="field pl-10" />
        </div>
        <p className="mt-2 text-[11.5px] text-slate-500">{notes.length} note{notes.length === 1 ? '' : 's'}</p>
      </Card>

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-40" />)}</div>
      ) : notes.length === 0 ? (
        <Card pad={false}>
          <EmptyState
            icon="note"
            title={q ? 'No notes match that search' : 'No notes yet'}
            message={q ? 'Try a different term.' : 'Write down your strategy rules while they are fresh. A rule you cannot articulate is a rule you cannot follow.'}
            action={!q && <Button size="sm" icon="plus" onClick={openNew}>Create your first note</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {notes.map((note) => (
            <Card key={note.id} className="flex flex-col transition hover:shadow-lift">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14.5px] font-bold leading-snug text-slate-900">{note.title}</h3>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {dateTime(note.created_at)}
                    {note.updated_at !== note.created_at && ` · edited ${timeAgo(note.updated_at)}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => openEdit(note)} aria-label="Edit" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                    <Icon name="edit" className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setDeleting(note)} aria-label="Delete" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600">
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {note.description && (
                <p className={`mt-2.5 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600 ${expanded === note.id ? '' : 'line-clamp-3'}`}>
                  {note.description}
                </p>
              )}

              {note.ai_summary && (
                <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/50 px-3.5 py-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-700">
                    <Icon name="spark" className="h-3 w-3" /> AI summary
                  </p>
                  <div className="text-[12.5px] leading-relaxed text-slate-700" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.ai_summary) }} />
                </div>
              )}

              {note.tags?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {note.tags.map((t) => <Badge key={t} tone="neutral">#{t}</Badge>)}
                </div>
              )}

              <div className="mt-auto flex gap-2 pt-3.5">
                {note.description && (note.description || '').length > 20 && (
                  <Button size="xs" variant="soft" icon="spark" loading={summarising === note.id} disabled={!aiStatus?.configured} onClick={() => summarize(note)}>
                    {note.ai_summary ? 'Re-summarise' : 'Summarise'}
                  </Button>
                )}
                {(note.description || '').length > 240 && (
                  <Button size="xs" variant="ghost" onClick={() => setExpanded(expanded === note.id ? null : note.id)}>
                    {expanded === note.id ? 'Show less' : 'Read more'}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New note' : 'Edit note'}
        subtitle="Saved to your Supabase row. Nobody else can read it — enforced by row-level security."
        footer={
          <div className="flex gap-2 [&>*]:min-w-0">
            <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button className="flex-1" icon="check" loading={busy} onClick={save}>{editing === 'new' ? 'Create note' : 'Save changes'}</Button>
          </div>
        }
      >
        <div className="space-y-3.5">
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Pullback entry rules" maxLength={160} />
          <Textarea
            label="Note" rows={9} value={form.description} maxLength={20000}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Only buy dips above the 50 SMA when RSI resets below 40 and turns back up. Stop goes 1.5 × ATR below entry, target at 2× that distance. Skip the trade if the entry candle closes more than 60% of its range away from support."
            hint={`${form.description.length}/20,000 characters`}
          />
          <Input
            label="Tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="strategy, rules, pullback" hint="Comma separated, up to 8. Stored lowercase."
          />
        </div>
      </Modal>

      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        busy={busy}
        title="Delete this note?"
        message={`“${deleting?.title}” will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete note"
      />
    </div>
  );
}
