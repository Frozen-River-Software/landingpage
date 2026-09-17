const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('./app.js');

const fixture = () => ({
  unitSystem: 'ft2', area: { ground: 2000, above: 500, basement: 1000 },
  rangeAmps: 40, rangeKw: '', dryerAmps: 30, dryerKw: '',
  acAmps: 0, acKw: '', waterAmps: 0, waterKw: '', heatAmps: 0, heatKw: '',
  heatMethod: 'residential-zoned', hvacInterlocked: false,
  evAmps: 0, evKw: '', evMode: 'full', evManagedKw: 0,
  quoteLoads: [{ name: 'Illustrative additional load', source: 'Synthetic test fixture only', amps: 15, volts: 120, qty: 1, bucket: 'other' }],
});
const step = (stage, key) => stage.steps.find(s => s.key === key);

test('trace includes heat, interlock, water, EV management and proposed EV at full load', () => {
  const input = { ...fixture(), rangeKw: 15, heatKw: 16, acKw: 6,
    hvacInterlocked: true, waterKw: 4, evKw: 12, evMode: 'managed', evManagedKw: 3 };
  const trace = calc.buildSingleReportTrace(input, [{ watts: 2000, bucket: 'evse', name: 'New EV' }]);
  assert.match(step(trace.after, 'heat').formula, /min\(16, 10\) \+ max\(0, 16 − 10\) × 75% = 14.5 kW/);
  assert.match(step(trace.after, 'hvac').formula, /max\(14.5, 6\) = 14.5 kW/);
  assert.match(step(trace.after, 'water').formula, /4 \+ 0 = 4 kW/);
  assert.match(step(trace.after, 'ev').formula, /EVEMS maximum 3 kW \+ 2 kW .* = 5 kW/);
  assert.match(step(trace.after, 'range').formula, /6 \+ max\(0, 15 − 12\) × 40% = 7.2 kW/);
  assert.match(trace.warnings.join(' '), /additional.*EVSE.*100%/i);
  const omitted = calc.buildSingleReportTrace({ ...input, evMode: 'omitted', hvacInterlocked: false, heatMethod: 'full' });
  assert.match(step(omitted.after, 'ev').formula, /omitted.*0 kW/i);
  assert.match(step(omitted.after, 'hvac').formula, /16 \+ 6 = 22 kW/);
});

test('inventory keeps every row, metadata, unknown versus zero and breaker estimate warning', () => {
  const input = fixture();
  input.equipment = { ac: { model: 'Existing <model>', source: 'Site notes & photo' } };
  input.acKw = 0;
  input.quoteLoads.push({ name: 'Unknown appliance', amps: 0, volts: 240, qty: 1, kw: '', bucket: 'other' });
  const trace = calc.buildSingleReportTrace(input, [{ name: 'New AC', watts: 5100, kw: '5.1', qty: 1,
    bucket: 'ac', model: '<script>not HTML</script>', source: 'Illustrative only' }]);
  assert.equal(trace.loads.length, 9);
  assert.equal(trace.loads.find(l => l.name === 'New AC').model, '<script>not HTML</script>');
  assert.equal(trace.loads.find(l => l.name === 'New AC').source, 'Illustrative only');
  assert.match(trace.loads.find(l => l.name === 'Existing AC').ratingText, /Entered 0 kW/);
  assert.match(trace.loads.find(l => l.name === 'Unknown appliance').ratingText, /Unknown/);
  assert.match(trace.loads.find(l => l.name === 'Existing range').ratingText, /Unknown/);
  assert.match(trace.loads.find(l => l.name === 'Existing range').formula, /40 A × 240 V × 1 = 9.6 kW/);
  assert.match(trace.warnings.join(' '), /BREAKER ESTIMATE/);
  assert.match(trace.loads.find(l => l.name === 'Unknown appliance').treatment, /≤ 1.5 kW.*excluded/);
});

