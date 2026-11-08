# Silent-Diff

Compare two versions of a CSV, TSV or Excel file and see exactly what changed: added rows in green, deleted rows in red, edited cells in yellow. Everything runs in the browser. Files are never uploaded.

See `Silent-Diff — Product Requirements Document.md` for the full spec.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit, edge-case and property tests
npm run build      # static site in dist/ (with CSP + offline service worker)
npm run preview    # serve the production build
npm run bench      # performance check against the PRD targets
npm run cli -- examples/leads_v1.csv examples/leads_final.csv
```

Click **Try sample files** on the start page to see a demo diff.

## What it does

| Area | Features |
| --- | --- |
| Ingest | Drag and drop or file picker, Before/After with a swap button; dropping two files at once fills both. CSV/TSV with delimiter detection (comma, semicolon, tab, pipe); UTF-8, UTF-8 BOM, UTF-16 BOM and Windows-1252; `.xlsx` (first sheet, cell values not formulas); header row toggle; ragged rows padded with a warning. |
| Columns | Matched by header name (exact, then case/space-insensitive), not position. Added and removed columns are reported and never mark rows as modified. |
| Key | Auto-detects a key column (unique and filled in both files; prefers names like id, email, sku; ignores 1..n row numbers). If confidence is low, the app stops and asks. Override with any column, or a composite key of up to 3 columns. Duplicate and empty keys are listed, not guessed. |
| Alignment | Keyed: O(n) hash join. Keyless: Myers diff over row hashes, moved rows detected as reordering, and deleted/added rows paired as "modified" when at least 50% of cells match. Very large, very different keyless files fall back to a set comparison labelled "approximate". |
| Normalization | Trim whitespace (default on), ignore case, compare numbers numerically (`1,000.00` = `1000`), empty = null. Values are read as text, so `07030` ≠ `7030` by default. A hint appears when most changes look like formatting. |
| Summary | One-line counts, per-column change counts, net change for numeric columns, "rows reordered" note. |
| View | Virtualized table with sticky header and key column, `+ − ~` markers as well as colors, old → new on hover or inline, runs of unchanged rows collapsed with 3 rows of context, filters by change type and column, `n`/`p` to jump between changes, `f` to focus the filter. Color-blind palette and dark mode. |
| Export | `.xlsx` with the same highlighting, old values as cell notes, and a Summary sheet; `.csv` with `_change` and `_changed_columns` columns. |
| CLI | `npm run cli -- before after [--key id] [--no-key] [--json] [--numeric] …` with the same engine. Exit code 1 when files differ. |

## Privacy

- All parsing and diffing runs in a Web Worker in the page. There is no server code.
- The production build ships a Content-Security-Policy with `connect-src 'self'`, so the page cannot send data to any other origin.
- A service worker caches every build file, so after the first visit the app works with the network off. You can check this yourself: load the page, go offline, and compare files.
- No analytics.

## Project layout

```
src/
  core/          Engine, shared by the web app, worker and CLI (no DOM code)
    parse.ts       Decoding, CSV/TSV/XLSX parsing into columnar string arrays
    columns.ts     Column matching by header name
    key.ts         Key column detection and confidence
    normalize.ts   Normalization options and number parsing
    myers.ts       Myers shortest edit script
    diff.ts        Keyed and keyless diff, summary
  worker.ts      Web Worker: holds parsed files, runs detect/diff on request
  client.ts      Promise wrapper around the worker
  ui/            React UI (App, DropZones, ConfirmBar, DiffView, styles)
  export.ts      .xlsx (ExcelJS) and .csv export
  samples.ts     Demo files
  cli.ts         Command-line version
  sw-template.js Service worker; vite.config.ts fills in the file list
test/
  diff.test.ts   Edge-case matrix from the PRD, key detection, property tests
  bench.ts       Performance benchmark
examples/        Sample file pair for the CLI
```

## Performance

`npm run bench` on a laptop (Node 22):

| Case | Time | PRD target |
| --- | --- | --- |
| 10k × 20, keyed | ~0.1 s | < 3 s |
| 10k × 20, keyless | ~0.1 s | < 3 s |
| 100k × 20, keyed | ~0.8 s | < 15 s |
| 100k × 20, keyless | ~1.1 s | < 15 s |

Limits: 200 MB or 1,000,000 rows per file in the browser; above that the app suggests the CLI.

## Not built yet

From the PRD's P2 list: suggesting renamed columns (F7), numeric tolerance and date normalization (F15), and a full side-by-side view (F22). "Show old values inline" covers part of F22.

## Deploying

`npm run build` produces a static site in `dist/` that uses relative paths, so it works on GitHub Pages, Vercel, Netlify or any static host.
