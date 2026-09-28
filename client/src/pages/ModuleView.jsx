import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, Badge, Icon, Button, Alert, Progress, Skeleton, SectionTitle, usePoll } from '../components/ui.jsx';
import { Learn as LearnApi } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { dateTime } from '../lib/format.js';

export default function ModuleView() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();

  const { data, loading, error, refresh } = usePoll(() => LearnApi.module(id), 0, [id]);
  const [openLesson, setOpenLesson] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const mod = data?.module;
  const read = new Set(data?.lessonsRead || []);

  useEffect(() => {
    setAnswers({});
    setResult(null);
    setOpenLesson(null);
  }, [id]);

  useEffect(() => {
    if (mod?.lessons?.length && openLesson === null && !read.has(mod.lessons[0].id)) {
      setOpenLesson(mod.lessons[0].id);
    }
  }, [mod]); // eslint-disable-line react-hooks/exhaustive-deps

  const allRead = useMemo(
    () => Boolean(mod) && mod.lessons.every((l) => read.has(l.id)),
    [mod, data?.lessonsRead] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const answered = Object.keys(answers).length;
  const ready = allRead && answered === (mod?.quiz?.length ?? 0);

  if (loading && !mod) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-52" />
        <Card className="h-40" />
        <Card className="h-64" />
      </div>
    );
  }

  if (error || !mod) {
    return (
      <Alert tone="danger" title="Could not load this module">
        {error || 'It may not exist.'}{' '}
        <Link to="/app/learn" className="font-bold underline underline-offset-2">Back to the path →</Link>
      </Alert>
    );
  }

  const markRead = async (lessonId) => {
    setOpenLesson((cur) => (cur === lessonId ? null : lessonId));
    if (!read.has(lessonId)) {
      try {
        await LearnApi.read(mod.id, lessonId);
        refresh();
      } catch (e) {
        toast.error('Could not save progress', e.message);
      }
    }
  };

  const submitQuiz = async () => {
    if (!ready) return;
    setSubmitting(true);
    setResult(null);
    try {
      const list = mod.quiz.map((_, i) => answers[i]);
      const r = await LearnApi.quiz(mod.id, list);
      setResult(r);
      refresh();
      if (r.passed) toast.success(`Module ${mod.step} complete`, r.message);
      else toast.warn('Not yet', r.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast.error('Could not submit the quiz', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    setAnswers({});
    setResult(null);
  };

  return (
    <div className="space-y-5">
      <Link to="/app/learn" className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500 transition hover:text-slate-800">
        <Icon name="arrowRight" className="h-3.5 w-3.5 rotate-180" /> Back to the path
      </Link>

      {/* header */}
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-100/50 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">Module {mod.step} of 14</Badge>
            {data.status === 'completed' && <Badge tone="done" icon="check">Completed {dateTime(data.completedAt)}</Badge>}
            {data.status === 'locked' && <Badge tone="locked" icon="lock">Locked</Badge>}
            <Badge tone="neutral" icon="clock">~{mod.minutes} min</Badge>
          </div>
          <h1 className="mt-3 text-[24px] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[30px]">
            {mod.title}
          </h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-600">{mod.tagline}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="min-w-[180px] flex-1">
              <div className="mb-1 flex items-center justify-between text-[11.5px] font-semibold text-slate-500">
                <span>Lessons read</span>
                <span className="tnum">{read.size}/{mod.lessons.length}</span>
              </div>
              <Progress value={read.size} max={mod.lessons.length} />
            </div>
            {data.quizScore != null && (
              <Badge tone={data.passed ? 'done' : 'neutral'} icon="target">
                Best quiz {data.quizScore}/{mod.quiz.length} · {data.quizAttempts} attempt{data.quizAttempts === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {data.status === 'locked' && (
        <Alert tone="warn" title="This module is locked">
          Finish the earlier modules first. The path is sequential on purpose — risk management has to be internalised
          before derivatives make any sense.
        </Alert>
      )}

      {result && (
        <Alert tone={result.passed ? 'success' : 'warn'} title={result.passed ? `Passed — ${result.score}/${result.total}` : `${result.score}/${result.total} — need ${result.passMark}`}>
          {result.message}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* lessons */}
        <div className="space-y-2.5">
          <SectionTitle icon="book" title="Lessons" subtitle="Tap to expand. Reading marks progress." className="px-1" />
          {mod.lessons.map((l, i) => {
            const isOpen = openLesson === l.id;
            const isRead = read.has(l.id);
            return (
              <div key={l.id} className={`card overflow-hidden transition ${isOpen ? 'border-brand-200 shadow-lift' : ''}`}>
                <button
                  onClick={() => markRead(l.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 sm:px-5"
                >
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11.5px] font-bold transition ${
                    isRead ? 'bg-emerald-500 text-white' : isOpen ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {isRead ? <Icon name="check" className="h-3.5 w-3.5" stroke={3} /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-bold text-slate-900">{l.title}</span>
                    {!isOpen && <span className="mt-0.5 block truncate text-[11.5px] text-slate-500">{l.body.slice(0, 90)}…</span>}
                  </span>
                  <Icon name="arrowDown" className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="animate-fade-in border-t border-slate-100 px-4 py-4 sm:px-5">
                    <p className="text-[14px] leading-[1.75] text-slate-700">{l.body}</p>
                    {!isRead && (
                      <p className="mt-3.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-600">
                        <Icon name="check" className="h-3.5 w-3.5" stroke={2.6} /> Marked as read
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* quiz */}
        <div className="space-y-4 lg:sticky lg:top-32 lg:self-start">
          <Card>
            <SectionTitle
              icon="target"
              title="Check your understanding"
              subtitle={`Score ${mod.passMark} of ${mod.quiz.length} to complete this module and unlock the next.`}
            />

            {!allRead && !result && (
              <Alert tone="info" className="mb-3.5">
                Read all {mod.lessons.length} lessons first — the quiz unlocks after that.
              </Alert>
            )}

            <div className="space-y-4">
              {mod.quiz.map((q, qi) => (
                <div key={qi} className={`rounded-2xl border p-3.5 transition ${answers[qi] != null ? 'border-brand-200 bg-brand-50/30' : 'border-slate-200'}`}>
                  <p className="text-[13px] font-bold leading-snug text-slate-900">
                    <span className="mr-1.5 text-brand-500">{qi + 1}.</span>{q.question}
                  </p>
                  <div className="mt-2.5 space-y-1.5">
                    {q.options.map((opt, oi) => {
                      const chosen = answers[qi] === oi;
                      const revealed = result?.results?.[qi];
                      const isRight = revealed?.rightAnswer === oi;
                      const isWrongPick = revealed && chosen && !revealed.correct;
                      return (
                        <button
                          key={oi}
                          disabled={Boolean(result)}
                          onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                          className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[12.5px] leading-snug transition ${
                            isRight
                              ? 'border-emerald-300 bg-emerald-50 font-semibold text-emerald-900'
                              : isWrongPick
                                ? 'border-rose-300 bg-rose-50 font-semibold text-rose-900'
                                : chosen
                                  ? 'border-brand-400 bg-white font-semibold text-brand-900 ring-2 ring-brand-500/10'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60'
                          }`}
                        >
                          <span className={`mt-px grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full border text-[9px] font-bold ${
                            isRight ? 'border-emerald-500 bg-emerald-500 text-white'
                              : isWrongPick ? 'border-rose-500 bg-rose-500 text-white'
                              : chosen ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 text-slate-400'
                          }`} style={{ height: 18, width: 18 }}>
                            {isRight ? '✓' : isWrongPick ? '✕' : String.fromCharCode(65 + oi)}
                          </span>
                          <span className="min-w-0 flex-1">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                  {result?.results?.[qi]?.why && (
                    <p className={`mt-2.5 rounded-xl px-3 py-2.5 text-[12px] leading-relaxed ${
                      result.results[qi].correct ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'
                    }`}>
                      <span className="font-bold">{result.results[qi].correct ? 'Correct. ' : 'Not quite. '}</span>
                      {result.results[qi].why}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              {result ? (
                <>
                  <Button variant="secondary" className="flex-1" icon="refresh" onClick={retry}>Try again</Button>
                  {result.passed && (
                    <Button className="flex-1" iconRight="arrowRight" onClick={() => nav(mod.step < 14 ? `/app/learn/${nextId(mod.step)}` : '/app/learn')}>
                      {mod.step < 14 ? 'Next module' : 'Finish'}
                    </Button>
                  )}
                </>
              ) : (
                <Button className="w-full" size="lg" loading={submitting} disabled={!ready} onClick={submitQuiz}>
                  {!allRead ? `Read the lessons first (${read.size}/${mod.lessons.length})` : `Submit quiz (${answered}/${mod.quiz.length})`}
                </Button>
              )}
            </div>
          </Card>

          <Card className="bg-slate-50">
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-slate-600">
              <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" stroke={2.2} />
              Quiz answers are graded on the server and never sent to your browser beforehand, so the correct option
              cannot be read out of the network tab. Explanations appear after you submit.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Steps map 1:1 to module order in the roadmap, so the next id is derivable. */
const ORDER = [
  'trading-basics', 'candlesticks', 'support-resistance', 'risk-management', 'one-strategy',
  'backtesting', 'python-basics', 'pandas-numpy', 'machine-learning', 'build-bot',
  'backtest-bot', 'paper-trade', 'improve-monitor', 'live-considerations',
];
const nextId = (step) => ORDER[step] || '/app/learn';