test('proposed breaker-derived watts retain their estimate origin', () => {
  // A caller may retain already computed watts together with their origin.
  const load = { name: 'Estimated new AC', kw: '', amps: 30, volts: 240, qty: 1,
    watts: 7200, bucket: 'ac', ratingBasis: 'breaker-estimate' };
  const rating = calc.describeLoadRating(load);
  assert.equal(rating.connectedW, 7200);
  assert.equal(rating.isEstimate, true);
  assert.match(rating.formula, /30 A × 240 V × 1 = 7.2 kW — BREAKER ESTIMATE/);
});

test('no-range pool, 1500 W threshold, basement exclusion, and every amps denominator', () => {
  const input = { ...fixture(), gasRange: true, dryerAmps: 0, unitSystem: 'm2',
    area: { ground: 50, above: 0, basement: 200 }, quoteLoads: [
      { name: 'Threshold', watts: 1500 }, { name: 'Just over', watts: 1501 }, { name: 'Large', watts: 8000 },
    ] };
  const trace = calc.buildSingleReportTrace(input);
  assert.equal(trace.after.result.components.other.demand, 6875.25);
  assert.match(step(trace.after, 'other').formula, /min\(T, 6\).*max\(0, T − 6\) × 25% = 6.87525 kW/);
  assert.match(step(trace.after, 'minimum').formula, /50 < 80 m² → 14.4 kW/);
  assert.match(trace.loads.find(l => l.name === 'Threshold').treatment, /excluded/);
  for (const [mode, denominator] of [['single-208', '208 V'], ['three-208', '(√3 × 208 V)'], ['three-240', '(√3 × 240 V)']]) {
    const s = calc.buildSingleReportTrace(input, [], mode).after;
    assert.ok(step(s, 'amps').formula.includes(`÷ ${denominator}`));
    assert.equal(step(s, 'amps').value, calc.ampsForWatts(s.result.totalW, mode).amps);
  }
});

test('known per-item kW adapter works for single and shared multi-family load rows', () => {
  assert.equal(typeof calc.prepareLoadInput, 'function');
  const load = calc.prepareLoadInput({ name: 'Known load', kw: '1.8', amps: 30, volts: 240, qty: 2, bucket: 'other', model: 'M', source: 'S' });
  assert.equal(load.watts, 3600);
  assert.equal(load.model, 'M');
  assert.equal(load.source, 'S');
  assert.equal(calc.calculateSingle({ ...fixture(), quoteLoads: [load] }).components.other.total, 10800);
  for (const buildingType of ['row-housing', 'apartment']) {
    const result = calc.calculateMulti({ unitSystem: 'm2', buildingType,
      groups: [{ qty: 2, area: { ground: 100 }, rangeKw: 10, quoteLoads: [load] }] });
    assert.equal(result.summaries[0].otherW, 900);
  }
  assert.match(calc.describeLoadRating(calc.prepareLoadInput({ kw: '', amps: 15, volts: 120, qty: 1 })).formula, /1.8 kW/);
  assert.match(calc.describeLoadRating(calc.prepareLoadInput({ kw: 0, amps: 15, volts: 120, qty: 1 })).ratingText, /Entered 0 kW/);
});

test('zero area, basic-load boundaries and both minimum branches remain traceable', () => {
  for (const [area, basicW, itemB] of [[0, 0, 14400], [79.999, 5000, 14400], [80, 5000, 24000], [90, 5000, 24000], [90.001, 6000, 24000], [180, 6000, 24000], [180.001, 7000, 24000]]) {
    const input = { ...fixture(), unitSystem: 'm2', area: { ground: area, basement: 0, above: 0 } };
    const trace = calc.buildSingleReportTrace(input);
    assert.equal(step(trace.before, 'basic').value, basicW);
    assert.equal(step(trace.before, 'minimum').value, itemB);
    assert.equal(trace.before.result.totalW, Math.max(trace.before.result.itemA, itemB));
  }
});

