import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, logSet, markRoughDay, request, saveDayNote, syncQueue, undoSet, updateDayStatus } from './api/client'
import type { AppSettings, Exercise, HistoryDay, SetRecord, TodayPayload } from './api/client'
import scoringFile from '../data/scoring.json'
import { isScoringDataLoaded, type ScoreResult, type ScoringData } from './engine/scoring'

type Tab = 'Today' | 'History' | 'Score'
const tabs: { name: Tab; icon: string }[] = [
  { name: 'Today', icon: '◷' },
  { name: 'History', icon: '▦' },
  { name: 'Score', icon: '◉' },
]
const defaultSettings: AppSettings = {
  shipDate: '', timezone: 'America/Chicago', morningMessageTime: '06:30',
  baselines: { pushups: null, situps: null, plankSeconds: null, runTimeSeconds: null },
  ageBracket: '', sex: '', overPrepMultiplier: 1.25, restTimerEnabled: true, telegramEnabled: false,
}
type PlannedExercise = { key: Exercise | 'core'; label: string; sets?: number; reps?: number; seconds?: number; miles?: number; minutes?: number; paceSecondsPerMile?: number; targetPaceSecondsPerMile?: number; kind?: string }
type DailyPlan = { restDay: boolean; exercises: PlannedExercise[]; warning?: string }

