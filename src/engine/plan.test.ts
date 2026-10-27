import { describe, expect, it } from 'vitest'
import { applyPlanPhase, calculateStreak, generatePlan, isPlanReady, rampVolume } from './plan.ts'
import type { PlanInputs } from './types.ts'

const sample: PlanInputs = {
  startDate: '2026-01-05', shipDate: '2026-05-04',
  baseline: { pushups: 20, situps: 30, crunches: 32, plankSeconds: 45, runTimeSeconds: 1200 },
  // Test-only fixture values; they are deliberately not Air Force standards.
  passing: { pushups: 30, situps: 35, crunches: 36, plankSeconds: 60, runTimeSeconds: 1185 },
  overPrepMultiplier: 1.25,
}

describe('plan engine', () => {
  it('does not generate targets without validated scoring inputs', () => {
    expect(isPlanReady({ ...sample, passing: null })).toBe(false)
    expect(generatePlan({ ...sample, passing: null }).days).toHaveLength(0)
  })
  it('generates a deterministic date-by-date plan', () => {
    expect(generatePlan(sample, '2026-01-11')).toEqual(generatePlan(sample, '2026-01-11'))
    expect(generatePlan(sample, '2026-01-11').days).toHaveLength(7)
  })
  it('warns when ship date is too close for a gradual ramp', () => {
    const result = generatePlan({ ...sample, shipDate: '2026-02-01' }, '2026-01-11')
    expect(result.warning).toContain('Short timeline')
  })
  it('caps planned weekly progression at the editable 15 percent setting', () => {
    const weeks = [0, 1, 2, 3].map((week) => rampVolume(20, 100, week, 16))
    expect(weeks[1]).toBeLessThanOrEqual(weeks[0] * 1.15)
    expect(weeks[2]).toBeLessThanOrEqual(weeks[1] * 1.15)
  })
  it('applies deload and final-week taper to planned volume', () => {
    expect(applyPlanPhase(100, 3, 30)).toBe(70)
    expect(applyPlanPhase(100, 2, 4)).toBe(60)
  })
  it('spaces three runs around rest days, and schedules four push days in the final eight weeks', () => {
    const firstWeek = generatePlan(sample, '2026-01-11').days
    expect(firstWeek.filter((day) => day.exercises.some((exercise) => exercise.key === 'run'))).toHaveLength(3)
    expect(firstWeek.at(-1)?.restDay).toBe(true)
    expect(firstWeek.find((day) => day.date === '2026-01-07')?.exercises.some((exercise) => exercise.key === 'run')).toBe(false)
    expect(firstWeek.find((day) => day.date === '2026-01-11')?.exercises.some((exercise) => exercise.key === 'run')).toBe(false)
    const finalEightWeek = generatePlan({ ...sample, startDate: '2026-03-10' }, '2026-03-16').days
    expect(finalEightWeek.filter((day) => day.exercises.some((exercise) => exercise.key === 'pushups' && exercise.label === 'Push-ups'))).toHaveLength(4)
    expect(finalEightWeek.filter((day) => day.exercises.some((exercise) => exercise.key === 'run'))).toHaveLength(3)
    expect(finalEightWeek.some((day) => day.exercises.some((exercise) => exercise.key === 'situps'))).toBe(true)
    expect(finalEightWeek.some((day) => day.exercises.some((exercise) => exercise.key === 'crunches'))).toBe(true)
    expect(finalEightWeek.some((day) => day.exercises.some((exercise) => exercise.key === 'plank'))).toBe(true)
    expect(finalEightWeek.some((day) => day.restDay)).toBe(true)
  })
  it('keeps a 10-push-up minimum every day and caps weekly training increases at 15 percent', () => {
    const plan = generatePlan(sample)
    const weeks = new Map<number, { pushups: number; runMiles: number; core: Record<string, number> }>()
    for (const day of plan.days) {
      const week = Math.floor((Date.parse(`${day.date}T00:00:00.000Z`) - Date.parse(`${sample.startDate}T00:00:00.000Z`)) / (7 * 86_400_000))
      const pushups = day.exercises.find((exercise) => exercise.key === 'pushups')!
      const total = pushups.setTargets!.reduce((sum, reps) => sum + reps, 0)
      const row: { pushups: number; runMiles: number; core: Record<string, number> } = weeks.get(week) ?? { pushups: 0, runMiles: 0, core: {} }
      row.pushups += total
      for (const exercise of day.exercises) {
        if (exercise.key === 'run') row.runMiles += exercise.miles ?? 0
        if (exercise.key === 'situps' || exercise.key === 'crunches') row.core[exercise.key] = exercise.setTargets!.reduce((sum, reps) => sum + reps, 0)
        if (exercise.key === 'plank') row.core.plank = exercise.seconds ?? 0
      }
      weeks.set(week, row)
    }
    const totals = [...weeks.values()]
    expect(plan.days.every((day) => day.exercises.find((exercise) => exercise.key === 'pushups')!.setTargets!.reduce((sum, reps) => sum + reps, 0) >= 10)).toBe(true)
    for (let index = 1; index < totals.length; index++) {
      expect(totals[index].pushups).toBeLessThanOrEqual(totals[index - 1].pushups * 1.15)
      expect(totals[index].runMiles).toBeLessThanOrEqual(totals[index - 1].runMiles * 1.15)
      for (const event of ['situps', 'crunches', 'plank']) {
        const previous = totals[index - 1].core[event]
        const current = totals[index].core[event]
        if (previous !== undefined && current !== undefined) expect(current).toBeLessThanOrEqual(previous * 1.15)
      }
    }
  })
  it('counts rest and rough days as streak-preserving', () => {
    expect(calculateStreak(['complete', 'rest', 'rough', 'missed', 'complete'])).toBe(3)
    expect(calculateStreak(['missed', 'complete'])).toBe(0)
  })
})