test('report does not mutate inputs and inventory sums stay tied to engine buckets', () => {
  const input = fixture();
  input.quoteLoads.push(...['heat', 'ac', 'water', 'evse'].map(bucket => calc.prepareLoadInput({ name: bucket, kw: 2, qty: 2, bucket })));
  const proposed = ['heat', 'ac', 'water', 'evse', 'other'].map(bucket => calc.prepareLoadInput({ name: `New ${bucket}`, kw: 3, qty: 1, bucket }));
  const original = JSON.stringify({ input, proposed });
  const trace = calc.buildSingleReportTrace(input, proposed);
  assert.equal(JSON.stringify({ input, proposed }), original);
  for (const bucket of ['heat', 'ac', 'water', 'evse']) {
    const connectedW = trace.loads.filter(l => l.bucket === bucket).reduce((sum, load) => sum + load.connectedW, 0);
    const expected = { heat: trace.after.result.components.heatConnectedW, ac: trace.after.result.components.acW,
      water: trace.after.result.components.waterW, evse: trace.after.result.components.evW }[bucket];
    assert.equal(connectedW, expected);
  }
  assert.equal(trace.loads.filter(l => l.scope === 'Proposed addition').length, proposed.length);
});

test('partial-unit known-kW loads preserve apartment and row-housing counts', () => {
  for (const buildingType of ['row-housing', 'apartment']) {
    const load = calc.prepareLoadInput({ name: 'AC', kw: '5.1', qty: 1, amps: 40, volts: 240, bucket: 'ac', unitCount: 1 });
    const result = calc.calculateMulti({ unitSystem: 'm2', buildingType,
      groups: [{ qty: 4, area: { ground: 100 }, rangeKw: 10, quoteLoads: [load] }] });
    assert.equal(result.unitCount, 4);
    assert.equal(result.summaries.reduce((sum, row) => sum + row.qty * row.acW, 0), 5100);
    assert.equal(result.summaries.reduce((sum, row) => sum + row.qty, 0), 4);
  }
});

test('range inventory states zero demand when no connected range is entered', () => {
  for (const rangeKw of ['', 0]) {
    const trace = calc.buildSingleReportTrace({ ...fixture(), rangeAmps: 0, rangeKw, gasRange: false });
    assert.equal(trace.after.result.components.rangeW, 0);
    assert.match(trace.loads.find(load => load.key === 'range').treatment, /No electric range.*0 kW/);
    assert.doesNotMatch(trace.loads.find(load => load.key === 'range').treatment, /6 kW/);
  }
});

test('single report works the requested before/after fixture from engine values', () => {
  assert.equal(typeof calc.buildSingleReportTrace, 'function', 'missing pure worked-report helper');
  const input = fixture();
  const proposed = [{ name: 'Proposed AC', watts: 5100, kw: '5.1', qty: 1, bucket: 'ac' }];
  const trace = calc.buildSingleReportTrace(input, proposed, 'single-240');
  assert.deepEqual(trace.before.result, calc.calculateSingle(input));
  assert.deepEqual(trace.after.result, calc.calculateSingle({ ...input, quoteLoads: [...input.quoteLoads, ...proposed] }));
  assert.match(step(trace.before, 'area').formula, /3250 ft² × 0\.09290304 = 301\.93488 m²/);
  assert.match(step(trace.before, 'basic').formula, /5 \+ ceil\(\(301\.93488 − 90\) ÷ 90\) × 1 = 8 kW/);
  assert.equal(step(trace.before, 'range').value, 6000);
  assert.match(step(trace.before, 'other').formula, /\(7\.2 \+ 1\.8\) × 25% = 2\.25 kW/);
  assert.match(step(trace.after, 'ac').formula, /0 \+ 5\.1 = 5\.1 kW/);
  assert.equal(trace.before.result.itemA, 16250);
  assert.equal(trace.after.result.itemA, 21350);
  assert.match(step(trace.after, 'governing').formula, /max\(21\.35, 24\) = 24 kW/);
  assert.match(step(trace.after, 'amps').formula, /24000 W ÷ 240 V = 100 A/);
  assert.match(step(trace.before, 'itemAAmps').formula, /16250 W ÷ 240 V = 67\.70833333 A/);
  assert.match(step(trace.after, 'itemAAmps').formula, /21350 W ÷ 240 V = 88\.95833333 A/);
});