function localIso(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function dateInTimezone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
function formatRunTime(seconds: number | null) {
  return seconds === null ? '' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
function formatPace(seconds: number | undefined) {
  return seconds === undefined ? '' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}/mi`
}
function parseRunTime(value: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}
function countdown(shipDate: string, timeZone: string) {
  if (!shipDate) return null
  const ship = Date.parse(`${shipDate}T00:00:00.000Z`)
  if (Number.isNaN(ship)) return null
  return Math.round((ship - Date.parse(`${dateInTimezone(timeZone)}T00:00:00.000Z`)) / 86_400_000)
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [loginError, setLoginError] = useState('')
  useEffect(() => {
    request('/api/today').then(() => { localStorage.setItem('fitnessPrepSessionKnown', 'yes'); setAuthenticated(true) }).catch((error: unknown) => {
      setAuthenticated(localStorage.getItem('fitnessPrepSessionKnown') === 'yes' && !(error instanceof ApiError && error.status === 401))
    })
  }, [])
  if (authenticated === null) return <div className="auth-screen"><p>Opening your private training log…</p></div>
  if (!authenticated) return <LoginScreen error={loginError} onLogin={async (passphrase) => {
    try { await request('/api/login', 'POST', { passphrase }); localStorage.setItem('fitnessPrepSessionKnown', 'yes'); setLoginError(''); setAuthenticated(true) }
    catch (error) { setLoginError(error instanceof ApiError && error.status === 401 ? 'That passphrase did not match. Try again.' : 'Could not connect. Check your connection and try again.') }
  }} />
  return <MainApp />
}

function LoginScreen({ error, onLogin }: { error: string; onLogin: (passphrase: string) => Promise<void> }) {
  const [passphrase, setPassphrase] = useState('')
  return <main className="auth-screen"><section className="auth-card card"><span className="auth-emblem">✦</span><p className="eyebrow">YOUR PRIVATE TRAINING LOG</p><h1>Welcome back</h1><p className="secondary">Enter your app passphrase to continue.</p><form onSubmit={(event) => { event.preventDefault(); void onLogin(passphrase) }}><label>Passphrase<input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit">Unlock app</button></form></section></main>
}

function MainApp() {
  const [active, setActive] = useState<Tab>('Today')
  return <div className="app-shell"><main className="screen">
    {active === 'Today' ? <Today /> : active === 'History' ? <History /> : <Score />}
  </main><nav className="tab-bar" aria-label="Main navigation">{tabs.map((tab) => <button key={tab.name} onClick={() => setActive(tab.name)} className={active === tab.name ? 'tab active' : 'tab'} aria-current={active === tab.name ? 'page' : undefined}><span className="tab-icon">{tab.icon}</span><span>{tab.name}</span></button>)}</nav></div>
}

function Today() {
  const [today, setToday] = useState<TodayPayload | null>(() => {
    try { return JSON.parse(localStorage.getItem('fitnessPrepTodayCache') ?? 'null') as TodayPayload | null }
    catch { return null }
  })
  const [recentDays, setRecentDays] = useState<HistoryDay[]>(() => {
    try { return JSON.parse(localStorage.getItem('fitnessPrepHistoryCache') ?? '[]') as HistoryDay[] }
    catch { return [] }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [lastAction, setLastAction] = useState<SetRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [restSeconds, setRestSeconds] = useState<number | null>(null)
  const [plankSeconds, setPlankSeconds] = useState(30)
  const [runDistance, setRunDistance] = useState('')
  const [runMinutes, setRunMinutes] = useState('')
  const [startDate] = useState(() => localStorage.getItem('startDate') ?? localIso())
  useEffect(() => {
    const refresh = async () => {
      try {
        await syncQueue()
        const [value, history] = await Promise.all([request<TodayPayload>('/api/today'), request<{ days: HistoryDay[] }>('/api/history')])
        setToday(value); localStorage.setItem('fitnessPrepTodayCache', JSON.stringify(value))
        setRecentDays(history.days); localStorage.setItem('fitnessPrepHistoryCache', JSON.stringify(history.days))
      } catch { /* Offline mode continues from the last saved view. */ }
    }
    void refresh()
    window.addEventListener('online', refresh)
    return () => window.removeEventListener('online', refresh)
  }, [])
  useEffect(() => {
    if (restSeconds === null) return
    const timer = window.setTimeout(() => setRestSeconds((seconds) => seconds === null || seconds <= 1 ? null : seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [restSeconds])
  const settings = today?.settings ?? defaultSettings
  const plan = today?.day?.plan as DailyPlan | null | undefined
  const roughDay = today?.day?.rough_day === 1
  const exercises = plan?.exercises ?? [{ key: 'stretch' as const, label: 'Stretch', minutes: 5 }]
  const activeSets = useMemo(() => (today?.sets ?? []).filter((set) => !set.undone), [today?.sets])
  const todayDate = today?.date ?? dateInTimezone(settings.timezone)
  const todayText = new Date(`${todayDate}T00:00:00.000Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).toUpperCase()
  const days = countdown(settings.shipDate, settings.timezone)
  const streak = streakSummary(recentDays, todayDate).current
  const firstLoggedDay = recentDays[recentDays.length - 1]?.date ?? todayDate
  const trainingWeek = Math.max(1, Math.floor((Date.parse(`${todayDate}T00:00:00.000Z`) - Date.parse(`${firstLoggedDay}T00:00:00.000Z`)) / (7 * 86_400_000)) + 1)
  const yesterdayDay = recentDays.find((day) => day.date === shiftDate(todayDate, -1))
  const start = Date.parse(`${todayDate}T00:00:00.000Z`)
  useEffect(() => { if (!localStorage.getItem('startDate')) localStorage.setItem('startDate', startDate) }, [startDate])
  const startTime = Date.parse(`${startDate}T00:00:00.000Z`)
  const shipTime = settings.shipDate ? Date.parse(`${settings.shipDate}T00:00:00.000Z`) : Number.NaN
  const progress = Number.isFinite(startTime) && Number.isFinite(shipTime) && shipTime > startTime ? Math.min(100, Math.max(0, ((start - startTime) / (shipTime - startTime)) * 100)) : 0

  async function complete(exercise: PlannedExercise) {
    if (busy) return
    if (exercise.key === 'run' && (!Number.isFinite(Number(runDistance)) || Number(runDistance) <= 0 || !Number.isFinite(Number(runMinutes)) || Number(runMinutes) <= 0)) {
      setNotice('Enter your completed run distance and time first.')
      return
    }
    setBusy(true); setNotice('')
    const date = today?.date ?? dateInTimezone(settings.timezone)
    const plannedValue = exercise.key === 'pushups' || exercise.key === 'core' ? Math.max(1, Math.floor((exercise.reps ?? 1) * (roughDay ? 0.7 : 1))) : exercise.key === 'run' ? Number(runDistance) : exercise.key === 'stretch' ? exercise.minutes ?? 5 : exercise.seconds ?? 1
    const primary: Exercise = exercise.key === 'core' ? 'situps' : exercise.key
    const primaryUnit = primary === 'pushups' || primary === 'situps' || primary === 'crunches' ? 'reps' : primary === 'run' ? 'miles' : primary === 'plank' || primary === 'run_time' ? 'seconds' : 'minutes'
    const records: SetRecord[] = [{ id: crypto.randomUUID(), date, exercise: primary, value: plannedValue, unit: primaryUnit, timestamp: new Date().toISOString() }]
    if (exercise.key === 'core') records.push({ id: crypto.randomUUID(), date, exercise: 'plank', value: plankSeconds, unit: 'seconds', timestamp: records[0].timestamp })
    if (exercise.key === 'run') records.push({ id: crypto.randomUUID(), date, exercise: 'run_time', value: Number(runMinutes) * 60, unit: 'seconds', timestamp: records[0].timestamp })
    setToday((old) => {
      if (!old) return old
      const next = { ...old, sets: [...old.sets, ...records] }; localStorage.setItem('fitnessPrepTodayCache', JSON.stringify(next)); return next
    })
    setLastAction(records)
    setRestSeconds(settings.restTimerEnabled ? 60 : null)
    try {
      for (const record of records) await logSet(record)
      const allComplete = Boolean(plan && exercises.every((item) => doneCount(item) + (item.key === exercise.key ? 1 : 0) >= (item.sets ?? 1)))
      if (allComplete) await updateDayStatus(date, plan?.restDay ? 'rest' : 'complete')
      setNotice('Set saved.')
    }
    catch { setNotice('Could not sync this set yet. It is still visible on this device.') }
    finally { setBusy(false) }
  }
  async function undoLast() {
    if (!lastAction.length) return
    setToday((old) => {
      if (!old) return old
      const ids = new Set(lastAction.map((item) => item.id))
      const next = { ...old, day: old.day?.status === 'complete' ? { ...old.day, status: 'partial' } : old.day, sets: old.sets.map((set) => ids.has(set.id) ? { ...set, undone: 1 } : set) }; localStorage.setItem('fitnessPrepTodayCache', JSON.stringify(next)); return next
    })
    for (const item of [...lastAction].reverse()) { try { await undoSet(item.id) } catch { /* The undo itself is queued if the device is offline. */ } }
    if (today?.day?.status === 'complete') { try { await updateDayStatus(today.date, 'partial') } catch { /* Offline status change is queued. */ } }
    setLastAction([]); setNotice('Last set undone.')
  }
  async function useRoughDay() {
    const date = today?.date ?? dateInTimezone(settings.timezone)
    setToday((old) => {
      if (!old || !old.day) return old
      const next = { ...old, day: { ...old.day, rough_day: 1, status: 'rough' } }; localStorage.setItem('fitnessPrepTodayCache', JSON.stringify(next)); return next
    })
    try { await markRoughDay(date) } catch { setNotice('Could not save the rough-day note.') }
  }
  function doneCount(exercise: PlannedExercise): number {
    const type = exercise.key === 'core' ? ['situps', 'crunches'] : [exercise.key]
    return activeSets.filter((set) => type.includes(set.exercise)).length
  }
  const dayComplete = Boolean(plan && !plan.restDay && exercises.every((exercise) => doneCount(exercise) >= (exercise.sets ?? 1)))
  async function saveSettings(value: AppSettings) {
    const result = await request<{ settings: AppSettings }>('/api/settings', 'PUT', { settings: value })
    setToday((old) => {
      if (!old) return old
      const next = { ...old, settings: result.settings }; localStorage.setItem('fitnessPrepTodayCache', JSON.stringify(next)); return next
    })
    setSettingsOpen(false)
  }

  return <>
    <header className="topbar"><span className="eyebrow">FITNESS PREP</span><button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙</button></header>
    <section className="countdown card"><p className="eyebrow">YOUR SHIP DATE</p><h1>{days === null ? 'Set your ship date' : days >= 0 ? `T-${days} days` : `T+${Math.abs(days)} days`}</h1><div className="progress-track" aria-label="Preparation timeline"><span style={{ width: `${progress}%` }} /></div><p className="secondary">{settings.shipDate ? new Date(`${settings.shipDate}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Add your date in Settings to start your countdown.'}</p></section>
    <div className="meta-row"><span>◉ &nbsp; Streak <strong>{streak}</strong></span><span>Week <strong>{trainingWeek}</strong></span></div>
    <section className="section-heading"><div><p className="eyebrow">{todayText}</p><h2>Today</h2></div></section>
    {!plan && <div className="rest-banner"><span className="rest-icon">☼</span><div><strong>{today?.planWarning?.startsWith('Scoring data not loaded') ? 'Scoring data not loaded' : 'Plan not ready yet'}</strong><p>{today?.planWarning ?? 'Connect to load your saved training plan. Stretching can still be logged today.'}</p></div></div>}
    {dayComplete && <div className="completion-banner" role="status"><span>✦</span><div><strong>Day complete</strong><p>That’s today’s plan done. Nice work.</p></div></div>}
    {plan?.warning && <p className="plan-warning">{plan.warning}</p>}
    {plan?.restDay && <div className="rest-banner"><span className="rest-icon">☼</span><div><strong>Rest day</strong><p>Stretching only. Rest days do not break your streak.</p></div></div>}
    {plan && !plan.restDay && !roughDay && <button className="rough-button" onClick={() => void useRoughDay()}>Rough day · reduce today’s remaining volume</button>}
    {roughDay && <p className="status-note">Rough day recorded. Your streak stays intact.</p>}
    {exercises.map((exercise) => {
      const count = doneCount(exercise)
      const target = exercise.sets ?? 1
      const reps = Math.max(1, Math.floor((exercise.reps ?? 1) * (roughDay ? 0.7 : 1)))
      const plankTarget = Math.max(1, Math.floor((exercise.seconds ?? 1) * (roughDay ? 0.7 : 1)))
      const runTarget = (exercise.miles ?? 0) * (roughDay ? 0.7 : 1)
      const isComplete = count >= target
      return <section className="card stretch-card exercise-card" key={exercise.key}><div className="stretch-mark">{exercise.key === 'stretch' ? '↗' : exercise.key === 'run' ? '⌁' : '＋'}</div><div className="exercise-copy"><p className="eyebrow">{exercise.key === 'stretch' ? 'DAILY RESET · 5 MIN' : 'TODAY'}</p><h3>{exercise.label}</h3><p className="secondary">{exercise.key === 'pushups' ? `${exercise.sets} sets × ${reps}${roughDay ? ' · rough day' : ''}` : exercise.key === 'core' ? `${exercise.sets} sets × ${reps} reps · plank target ${plankTarget}s${roughDay ? ' · rough day' : ''}` : exercise.key === 'run' ? `${runTarget.toFixed(1)} mile target · ${exercise.kind ?? 'easy'} run${roughDay ? ' · rough day' : ''}` : '5 minutes · checklist'}</p>{exercise.key === 'run' && <p className="pace-guidance">Easy pace {formatPace(exercise.paceSecondsPerMile)}{exercise.targetPaceSecondsPerMile ? ` · test pace ${formatPace(exercise.targetPaceSecondsPerMile)}` : ''}</p>}{exercise.key === 'core' && <div className="stepper"><button type="button" onClick={() => setPlankSeconds((seconds) => Math.max(1, seconds - 5))} aria-label="Reduce plank seconds">−</button><span>Log hold: {plankSeconds} sec</span><button type="button" onClick={() => setPlankSeconds((seconds) => seconds + 5)} aria-label="Add plank seconds">+</button></div>}{exercise.key === 'run' && <div className="run-inputs"><label>Distance (mi)<input type="number" min="0.1" step="0.1" value={runDistance} onChange={(event) => setRunDistance(event.target.value)} /></label><label>Time (min)<input type="number" min="1" step="0.1" value={runMinutes} onChange={(event) => setRunMinutes(event.target.value)} /></label></div>}<small>{count} / {target} complete</small></div><button className={isComplete ? 'check-button completed' : 'check-button'} onClick={() => void complete(exercise)} disabled={isComplete || busy} aria-label={`Log ${exercise.label}`}>{isComplete ? '✓' : '+'}</button></section>
    })}
    {notice && <p className="status-note" role="status">{notice}</p>}
    {restSeconds !== null && <div className="timer-banner"><span>Rest timer</span><strong>{Math.floor(restSeconds / 60)}:{String(restSeconds % 60).padStart(2, '0')}</strong><button onClick={() => setRestSeconds(null)}>Skip</button></div>}
    {lastAction.length > 0 && <button className="text-button" onClick={() => void undoLast()}>Undo last set</button>}
    <p className="yesterday">Yesterday <span>{yesterdayDay ? `${statusLabel(yesterdayDay.status)} · ${activitySummary(yesterdayDay)}` : 'No saved result yet'}</span></p>
    {settingsOpen && <SettingsSheet initial={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}
  </>
}

function History() {
  const [days, setDays] = useState<HistoryDay[]>(() => {
    try { return JSON.parse(localStorage.getItem('fitnessPrepHistoryCache') ?? '[]') as HistoryDay[] }
    catch { return [] }
  })
  const [loaded, setLoaded] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [noteMessage, setNoteMessage] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [timezone, setTimezone] = useState('America/Chicago')
  useEffect(() => {
    request<{ days: HistoryDay[] }>('/api/history').then((result) => {
      setDays(result.days); localStorage.setItem('fitnessPrepHistoryCache', JSON.stringify(result.days))
      setSelectedDate((current) => current ?? result.days[0]?.date ?? null)
    }).catch(() => {}).finally(() => setLoaded(true))
    request<{ settings: AppSettings }>('/api/settings').then((result) => setTimezone(result.settings.timezone)).catch(() => {})
  }, [])
  const selected = days.find((day) => day.date === selectedDate) ?? null
  useEffect(() => { if (!selectedDate && days[0]) setSelectedDate(days[0].date) }, [selectedDate, days])
  useEffect(() => { setNote(selected?.note ?? ''); setNoteMessage('') }, [selected?.date, selected?.note])
  const byDate = new Map(days.map((day) => [day.date, day]))
  const today = dateInTimezone(timezone)
  const cells = Array.from({ length: 56 }, (_, index) => {
    const date = new Date(`${today}T00:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() - 55 + index)
    const key = date.toISOString().slice(0, 10)
    return { date: key, day: byDate.get(key) }
  })
  const stats = streakSummary(days, today)
  const weekly = weeklyRepTotals(days, today)

  async function saveNote() {
    if (!selected) return
    setSavingNote(true); setNoteMessage('')
    try {
      await saveDayNote(selected.date, note)
      const updated = days.map((day) => day.date === selected.date ? { ...day, note: note.trim() } : day)
      setDays(updated); localStorage.setItem('fitnessPrepHistoryCache', JSON.stringify(updated)); setNoteMessage('Note saved.')
    } catch { setNoteMessage('Could not save the note. Try again when you’re online.') }
    finally { setSavingNote(false) }
  }

  return <>
    <header className="topbar"><span className="eyebrow">FITNESS PREP</span></header>
    <section className="history-title"><p className="eyebrow">YOUR TRAINING LOG</p><h1>History</h1></section>
    <div className="streak-cards"><section className="card streak-card"><p className="eyebrow">CURRENT STREAK</p><strong>{stats.current}</strong><span>days</span></section><section className="card streak-card"><p className="eyebrow">LONGEST STREAK</p><strong>{stats.longest}</strong><span>days</span></section></div>
    <section className="history-section"><div className="history-section-heading"><h2>Recent days</h2><span>Last 8 weeks</span></div>
      <div className="heat-strip" aria-label="Recent activity calendar">{cells.map(({ date, day }) => <button key={date} type="button" disabled={!day} className={`heat-cell ${heatStatus(day)}`} title={`${date}: ${day ? statusLabel(day.status) : 'No saved plan'}`} aria-label={`${date}: ${day ? statusLabel(day.status) : 'No saved plan'}`} onClick={() => day && setSelectedDate(date)} />)}</div>
      <div className="heat-legend"><span><i className="complete" />Complete</span><span><i className="partial" />Partial</span><span><i className="rest" />Rest</span><span><i className="missed" />Missed</span><span><i className="rough" />Rough</span></div>
    </section>
    <section className="card chart-card"><div className="history-section-heading"><div><h2>Weekly volume</h2><p>Push-up and core reps completed</p></div></div><WeeklyChart data={weekly} /></section>
    <section className="history-section"><div className="history-section-heading"><h2>All days</h2><span>{days.length} saved</span></div>
      {!loaded && days.length === 0 ? <p className="empty-hint">Loading your history…</p> : days.length === 0 ? <p className="empty-hint">No saved days yet. Your daily activity will appear here.</p> : <div className="history-list">{days.map((day) => <button type="button" key={day.date} className={`history-entry ${selectedDate === day.date ? 'selected' : ''}`} onClick={() => setSelectedDate(day.date)}><span className={`status-dot ${heatStatus(day)}`} /><span className="entry-copy"><strong>{formatDate(day.date)}</strong><small>{activitySummary(day)}</small></span><span className="entry-status">{statusLabel(day.status)}</span><span className="chevron">›</span></button>)}</div>}
    </section>
    {selected && <section className="card day-detail"><div className="history-section-heading"><div><p className="eyebrow">DAY DETAILS</p><h2>{formatDate(selected.date)}</h2></div><span className={`status-pill ${heatStatus(selected)}`}>{statusLabel(selected.status)}</span></div>
      {selected.plan ? <PlanComparison day={selected} /> : <p className="empty-hint">No plan snapshot was saved for this day. Completed activity is listed below.</p>}
      <CompletedSummary sets={selected.sets} />
      <label className="note-label">Notes<textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note about this day…" /></label><div className="note-actions"><span>{noteMessage || `${note.length}/500`}</span><button className="small-button" onClick={() => void saveNote()} disabled={savingNote}>{savingNote ? 'Saving…' : 'Save note'}</button></div>
    </section>}
    <p className="yesterday">History is saved to your private training log.</p>
  </>
}

