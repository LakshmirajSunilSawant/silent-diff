# Silent-Diff — Product Requirements Document

Nov 8, 2026 · @Sakshi

## Overview

Silent-Diff is a browser tool that takes two versions of a CSV or Excel file and shows exactly what changed — added rows in green, deleted rows in red, edited cells in yellow — without the files ever leaving the user's machine.

**The problem.** Business data moves between people as file attachments: `leads_v2.csv`, `leads_final.csv`, `leads_final_FINAL.xlsx`. When someone asks "what did you change?", the recipient has no good way to answer.

- **Eyeballing in Excel** fails past a few dozen rows.
- **Formula workarounds** (`=IF(Sheet1!A2=Sheet2!A2,…)`, conditional formatting) assume rows are in the same order, which they rarely are after a sort or filter.
- **Git diff and text diff tools** compare lines, so one reordered column or re-sorted file produces a wall of noise.
- **Spreadsheet add-ons** that do key-based diffing live inside Google Sheets and need permission to read the user's spreadsheets, which is a non-starter for sensitive files like leads or payroll exports.

**The product.** Drop two files, get a readable diff in seconds. Silent-Diff matches rows by a key column it detects automatically, ignores formatting noise the user opts out of, and summarizes the change in one line before showing the detail. All parsing and diffing runs client-side.

## Goals, non-goals and success metrics

The product succeeds if a non-technical user can answer "what changed between these two files?" in under a minute, and trusts the answer.

**Goals**

1. Correctly classify every row as added, deleted, modified or unchanged when a key column exists.
2. Produce a sensible diff for keyless files via row alignment.
3. Keep false positives from formatting noise near zero with opt-in normalization.
4. Process everything locally: no upload, no account, no server-side storage.
5. Let users take the result with them as a highlighted Excel file.

**Non-goals (v1)**

- Merging or reconciling changes back into a file.
- Three-way diffs or comparing more than two files.
- Live connections to Google Sheets, Excel Online or databases.
- Diffing formulas, formatting, charts or multiple sheets per workbook (first sheet only).
- Collaboration features such as comments or shared links.

**Success metrics**

| Metric | Target | How measured |
| --- | --- | --- |
| Time to first diff | < 3 s for a 10k-row × 20-col pair | Performance benchmark suite |
| Key auto-detection accuracy | ≥ 90% picks the column a human would | Labelled test corpus of 50 real-world file pairs |
| False-positive rate with normalization on | < 1% of reported cell changes | Same corpus, manually verified |
| Export usage | ≥ 25% of sessions export | Privacy-respecting, count-only analytics |
| Return use | ≥ 30% of users run a second diff within 30 days | Count-only analytics, no file data |

## Users and user stories

The primary user is a spreadsheet-literate business person who receives revised files from colleagues and has no coding background.

| Persona | Context | What they need most |
| --- | --- | --- |
| Ops / RevOps analyst | Receives updated lead or account lists from sales weekly | Which records changed owner or status, fast |
| Finance associate | Reconciles monthly exports from two systems | Confidence nothing was silently dropped; numeric normalization |
| Data engineer / analyst | Validates a pipeline's output before and after a change | Keyless diffs, large files, exact cell-level changes |
| Recruiter or student TA | Compares roster or grade exports | Simple drag-and-drop, no setup |

**Key user stories**

1. As an analyst, I drop two files and immediately see a one-line summary of what changed, so I know whether to dig in.
2. As an analyst, I see the key column the tool picked and can change it with one click if it's wrong.
3. As a finance user, I turn on "compare numbers numerically" so `1,000.00` and `1000` aren't flagged.
4. As any user, I filter the view to only modified rows, or only changes in one column.
5. As any user, I export the diff to Excel with the same colors to send back to the sender.
6. As a privacy-conscious user, I can verify the files are never uploaded (works offline after load).

## Competitive landscape and positioning

The core diff is not novel: the closest competitor already ships key matching, a plain-English summary and in-browser CSV import, so Silent-Diff must win on where it runs, not on what it computes.

