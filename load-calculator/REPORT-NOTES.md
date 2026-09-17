# Worked-report implementation notes

This is a static calculator; there are no runtime packages or build step. Tests require a Node version with `node:test` (Node 18+).

```sh
cd load-calculator
npm test
npm run check
```

## Report scope

- Single dwelling exports include an individual equipment inventory (including inactive/unknown rows), before/after Item A versus Item B, and explicit substitution arithmetic for area, basic load, range, heating, AC/interlock, water, EVSE, other loads, minimum and amps conversion.
- `calculateSingle` exposes its existing intermediates as `components`. The pure `buildSingleReportTrace` uses those values; it does not implement a second demand calculation.
- Equipment model and source/nameplate notes are optional user-entered text, not verified data. Single fixed inputs, shared additional-load rows and proposed rows support these notes. No equipment data is prefilled.
- Positive **per-item** nameplate kW on shared additional-load rows is adapted to the engine's existing connected-watts input. Quantity applies once. This works for single dwellings, apartment groups, row-housing groups and partial-unit loads.
- Multi-family exports retain their existing group/diversity calculations and add rating/source evidence for every fixed group input, additional row and proposed row. Full step-by-step multi-family diversity and selected-unit auditing are **not** implemented. That limitation is stated in the export. Fixed group inputs do not have individual model/source fields; their source is printed as not supplied.
- Print CSS allows multiple pages, repeats table headers, keeps normal rows together, wraps long text and starts the inventory and each single-dwelling worked scenario on a new page. Chromium PDF pagination was exercised and the nine-page illustrative worksheet inspected visually; all extracted words were inside page bounds. Browser differences still warrant checking the actual submission PDF.

## Preserved behavior requiring review

This change is not a CEC compliance audit and does not establish inspector acceptance. Original demand formulas and panel/feeder policies are retained.

- A positive kW rating overrides breaker A × V. **Blank means unknown. An entered 0 kW historically falls back to the breaker**, rather than overriding it. The UI and report distinguish these inputs and explain that behavior. Setting breaker amps to zero with no positive rating enters no connected load; that does not verify equipment absence.
- Additional/proposed EVSE is added at 100% after the existing EVSE management/omission calculation. The existing EVEMS maximum does not cap these rows. Reports warn about this rather than silently changing the rule.
- Other-load qualification is evaluated on each row's total including quantity, strictly greater than 1500 W. Without a primary electric range, the first 6 kW of the qualifying pool is taken at 100%, the remainder at 25%.
- Additional range presets remain in the existing `other` bucket. They do not become the primary range formula.
- The existing Item-B-versus-80% panel policy and multi-family partial-unit allocation/selected-unit policies are not validated or revised. Confirm applicability with the authority having jurisdiction.

## Verification

TDD: the first fixture test was run against the missing report helper and failed (`undefined` instead of `function`). Further tests were run while heat/EV steps, inventory/source evidence and the kW adapter were missing (4 failing, 1 passing), then implemented. The Node suite now covers the requested illustrative fixture, alternate formulas, threshold/minimum boundaries, evidence preservation, input immutability, and shared multi-family kW/quantity handling.

The 1.8 kW extra load in the test fixture is explicitly illustrative, not a claim about installed equipment. The fixture verifies 3250 ft² → 301.93488 m², 8 kW basic, 6 kW range, (7.2 + 1.8) × 25% = 2.25 kW other, and 5.1 kW proposed AC: Item A 16.25 → 21.35 kW, both below the 24 kW minimum, yielding 24000 W ÷ 240 V = 100 A.

A separate deterministic comparison against baseline commit `6705d3a` exercised 360 original-input cases across single, apartment and row-housing calculations. All original result fields were identical (excluding the newly added `components` field).

Final verification: 10 Node tests pass, syntax and diff-whitespace checks pass. Independent Chromium exercises cover nameplate overrides, quantity multiplication, equipment/source propagation, literal HTML handling, 390/768/1440 px screen widths, both multi-family export paths with a partial-unit load, and gas-range/heat-interlock/EVEMS scenarios. An additional 288 single-dwelling comparisons preserve baseline calculation results. Review caught and fixed a contradictory range-inventory label when no connected range is entered; a regression test covers that branch. Both Item-A current and governing current now print their complete conversions. Browser harnesses and illustrative PDFs are outside the deployed repository in the parent workspace's `qa-tools/` and `artifacts/` directories. No deployment is implied by these checks.
