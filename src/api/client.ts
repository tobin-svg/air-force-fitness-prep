export type Exercise = 'pushups' | 'situps' | 'crunches' | 'plank' | 'run' | 'run_time' | 'stretch'
export type SetRecord = { id: string; date: string; exercise: Exercise; value: number; unit: string; timestamp: string; undone?: number }
export type AppSettings = {
  shipDate: string; timezone: string; morningMessageTime: string
  baselines: { pushups: number | null; situps: number | null; crunches: number | null; plankSeconds: number | null; runTimeSeconds: number | null }
  ageBracket: string; sex: string; overPrepMultiplier: number; restTimerEnabled: boolean; restTimerSeconds: number; telegramEnabled: boolean
}
export type TodayPayload = { date: string; settings: AppSettings; day: { plan: unknown; status: string; rough_day: number } | null; planWarning?: string | null; sets: SetRecord[] }
export type HistoryDay = { date: string; plan: unknown; status: 'pending' | 'complete' | 'partial' | 'missed' | 'rest' | 'rough'; rough_day: number; note: string | null; sets: SetRecord[] }
type QueueEntry = { method: 'POST'; path: '/api/log-set' | '/api/undo-set' | '/api/rough-day' | '/api/day-status'; body: Record<string, unknown> }
const queueKey = 'fitnessPrepOfflineQueue'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new ApiError(data.error ?? `Request failed (${response.status})`, response.status)
  return data
}

function getQueue(): QueueEntry[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(queueKey) ?? '[]'); return Array.isArray(value) ? value as QueueEntry[] : [] }
  catch { return [] }
}
function saveQueue(queue: QueueEntry[]) { localStorage.setItem(queueKey, JSON.stringify(queue)) }
export async function logSet(body: { id: string; date: string; exercise: Exercise; value: number; unit: string }): Promise<void> {
  try { await request('/api/log-set', 'POST', body) }
  catch (error) {
    if (error instanceof ApiError) throw error
    saveQueue([...getQueue(), { method: 'POST', path: '/api/log-set', body }])
  }
}
export async function undoSet(id: string): Promise<void> {
  try { await request('/api/undo-set', 'POST', { id }) }
  catch (error) {
    if (error instanceof ApiError) throw error
    saveQueue([...getQueue(), { method: 'POST', path: '/api/undo-set', body: { id } }])
  }
}
export async function markRoughDay(date: string): Promise<void> {
  try { await request('/api/rough-day', 'POST', { date }) }
  catch (error) {
    if (error instanceof ApiError) throw error
    saveQueue([...getQueue(), { method: 'POST', path: '/api/rough-day', body: { date } }])
  }
}
export async function updateDayStatus(date: string, status: 'complete' | 'partial' | 'rest'): Promise<void> {
  try { await request('/api/day-status', 'POST', { date, status }) }
  catch (error) {
    if (error instanceof ApiError) throw error
    saveQueue([...getQueue(), { method: 'POST', path: '/api/day-status', body: { date, status } }])
  }
}
export async function saveDayNote(date: string, note: string): Promise<void> {
  await request('/api/day-note', 'POST', { date, note })
}
export async function syncQueue(): Promise<void> {
  const queue = getQueue()
  const remaining: QueueEntry[] = []
  let offline = false
  for (const item of queue) {
    if (offline) { remaining.push(item); continue }
    try { await request(item.path, item.method, item.body) }
    catch (error) {
      if (error instanceof ApiError) { if (error.status === 401 || error.status >= 500) { remaining.push(item); offline = true } }
      else { remaining.push(item); offline = true }
    }
  }
  saveQueue(remaining)
}