type SavedPlan = { restDay?: boolean; exercises?: PlannedExercise[] }
function PlanComparison({ day }: { day: HistoryDay }) {
  const plan = day.plan as SavedPlan
  return <div className="plan-comparison">{(plan.exercises ?? []).map((exercise, index) => {
    const exercises = exercise.key === 'core' ? ['situps', 'crunches', 'plank'] : exercise.key === 'run' ? ['run', 'run_time'] : [exercise.key]
    const records = day.sets.filter((set) => !set.undone && exercises.includes(set.exercise))
    const planned = exercise.key === 'pushups' || exercise.key === 'core' ? `${exercise.sets ?? 0} sets × ${exercise.reps ?? 0}${exercise.key === 'core' ? ` reps · plank ${exercise.seconds ?? 0}s` : ''}` : exercise.key === 'run' ? `${exercise.miles?.toFixed(1) ?? '—'} mi · ${exercise.kind ?? 'run'}` : `${exercise.minutes ?? 5} min`
    const completed = records.length ? records.map((set) => `${set.value}${set.unit === 'reps' ? ' reps' : set.unit === 'seconds' ? ' sec' : set.unit === 'miles' ? ' mi' : ' min'}`).join(' · ') : 'Nothing logged'
    return <div className="comparison-row" key={`${exercise.key}-${index}`}><strong>{exercise.label}</strong><span><small>Planned</small>{planned}</span><span><small>Completed</small>{completed}</span></div>
  })}</div>
}
function CompletedSummary({ sets }: { sets: SetRecord[] }) {
  const groups = new Map<string, number>()
  for (const set of sets.filter((item) => !item.undone)) groups.set(set.exercise, (groups.get(set.exercise) ?? 0) + set.value)
  if (groups.size === 0) return <p className="empty-hint">No activity was logged.</p>
  return <div className="completed-summary">{[...groups].map(([exercise, total]) => <span key={exercise}>{exercise.replace('_', ' ')} <strong>{Number.isInteger(total) ? total : total.toFixed(1)}</strong></span>)}</div>
}
function WeeklyChart({ data }: { data: Array<{ label: string; reps: number }> }) {
  const max = Math.max(1, ...data.map((week) => week.reps))
  return <svg className="weekly-chart" viewBox="0 0 320 118" role="img" aria-label="Weekly strength repetitions"><line x1="10" y1="88" x2="310" y2="88" stroke="currentColor" opacity=".15" />{data.map((week, index) => {
    const height = week.reps ? Math.max(3, (week.reps / max) * 62) : 0
    const x = 20 + index * 38
    return <g key={`${week.label}-${index}`}><rect x={x} y={88 - height} width="22" height={height} rx="7" fill="var(--accent)" opacity={week.reps ? '.82' : '.12'} /><text x={x + 11} y="106" textAnchor="middle">{week.label}</text></g>
  })}</svg>
}
function heatStatus(day: HistoryDay | undefined) {
  if (!day) return 'empty'
  return day.status === 'complete' ? 'complete' : day.status === 'partial' ? 'partial' : day.status === 'rest' ? 'rest' : day.status === 'missed' ? 'missed' : day.status === 'rough' ? 'rough' : 'pending'
}
function statusLabel(status: string) {
  return status === 'complete' ? 'Complete' : status === 'partial' ? 'Partial' : status === 'rest' ? 'Rest' : status === 'missed' ? 'Missed' : status === 'rough' ? 'Rough day' : 'In progress'
}
function activitySummary(day: HistoryDay) {
  const active = day.sets.filter((set) => !set.undone)
  if (!active.length) return day.plan ? 'No sets logged' : 'No saved activity'
  const reps = active.filter((set) => set.unit === 'reps').reduce((sum, set) => sum + set.value, 0)
  const run = active.filter((set) => set.exercise === 'run').reduce((sum, set) => sum + set.value, 0)
  return [reps ? `${reps} reps` : '', run ? `${run.toFixed(1)} mi run` : '', `${active.length} entries`].filter(Boolean).join(' · ')
}
function formatDate(date: string) { return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) }
function streakSummary(days: HistoryDay[], today: string) {
  const byDate = new Map(days.map((day) => [day.date, day.status]))
  const keeps = (date: string) => ['complete', 'rest', 'rough'].includes(byDate.get(date) ?? '')
  let longest = 0, run = 0, previous: string | null = null
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const prior = new Date(`${day.date}T00:00:00.000Z`); prior.setUTCDate(prior.getUTCDate() - 1)
    if (keeps(day.date)) run = previous === prior.toISOString().slice(0, 10) ? run + 1 : 1
    else run = 0
    longest = Math.max(longest, run); previous = day.date
  }
  let cursor = keeps(today) ? today : shiftDate(today, -1)
  let current = 0
  while (keeps(cursor)) { current++; cursor = shiftDate(cursor, -1) }
  return { current, longest }
}
function shiftDate(date: string, amount: number) { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10) }
function weeklyRepTotals(days: HistoryDay[], today: string) {
  const todayDate = new Date(`${today}T00:00:00.000Z`)
  const offset = (todayDate.getUTCDay() + 6) % 7
  const thisMonday = new Date(todayDate); thisMonday.setUTCDate(todayDate.getUTCDate() - offset)
  return Array.from({ length: 8 }, (_, index) => {
    const weekStart = new Date(thisMonday); weekStart.setUTCDate(thisMonday.getUTCDate() - (7 - index) * 7)
    const startKey = weekStart.toISOString().slice(0, 10)
    const reps = days.filter((day) => day.date >= startKey && day.date < shiftDate(startKey, 7)).flatMap((day) => day.sets).filter((set) => !set.undone && set.unit === 'reps').reduce((sum, set) => sum + set.value, 0)
    return { label: startKey.slice(5), reps }
  })
}

