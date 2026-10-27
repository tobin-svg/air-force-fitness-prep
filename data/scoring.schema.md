# `data/scoring.json` schema

This file is the only source of Air Force scoring values in the app. The checked-in file is intentionally a placeholder and must never be used to calculate a score or training target.

- `schemaVersion`: integer format version; currently `1`.
- `status`: set to `LOADED` only after replacing every placeholder using an official Air Force source.
- `source`: official document/page title, direct URL, and retrieval date (`YYYY-MM-DD`).
- `passingComposite`: official composite minimum.
- `records`: one entry per official age bracket and sex/category. The names must match the values in Settings exactly.
- `components`: include `pushups`, `plank`, `run`, and at least one of `situps` or `crunches`.
- `unit` is `reps` or `seconds`. `higherIsBetter` defines which direction improves performance. `minimum` is the official pass minimum in the given metric.
- `bands` is the official raw-result-to-points lookup, represented as `{ "minRaw": number, "maxRaw": number | null, "points": number }` entries. Bounds are inclusive; `maxRaw: null` means there is no upper bound. Enter boundaries and points exactly as listed by the official source. The app uses direct band lookup and does not interpolate or invent intermediate scores.

Do not infer missing minimums or copy values from unofficial summaries. Keep the official source and scoring version with this file so future updates are traceable.
