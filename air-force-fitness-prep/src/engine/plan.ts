import { planConfig } from '../../config/plan.ts'
import type { DayPlan, ExercisePlan, PlanInputs, PlanResult } from './types.ts'

const DAY = 86_400_000
const iso = (date: Date) => date.toISOString().slice(0, 10)
const dateAtUtcMidnight = (value: string) => new Date(`${value}T00:00:00.000Z`)
const validPositive = (n: number) => Number.isFinite(n) && n > 0

export function isPlanReady(input: PlanInputs): boolean {
  if (!input.passing || !validPositive(input.overPrepMultiplier)) return false
  return Object.values(input.baseline).every(validPositive) && Object.values(input.passing).every(validPositive)
}

function weekIndex(date: Date, start: Date): number { return Math.max(0, Math.floor((date.getTime() - start.getTime()) / (7 * DAY))) }
function weekday(date: Date): number { return date.getUTCDay() }
function setCount(total: number, reps: number): number { return Math.max(1, Math.ceil(total / reps)) }
export function applyPlanPhase(baseVolume: number, week: number, daysToShip: number): number {
  const taper = daysToShip < planConfig.taperDays
  const deload = week > 0 && week % 4 === 3
  return baseVolume * (taper ? planConfig.taperFraction : deload ? planConfig.deloadFraction : 1)
}
export function rampVolume(baseline: number, target: number, week: number, peakWeek: number): number {
  const progress = Math.min(1, week / Math.max(1, peakWeek))
  const desired = baseline * planConfig.startFractionOfBaseline + (target * planConfig.peakFractionOfOverPrepTarget - baseline * planConfig.startFractionOfBaseline) * progress
  return Math.min(desired, baseline * planConfig.startFractionOfBaseline * (1 + planConfig.weeklyIncreaseCap) ** week)
}

/** Pure, deterministic calendar generator. Scoring minima are always explicit inputs. */
export function generatePlan(input: PlanInputs, throughDate = input.shipDate): PlanResult {
  if (!isPlanReady(input)) return { ready: false, warning: 'Add baseline measurements and load valid scoring data to generate training targets.', days: [] }
  const start = dateAtUtcMidnight(input.startDate)
  const ship = dateAtUtcMidnight(input.shipDate)
  const end = dateAtUtcMidnight(throughDate)
  if ([start, ship, end].some((date) => Number.isNaN(date.getTime())) || start > ship || end < start) return { ready: false, warning: 'Check the start date and ship date in Settings.', days: [] }

  const weeksRemaining = Math.max(0, (ship.getTime() - start.getTime()) / (7 * DAY))
  const warning = weeksRemaining < 10 ? 'Short timeline: progression is compressed and weekly volume increases remain capped.' : undefined
  const peakDate = new Date(ship.getTime() - planConfig.peakWeeksBeforeShip * 7 * DAY)
  const peakWeek = Math.max(0, weekIndex(peakDate, start))
  const result: DayPlan[] = []
  const pushReps = Math.max(planConfig.minimumRepsPerSet, Math.floor(input.baseline.pushups * planConfig.repFractionOfMax))
  const coreReps = Math.max(planConfig.minimumRepsPerSet, Math.floor(input.baseline.situps * planConfig.repFractionOfMax))
  const pushTarget = input.passing!.pushups * input.overPrepMultiplier
  const coreTarget = input.passing!.situps * input.overPrepMultiplier
  const plankTarget = input.passing!.plankSeconds * input.overPrepMultiplier
  const peakPush = Math.max(input.baseline.pushups * 0.6, pushTarget * planConfig.peakFractionOfOverPrepTarget)
  const peakCore = Math.max(input.baseline.situps * 0.6, coreTarget * planConfig.peakFractionOfOverPrepTarget)

  for (let time = start.getTime(); time <= Math.min(ship.getTime(), end.getTime()); time += DAY) {
    const date = new Date(time)
    const week = weekIndex(date, start)
    const dow = weekday(date)
    const daysToShip = Math.floor((ship.getTime() - time) / DAY)
    const finalEight = daysToShip < 56
    const pushSchedule = finalEight ? [1, 2, 4, 6] : [1, 3, 5]
    const pushDays = pushSchedule.slice(0, finalEight ? planConfig.pushDaysFinalEightWeeks : planConfig.pushDaysBeforeFinalEightWeeks)
    const coreDays = [1, 3, 6].slice(0, planConfig.coreDaysPerWeek)
    const runDays = [2, 4, 6].slice(0, finalEight ? planConfig.runDaysFinalEightWeeks : planConfig.runDaysBeforeFinalEightWeeks)
    const exercises: ExercisePlan[] = []
    const basePush = rampVolume(input.baseline.pushups, pushTarget, week, peakWeek)
    const baseCore = rampVolume(input.baseline.situps, coreTarget, week, peakWeek)
    const basePlank = rampVolume(input.baseline.plankSeconds, plankTarget, week, peakWeek)
    const pushVolume = Math.min(peakPush, applyPlanPhase(basePush, week, daysToShip))
    const coreVolume = Math.min(peakCore, applyPlanPhase(baseCore, week, daysToShip))
    if (pushDays.includes(dow)) exercises.push({ key: 'pushups', label: 'Push-ups', sets: setCount(pushVolume, pushReps), reps: pushReps })
    if (coreDays.includes(dow)) exercises.push({ key: 'core', label: 'Core', sets: setCount(coreVolume, coreReps), reps: coreReps, seconds: Math.max(1, Math.round(applyPlanPhase(basePlank, week, daysToShip))) })
    if (runDays.includes(dow)) {
      const runProgress = Math.min(1, week / Math.max(1, peakWeek))
      const desiredMiles = 1.5 * 0.6 + (2 - 1.5 * 0.6) * runProgress
      const miles = Math.min(desiredMiles, 1.5 * 0.6 * (1 + planConfig.weeklyIncreaseCap) ** week)
      const runFactor = applyPlanPhase(miles, week, daysToShip) / Math.max(miles, 0.01)
      const targetPace = input.passing!.runTimeSeconds / 1.5
      const easyPace = Math.max(input.baseline.runTimeSeconds / 1.5, targetPace * 1.15)
      exercises.push({ key: 'run', label: 'Run', miles: Math.max(0.5, miles * runFactor), paceSecondsPerMile: Math.round(easyPace), targetPaceSecondsPerMile: Math.round(targetPace), kind: dow === 2 ? 'tempo' : dow === 6 ? 'intervals' : 'easy' })
    }
    const restDay = exercises.length === 0
    exercises.push({ key: 'stretch', label: 'Stretch', minutes: 5 })
    result.push({ date: iso(date), restDay, exercises, warning })
  }
  return { ready: true, warning, days: result }
}

export function calculateStreak(statuses: Array<'complete' | 'partial' | 'missed' | 'rest' | 'rough'>): number {
  let streak = 0
  for (const status of statuses) {
    if (status === 'complete' || status === 'rest' || status === 'rough') streak++
    else break
  }
  return streak
}
