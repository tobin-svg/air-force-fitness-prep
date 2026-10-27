import { describe, expect, it } from 'vitest'
import { formatPlan, formatYesterday, localDateAndTime, motivationalLine } from './telegram'

describe('morning message helpers', () => {
  it('matches the configured Chicago time across daylight saving changes', () => {
    expect(localDateAndTime('America/Chicago', new Date('2026-03-08T11:30:00.000Z'))).toEqual({ date: '2026-03-08', time: '06:30' })
    expect(localDateAndTime('America/Chicago', new Date('2026-11-01T12:30:00.000Z'))).toEqual({ date: '2026-11-01', time: '06:30' })
  })

  it('formats the stored plan without making up missing training data', () => {
    expect(formatPlan(null)).toBe('Today: training plan not available yet.')
    expect(formatPlan(JSON.stringify({ restDay: false, exercises: [
      { key: 'pushups', sets: 4, reps: 2, setTargets: [2, 2, 2, 2] },
      { key: 'core', sets: 3, reps: 10, seconds: 45 },
      { key: 'run', miles: 1.2, kind: 'intervals' },
      { key: 'stretch', minutes: 5 },
    ] }))).toContain('Today:\nPush-ups: 8 total (2 + 2 + 2 + 2)\nCore: 3 sets × 10 · Plank 45 sec\nRun: 1.2 mi · intervals\nStretch: 5 min')
  })

  it('summarizes completed and partial days with logged numbers', () => {
    expect(formatYesterday({ status: 'partial', sets: [
      { exercise: 'pushups', value: 8, unit: 'reps', undone: 0 },
      { exercise: 'pushups', value: 7, unit: 'reps', undone: 0 },
      { exercise: 'plank', value: 45, unit: 'seconds', undone: 1 },
    ] })).toBe('Yesterday: partial · push-ups: 2 logged (15 reps)')
    expect(motivationalLine('2026-10-26')).toBe(motivationalLine('2026-10-26'))
  })
})