type MaxTest = { id: string; date: string; metrics: Record<string, number | null> }
type ScoreInputs = { pushups: string; coreMetric: 'situps' | 'crunches'; coreValue: string; plankSeconds: string; runTime: string }
const loadedScoringData = scoringFile as unknown as ScoringData
function scoreInputsFrom(metrics: Record<string, number | null> | undefined, settings: AppSettings): ScoreInputs {
  const coreMetric = metrics?.crunches != null && metrics.situps == null ? 'crunches' : 'situps'
  const coreFallback = coreMetric === 'situps' ? settings.baselines.situps : null
  return {
    pushups: String(metrics?.pushups ?? settings.baselines.pushups ?? ''),
    coreMetric,
    coreValue: String(metrics?.[coreMetric] ?? coreFallback ?? ''),
    plankSeconds: String(metrics?.plankSeconds ?? settings.baselines.plankSeconds ?? ''),
    runTime: formatRunTime(metrics?.runTimeSeconds ?? settings.baselines.runTimeSeconds ?? null),
  }
}
function Score() {
  const [settings, setSettings] = useState(defaultSettings)
  const [tests, setTests] = useState<MaxTest[]>([])
  const [inputs, setInputs] = useState<ScoreInputs>(() => scoreInputsFrom(undefined, defaultSettings))
  const [result, setResult] = useState<ScoreResult | null>(null)
  const [message, setMessage] = useState('')
  const [savingTest, setSavingTest] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [today, setToday] = useState(localIso())
  const dataLoaded = isScoringDataLoaded(loadedScoringData)
  useEffect(() => {
    Promise.all([request<{ settings: AppSettings }>('/api/settings'), request<{ tests: MaxTest[] }>('/api/tests')]).then(([savedSettings, savedTests]) => {
      setSettings(savedSettings.settings)
      setTests(savedTests.tests)
      setToday(dateInTimezone(savedSettings.settings.timezone))
      setInputs(scoreInputsFrom(savedTests.tests[0]?.metrics, savedSettings.settings))
    }).catch(() => setMessage('Could not load saved tests or settings. Check your connection.'))
  }, [])

  function metricPayload(): Record<string, number | null> {
    const parsedRun = inputs.runTime === '' ? null : parseRunTime(inputs.runTime)
    return {
      pushups: inputs.pushups === '' ? null : Number(inputs.pushups),
      [inputs.coreMetric]: inputs.coreValue === '' ? null : Number(inputs.coreValue),
      plankSeconds: inputs.plankSeconds === '' ? null : Number(inputs.plankSeconds),
      runTimeSeconds: parsedRun,
    }
  }
  function validMetrics(metrics: Record<string, number | null>) {
    return Object.values(metrics).every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
  }
  async function calculate() {
    if (!dataLoaded) { setMessage('Scoring data not loaded. No standards have been entered yet.'); return }
    if (!settings.ageBracket || !settings.sex) { setMessage('Set your age bracket and sex category in Settings first.'); return }
    const metrics = metricPayload()
    if (!validMetrics(metrics)) { setMessage('Enter all four test measurements to calculate your score.'); return }
    setCalculating(true); setMessage('')
    try {
      const score = await request<ScoreResult>('/api/score', 'POST', { metrics, coreMetric: inputs.coreMetric })
      setResult(score)
      if (score.reason === 'profile_not_found') setMessage('Your Settings age bracket and sex category do not match a record in the official scoring file.')
    } catch (error) {
      setMessage(error instanceof ApiError && error.status === 503 ? 'Scoring data not loaded. No score or training target was generated.' : 'Could not calculate this score. Check your saved scoring profile.')
    } finally { setCalculating(false) }
  }
  async function logTest() {
    const metrics = metricPayload()
    if (!validMetrics(metrics)) { setMessage('Enter all four measurements before logging a max test.'); return }
    setSavingTest(true); setMessage('')
    try {
      const saved = await request<MaxTest>('/api/tests', 'POST', { date: today, metrics })
      const updated = [saved, ...tests]
      setTests(updated); setInputs(scoreInputsFrom(saved.metrics, settings)); setResult(null); setMessage('Max test saved.')
    } catch { setMessage('Could not save your max test. Try again when you’re online.') }
    finally { setSavingTest(false) }
  }
  function update(field: keyof ScoreInputs, value: string) { setInputs((old) => ({ ...old, [field]: value })); setResult(null) }

  return <>
    <header className="topbar"><span className="eyebrow">FITNESS PREP</span></header>
    <section className="score-title"><p className="eyebrow">YOUR TEST PROFILE</p><h1>Score</h1><p className="secondary">{settings.ageBracket || 'Age bracket not set'} · {settings.sex || 'sex category not set'}</p></section>
    {!dataLoaded && <div className="scoring-unavailable"><span>◉</span><div><strong>Scoring data not loaded</strong><p>The official table has not been added yet, so the app won’t show sample or guessed scores. You can still save a max test.</p></div></div>}
    <section className="card score-form"><h2>Test results</h2><div className="score-input-grid"><label>Push-ups<input type="number" min="1" inputMode="numeric" value={inputs.pushups} onChange={(event) => update('pushups', event.target.value)} /></label><label>Core event<select value={inputs.coreMetric} onChange={(event) => { const coreMetric = event.target.value as 'situps' | 'crunches'; setInputs((old) => ({ ...old, coreMetric, coreValue: '' })); setResult(null) }}><option value="situps">Sit-ups</option><option value="crunches">Cross-leg reverse crunches</option></select></label><label>{inputs.coreMetric === 'situps' ? 'Sit-ups' : 'Cross-leg reverse crunches'}<input type="number" min="1" inputMode="numeric" value={inputs.coreValue} onChange={(event) => update('coreValue', event.target.value)} /></label><label>Plank (seconds)<input type="number" min="1" inputMode="numeric" value={inputs.plankSeconds} onChange={(event) => update('plankSeconds', event.target.value)} /></label><label>1.5-mile time (mm:ss)<input type="text" inputMode="numeric" placeholder="14:30" value={inputs.runTime} onChange={(event) => update('runTime', event.target.value)} /></label></div><div className="score-actions"><button className="primary-button" onClick={() => void calculate()} disabled={!dataLoaded || calculating}>{calculating ? 'Calculating…' : 'Calculate score'}</button><button className="secondary-button" onClick={() => void logTest()} disabled={savingTest}>{savingTest ? 'Saving…' : 'Log a max test'}</button></div>{message && <p className="status-note" role="status">{message}</p>}</section>
    {result && <section className="card score-result"><div className="composite-row"><div><p className="eyebrow">COMPOSITE SCORE</p><strong>{result.composite ?? '—'}</strong><span>{result.passingComposite !== null ? ` / ${result.passingComposite} to pass` : ''}</span></div><span className={`pass-badge ${result.passed === true ? 'passed' : result.passed === false ? 'not-passed' : ''}`}>{result.passed === true ? 'PASS' : result.passed === false ? 'NOT YET' : 'INCOMPLETE'}</span></div>{result.components.map((component) => <div className="score-component" key={component.name}><div><strong>{component.name}</strong><span>{component.points === null ? 'Outside the supplied point ranges' : `${component.points} points`}</span></div><p>{gapText(component.gapToPassing, component, 'pass')} <span>·</span> {gapText(component.gapToOverPrep, component, 'target')}</p></div>)}</section>}
    <section className="history-section score-tests"><div className="history-section-heading"><h2>Max test history</h2><span>{tests.length} saved</span></div>{tests.length === 0 ? <p className="empty-hint">Logged tests will appear here as a simple trend list.</p> : <div className="history-list">{tests.map((test) => <div className="history-entry test-entry" key={test.id}><span className="entry-copy"><strong>{formatDate(test.date)}</strong><small>{test.metrics.pushups ?? '—'} push-ups · {test.metrics[inputs.coreMetric] ?? '—'} {inputs.coreMetric === 'situps' ? 'sit-ups' : 'crunches'} · {test.metrics.plankSeconds ?? '—'}s plank · {test.metrics.runTimeSeconds ? formatRunTime(test.metrics.runTimeSeconds) : '—'} run</small></span></div>)}</div>}</section>
  </>
}
function gapText(gap: number | null, component: ScoreResult['components'][number], kind: 'pass' | 'target') {
  const target = kind === 'pass' ? 'passing minimum' : 'over-prepared target'
  if (gap === null) return `${target}: —`
  if (gap === 0) return `${kind === 'pass' ? 'Meets' : 'At'} ${target}`
  const amount = Number.isInteger(gap) ? String(gap) : gap.toFixed(1)
  if (component.name === '1.5-mile run') return `Need ${formatRunTime(Math.ceil(gap))} faster for ${target}`
  return `Need ${amount} ${component.unit} more for ${target}`
}