| Product | Where it runs | Strengths | Gaps Silent-Diff targets |
| --- | --- | --- | --- |
| [SheetDiff](https://workspace.google.com/marketplace/app/sheetdiff_compare_two_sheets_find_differ/544557039913) (Sheets add-on) | Inside Google Sheets | Matches by ID, whole row or row order; plain-English summary; old → new values; snapshots over time; Pro is $10/year | Requires a Google account, installing an add-on and granting spreadsheet permissions; imported files become tabs in a Sheet |
| Sheets / Excel formulas | Inside the spreadsheet | Free, familiar | Assume same row order; no added/deleted detection; manual setup per file |
| Excel Spreadsheet Compare | Windows desktop | Cell-level and formula diffs | Windows-only, limited to certain Office editions (approximate, from general knowledge) |
| daff | Library / CLI (JS, Python) | Solid open-source tabular diff algorithm | Developer-facing; no drag-and-drop UI for business users |
| Beyond Compare | Paid desktop app | Powerful table compare | Install + licence; built for developers |

**Positioning.** Silent-Diff is the zero-install, zero-account option for files that arrive as attachments: open a URL, drop two files, done, with nothing uploaded and nothing to grant access to.

**Differentiators to defend**

- Works on raw `.csv`, `.tsv` and `.xlsx` directly; no Google or Microsoft account.
- Verifiably local: works offline once loaded; open-source code so claims can be audited.
- True keyless alignment (LCS with fuzzy row pairing), not just whole-row or row-order matching.
- Highlighted `.xlsx` export, so the result travels back over the same Slack or email thread.
- Free for the core use case; no row-count paywall.

## Functional requirements

P0 ships in the MVP, P1 in v1, P2 is later or optional.

| ID | Area | Requirement | Priority |
| --- | --- | --- | --- |
| F1 | Ingest | Drag-and-drop or file-picker for two files, labelled "Before" and "After", with a swap button | P0 |
| F2 | Ingest | Parse `.csv` and `.tsv` with delimiter auto-detection (comma, semicolon, tab, pipe) | P0 |
| F3 | Ingest | Handle UTF-8, UTF-8 with BOM and Windows-1252 encodings | P0 |
| F4 | Ingest | Parse `.xlsx` (first sheet), reading cell values not formulas | P1 |
| F5 | Ingest | Treat the first row as headers by default, with a toggle to turn it off | P0 |
| F6 | Columns | Match columns by header name, not position; report added and removed columns | P0 |
| F7 | Columns | Suggest renamed columns when a removed and an added column share most values | P2 |
| F8 | Key | Auto-detect the key column: unique and non-empty in both files, preferring names like id, email, sku | P0 |
| F9 | Key | Let the user override the key, including composite keys of up to 3 columns | P0 (single) / P1 (composite) |
| F10 | Key | Detect duplicate keys and list them instead of guessing a match | P0 |
| F11 | Alignment | With a key: outer join, classify each row as added, deleted, modified or unchanged | P0 |
| F12 | Alignment | Without a key: align rows by LCS over row hashes, then pair nearby deletes and adds as modifications above a similarity threshold | P1 |
| F13 | Alignment | Detect pure reordering and report it once rather than as changes | P1 |
| F14 | Normalization | Toggles: trim whitespace, ignore case, compare numbers numerically, treat empty and null-like values as equal | P0 (trim) / P1 (rest) |
| F15 | Normalization | Numeric tolerance (absolute or %) and date-format normalization | P2 |
| F16 | Normalization | Read every value as text by default so leading zeros are preserved | P0 |
| F17 | Summary | One-line summary with counts of added, deleted, modified rows and added/removed columns | P0 |
| F18 | Summary | Per-column change counts, and for numeric columns the net change | P1 |
| F19 | View | Color-coded diff table: green added, red deleted, yellow changed cells with old → new on hover | P0 |
| F20 | View | Collapse runs of unchanged rows into an expandable "N unchanged rows" bar | P0 |
| F21 | View | Filter by change type and by column; jump to next/previous change | P1 |
| F22 | View | Side-by-side mode showing both files aligned | P2 |
| F23 | Export | Download the diff as `.xlsx` with the same color highlighting and a summary sheet | P1 |
| F24 | Export | Download the diff as CSV with a `_change` column | P1 |
| F25 | CLI | Command-line version producing the same diff as JSON or a terminal table | P2 |

## UX flow and diff view

The whole flow is one page with three states, and the diff appears without the user clicking "Compare" if the tool is confident in the key.

1. **Drop.** Two drop zones, "Before" and "After". A line under them reads "Files are processed in your browser and never uploaded." A "Try sample files" link loads demo data.
2. **Confirm.** After parsing, a compact bar shows row and column counts per file, the detected key column ("Matching rows by `email`", with a dropdown to change it) and the normalization toggles. If key confidence is low, the tool stops here and asks the user to pick one.
3. **Review.** The summary line sits at the top, per-column change counts below it, then the diff table with filters and an Export button.

**Color and symbol semantics** (never color alone, for accessibility):

| Change | Row marker | Styling | Detail |
| --- | --- | --- | --- |
| Added row | `+` | Green background | All cells shown as new values |
| Deleted row | `−` | Red background, struck-through text | All cells shown as old values |
| Modified row | `~` | Neutral row, yellow changed cells | Cell shows new value; old value in a tooltip and in side-by-side mode |
| Unchanged rows | none | Collapsed into a grey "N unchanged rows" bar | Click to expand |
| Added / removed column | Header badge | Green or red header | Column listed in the summary |

**View rules**

- Show 3 unchanged rows of context around each change, like a code diff.
- Sticky header row and sticky key column when scrolling.
- Keyboard: `n` / `p` jump to next / previous change, `f` focuses the filter.
- Empty state when files are identical: "No differences found" plus a note of which normalizations were applied.

## Technical approach

Silent-Diff is a static web app: the UI stays on the main thread, and parsing, key detection, normalization and alignment run in a Web Worker so the page never freezes.

&#91;embedded content: Silent-Diff architecture · main thread and Web Worker\]

Changing the key or a normalization toggle re-runs only the worker steps from "Match + key" onward; parsed files stay in memory.

**Stack**

- TypeScript, Vite, and React or plain DOM for the UI; static hosting (GitHub Pages or Vercel) with a service worker for offline use.
- PapaParse for CSV/TSV (streaming, delimiter detection); SheetJS for reading `.xlsx`.
- ExcelJS for the highlighted `.xlsx` export, since the free SheetJS build does not write cell styles.
- A virtualized table (TanStack Virtual or hand-rolled) for rendering.

**Key detection.** Score each column present in both files: it must be non-empty and unique in both. Break ties by name (id, key, email, sku, code score higher) and by overlap of values between the files. Below a confidence threshold, ask the user instead of guessing.

**Keyed diff.** Build a hash map from key to row index for the Before file, then walk the After file once. Matched rows compare cell by cell over shared columns; unmatched keys become added or deleted. This is O(n) in rows.

**Keyless diff.** Hash each normalized row. Run a Myers / LCS diff over the two hash sequences to get runs of deletes and adds. Inside each run, pair a deleted and an added row as "modified" when enough of their cells match (threshold to be tuned). Cap the alignment size and fall back to set comparison for very large keyless files.

**Data model.** Store parsed files as columnar string arrays. The diff model is a list of operations `{type, beforeIndex, afterIndex, changedColumns}`, which both the view and the exports read from.

**Testing.** Fixture pairs for every edge case, plus property tests: diffing a file against itself returns no changes, and applying the diff to Before reproduces After.

## Non-functional requirements

Privacy is the product's main promise, so it is a hard requirement, not a feature.

| Area | Requirement |
| --- | --- |
| Privacy | No network requests carry file contents; enforced by a strict Content-Security-Policy with `connect-src 'self'`. Analytics, if any, send only anonymous counts. |
| Offline | Fully functional offline after first load (service worker cache). |
| Performance | 10k rows × 20 cols diff in < 3 s; 100k rows × 20 cols in < 15 s on a mid-range laptop; UI stays responsive throughout (work runs in a Web Worker). |
| Limits | Supports files up to 200 MB or 1M rows; above that, shows a clear message and suggests the CLI. |
| Memory | Peak memory below 4× the combined file size. |
| Rendering | Virtualized table; scrolling stays at 60 fps with 100k rendered rows. |
| Accessibility | WCAG 2.1 AA; change type conveyed by symbol and text as well as color; color-blind-safe palette option; full keyboard navigation. |
| Browsers | Latest two versions of Chrome, Edge, Firefox and Safari; desktop first, read-only usable on tablets. |
| Correctness | Deterministic output: same inputs and settings always produce the same diff. |

## Edge cases and test matrix

Each case below becomes a fixture pair in the test suite with an expected diff checked into the repo.

| Case | Example | Expected behavior |
| --- | --- | --- |
| Identical files | Same file twice | "No differences found" |
| Re-sorted rows | After file sorted by name | Zero changes with a key; one "rows reordered" note without one |
| Reordered columns | `name,email` vs `email,name` | Zero changes |
| Added / removed column | `phone` added | Column reported in summary; no row marked modified because of it |
| Leading zeros | ZIP `07030` vs `7030` | Flagged as changed (text comparison by default) |
| Number formatting | `1,000.00` vs `1000` | Changed by default; equal with numeric toggle on |
| Whitespace | `"Acme "` vs `"Acme"` | Equal with trim on (default) |
| Encoding | Windows-1252 `é` vs UTF-8 `é` | Equal after decoding |
| BOM | UTF-8 BOM on first header | Header still matches `id` |
| Delimiters | Semicolon file vs comma file | Both parsed correctly; contents compared |
| Quoted newlines | Address field with a line break | Parsed as one cell |
| Duplicate keys | Two rows with `id=42` | Listed as duplicates; not matched |
| Empty key values | Blank `email` in some rows | Key confidence drops; user prompted |
| Ragged rows | Row with fewer columns than header | Missing cells treated as empty; warning shown |
| Keyless edit | One cell changed in a file with no unique column | Shown as one modified row, not delete + add |
| Large file | 100k × 20 | Meets performance targets; UI responsive |
| Header-only file | Before has rows, After has headers only | All rows deleted |
| Different headers entirely | Two unrelated files | Warning: "These files share no columns" |

## Risks and open questions

The biggest risk is not technical: an established add-on already covers most of the feature list, so adoption depends on the privacy and zero-install story landing.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Feature overlap with SheetDiff and similar add-ons | Few users switch | Lead with no-install, no-account, open source; target users outside Google Workspace |
| Wrong key auto-detection | Diff looks badly wrong; trust lost on first use | Show the chosen key prominently; stop and ask when confidence is low |
| Noisy diffs from formatting | Users see thousands of false changes and leave | Sensible normalization defaults; a "changes look like formatting" hint when most changes differ only by case, whitespace or number format |
| Browser memory limits on large files | Tab crashes | Streaming parse, columnar storage, hard size limit with a clear message, CLI for big files |
| Keyless alignment is slow or ambiguous | Poor results on large unkeyed files | Cap LCS input size, fall back to hash-set comparison, label results "approximate" |
| Privacy claim not believed | Main differentiator wasted | Open-source repo, strict CSP, offline mode users can verify |

**Open questions**

- [ ] Is this a portfolio project, a free tool or a paid product? This decides whether analytics, accounts or monetization belong in scope at all.
- [ ] Ship as a web app only, or also a desktop wrapper (Tauri) for users who distrust any web page?
- [ ] Should `.xlsx` support cover multiple sheets in v1, or stay first-sheet-only?
- [ ] What similarity threshold should pair a deleted and an added row as "modified" in keyless mode? Needs tuning on real data.
- [ ] Where will the 50-pair real-world test corpus come from without using anyone's private data?
