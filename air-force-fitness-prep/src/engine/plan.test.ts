import { describe, expect, it } from 'vitest'
import { applyPlanPhase, calculateStreak, generatePlan, isPlanReady, rampVolume } from './plan.ts'
import type { PlanInputs } from './types.ts'

const sample: PlanInputs = {
  startDate: '2026-01-05', shipDate: '2026-05-04',
  baseline: { pushups: 20, situps: 30, plankSeconds: 45, runTimeSeconds: 900 },
  // Test-only fixture values; they are deliberately not Air Force standards.
  passing: { pushups: 30, situps: 35, plankSeconds: 60, runTimeSeconds: 800 },
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
    const finalEightWeek = generatePlan({ ...sample, startDate: '2026-03-09' }, '2026-03-15').days
    expect(finalEightWeek.filter((day) => day.exercises.some((exercise) => exercise.key === 'pushups'))).toHaveLength(4)
    expect(finalEightWeek.filter((day) => day.exercises.some((exercise) => exercise.key === 'run'))).toHaveLength(3)
    expect(finalEightWeek.some((day) => day.restDay)).toBe(true)
  })
  it('counts rest and rough days as streak-preserving', () => {
    expect(calculateStreak(['complete', 'rest', 'rough', 'missed', 'complete'])).toBe(3)
    expect(calculateStreak(['missed', 'complete'])).toBe(0)
  })
})
