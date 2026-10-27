export type PlanInputs = {
  shipDate: string
  startDate: string
  baseline: { pushups: number; situps: number; crunches: number; plankSeconds: number; runTimeSeconds: number }
  /** Passing minima must come from validated scoring.json data. */
  passing: { pushups: number; situps: number; crunches: number; plankSeconds: number; runTimeSeconds: number } | null
  overPrepMultiplier: number
}

export type ExercisePlan = { key: 'pushups' | 'core' | 'situps' | 'crunches' | 'plank' | 'run' | 'stretch'; label: string; sets?: number; reps?: number; setTargets?: number[]; seconds?: number; miles?: number; minutes?: number; paceSecondsPerMile?: number; targetPaceSecondsPerMile?: number; kind?: 'easy' | 'intervals' | 'tempo' }
export type DayPlan = { planVersion: number; date: string; restDay: boolean; exercises: ExercisePlan[]; warning?: string }
export type PlanResult = { ready: boolean; warning?: string; days: DayPlan[] }