function SettingsSheet({ initial, onClose, onSave }: { initial: AppSettings; onClose: () => void; onSave: (value: AppSettings) => Promise<void> }) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [runTimeText, setRunTimeText] = useState(formatRunTime(initial.baselines.runTimeSeconds))
  function numberField(key: keyof AppSettings['baselines'], raw: string) {
    setValue((old) => ({ ...old, baselines: { ...old.baselines, [key]: raw === '' ? null : Number(raw) } }))
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('')
    const parsedTime = runTimeText === '' ? null : parseRunTime(runTimeText)
    if (runTimeText !== '' && parsedTime === null) { setError('Enter your 1.5-mile time as minutes:seconds, for example 14:30.'); setSaving(false); return }
    try { await onSave({ ...value, baselines: { ...value.baselines, runTimeSeconds: parsedTime } }) } catch { setError('Could not save these settings. Check the values and try again.') }
    finally { setSaving(false) }
  }
  return <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="settings-sheet card" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header className="sheet-header"><div><p className="eyebrow">PERSONALIZE</p><h2 id="settings-title">Settings</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">×</button></header><form onSubmit={(event) => void submit(event)}>
    <label>Ship date<input type="date" value={value.shipDate} onChange={(event) => setValue({ ...value, shipDate: event.target.value })} /></label>
    <label>Timezone<input value={value.timezone} onChange={(event) => setValue({ ...value, timezone: event.target.value })} required /></label>
    <label>Morning message time<input type="time" value={value.morningMessageTime} onChange={(event) => setValue({ ...value, morningMessageTime: event.target.value })} required /></label>
    <p className="settings-group-title">Baseline measurements</p>
    <div className="settings-grid"><label>Push-ups<input type="number" min="1" value={value.baselines.pushups ?? ''} onChange={(event) => numberField('pushups', event.target.value)} /></label><label>Sit-ups / crunches<input type="number" min="1" value={value.baselines.situps ?? ''} onChange={(event) => numberField('situps', event.target.value)} /></label><label>Plank seconds<input type="number" min="1" value={value.baselines.plankSeconds ?? ''} onChange={(event) => numberField('plankSeconds', event.target.value)} /></label><label>1.5-mile time (mm:ss)<input type="text" inputMode="numeric" placeholder="14:30" value={runTimeText} onChange={(event) => setRunTimeText(event.target.value)} /></label></div>
    <p className="settings-group-title">Scoring profile</p><label>Age bracket<input value={value.ageBracket} onChange={(event) => setValue({ ...value, ageBracket: event.target.value })} placeholder="Set from official scoring table" /></label><label>Sex category<input value={value.sex} onChange={(event) => setValue({ ...value, sex: event.target.value })} placeholder="Set from official scoring table" /></label><label>Over-prepared target multiplier<input type="number" min="1" max="3" step="0.05" value={value.overPrepMultiplier} onChange={(event) => setValue({ ...value, overPrepMultiplier: Number(event.target.value) })} /></label>
    <label className="toggle-row"><span>Rest timer</span><input type="checkbox" checked={value.restTimerEnabled} onChange={(event) => setValue({ ...value, restTimerEnabled: event.target.checked })} /></label><label className="toggle-row"><span>Telegram messages</span><input type="checkbox" checked={value.telegramEnabled} onChange={(event) => setValue({ ...value, telegramEnabled: event.target.checked })} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
  </form></section></div>
}

function Empty({ title, copy, icon }: { title: string; copy: string; icon: string }) {
  return <><header className="topbar"><span className="eyebrow">FITNESS PREP</span></header><section className="empty-state"><span className="empty-icon">{icon}</span><h1>{title}</h1><p>{copy}</p></section></>
}

export default App
