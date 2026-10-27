const motivation = [
  'Small, steady work adds up.',
  'Show up, do the work, recover well.',
  'Build consistency one session at a time.',
  'Today’s effort supports your future self.',
  'Keep it steady. You are making progress.',
  'A good plan leaves room to recover.',
  'Focus on the next set, then the next step.',
]

export function localDateAndTime(timeZone: string, instant: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}
export function shiftDate(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}
export function formatCountdown(shipDate: string, today: string) {
  if (!shipDate) return 'Ship date not set'
  const days = Math.round((Date.parse(`${shipDate}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000)
  return days >= 0 ? `T-${days} days` : `T+${Math.abs(days)} days`
}
export function formatPlan(planJson: string | null) {
  if (!planJson) return 'Today: training plan not available yet.'
  try {
    const plan = JSON.parse(planJson) as { restDay?: boolean; exercises?: Array<{ key?: string; label?: string; sets?: number; reps?: number; setTargets?: number[]; seconds?: number; miles?: number; minutes?: number; kind?: string }> }
    if (plan.restDay) return 'Today: Recovery day · 10 push-ups · Stretch 5 min'
    const lines = (plan.exercises ?? []).map((exercise) => {
      if (exercise.key === 'pushups') return `Push-ups: ${exercise.setTargets?.reduce((sum, reps) => sum + reps, 0) ?? exercise.reps ?? 10} total (${exercise.setTargets?.join(' + ') ?? 'daily minimum'})`
      if (exercise.key === 'core') return `Core: ${exercise.sets ?? 1} sets × ${exercise.reps ?? '—'} · Plank ${exercise.seconds ?? '—'} sec`
      if (exercise.key === 'situps' || exercise.key === 'crunches') return `${exercise.label}: ${exercise.sets ?? 1} sets × ${exercise.reps ?? '—'}`
      if (exercise.key === 'plank') return `Plank: ${exercise.seconds ?? '—'} sec`
      if (exercise.key === 'run') return `Run: ${exercise.miles ?? '—'} mi · ${exercise.kind ?? 'run'}`
      if (exercise.key === 'stretch') return `Stretch: ${exercise.minutes ?? 5} min`
      return ''
    }).filter(Boolean)
    return lines.length ? `Today:\n${lines.join('\n')}` : 'Today: training plan not available yet.'
  } catch { return 'Today: training plan not available yet.' }
}
export function formatYesterday(day: { status: string; sets: Array<{ exercise: string; value: number; unit: string; undone: number }> } | undefined) {
  if (!day) return 'Yesterday: no activity recorded.'
  const totals = new Map<string, { count: number; value: number; unit: string }>()
  for (const set of day.sets) {
    if (set.undone) continue
    const value = totals.get(set.exercise) ?? { count: 0, value: 0, unit: set.unit }
    value.count++; value.value += set.value; totals.set(set.exercise, value)
  }
  const status = day.status === 'complete' ? 'done' : day.status === 'partial' || day.status === 'rough' ? 'partial' : day.status === 'missed' ? 'missed' : day.status
  const details = [...totals.entries()].map(([exercise, value]) => {
    const label = exercise === 'run_time' ? 'run time' : exercise === 'pushups' ? 'push-ups' : exercise === 'situps' ? 'sit-ups' : exercise
    const amount = value.unit === 'reps' ? `${value.value} reps` : value.unit === 'seconds' ? `${value.value} sec` : `${value.value} ${value.unit}`
    return `${label}: ${value.count} logged (${amount})`
  })
  return `Yesterday: ${status}${details.length ? ` · ${details.join('; ')}` : ''}`
}
export function motivationalLine(date: string) {
  const dayNumber = Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000)
  return motivation[((dayNumber % motivation.length) + motivation.length) % motivation.length]
}
