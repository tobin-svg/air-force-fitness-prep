import scoringFile from '../data/scoring.json'
import { calculateScore, isScoringDataLoaded, type ScoringData } from '../src/engine/scoring.ts'
import { calculateStreak, generatePlan } from '../src/engine/plan.ts'
import type { DayPlan } from '../src/engine/types.ts'
import { formatCountdown, formatPlan, formatYesterday, localDateAndTime, motivationalLine, shiftDate } from './telegram.ts'

interface Env {
  DB: D1Database
  ASSETS: Fetcher
  PASS_PHRASE: string
  SESSION_SECRET: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

type Settings = {
  shipDate: string
  timezone: string
  morningMessageTime: string
  baselines: { pushups: number | null; situps: number | null; crunches: number | null; plankSeconds: number | null; runTimeSeconds: number | null }
  ageBracket: string
  sex: string
  overPrepMultiplier: number
  restTimerEnabled: boolean
  restTimerSeconds: number
  telegramEnabled: boolean
}

const defaults: Settings = {
  shipDate: '2027-02-01', timezone: 'America/Chicago', morningMessageTime: '06:30',
  baselines: { pushups: null, situps: null, crunches: null, plankSeconds: null, runTimeSeconds: null },
  ageBracket: 'Under 25', sex: 'M', overPrepMultiplier: 1.25, restTimerEnabled: true, restTimerSeconds: 60, telegramEnabled: false,
}
const cookieName = 'fitness_prep_session'
const oneYearSeconds = 60 * 60 * 24 * 365
const exercises = new Set(['pushups', 'situps', 'crunches', 'plank', 'run', 'run_time', 'stretch'])
const units: Record<string, string> = { pushups: 'reps', situps: 'reps', crunches: 'reps', plank: 'seconds', run: 'miles', run_time: 'seconds', stretch: 'minutes' }

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}
function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function dateInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const binary = String.fromCharCode(...data)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
function fromB64url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
}
function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let difference = a.length ^ b.length
  for (let i = 0; i < length; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return difference === 0
}
async function hasSession(request: Request, secret: string): Promise<boolean> {
  const cookieHeader = request.headers.get('Cookie') ?? ''
  const item = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))
  if (!item || !secret) return false
  const [payload, signature] = item.slice(cookieName.length + 1).split('.')
  if (!payload || !signature) return false
  try {
    const decoded = new TextDecoder().decode(fromB64url(payload))
    const [expiry, nonce] = decoded.split(':')
    if (!expiry || !nonce || Number(expiry) < Date.now()) return false
    return constantTimeEqual(signature, await sign(decoded, secret))
  } catch { return false }
}
async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const contentLength = Number(request.headers.get('Content-Length') ?? 0)
    if (contentLength > 16_384) return null
    const body: unknown = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  } catch { return null }
}
async function getSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare('SELECT settings_json FROM settings WHERE id = 1').first<{ settings_json: string }>()
  if (!row) return defaults
  try {
    const saved = JSON.parse(row.settings_json)
    const oldBaselineFormat = !Object.hasOwn(saved.baselines ?? {}, 'crunches')
    const settings = { ...defaults, ...saved, baselines: { ...defaults.baselines, ...saved.baselines } }
    if (!settings.shipDate) settings.shipDate = defaults.shipDate
    if (!settings.ageBracket) settings.ageBracket = defaults.ageBracket
    if (!settings.sex) settings.sex = defaults.sex
    if (oldBaselineFormat) settings.baselines.runTimeSeconds = null
    return settings
  }
  catch { return defaults }
}
async function ensureTodayPlan(db: D1Database, settings: Settings, date: string): Promise<{ plan: DayPlan | null; warning: string | null }> {
  const saved = await db.prepare('SELECT plan_json, status FROM days WHERE date = ?').bind(date).first<{ plan_json: string | null; status: string }>()
  if (saved?.plan_json) {
    const existing = JSON.parse(saved.plan_json) as DayPlan
    if (existing.planVersion === 2 || saved.status === 'complete' || saved.status === 'rest') return { plan: existing, warning: null }
    await db.prepare('UPDATE days SET plan_json = NULL WHERE date = ?').bind(date).run()
  }
  const data = scoringFile as unknown as ScoringData
  if (!isScoringDataLoaded(data)) return { plan: null, warning: 'Scoring data not loaded. Add the verified official table before generating training targets.' }
  const record = data.records.find((item) => item.ageBracket === settings.ageBracket && item.sex === settings.sex)
  if (!record) return { plan: null, warning: 'Your Settings age bracket and sex category do not match a scoring record.' }
  const core = record.components.situps ? 'situps' : 'crunches'
  const baseline = settings.baselines
  if (![baseline.pushups, baseline.situps, baseline.crunches, baseline.plankSeconds, baseline.runTimeSeconds].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
    return { plan: null, warning: 'Add your baseline results for push-ups, sit-ups, cross-leg reverse crunches, plank, and 2-mile run in Settings to generate your plan.' }
  }
  if (!settings.shipDate) return { plan: null, warning: 'Add your ship date in Settings to generate your plan.' }
  if (date > settings.shipDate) return { plan: null, warning: 'Your ship date has passed. Update it in Settings to generate a new plan.' }
  const firstDay = await db.prepare('SELECT MIN(date) AS date FROM days WHERE date <= ?').bind(date).first<{ date: string | null }>()
  const generated = generatePlan({
    startDate: firstDay?.date ?? date,
    shipDate: settings.shipDate,
    baseline: { pushups: baseline.pushups!, situps: baseline.situps!, crunches: baseline.crunches!, plankSeconds: baseline.plankSeconds!, runTimeSeconds: baseline.runTimeSeconds! },
    passing: {
      pushups: record.components.pushups!.minimum,
      situps: record.components[core]!.minimum,
      crunches: record.components.crunches!.minimum,
      plankSeconds: record.components.plank!.minimum,
      runTimeSeconds: record.components.run!.minimum,
    },
    overPrepMultiplier: settings.overPrepMultiplier,
  }, date)
  const plan = generated.days.find((item) => item.date === date)
  if (!generated.ready || !plan) return { plan: null, warning: generated.warning ?? 'The saved ship date is before the start of this training plan.' }
  await db.prepare('UPDATE days SET plan_json = ? WHERE date = ? AND plan_json IS NULL').bind(JSON.stringify(plan), date).run()
  const savedPlan = await db.prepare('SELECT plan_json FROM days WHERE date = ?').bind(date).first<{ plan_json: string | null }>()
  return { plan: savedPlan?.plan_json ? JSON.parse(savedPlan.plan_json) as DayPlan : plan, warning: generated.warning ?? null }
}
function validSettings(value: Record<string, unknown>): value is Record<string, unknown> & Settings {
  if (typeof value.shipDate !== 'string' || (value.shipDate !== '' && !isDate(value.shipDate))) return false
  if (typeof value.timezone !== 'string' || value.timezone.length > 100) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }) } catch { return false }
  if (typeof value.morningMessageTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.morningMessageTime)) return false
  if (!value.baselines || typeof value.baselines !== 'object') return false
  const baselines = value.baselines as Record<string, unknown>
  for (const key of ['pushups', 'situps', 'crunches', 'plankSeconds', 'runTimeSeconds']) {
    const metric = baselines[key]
    if (metric !== null && (typeof metric !== 'number' || !Number.isFinite(metric) || metric <= 0 || metric > 100_000)) return false
  }
  if (typeof value.ageBracket !== 'string' || value.ageBracket.length > 40 || typeof value.sex !== 'string' || value.sex.length > 40) return false
  if (typeof value.overPrepMultiplier !== 'number' || !Number.isFinite(value.overPrepMultiplier) || value.overPrepMultiplier < 1 || value.overPrepMultiplier > 3) return false
  return typeof value.restTimerEnabled === 'boolean' && typeof value.restTimerSeconds === 'number' && Number.isInteger(value.restTimerSeconds) && value.restTimerSeconds >= 15 && value.restTimerSeconds <= 300 && typeof value.telegramEnabled === 'boolean'
}
function validMetric(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000 }

