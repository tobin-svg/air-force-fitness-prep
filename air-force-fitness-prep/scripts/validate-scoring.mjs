import { readFileSync } from 'node:fs'

const file = new URL('../data/scoring.json', import.meta.url)
const data = JSON.parse(readFileSync(file, 'utf8'))
const problems = []
const required = ['pushups', 'plank', 'run']

if (data.schemaVersion !== 1) problems.push('schemaVersion must be 1')
if (data.status !== 'LOADED') problems.push('status is still a placeholder; set it to LOADED only after verifying the official table')
if (!data.source?.title || data.source.title.includes('PLACEHOLDER')) problems.push('source.title is missing or still a placeholder')
if (!/^https:\/\//.test(data.source?.url ?? '') || data.source.url.includes('PLACEHOLDER')) problems.push('source.url must be an official HTTPS URL')
if (!/^\d{4}-\d{2}-\d{2}$/.test(data.source?.retrievedOn ?? '')) problems.push('source.retrievedOn must be a YYYY-MM-DD date')
if (!Number.isFinite(data.passingComposite) || data.passingComposite <= 0) problems.push('passingComposite must contain the official positive minimum')
if (!Array.isArray(data.records) || data.records.length === 0) problems.push('records must include at least one verified age/sex record')

const seenProfiles = new Set()
for (const [recordIndex, record] of (Array.isArray(data.records) ? data.records : []).entries()) {
  if (!record.ageBracket || record.ageBracket === 'PLACEHOLDER') problems.push(`records[${recordIndex}].ageBracket is missing`)
  if (!record.sex || record.sex === 'PLACEHOLDER') problems.push(`records[${recordIndex}].sex is missing`)
  const profile = `${record.ageBracket}|${record.sex}`
  if (seenProfiles.has(profile)) problems.push(`records[${recordIndex}] duplicates age bracket and sex`)
  seenProfiles.add(profile)
  if (!record.components?.situps && !record.components?.crunches) problems.push(`records[${recordIndex}].components must include situps or crunches`)
  for (const name of [...required, 'situps', 'crunches']) {
    const component = record.components?.[name]
    if (!component) { if (required.includes(name)) problems.push(`records[${recordIndex}].components.${name} is missing`); continue }
    if (!['reps', 'seconds'].includes(component.unit)) problems.push(`records[${recordIndex}].components.${name}.unit must be reps or seconds`)
    if (typeof component.higherIsBetter !== 'boolean') problems.push(`records[${recordIndex}].components.${name}.higherIsBetter must be boolean`)
    if (!Number.isFinite(component.minimum) || component.minimum <= 0) problems.push(`records[${recordIndex}].components.${name}.minimum is missing`)
    if (!Array.isArray(component.bands) || component.bands.length === 0) { problems.push(`records[${recordIndex}].components.${name}.bands must contain official point ranges`); continue }
    const bands = [...component.bands].sort((a, b) => a.minRaw - b.minRaw)
    let previous = null
    for (const band of bands) {
      if (!Number.isFinite(band.minRaw) || (band.maxRaw !== null && !Number.isFinite(band.maxRaw)) || !Number.isFinite(band.points) || (band.maxRaw !== null && band.maxRaw < band.minRaw)) {
        problems.push(`records[${recordIndex}].components.${name}.bands contains a placeholder or invalid range`)
        continue
      }
      if (previous && (previous.maxRaw === null || band.minRaw <= previous.maxRaw)) problems.push(`records[${recordIndex}].components.${name}.bands overlap`)
      if (previous && (component.higherIsBetter ? band.points < previous.points : band.points > previous.points)) problems.push(`records[${recordIndex}].components.${name}.bands points conflict with higherIsBetter`)
      previous = band
    }
    if (Number.isFinite(component.minimum) && !bands.some((band) => band.minRaw <= component.minimum && (band.maxRaw === null || component.minimum <= band.maxRaw))) problems.push(`records[${recordIndex}].components.${name}.minimum is outside all score bands`)
  }
}

if (problems.length) {
  console.error(`Scoring data is not ready (${problems.length} issue${problems.length === 1 ? '' : 's'}):`)
  for (const problem of problems) console.error(`- ${problem}`)
  process.exitCode = 1
} else {
  console.log('Scoring data structure is complete.')
}
