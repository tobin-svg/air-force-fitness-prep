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
export function applyPlanPhase(baseVolume: number, week: number, daysToShip: number): number {
  const taper = daysToShip < planConfig.taperDays
  const deload = week > 0 && week % 4 === 3
  return baseVolume * (taper ? planConfig.taperFraction : deload ? planConfig.deloadFraction : 1)
}
export function rampVolume(baseline: number, target: number, week: number, peakWeek: number, minimumStart = 0): number {
  const progress = Math.min(1, week / Math.max(1, peakWeek))
  const initial = Math.max(baseline * planConfig.startFractionOfBaseline, minimumStart)
  const peakTarget = target * planConfig.peakFractionOfOverPrepTarget
  const desired = initial + (peakTarget - initial) * progress
  return Math.min(desired, initial * (1 + planConfig.weeklyIncreaseCap) ** week)
}

function distributeReps(total: number, maxPerSet: number): number[] {
  const sets = Math.max(1, Math.ceil(total / maxPerSet))
  const base = Math.floor(total / sets)
  const remainder = total % sets
  return Array.from({ length: sets }, (_, index) => base + (index < remainder ? 1 : 0))
}

function weeklyPushTargets(input: PlanInputs, start: Date, ship: Date, peakWeek: number): Map<string, number> {
  const targets = new Map<string, number>()
  const pushupGoal = input.passing!.pushups * input.overPrepMultiplier
  let previousWeeklyTotal = 0
  let previousWorkoutGoal = 0
  const numberOfWeeks = weekIndex(ship, start)
  for (let week = 0; week <= numberOfWeeks; week++) {
    const weekStart = start.getTime() + week * 7 * DAY
    const days: Array<{ date: string; target: number; scheduled: boolean }> = []
    for (let day = 0; day < 7; day++) {
      const time = weekStart + day * DAY
      if (time > ship.getTime()) break
      const date = new Date(time)
      const daysToShip = Math.floor((ship.getTime() - time) / DAY)
      const finalEight = daysToShip < 56
      const schedule = finalEight ? [1, 2, 4, 6] : [1, 3, 5]
      const count = finalEight ? planConfig.pushDaysFinalEightWeeks : planConfig.pushDaysBeforeFinalEightWeeks
      const scheduled = schedule.slice(0, count).includes(weekday(date))
      let target = 10
      if (scheduled) {
        const ramped = rampVolume(input.baseline.pushups, pushupGoal, week, peakWeek, 10)
        target = Math.max(10, Math.floor(applyPlanPhase(ramped, week, daysToShip)))
      }
      if (week > 0 && scheduled && previousWorkoutGoal > 0) target = Math.min(target, Math.floor(previousWorkoutGoal * (1 + planConfig.weeklyIncreaseCap)))
      days.push({ date: iso(date), target, scheduled })
    }
    const desiredTotal = days.reduce((sum, day) => sum + day.target, 0)
    if (week > 0 && desiredTotal > previousWeeklyTotal * (1 + planConfig.weeklyIncreaseCap)) {
      const minimumTotal = days.length * 10
      const desiredExtra = desiredTotal - minimumTotal
      const allowedExtra = Math.max(0, Math.floor(previousWeeklyTotal * (1 + planConfig.weeklyIncreaseCap) - minimumTotal))
      const scale = desiredExtra > 0 ? Math.min(1, allowedExtra / desiredExtra) : 1
      for (const day of days) day.target = 10 + Math.floor((day.target - 10) * scale)
    }
    previousWeeklyTotal = days.reduce((sum, day) => sum + day.target, 0)
    const workoutDays = days.filter((day) => day.scheduled)
    if (workoutDays.length) previousWorkoutGoal = workoutDays.reduce((sum, day) => sum + day.target, 0) / workoutDays.length
    for (const day of days) targets.set(day.date, day.target)
  }
  return targets
}

function weeklyCoreTargets(input: PlanInputs, start: Date, ship: Date, peakWeek: number, event: 'situps' | 'crunches' | 'plank', eventWeekday: number): Map<string, number> {
  const targets = new Map<string, number>()
  const baseline = event === 'plank' ? input.baseline.plankSeconds : input.baseline[event]
  const passing = event === 'plank' ? input.passing!.plankSeconds : input.passing![event]
  let previousGoal = 0
  for (let week = 0; week <= weekIndex(ship, start); week++) {
    const weekStart = start.getTime() + week * 7 * DAY
    const time = Array.from({ length: 7 }, (_, day) => weekStart + day * DAY).find((candidate) => weekday(new Date(candidate)) === eventWeekday)
    if (time === undefined || time > ship.getTime()) continue
    const date = new Date(time)
    const daysToShip = Math.floor((ship.getTime() - time) / DAY)
    const ramped = rampVolume(baseline, passing * input.overPrepMultiplier, week, peakWeek)
    let goal = Math.max(1, Math.floor(applyPlanPhase(ramped, week, daysToShip)))
    if (previousGoal > 0) goal = Math.min(goal, Math.floor(previousGoal * (1 + planConfig.weeklyIncreaseCap)))
    targets.set(iso(date), goal)
    previousGoal = goal
  }
  return targets
}