async function sendMorningTelegram(env: Env, instant: Date) {
  const settings = await getSettings(env.DB)
  if (!settings.telegramEnabled || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return
  const local = localDateAndTime(settings.timezone, instant)
  if (local.time !== settings.morningMessageTime) return
  const yesterdayDate = shiftDate(local.date, -1)
  await env.DB.prepare("INSERT OR IGNORE INTO days (date, plan_json, status) VALUES (?, NULL, 'pending')").bind(local.date).run()
  const currentPlan = await ensureTodayPlan(env.DB, settings, local.date)
  const [daysResult, yesterdayResult, streakResult] = await Promise.all([
    env.DB.prepare('SELECT date, plan_json FROM days WHERE date = ?').bind(local.date).first<{ date: string; plan_json: string | null }>(),
    env.DB.prepare('SELECT status FROM days WHERE date = ?').bind(yesterdayDate).first<{ status: string }>(),
    env.DB.prepare('SELECT date, status FROM days WHERE date <= ? ORDER BY date DESC LIMIT 365').bind(local.date).all<{ date: string; status: 'complete' | 'partial' | 'missed' | 'rest' | 'rough' | 'pending' }>(),
  ])
  const yesterdaySets = await env.DB.prepare('SELECT exercise, value, unit, undone FROM sets WHERE date = ? ORDER BY timestamp').bind(yesterdayDate).all<{ exercise: string; value: number; unit: string; undone: number }>()
  const streakRows = streakResult.results.filter((row) => !(row.date === local.date && row.status === 'pending'))
  const streak = calculateStreak(streakRows.map((row) => row.status === 'pending' ? 'missed' : row.status))
  const yesterday = yesterdayResult ? { status: yesterdayResult.status, sets: yesterdaySets.results } : undefined
  const message = [
    formatCountdown(settings.shipDate, local.date),
    formatPlan(daysResult?.plan_json ?? (currentPlan.plan ? JSON.stringify(currentPlan.plan) : null)),
    formatYesterday(yesterday),
    `Current streak: ${streak} day${streak === 1 ? '' : 's'}`,
    motivationalLine(local.date),
  ].join('\n\n')
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO message_log (date, sent_at) VALUES (?, ?)').bind(local.date, instant.toISOString()).run()
  if (!claim.meta.changes) return
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }),
    })
    const result = await response.json() as { ok?: boolean }
    if (!response.ok || result.ok !== true) throw new Error(`Telegram sendMessage failed (${response.status})`)
  } catch (error) {
    await env.DB.prepare('DELETE FROM message_log WHERE date = ?').bind(local.date).run()
    throw error
  }
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  if (path === '/api/login' && request.method === 'POST') {
    if (!env.PASS_PHRASE || !env.SESSION_SECRET) return json({ error: 'auth_not_configured' }, 503)
    const body = await readJson(request)
    if (!body || typeof body.passphrase !== 'string' || body.passphrase.length > 512 || !constantTimeEqual(body.passphrase, env.PASS_PHRASE)) return json({ error: 'invalid_passphrase' }, 401)
    const payload = `${Date.now() + oneYearSeconds * 1000}:${crypto.randomUUID()}`
    const token = `${b64url(new TextEncoder().encode(payload))}.${await sign(payload, env.SESSION_SECRET)}`
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${oneYearSeconds}` } })
  }
  if (!await hasSession(request, env.SESSION_SECRET)) return json({ error: 'unauthorized' }, 401)

  if (path === '/api/settings' && request.method === 'GET') return json({ settings: await getSettings(env.DB) })
  if (path === '/api/settings' && request.method === 'PUT') {
    const body = await readJson(request)
    if (!body || !body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings) || !validSettings(body.settings as Record<string, unknown>)) return json({ error: 'invalid_settings' }, 400)
    const settings = body.settings as Record<string, any>
    await env.DB.prepare('INSERT INTO settings (id, settings_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at').bind(JSON.stringify(settings), new Date().toISOString()).run()
    const today = dateInZone(settings.timezone)
    await env.DB.prepare("UPDATE days SET plan_json = NULL WHERE date >= ? AND status IN ('pending', 'partial', 'rough')").bind(today).run()
    return json({ settings })
  }
  if (path === '/api/today' && request.method === 'GET') {
    const settings = await getSettings(env.DB)
    const date = dateInZone(settings.timezone)
    await env.DB.prepare("INSERT OR IGNORE INTO days (date, plan_json, status) VALUES (?, NULL, 'pending')").bind(date).run()
    const planState = await ensureTodayPlan(env.DB, settings, date)
    const day = await env.DB.prepare('SELECT date, plan_json, status, rough_day, note FROM days WHERE date = ?').bind(date).first<{ date: string; plan_json: string | null; status: string; rough_day: number; note: string | null }>()
    const logged = await env.DB.prepare('SELECT id, exercise, value, unit, timestamp, undone FROM sets WHERE date = ? ORDER BY timestamp').bind(date).all()
    return json({ date, settings, day: day && { ...day, plan: day.plan_json ? JSON.parse(day.plan_json) : null }, planWarning: planState.warning, sets: logged.results })
  }
  if (path === '/api/log-set' && request.method === 'POST') {
    const body = await readJson(request)
    if (!body || !isDate(body.date) || typeof body.exercise !== 'string' || !exercises.has(body.exercise) || !validMetric(body.value) || body.unit !== units[body.exercise]) return json({ error: 'invalid_set' }, 400)
    if (body.date > dateInZone((await getSettings(env.DB)).timezone)) return json({ error: 'set_cannot_be_future' }, 400)
    const now = new Date().toISOString()
    const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : crypto.randomUUID()
    await env.DB.prepare("INSERT OR IGNORE INTO days (date, plan_json, status) VALUES (?, NULL, 'partial')").bind(body.date).run()
    await env.DB.prepare("INSERT OR IGNORE INTO sets (id, date, exercise, value, unit, timestamp, undone) VALUES (?, ?, ?, ?, ?, ?, 0)").bind(id, body.date, body.exercise, body.value, body.unit, now).run()
    await env.DB.prepare("UPDATE days SET status = CASE WHEN status = 'pending' THEN 'partial' ELSE status END WHERE date = ?").bind(body.date).run()
    return json({ id, date: body.date, exercise: body.exercise, value: body.value, unit: body.unit, timestamp: now }, 201)
  }
  if (path === '/api/undo-set' && request.method === 'POST') {
    const body = await readJson(request)
    if (!body || typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return json({ error: 'invalid_set_id' }, 400)
    const result = await env.DB.prepare('UPDATE sets SET undone = 1 WHERE id = ? AND undone = 0 AND id = (SELECT id FROM sets WHERE undone = 0 ORDER BY timestamp DESC, rowid DESC LIMIT 1)').bind(body.id).run()
    return result.meta.changes ? json({ ok: true }) : json({ error: 'set_not_found' }, 404)
  }
  if (path === '/api/rough-day' && request.method === 'POST') {
    const body = await readJson(request)
    if (!body || !isDate(body.date)) return json({ error: 'invalid_date' }, 400)
    const settings = await getSettings(env.DB)
    if (body.date > dateInZone(settings.timezone)) return json({ error: 'rough_day_cannot_be_future' }, 400)
    const existing = await env.DB.prepare('SELECT date FROM days WHERE date = ?').bind(body.date).first()
    if (!existing) return json({ error: 'day_not_found' }, 404)
    await env.DB.prepare("UPDATE days SET rough_day = 1, status = 'rough' WHERE date = ?").bind(body.date).run()
    return json({ ok: true, date: body.date, roughDay: true })
  }
  if (path === '/api/day-status' && request.method === 'POST') {
    const body = await readJson(request)
    if (!body || !isDate(body.date) || !['complete', 'partial', 'rest'].includes(String(body.status))) return json({ error: 'invalid_day_status' }, 400)
    const settings = await getSettings(env.DB)
    if (body.date > dateInZone(settings.timezone)) return json({ error: 'status_cannot_be_for_future' }, 400)
    const day = await env.DB.prepare('SELECT rough_day FROM days WHERE date = ?').bind(body.date).first<{ rough_day: number }>()
    if (!day) return json({ error: 'day_not_found' }, 404)
    await env.DB.prepare("UPDATE days SET status = CASE WHEN rough_day = 1 THEN 'rough' ELSE ? END WHERE date = ?").bind(body.status, body.date).run()
    return json({ ok: true, date: body.date, status: day.rough_day ? 'rough' : body.status })
  }
  if (path === '/api/day-note' && request.method === 'POST') {
    const body = await readJson(request)
    if (!body || !isDate(body.date) || typeof body.note !== 'string' || body.note.length > 500) return json({ error: 'invalid_note' }, 400)
    const result = await env.DB.prepare('UPDATE days SET note = ? WHERE date = ?').bind(body.note.trim(), body.date).run()
    return result.meta.changes ? json({ ok: true, date: body.date }) : json({ error: 'day_not_found' }, 404)
  }
  if (path === '/api/history' && request.method === 'GET') {
    const days = await env.DB.prepare('SELECT date, plan_json, status, rough_day, note FROM days ORDER BY date DESC LIMIT 365').all()
    if (days.results.length === 0) return json({ days: [] })
    const oldest = String(days.results[days.results.length - 1].date)
    const sets = await env.DB.prepare('SELECT id, date, exercise, value, unit, timestamp, undone FROM sets WHERE date >= ? ORDER BY date DESC, timestamp DESC LIMIT 5000').bind(oldest).all()
    const today = dateInZone((await getSettings(env.DB)).timezone)
    const byDate = new Map<string, unknown[]>()
    for (const set of sets.results) {
      const date = String(set.date)
      byDate.set(date, [...(byDate.get(date) ?? []), set])
    }
    const result = days.results.map((row) => {
      const date = String(row.date)
      const plan = row.plan_json ? JSON.parse(String(row.plan_json)) as { restDay?: boolean } : null
      let status = String(row.status)
      if (status === 'pending' && plan?.restDay) status = 'rest'
      else if (status === 'pending' && plan && date < today) status = 'missed'
      return { date, plan, status, rough_day: row.rough_day, note: row.note, sets: byDate.get(date) ?? [] }
    })
    return json({ days: result })
  }
  if (path === '/api/tests' && request.method === 'GET') {
    const result = await env.DB.prepare('SELECT id, date, metrics_json, created_at FROM tests ORDER BY date DESC, created_at DESC LIMIT 100').all()
    return json({ tests: result.results.map((row) => ({ ...row, metrics: JSON.parse(String(row.metrics_json)) })) })
  }
  if (path === '/api/tests' && request.method === 'POST') {
    const body = await readJson(request)
    if (!body || !isDate(body.date) || !body.metrics || typeof body.metrics !== 'object' || Array.isArray(body.metrics)) return json({ error: 'invalid_test' }, 400)
    if (body.date > dateInZone((await getSettings(env.DB)).timezone)) return json({ error: 'test_cannot_be_future' }, 400)
    const metrics = body.metrics as Record<string, unknown>
    const allowed = ['pushups', 'situps', 'crunches', 'plankSeconds', 'runTimeSeconds', 'waistInches', 'heightInches', 'waistToHeight']
    if (Object.keys(metrics).length === 0 || Object.keys(metrics).some((key) => !allowed.includes(key)) || !Object.values(metrics).every((value) => value === null || validMetric(value))) return json({ error: 'invalid_test_metrics' }, 400)
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    await env.DB.prepare('INSERT INTO tests (id, date, metrics_json, created_at) VALUES (?, ?, ?, ?)').bind(id, body.date, JSON.stringify(metrics), createdAt).run()
    return json({ id, date: body.date, metrics, created_at: createdAt }, 201)
  }
  if (path === '/api/score' && request.method === 'POST') {
    const body = await readJson(request)
    if (!body || !body.metrics || typeof body.metrics !== 'object' || Array.isArray(body.metrics)) return json({ error: 'invalid_score_input' }, 400)
    const metrics = body.metrics as Record<string, unknown>
    const allowed = ['pushups', 'situps', 'crunches', 'plankSeconds', 'runTimeSeconds', 'waistInches', 'heightInches', 'waistToHeight']
    if (Object.keys(metrics).length === 0 || Object.keys(metrics).some((key) => !allowed.includes(key)) || !Object.values(metrics).every((value) => value === null || validMetric(value))) return json({ error: 'invalid_score_metrics' }, 400)
    if (body.coreMetric !== 'situps' && body.coreMetric !== 'crunches' && body.coreMetric !== 'plank') return json({ error: 'invalid_core_metric' }, 400)
    const settings = await getSettings(env.DB)
    const result = calculateScore(scoringFile as unknown as ScoringData, {
      ageBracket: settings.ageBracket,
      sex: settings.sex,
      coreMetric: body.coreMetric,
      metrics: metrics as { pushups?: number; situps?: number; crunches?: number; plankSeconds?: number; runTimeSeconds?: number; waistToHeight?: number },
      overPrepMultiplier: settings.overPrepMultiplier,
    })
    if (result.reason === 'scoring_data_not_loaded') return json({ error: result.reason, scoringLoaded: false }, 503)
    if (result.reason === 'profile_not_found') return json({ error: result.reason, scoringLoaded: true }, 422)
    return json(result)
  }
  return json({ error: 'not_found' }, 404)
}

export default {
  async scheduled(controller: { scheduledTime: number }, env: Env): Promise<void> {
    try { await sendMorningTelegram(env, new Date(controller.scheduledTime)) }
    catch (error) { console.error('Morning Telegram message failed', error) }
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env) }
      catch { return json({ error: 'server_error' }, 500) }
    }
    return env.ASSETS.fetch(request)
  },
}
