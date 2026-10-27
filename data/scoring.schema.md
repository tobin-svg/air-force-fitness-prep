# `data/scoring.json` schema

This file is the source of current general Air Force PFRA scoring values. It uses the official AFPC chart effective 1 March 2026 (corrected 17 March 2026).

- `schemaVersion`: integer format version; currently `2`.
- `status`: `LOADED` only when the official chart tables are present.
- `source`: official document/page title, direct URL, and retrieval date (`YYYY-MM-DD`).
- `passingComposite`: official composite minimum.
- `records`: one entry per official age bracket and sex/category. The names must match the values in Settings exactly.
- `components`: include `pushups`, `plank`, `run`, `waistToHeight`, `situps`, and `crunches`.
- `unit` is `reps`, `seconds`, or `ratio`. `higherIsBetter` defines which direction improves performance. `minimum` is the raw threshold for the passing floor where applicable.
- `bands` is the official raw-result-to-points lookup, represented as `{ "minRaw": number, "maxRaw": number | null, "points": number }` entries. Bounds are inclusive; `maxRaw: null` means there is no upper bound. Enter boundaries and points exactly as listed by the official source. The app uses direct band lookup and does not interpolate or invent intermediate scores.

The app scores push-ups (15 points), one selected core event (15), the 2-mile run (50), and waist-to-height ratio (20), with a 75-point composite passing score plus the event minimums. The waist-to-height ratio is waist divided by height, rounded to two decimal places.
