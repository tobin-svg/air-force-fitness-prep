import { describe, expect, it } from 'vitest'
import { calculateScore, isScoringDataLoaded, type ScoringData } from './scoring'

// Entirely synthetic test fixture. These values are not Air Force standards.
const fakeScoringFixture: ScoringData = {
  schemaVersion: 1,
  status: 'LOADED',
  source: { title: 'TEST-ONLY fictional table', url: 'https://example.invalid/fake', retrievedOn: '2026-01-01' },
  passingComposite: 8,
  records: [{
    ageBracket: 'TEST-ONLY', sex: 'TEST-ONLY',
    components: {
      pushups: { unit: 'reps', higherIsBetter: true, minimum: 10, bands: [{ minRaw: 0, maxRaw: 9, points: 1 }, { minRaw: 10, maxRaw: 19, points: 2 }, { minRaw: 20, maxRaw: null, points: 3 }] },
      situps: { unit: 'reps', higherIsBetter: true, minimum: 8, bands: [{ minRaw: 0, maxRaw: 7, points: 1 }, { minRaw: 8, maxRaw: 14, points: 2 }, { minRaw: 15, maxRaw: null, points: 3 }] },
      plank: { unit: 'seconds', higherIsBetter: true, minimum: 30, bands: [{ minRaw: 0, maxRaw: 29, points: 1 }, { minRaw: 30, maxRaw: 59, points: 2 }, { minRaw: 60, maxRaw: null, points: 3 }] },
      run: { unit: 'seconds', higherIsBetter: false, minimum: 777, bands: [{ minRaw: 0, maxRaw: 699, points: 3 }, { minRaw: 700, maxRaw: 777, points: 2 }, { minRaw: 778, maxRaw: null, points: 1 }] },
      waistToHeight: { unit: 'ratio', higherIsBetter: false, minimum: 0.6, bands: [{ minRaw: 0, maxRaw: 0.49, points: 3 }, { minRaw: 0.5, maxRaw: 0.59, points: 2 }, { minRaw: 0.6, maxRaw: null, points: 1 }] },
    },
  }],
}

describe('score calculator', () => {
  it('does not score placeholder data', () => {
    expect(isScoringDataLoaded({ ...fakeScoringFixture, status: 'PLACEHOLDER_DO_NOT_USE' })).toBe(false)
    expect(calculateScore({ ...fakeScoringFixture, status: 'PLACEHOLDER_DO_NOT_USE' }, { ageBracket: 'TEST-ONLY', sex: 'TEST-ONLY', coreMetric: 'situps', metrics: {}, overPrepMultiplier: 1.25 }).reason).toBe('scoring_data_not_loaded')
  })
  it('maps supplied raw ranges to points and evaluates the composite pass', () => {
    const result = calculateScore(fakeScoringFixture, { ageBracket: 'TEST-ONLY', sex: 'TEST-ONLY', coreMetric: 'situps', metrics: { pushups: 10, situps: 8, plankSeconds: 30, runTimeSeconds: 777, waistToHeight: 0.5 }, overPrepMultiplier: 1.25 })
    expect(result.composite).toBe(8)
    expect(result.passed).toBe(true)
    expect(result.components.map((component) => component.points)).toEqual([2, 2, 2, 2])
  })
  it('uses the direction of the metric for passing gaps and the over-prepared run target', () => {
    const result = calculateScore(fakeScoringFixture, { ageBracket: 'TEST-ONLY', sex: 'TEST-ONLY', coreMetric: 'situps', metrics: { pushups: 9, situps: 8, plankSeconds: 30, runTimeSeconds: 800, waistToHeight: 0.5 }, overPrepMultiplier: 1.25 })
    expect(result.components[0].gapToPassing).toBe(1)
    expect(result.components[2].gapToPassing).toBe(23)
    expect(result.components[2].overPrepTarget).toBeCloseTo(621.6)
  })
  it('requires an exact official band lookup and never interpolates points', () => {
    const result = calculateScore(fakeScoringFixture, { ageBracket: 'TEST-ONLY', sex: 'TEST-ONLY', coreMetric: 'situps', metrics: { pushups: 9.5, situps: 8, plankSeconds: 30, runTimeSeconds: 777, waistToHeight: 0.5 }, overPrepMultiplier: 1.25 })
    expect(result.components[0].points).toBeNull()
    expect(result.composite).toBeNull()
  })
  it('reports when no age/sex profile matches', () => {
    expect(calculateScore(fakeScoringFixture, { ageBracket: 'MISSING', sex: 'TEST-ONLY', coreMetric: 'situps', metrics: {}, overPrepMultiplier: 1.25 }).reason).toBe('profile_not_found')
  })
})
