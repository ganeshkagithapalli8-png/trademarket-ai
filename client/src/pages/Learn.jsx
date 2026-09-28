import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Badge, Icon, Button, Progress, SectionTitle, Skeleton, Alert, usePoll } from '../components/ui.jsx';
import { Donut } from '../components/Chart.jsx';
import { Learn as LearnApi } from '../lib/api.js';
import { dateTime } from '../lib/format.js';

const STATUS = {
  completed: { tone: 'done', label: 'Completed', icon: 'check' },
  in_progress: { tone: 'brand', label: 'In progress', icon: 'play' },
  available: { tone: 'brand', label: 'Available', icon: 'arrowRight' },
  locked: { tone: 'locked', label: 'Locked', icon: 'lock' },
};

export default function Learn() {
  const { data, loading, error } = usePoll(() => LearnApi.roadmap(), 60000, []);
  const [filter, setFilter] = useState('all');

  const modules = data?.modules || [];
  const summary = data?.summary || {};
  const shown = modules.filter((m) => (filter === 'all' ? true : filter === 'todo' ? m.status !== 'completed' : m.status === 'completed'));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">The path</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-500">
          Fourteen modules, in order. Each one unlocks the next only after you pass its quiz. The bot cannot be armed
          until the first thirteen are done — that gate is the whole point of the product.
        </p>
      </div>

      {error && <Alert tone="danger" title="Could not load the roadmap">{error}</Alert>}

      {/* progress hero */}
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-brand-100/50 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-6">
          <Donut value={summary.completed ?? 0} max={summary.total ?? 14} size={92} stroke={9} label={`${summary.completed ?? 0}/${summary.total ?? 14}`} />
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-500">Progress</p>
            <p className="mt-0.5 text-[19px] font-extrabold tracking-tight text-slate-900">
              {summary.completed === summary.total ? 'Path complete' : `Module ${summary.currentStep} of ${summary.total}`}
            </p>
            <Progress value={summary.completed ?? 0} max={summary.total ?? 14} className="mt-3 max-w-md" />
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <Badge tone={summary.botArmable ? 'done' : 'neutral'} icon={summary.botArmable ? 'check' : 'lock'}>
                Bot arming {summary.botModulesDone ?? 0}/{summary.botModulesTotal ?? 13}
              </Badge>
              {summary.botArmable && (
                <Link to="/app/bot"><Badge tone="brand" icon="bot">Bot can be armed →</Badge></Link>
              )}
            </div>
          </div>
        </div>
      </Card>

      {!summary.botArmable && (
        <Alert tone="info" title="Why the bot is locked">
          Arming requires modules 1–13. Paper trading without internalised risk management is how accounts die — the
          sequence is enforced on the server, not just in the UI.
        </Alert>
      )}

      {/* filter */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {[
          { id: 'all', label: `All ${modules.length}` },
          { id: 'todo', label: `Remaining ${modules.length - (summary.completed ?? 0)}` },
          { id: 'done', label: `Completed ${summary.completed ?? 0}` },
        ].map((f) => (
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

      {/* modules */}
      {loading && !modules.length ? (
        <div className="space-y-2.5">{Array.from({ length: 6 }).map((_, i) => <Card key={i} className="h-[86px]" />)}</div>
      ) : (
        <div className="space-y-2.5">
          {shown.map((m) => {
            const s = STATUS[m.status] || STATUS.locked;
            const isLast = m.step === 14;
            return (
              <Link
                key={m.id}
                to={m.status === 'locked' ? '/app/learn' : `/app/learn/${m.id}`}
                onClick={(e) => { if (m.status === 'locked') e.preventDefault(); }}
                className={`card group flex items-start gap-3.5 p-4 transition sm:p-5 ${
                  m.status === 'locked' ? 'opacity-60' : 'hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift'
                } ${isLast ? 'border-amber-200 bg-gradient-to-br from-amber-50/60 to-white' : ''}`}
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[13px] font-extrabold transition ${
                  m.status === 'completed'
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : m.status === 'locked'
                      ? 'bg-slate-100 text-slate-400'
                      : isLast ? 'bg-amber-500 text-white shadow-sm' : 'bg-brand-600 text-white shadow-sm'
                }`}>
                  {m.status === 'completed' ? <Icon name="check" className="h-4.5 w-4.5" stroke={3} /> : m.step}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14.5px] font-bold leading-tight text-slate-900">{m.title}</h3>
                    <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-slate-500">{m.tagline}</p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                      <Icon name="book" className="h-3 w-3" /> {m.lessonCount} lessons
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                      <Icon name="clock" className="h-3 w-3" /> ~{m.minutes} min
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                      <Icon name="target" className="h-3 w-3" /> {m.lessonsRead?.length ?? 0}/{m.lessonCount} read
                    </span>
                    {m.quizScore != null && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                        <Icon name="check" className="h-3 w-3" /> quiz {m.quizScore}/3
                      </span>
                    )}
                    {m.completedAt && (
                      <span className="text-[11px] text-slate-400">{dateTime(m.completedAt)}</span>
                    )}
                  </div>

                  {m.status !== 'completed' && m.status !== 'locked' && (
                    <Progress value={m.lessonsRead?.length ?? 0} max={m.lessonCount} className="mt-2.5 max-w-xs" />
                  )}
                </div>

                <Icon
                  name={m.status === 'locked' ? 'lock' : 'arrowRight'}
                  className={`mt-1 h-4 w-4 shrink-0 transition ${m.status === 'locked' ? 'text-slate-300' : 'text-slate-300 group-hover:translate-x-0.5 group-hover:text-brand-500'}`}
                />
              </Link>
            );
          })}
          {shown.length === 0 && (
            <Card pad={false}>
              <div className="px-6 py-12 text-center">
                <p className="text-[15px] font-bold text-slate-800">Nothing in this filter</p>
                <p className="mt-1 text-[13px] text-slate-500">Switch the filter to see your modules.</p>
              </div>
            </Card>
          )}
        </div>
      )}

      <Card className="border-amber-200 bg-amber-50/50">
        <div className="flex items-start gap-2.5">
          <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" stroke={2.2} />
          <p className="text-[12.5px] leading-relaxed text-amber-900">
            <span className="font-bold">Module 14 is deliberately the last one, and it is not a feature.</span> It
            explains what going live in India actually requires — a SEBI-registered broker's approved API, your own
            account, 18+, and a deterministic strategy you control. This application has no live trading and never will.
          </p>
        </div>
      </Card>
    </div>
  );
}
