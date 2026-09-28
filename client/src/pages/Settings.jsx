import { useEffect, useState } from 'react';
import { Card, Badge, Icon, Button, Input, Select, Alert, SectionTitle, Toggle, Confirm, usePoll } from '../components/ui.jsx';
import { Profile, Auth, Market, Bot, AI } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { dateTime, timeAgo } from '../lib/format.js';

export default function Settings() {
  const { user, patchUser, logout } = useAuth();
  const toast = useToast();

  const { data: access, refresh: refreshAccess } = usePoll(() => Profile.marketAccess(), 60000, []);
  const { data: sessions, refresh: refreshSessions } = usePoll(() => Auth.sessions(), 60000, []);
  const { data: live } = usePoll(() => Market.liveStatus(), 300000, []);
  const { data: botState } = usePoll(() => Bot.state().catch(() => null), 60000, []);
  const { data: aiStatus } = usePoll(() => AI.status().catch(() => null), 300000, []);

  const [name, setName] = useState(user?.fullName || '');
  const [risk, setRisk] = useState(user?.riskPerTrade ?? 1);
  const [daily, setDaily] = useState(user?.maxDailyLoss ?? 3);
  const [maxPos, setMaxPos] = useState(user?.maxOpenPositions ?? 3);
  const [markets, setMarkets] = useState(user?.marketsEnabled || ['stocks']);
  const [dob, setDob] = useState(user?.dateOfBirth || '');
  const [busy, setBusy] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.fullName || '');
    setRisk(user.riskPerTrade ?? 1);
    setDaily(user.maxDailyLoss ?? 3);
    setMaxPos(user.maxOpenPositions ?? 3);
    setMarkets(user.marketsEnabled || ['stocks']);
    setDob(user.dateOfBirth || '');
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      const patch = {
        fullName: name.trim(),
        riskPerTrade: Number(risk),
        maxDailyLoss: Number(daily),
        maxOpenPositions: Number(maxPos),
        marketsEnabled: markets.length ? markets : ['stocks'],
      };
      if (dob && dob !== user?.dateOfBirth) patch.dateOfBirth = dob;
      const r = await Profile.update(patch);
      patchUser(r.profile);
      toast.success('Settings saved');
      refreshAccess();
    } catch (e) {
      toast.error('Could not save', e.message);
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (!pw.current || !pw.next) return toast.error('Fill in both fields');
    if (pw.next.length < 8) return toast.error('New password too short', 'At least 8 characters, with a letter and a number.');
    if (pw.next !== pw.confirm) return toast.error('Passwords do not match');
    setPwBusy(true);
    try {
      const r = await Auth.changePassword({ currentPassword: pw.current, newPassword: pw.next });
      toast.success('Password changed', r.message);
      setPw({ current: '', next: '', confirm: '' });
      refreshSessions();
    } catch (e) {
      toast.error('Could not change password', e.message);
    } finally {
      setPwBusy(false);
    }
  };

  const revoke = async (id) => {
    try {
      await Auth.revokeSession(id);
      toast.info('Device signed out');
      refreshSessions();
    } catch (e) {
      toast.error('Could not revoke', e.message);
    }
  };

  const toggleMarket = (id) => {
    setMarkets((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">Settings</h1>
        <p className="mt-1 text-[13px] text-slate-500">Profile, risk limits, market access, sessions and security.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* profile */}
        <Card>
          <SectionTitle icon="settings" title="Profile" subtitle="Stored in your Supabase row, readable only by you" />
          <div className="space-y-3.5">
            <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            <Input label="Email" value={user?.email || ''} disabled hint="Email cannot be changed — it is your sign-in identity." />
            <Input
              label="Date of birth" type="date" value={dob || ''} onChange={(e) => setDob(e.target.value)}
              hint={user?.ageVerified ? 'Age verified as 18+. Required for derivatives and leveraged FX.' : 'Required to unlock F&O and forex.'}
            />
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={user?.ageVerified ? 'done' : 'warn'} icon={user?.ageVerified ? 'shield' : 'alert'}>
                {user?.ageVerified ? '18+ verified' : 'Age not verified'}
              </Badge>
              <Badge tone="neutral" icon="clock">Joined {dateTime(user?.createdAt)}</Badge>
            </div>
          </div>
        </Card>

        {/* risk */}
        <Card>
          <SectionTitle icon="shield" title="Risk limits" subtitle="Enforced server-side on every order — the UI cannot override them" />
          <div className="space-y-3.5">
            <Input label="Risk per trade (%)" type="number" step="0.1" min="0.1" max="5" inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value)}
              hint="0.1 – 5%. Position size is derived from this, never chosen directly." />
            <Input label="Daily loss limit (%)" type="number" step="0.5" min="0.5" max="20" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)}
              hint="0.5 – 20%. Once hit, no new entries that day — including from the bot." />
            <Input label="Max open positions" type="number" step="1" min="1" max="10" inputMode="numeric" value={maxPos} onChange={(e) => setMaxPos(e.target.value)}
              hint="1 – 10. Caps your total portfolio heat." />
            <div className="rounded-xl bg-slate-50 px-3.5 py-3">
              <p className="text-[11.5px] leading-relaxed text-slate-600">
                At {Number(risk).toFixed(1)}% per trade with {maxPos} positions, your worst case if every stop is hit
                simultaneously is roughly <span className="font-bold text-down-deep">{(Number(risk) * Number(maxPos)).toFixed(1)}%</span> of
                capital — assuming the positions are genuinely uncorrelated. Three bank longs are one bet, not three.
              </p>
            </div>
          </div>
        </Card>

        {/* markets */}
        <Card className="lg:col-span-2">
          <SectionTitle icon="layers" title="Market access" subtitle="Derivatives stay locked until the Risk Management module is complete" />
          <div className="grid gap-2.5 grid-tight sm:grid-cols-2 lg:grid-cols-3">
            {(access?.access || []).map((m) => (
              <div key={m.id} className={`rounded-2xl border p-3.5 transition ${m.unlocked ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-bold text-slate-900">{m.label}</p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{m.blurb}</p>
                  </div>
                  {m.unlocked ? <Badge tone="done" icon="check">Open</Badge> : <Badge tone="warn" icon="lock">Locked</Badge>}
                </div>
                {!m.unlocked && (
                  <p className="mt-2 text-[11px] font-semibold leading-snug text-amber-800">
                    {m.needsAge && 'Verify you are 18+ below. '}
                    {m.missingModules?.length > 0 && 'Complete Risk Management in the Learn tab.'}
                  </p>
                )}
                <div className="mt-3 border-t border-slate-100 pt-2.5">
                  <Toggle
                    checked={markets.includes(m.id)}
                    onChange={() => toggleMarket(m.id)}
                    disabled={!m.unlocked}
                    label={m.unlocked ? 'Show in my markets' : 'Locked'}
                  />
                </div>
              </div>
            ))}
          </div>
          {!markets.length && (
            <Alert tone="warn" className="mt-3">Select at least one market — otherwise the bot has nothing to scan.</Alert>
          )}
        </Card>

        {/* sessions */}
        <Card>
          <SectionTitle
            icon="layers"
            title="Active sessions"
            subtitle="Sign in on any device; revoke any of them from here"
            action={<Badge tone="neutral">{(sessions?.sessions || []).filter((s) => s.active).length} active</Badge>}
          />
          <div className="space-y-2">
            {(sessions?.sessions || []).slice(0, 6).map((s) => (
              <div key={s.id} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${s.active ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${s.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200 text-slate-400'}`}>
                  <Icon name={s.active ? 'check' : 'x'} className="h-3.5 w-3.5" stroke={2.4} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-slate-800">{s.device || 'Unknown device'}</p>
                  <p className="mt-0.5 text-[10.5px] text-slate-400">
                    {s.ip || 'no ip'} · {timeAgo(s.createdAt)} · expires {dateTime(s.expiresAt)}
                  </p>
                </div>
                {s.active && (
                  <Button size="xs" variant="ghost" icon="logout" onClick={() => revoke(s.id)}>Revoke</Button>
                )}
              </div>
            ))}
            {!sessions?.sessions?.length && <p className="py-4 text-center text-[12.5px] text-slate-400">No sessions recorded.</p>}
          </div>
          <Button variant="secondary" size="sm" icon="shield" className="mt-3 w-full" onClick={() => setConfirmLogoutAll(true)}>
            Sign out of every device
          </Button>
        </Card>

        {/* security */}
        <Card>
          <SectionTitle icon="lock" title="Password" subtitle="Hashed with bcrypt, 10+ rounds. Never stored or logged in plain text." />
          <div className="space-y-3.5">
            <Input label="Current password" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <Input label="New password" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })}
              hint="At least 8 characters, with a letter and a number." />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              error={pw.confirm && pw.confirm !== pw.next ? 'Passwords do not match.' : undefined} />
            <Button className="w-full" icon="check" loading={pwBusy} onClick={changePassword} disabled={!pw.current || !pw.next}>
              Update password
            </Button>
            <p className="text-[11px] leading-snug text-slate-500">
              Changing your password signs every other device out. You will need to sign in again on each one.
            </p>
          </div>
        </Card>

        {/* system */}
        <Card className="lg:col-span-2">
          <SectionTitle icon="info" title="System status" subtitle="What this deployment is actually connected to" />
          <div className="grid gap-2.5 grid-tight sm:grid-cols-2 lg:grid-cols-4">
            {[
              { l: 'Trading mode', v: 'Paper only', ok: true, note: 'No live capital, ever' },
              { l: 'Broker order routing', v: 'None', ok: true, note: 'No such code exists here' },
              { l: 'Gemini', v: aiStatus?.configured ? 'Connected (backend)' : 'Not configured', ok: Boolean(aiStatus?.configured), note: 'Key never reaches the browser' },
              { l: 'Bot state', v: botState?.armed ? (botState?.enabled ? 'Armed & running' : 'Armed, paused') : 'Disarmed', ok: true, note: 'Simulated orders only' },
              { l: 'Live price feeds', v: live ? `${live.pairs ?? 0} crypto pair${live?.pairs === 1 ? '' : 's'}` : 'Simulated', ok: true, note: 'Read-only quotes' },
            ].map((s) => (
              <div key={s.l} className="rounded-xl bg-slate-50 px-3.5 py-3">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{s.l}</p>
                <p className="mt-1 flex items-center gap-1.5 text-[13.5px] font-bold text-slate-900">
                  <span className={`h-1.5 w-1.5 rounded-full ${s.ok ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  {s.v}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{s.note}</p>
              </div>
            ))}
          </div>
          {live && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-slate-500">
              {live.note} Live crypto reference prices refresh every 60 seconds and fall back to the simulator when the
              feed is unreachable, so charts never break.
            </p>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap gap-2.5 [&>*]:min-w-0">
        <Button icon="check" loading={busy} onClick={save}>Save settings</Button>
        <Button variant="secondary" icon="logout" onClick={() => logout()}>Sign out</Button>
      </div>

      <Card className="border-amber-200 bg-amber-50/50">
        <div className="flex items-start gap-2.5">
          <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" stroke={2.2} />
          <p className="text-[12px] leading-relaxed text-amber-900">
            <span className="font-bold">A note on what this app will never be.</span> There is no setting here to connect
            a bank account, a UPI id, a card or a broker API for order placement. That is not an omission — accepting
            deposits and trading on someone's behalf requires SEBI registration in India, and doing it unregistered is a
            criminal matter. If you ever want to trade your own money algorithmically, module 14 explains the compliant
            path: your own broker account, your own API key, your own deterministic strategy, at 18+.
          </p>
        </div>
      </Card>

      <Confirm
        open={confirmLogoutAll}
        onClose={() => setConfirmLogoutAll(false)}
        onConfirm={async () => { setConfirmLogoutAll(false); await logout(true); }}
        title="Sign out of every device?"
        message="All active sessions will be revoked. You will need to sign in again on each device you use."
        confirmLabel="Sign out everywhere"
      />
    </div>
  );
}