function weeklyRunTargets(start: Date, ship: Date, peakWeek: number): Map<string, number> {
  const targets = new Map<string, number>()
  let previousWeeklyMiles = 0
  for (let week = 0; week <= weekIndex(ship, start); week++) {
    const weekStart = start.getTime() + week * 7 * DAY
    const days: Array<{ date: string; miles: number }> = []
    for (let day = 0; day < 7; day++) {
      const time = weekStart + day * DAY
      if (time > ship.getTime()) break
      const date = new Date(time)
      const daysToShip = Math.floor((ship.getTime() - time) / DAY)
      const finalEight = daysToShip < 56
      const runDays = [2, 4, 6].slice(0, finalEight ? planConfig.runDaysFinalEightWeeks : planConfig.runDaysBeforeFinalEightWeeks)
      if (!runDays.includes(weekday(date))) continue
      const progress = Math.min(1, week / Math.max(1, peakWeek))
      const desired = 1.2 + (2 - 1.2) * progress
      const cap = 1.2 * (1 + planConfig.weeklyIncreaseCap) ** week
      const miles = Math.max(0.5, Math.min(desired, cap) * applyPlanPhase(1, week, daysToShip))
      days.push({ date: iso(date), miles })
    }
    const desiredWeeklyMiles = days.reduce((sum, day) => sum + day.miles, 0)
    const scale = week > 0 && desiredWeeklyMiles > previousWeeklyMiles * (1 + planConfig.weeklyIncreaseCap)
      ? previousWeeklyMiles * (1 + planConfig.weeklyIncreaseCap) / desiredWeeklyMiles
      : 1
    for (const day of days) targets.set(day.date, Math.max(0.5, Math.floor(day.miles * scale * 100) / 100))
    previousWeeklyMiles = days.reduce((sum, day) => sum + (targets.get(day.date) ?? day.miles), 0)
  }
  return targets
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
  const dailyPushTargets = weeklyPushTargets(input, start, ship, peakWeek)
  const situpTargets = weeklyCoreTargets(input, start, ship, peakWeek, 'situps', 1)
  const crunchTargets = weeklyCoreTargets(input, start, ship, peakWeek, 'crunches', 3)
  const plankTargets = weeklyCoreTargets(input, start, ship, peakWeek, 'plank', 6)
  const dailyRunTargets = weeklyRunTargets(start, ship, peakWeek)
  const result: DayPlan[] = []

  for (let time = start.getTime(); time <= Math.min(ship.getTime(), end.getTime()); time += DAY) {
    const date = new Date(time)
    const dow = weekday(date)
    const daysToShip = Math.floor((ship.getTime() - time) / DAY)
    const finalEight = daysToShip < 56
    const pushSchedule = finalEight ? [1, 2, 4, 6] : [1, 3, 5]
    const pushDays = pushSchedule.slice(0, finalEight ? planConfig.pushDaysFinalEightWeeks : planConfig.pushDaysBeforeFinalEightWeeks)
    const coreDays = [1, 3, 6].slice(0, planConfig.coreDaysPerWeek)
    const runDays = [2, 4, 6].slice(0, finalEight ? planConfig.runDaysFinalEightWeeks : planConfig.runDaysBeforeFinalEightWeeks)
    const exercises: ExercisePlan[] = []
    const pushTargetForDay = dailyPushTargets.get(iso(date)) ?? 10
    const pushRepsPerSet = Math.max(planConfig.minimumRepsPerSet, Math.floor(input.baseline.pushups * planConfig.repFractionOfMax))
    const setTargets = distributeReps(pushTargetForDay, pushRepsPerSet)
    exercises.push({ key: 'pushups', label: pushDays.includes(dow) ? 'Push-ups' : 'Daily push-up minimum', sets: setTargets.length, reps: Math.max(...setTargets), setTargets })
    if (coreDays.includes(dow)) {
      if (dow === 1 || dow === 3) {
        const metric = dow === 1 ? 'situps' : 'crunches'
        const baseline = input.baseline[metric]
        const reps = Math.max(planConfig.minimumRepsPerSet, Math.floor(baseline * planConfig.repFractionOfMax))
        const volume = metric === 'situps' ? situpTargets.get(iso(date)) ?? baseline : crunchTargets.get(iso(date)) ?? baseline
        const setTargets = distributeReps(volume, reps)
        exercises.push({ key: metric, label: metric === 'situps' ? 'Sit-ups' : 'Cross-leg reverse crunches', sets: setTargets.length, reps: Math.max(...setTargets), setTargets })
      } else exercises.push({ key: 'plank', label: 'Plank', seconds: plankTargets.get(iso(date)) ?? input.baseline.plankSeconds })
    }
    if (runDays.includes(dow)) {
      const miles = dailyRunTargets.get(iso(date)) ?? 1.2
      const targetPace = input.passing!.runTimeSeconds / 2
      const easyPace = Math.max(input.baseline.runTimeSeconds / 2, targetPace * 1.15)
      exercises.push({ key: 'run', label: 'Run', miles, paceSecondsPerMile: Math.round(easyPace), targetPaceSecondsPerMile: Math.round(targetPace), kind: dow === 2 ? 'tempo' : dow === 6 ? 'intervals' : 'easy' })
    }
    const restDay = !pushDays.includes(dow) && !coreDays.includes(dow) && !runDays.includes(dow)
    exercises.push({ key: 'stretch', label: 'Stretch', minutes: 5 })
    result.push({ planVersion: 2, date: iso(date), restDay, exercises, warning })
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
