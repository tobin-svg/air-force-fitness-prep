export type ScoreBand = { minRaw: number; maxRaw: number | null; points: number }
export type ComponentStandard = { unit: 'reps' | 'seconds'; higherIsBetter: boolean; minimum: number; bands: ScoreBand[] }
export type ScoringRecord = { ageBracket: string; sex: string; components: Partial<Record<'pushups' | 'situps' | 'crunches' | 'plank' | 'run', ComponentStandard>> }
export type ScoringData = { schemaVersion: number; status: string; source: { title: string; url: string; retrievedOn: string | null }; passingComposite: number | null; records: ScoringRecord[] }
export type ScoreMetric = 'pushups' | 'situps' | 'crunches' | 'plankSeconds' | 'runTimeSeconds'
export type ScoreQuery = { ageBracket: string; sex: string; coreMetric: 'situps' | 'crunches'; metrics: Partial<Record<ScoreMetric, number>>; overPrepMultiplier: number }
export type ComponentResult = { name: string; unit: string; points: number | null; minimum: number; higherIsBetter: boolean; gapToPassing: number | null; overPrepTarget: number | null; gapToOverPrep: number | null }
export type ScoreResult = { ready: boolean; reason?: 'scoring_data_not_loaded' | 'profile_not_found'; composite: number | null; passingComposite: number | null; passed: boolean | null; components: ComponentResult[] }

export function isScoringDataLoaded(data: ScoringData): boolean {
  if (data.status !== 'LOADED' || !data.source?.title || data.source.title.includes('PLACEHOLDER') || !/^https:\/\//.test(data.source.url ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(data.source.retrievedOn ?? '') || !Number.isFinite(data.passingComposite) || !Array.isArray(data.records) || !data.records.length) return false
  return data.records.every((record) => {
    if (!record.ageBracket || record.ageBracket === 'PLACEHOLDER' || !record.sex || record.sex === 'PLACEHOLDER') return false
    const standards = [record.components.pushups, record.components.plank, record.components.run]
    if (standards.some((component) => !component)) return false
    if (!record.components.situps && !record.components.crunches) return false
    const all = [...standards, record.components.situps, record.components.crunches].filter((component): component is ComponentStandard => component !== undefined)
    return all.every((component) => {
      if (!['reps', 'seconds'].includes(component.unit) || !Number.isFinite(component.minimum) || component.minimum <= 0 || typeof component.higherIsBetter !== 'boolean' || !Array.isArray(component.bands) || component.bands.length === 0) return false
      const bands = [...component.bands].sort((a, b) => a.minRaw - b.minRaw)
      let previous: ScoreBand | undefined
      for (const band of bands) {
        if (!Number.isFinite(band.minRaw) || (band.maxRaw !== null && !Number.isFinite(band.maxRaw)) || !Number.isFinite(band.points) || (band.maxRaw !== null && band.maxRaw < band.minRaw)) return false
        if (previous && (previous.maxRaw === null || band.minRaw <= previous.maxRaw || (component.higherIsBetter ? band.points < previous.points : band.points > previous.points))) return false
        previous = band
      }
      return bands.some((band) => band.minRaw <= component.minimum && (band.maxRaw === null || component.minimum <= band.maxRaw))
    })
  })
}

function findBand(standard: ComponentStandard, value: number): ScoreBand | undefined {
  return standard.bands.find((band) => value >= band.minRaw && (band.maxRaw === null || value <= band.maxRaw))
}
function gap(current: number, target: number, higherIsBetter: boolean) { return higherIsBetter ? Math.max(0, target - current) : Math.max(0, current - target) }

/** Uses only the supplied official range table. It never interpolates point values. */
export function calculateScore(data: ScoringData, query: ScoreQuery): ScoreResult {
  if (!isScoringDataLoaded(data)) return { ready: false, reason: 'scoring_data_not_loaded', composite: null, passingComposite: null, passed: null, components: [] }
  const record = data.records.find((item) => item.ageBracket === query.ageBracket && item.sex === query.sex)
  if (!record) return { ready: false, reason: 'profile_not_found', composite: null, passingComposite: data.passingComposite, passed: null, components: [] }
  const selectedCore = query.coreMetric
  const metrics: Array<{ key: keyof ScoringRecord['components']; input: ScoreMetric; name: string }> = [
    { key: 'pushups', input: 'pushups', name: 'Push-ups' },
    { key: selectedCore, input: selectedCore, name: selectedCore === 'situps' ? 'Sit-ups' : 'Crunches' },
    { key: 'plank', input: 'plankSeconds', name: 'Plank' },
    { key: 'run', input: 'runTimeSeconds', name: '1.5-mile run' },
  ]
  const components: ComponentResult[] = []
  for (const item of metrics) {
    const standard = record.components[item.key]
    const raw = query.metrics[item.input]
    if (!standard || raw === undefined || !Number.isFinite(raw) || raw <= 0) continue
    const band = findBand(standard, raw)
    const overPrepTarget = standard.higherIsBetter ? standard.minimum * query.overPrepMultiplier : standard.minimum / query.overPrepMultiplier
    components.push({ name: item.name, unit: standard.unit, points: band?.points ?? null, minimum: standard.minimum, higherIsBetter: standard.higherIsBetter, gapToPassing: gap(raw, standard.minimum, standard.higherIsBetter), overPrepTarget, gapToOverPrep: gap(raw, overPrepTarget, standard.higherIsBetter) })
  }
  const complete = components.length === metrics.length && components.every((component) => component.points !== null)
  const composite = complete ? components.reduce((sum, component) => sum + (component.points ?? 0), 0) : null
  const passed = composite === null ? null : components.every((component) => component.gapToPassing === 0) && composite >= data.passingComposite!
  return { ready: true, composite, passingComposite: data.passingComposite, passed, components }
}
