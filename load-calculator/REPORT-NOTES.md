# Inspector report implementation notes

Static HTML/CSS/JavaScript; no runtime packages or build step. Node 18+ supports the dependency-free tests:

```sh
cd load-calculator
npm test
npm run check
```

## Single-dwelling export

- The dedicated single-dwelling renderer replaces the legacy duplicated report sections. The normal report has four intentional page starts: project/proposal/final result, equipment inventory, worked calculation with one before/after comparison, and assumptions/review/sign-off. Long equipment lists, source notes or complex calculations may continue onto extra pages rather than shrink or clip.
- `buildSingleInspectorReport` is a pure presentation helper. It obtains before/after engine components through the existing public `buildSingleReportTrace`; the trace and its regression tests remain available. Calculation formulas, thresholds, rounding and panel-check policy are unchanged.
- The six-column inventory contains contributing existing equipment and every proposed row. Zero existing entries collapse to a single “No connected load entered for…” line with an absence-not-verified qualification. Nonzero excluded equipment is retained in a concise note with its reason. Classification reflects the **after-proposal** scenario; changed before/after HVAC and other-load arithmetic is shown on the calculation page.
- Rating basis shows breaker A × V estimates, per-item nameplate kW and quantity, or entered row-total connected load. A single breaker-estimate warning follows the table. Optional model/source evidence follows as full-width text, preventing long metadata from bloating the six-column rows. All user-entered text is rendered with `textContent`, not interpolated HTML.
- A no-range other-load pool and diversified/interlocked HVAC do not have additive per-device demands. Their inventory rows explicitly point to the pooled calculation. Managed existing EVSE uses the entered EVEMS maximum; additional/proposed EVSE remains separately counted at 100% under the existing engine behavior.
- Worked arithmetic covers basement weighting, effective area, additional 90 m² portions, both range branches, other-load factors, heat diversity/interlock, water and EV demand, Item B and current conversion. Only changed arithmetic is repeated between scenarios. User-facing output does not print `ceil()`, `max()` or `min()` expressions.
- One comparison table shows every demand component, Item A, Item B, governing load, Item A current and governing current. The explanation identifies which value governs and why a real addition may leave the final requirement unchanged.
- Print body/calculation text is generally 10 pt; inventory is 9.5 pt, with wrapping and repeated headers. Headline current retains the existing whole-amp upward rounding; table current and area generally use one decimal and kW two decimals. Engine values and threshold decisions remain full precision.

## Preserved behavior requiring review

This is a report presentation change, **not** a CEC compliance audit or assurance of inspector acceptance.

- Positive per-item kW overrides breaker A × V. Blank means unknown. Entered **0 kW still falls back to the breaker**, rather than overriding it; inventory and notes distinguish this. Zero does not verify equipment absence.
- Other-load qualification uses each row total including quantity, strictly greater than 1500 W. With no primary electric range, the first 6 kW of that pool is at 100% and the balance at 25%. Additional range presets remain in the other-load category.
- Additional/proposed EVSE is added at 100% after existing EVSE management/omission; an existing EVEMS maximum does not cap those additions.
- Existing Item-B-versus-80% panel policy and multi-family partial-unit/selected-unit policies are retained, not validated. Confirm applicability with the authority having jurisdiction.
- Multi-family exports retain their group/diversity and rating-evidence path. Full worked multi-family diversity and selected-unit auditing are not implemented; the export continues to state that limitation.

## Verification

- Strict RED→GREEN slices were exercised for the missing inspector helper, active-only inventory, truthful pooling/exclusions, canonical human arithmetic/comparison, alternate demand branches, compact optional equipment evidence, elimination of zero-HVAC multiplication clutter, and literal custom labels/zero-rating evidence. Existing public-trace tests were retained. `npm test` now runs both `*.test.js` files.
- The canonical illustrative fixture is 1400 + 800 + (1400 × 75%) = 3250 ft² / 301.9 m², 8 kW basic, 6 kW range, and (7.2 + 1.8) × 25% = 2.25 kW other demand. Proposed 5.1 kW A/C changes Item A 16.25 → 21.35 kW; Item B remains 24 kW, so governing current remains 100 A at 240 V. The Jet tub label is explicitly illustrative, not a claim about installed equipment.
- 18 Node tests pass, including review regressions for threshold precision, an HVAC interlock winner changing, excluded-rating/quantity evidence, and identification notes on zero-connected entries. Syntax and diff-whitespace checks pass. A pre-existing independent baseline harness confirms 288 single-dwelling combinations retain original calculation outputs.
- Display precision increases when ordinary rounding would hide a threshold or make unequal comparison values look equal; entered floor-area operands retain their supplied precision. Equipment identification notes are collected independently of inclusion, labelled Existing/Proposed, and excluded-load notes retain the same rating basis and quantity as active rows.
- Parent verification reran the canonical and complex browser exports, visually inspected all canonical pages, and exercised twelve loads with long equipment/source notes. The canonical example remains four pages; the long-input report expands and retains every end marker and sign-off.
- Parent-workspace QA `qa-tools/inspector-report.cjs` was observed failing against the legacy nine-page report, then passing all assertions against a four-page Chromium PDF with project metadata, optional proposed model/source, named illustrative load, unchanged totals and no software functions/repeated missing-data placeholders. Output: `artifacts/inspector-redesign.pdf`; generated artifacts are outside the deployed repository. Inventory and calculation pages were visually inspected for readable columns and unclipped content. Parent review separately verifies the final PDF.

- Additional Chromium smoke checks pass for literal HTML equipment text, positive-nameplate override and quantity, 390/768/1440 px screens, both multi-family export paths with partial-unit loads, and gas-range/heating-diversity/interlock/managed-EV arithmetic. The extra QA script is `qa-tools/inspector-extra-subagent.cjs`, outside the repository.

No commit, push or deployment is implied by these checks.
