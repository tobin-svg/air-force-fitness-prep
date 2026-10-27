/** Editable training-plan guardrails. Volume is normalized against the supplied targets. */
export const planConfig = {
  pushDaysBeforeFinalEightWeeks: 3,
  pushDaysFinalEightWeeks: 4,
  coreDaysPerWeek: 3,
  runDaysBeforeFinalEightWeeks: 3,
  runDaysFinalEightWeeks: 3,
  weeklyIncreaseCap: 0.15,
  startFractionOfBaseline: 0.60,
  peakFractionOfOverPrepTarget: 1.50,
  deloadFraction: 0.70,
  taperFraction: 0.60,
  taperDays: 5,
  peakWeeksBeforeShip: 2,
  minimumRepsPerSet: 3,
  repFractionOfMax: 0.45,
} as const
