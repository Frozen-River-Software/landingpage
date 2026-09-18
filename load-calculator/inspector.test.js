const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('./app.js');
const fixture = () => ({
  unitSystem: 'ft2', area: { ground: 1400, above: 800, basement: 1400 },
  rangeAmps: 40, dryerAmps: 30, acAmps: 0, waterAmps: 0, heatAmps: 0, evAmps: 0,
  heatMethod: 'residential-zoned', hvacInterlocked: false, evMode: 'full',
  quoteLoads: [{ name: 'Jet tub (illustrative sample)', amps: 15, volts: 120, qty: 1, bucket: 'other' }],
});
const proposal = () => [{ name: 'Air conditioner', kw: '5.1', watts: 5100, qty: 1, bucket: 'ac' }];

test('threshold decisions retain the digits needed to verify inequalities', () => {
  const base = { ...fixture(), unitSystem: 'm2', area: { ground: 90.01, above: 0, basement: 0 } };
  const basic = calc.buildSingleInspectorReport(base);
  assert.match(JSON.stringify(basic.worked), /Remaining 0\.01 m² requires 1/);
  const portions = calc.buildSingleInspectorReport({ ...base, area: { ground: 180.01, above: 0, basement: 0 } });
  assert.match(JSON.stringify(portions.worked), /Remaining 90\.01 m² requires 2/);
  const minimum = calc.buildSingleInspectorReport({ ...base, area: { ground: 79.99, above: 0, basement: 0 } });
  assert.match(JSON.stringify(minimum.worked), /79\.99.*Below 80 m²/);
  const compound = calc.buildSingleInspectorReport({ ...base, area: { ground: 39.999, above: 39.999, basement: 0 } });
  assert.match(JSON.stringify(compound.worked), /39\.999 \+ 39\.999 = 79\.998 m²/);
  const nearEqual = calc.buildSingleInspectorReport({ ...base, area: { ground: 100, above: 0, basement: 0 },
    rangeAmps: 0, dryerAmps: 0, quoteLoads: [], waterKw: 17.999 });
  assert.match(nearEqual.governingNote, /24\.0{2,} kW is greater than the 23\.999 kW/);
  assert.equal(nearEqual.comparison.find(row => row[0].includes('Item A'))[2], '23.999 kW');
});

test('excluded loads retain quantity and rating evidence when HVAC winner changes', () => {
  const input = { ...fixture(), heatAmps: 25, acKw: 4, hvacInterlocked: true,
    quoteLoads: [calc.prepareLoadInput({ name: 'Small units', kw: 0.5, qty: 2, bucket: 'other' })] };
  const report = calc.buildSingleInspectorReport(input, [{ name: 'Added A/C', watts: 5000, bucket: 'ac' }]);
  assert.match(report.excludedNote, /25 A × 240 V, breaker estimate/);
  assert.match(report.excludedNote, /0\.5 kW × 2/);
  assert.deepEqual(report.comparison.find(row => row[0] === 'Heating / A\/C'), ['Heating / A/C', '6.00 kW', '9.00 kW']);
});

test('zero connected identification survives and same-name evidence is scoped', () => {
  const input = { ...fixture(), equipment: { ev: { model: 'EV123', source: 'site survey' } },
    quoteLoads: [{ name: 'Shared name', watts: 0, model: 'OLD-UNIT', source: 'existing photo' }] };
  const report = calc.buildSingleInspectorReport(input, [{ name: 'Shared name', watts: 2000, model: 'NEW-UNIT', source: 'proposed photo' }]);
  assert.equal(report.inventory.length, 3);
  assert.match(report.equipmentNotes.join('\n'), /Existing.*EV123.*site survey/);
  assert.match(report.equipmentNotes.join('\n'), /Existing.*Shared name.*OLD-UNIT/);
  assert.match(report.equipmentNotes.join('\n'), /Proposed.*Shared name.*NEW-UNIT/);
});

test('worked arithmetic and a single component comparison tie to engine values without software expressions', () => {
  const input = fixture();
  const original = JSON.stringify(input);
  const report = calc.buildSingleInspectorReport(input, proposal());
  assert.ok(Array.isArray(report.worked));
  const text = report.worked.map(step => `${step.title}: ${step.text}`).join('\n');
  assert.match(text, /1400 × 75% = 1050 ft²/);
  assert.match(text, /1400 \+ 800 \+ 1050 = 3250 ft².*301.9 m²/);
  assert.match(text, /211.9 m².*3 additional 90 m² portions.*3.00 kW/);
  assert.match(text, /9.60 kW.*does not exceed 12 kW.*6.00 kW/);
  assert.match(text, /Dryer: 7.20 kW.*Jet tub \(illustrative sample\): 1.80 kW.*9.00 kW/);
  assert.match(text, /9.00 kW × 25% = 2.25 kW/);
  assert.match(text, /5.10 kW × 100% = 5.10 kW/);
  assert.doesNotMatch(text, /0.00 kW × 100%/);
  assert.equal(report.comparison.length, 11);
  assert.deepEqual(report.comparison.find(row => row[0].includes('Item A')), ['8-200(1)(a) Item A', '16.25 kW', '21.35 kW']);
  assert.deepEqual(report.comparison.find(row => row[0] === 'Governing calculated load'), ['Governing calculated load', '24.00 kW', '24.00 kW']);
  assert.deepEqual(report.comparison.at(-1), ['Governing current', '100 A', '100 A']);
  assert.match(report.governingNote, /24.00 kW is greater than.*21.35 kW/);
  assert.match(report.governingNote, /16.25 kW to 21.35 kW.*remains 24.00 kW/);
  assert.doesNotMatch(JSON.stringify(report), /\b(?:ceil|max|min)\(/);
  assert.equal(JSON.stringify(input), original);
});

test('worked branches explain diversity, managed or omitted EVSE, supply and minimum without programming notation', () => {
  const input = { ...fixture(), unitSystem: 'm2', area: { ground: 70, above: 0, basement: 10 },
    rangeKw: 16, heatKw: 16, acKw: 6, waterKw: 2, evKw: 12, evMode: 'managed', evManagedKw: 3, hvacInterlocked: true };
  const proposed = [{ name: 'New EVSE', watts: 2000, bucket: 'evse' }, { name: 'Extra heat', watts: 4000, bucket: 'heat' }];
  const report = calc.buildSingleInspectorReport(input, proposed, 'three-208');
  const text = report.worked.map(step => `${step.title}: ${step.text}`).join('\n');
  assert.match(text, /6.00 kW \+ \(16.00 kW − 12.00 kW\) × 40% = 7.60 kW/);
  assert.match(text, /first 10.00 kW at 100%.*10.00 kW × 75%.*17.50 kW/i);
  assert.match(text, /Existing:.*14.50 kW.*After proposal:.*17.50 kW/);
  assert.match(text, /Interlocked.*greater of.*17.50 kW.*6.00 kW.*17.50 kW/);
  assert.match(text, /EVEMS maximum 3.00 kW.*2.00 kW.*5.00 kW/);
  assert.match(text, /Water.*2.00 kW × 100% = 2.00 kW/);
  assert.match(text, /Below 80 m².*14.40 kW/);
  assert.match(text, /÷ \(√3 × 208 V\)/);
  assert.match(report.governingNote, /Item A governs/);
  assert.doesNotMatch(text, /negative|−12.5|\b(?:ceil|max|min)\(/);
  const omitted = calc.buildSingleInspectorReport({ ...input, evMode: 'omitted' }, proposed);
  assert.match(JSON.stringify(omitted.worked), /Existing EVSE omitted.*0.00 kW.*2.00 kW/);
  const noRange = calc.buildSingleInspectorReport({ ...input, gasRange: true }, []);
  assert.match(JSON.stringify(noRange.worked), /first 6.00 kW at 100%.*3.00 kW × 25%.*6.75 kW/i);
  const small = calc.buildSingleInspectorReport({ ...input, gasRange: true, dryerAmps: 0, quoteLoads: [{ name: 'Small pool', watts: 2000 }] });
  assert.match(JSON.stringify(small.worked), /2.00 kW × 100% = 2.00 kW/);
  const zero = calc.buildSingleInspectorReport({ ...fixture(), area: {}, gasRange: true, dryerAmps: 0, quoteLoads: [] });
  assert.match(JSON.stringify(zero.worked), /No positive area entered.*0.00 kW/);
  assert.doesNotMatch(JSON.stringify(zero.worked), /−90|-90|25%/);
});

test('inspector inventory contains only contributing or proposed equipment in six concise columns', () => {
  assert.equal(typeof calc.buildSingleInspectorReport, 'function');
  const input = fixture();
  input.equipment = { range: { model: '<literal model>', source: 'Site photo' } };
  const report = calc.buildSingleInspectorReport(input, proposal());
  assert.equal(report.inventory.length, 4);
  assert.ok(report.inventory.every(row => row.length === 6));
  assert.deepEqual(report.inventory[1], ['Dryer', 'Existing', '30 A × 240 V, breaker estimate', '7.20 kW', '25%', '1.80 kW']);
  assert.equal(report.inventory[0][0], 'Range');
  assert.deepEqual(report.equipmentNotes, ['Existing — Range — Model: <literal model>; Source: Site photo']);
  assert.match(report.inventory[0][4], /8-200\(1\)\(a\)\(iv\)/);
  assert.deepEqual(report.inventory[3], ['Air conditioner', 'Proposed', 'Entered nameplate rating: 5.1 kW', '5.10 kW', '100%', '5.10 kW']);
  assert.match(report.zeroNote, /No connected load entered for:.*existing A\/C.*electric space heat.*EVSE/);
  assert.match(report.zeroNote, /absence not verified/i);
  assert.equal(report.breakerNote, 'Breaker-derived connected loads are estimates only. Use verified equipment nameplate ratings where available.');
  assert.doesNotMatch(JSON.stringify(report.inventory), /Not supplied|Unknown —/);
});

test('inventory preserves literal custom labels, quantities and an explicit zero rating', () => {
  const input = fixture();
  input.quoteLoads = [calc.prepareLoadInput({ name: 'Existing <Jet tub>', kw: 2, qty: 2, bucket: 'other', model: '<m>', source: 'nameplate' })];
  input.dryerKw = '0';
  const report = calc.buildSingleInspectorReport(input);
  const row = report.inventory.find(row => row[0] === 'Existing <Jet tub>');
  assert.ok(row);
  assert.equal(row[2], 'Entered nameplate rating: 2 kW × 2');
  assert.equal(row[3], '4.00 kW');
  assert.equal(row[5], '1.00 kW');
  assert.match(report.inventory.find(row => row[0] === 'Dryer')[2], /0 kW entered.*30 A × 240 V/);
});

test('inventory distinguishes pooled demands and preserves excluded nonzero entries outside main rows', () => {
  const input = { ...fixture(), gasRange: true, heatKw: 16, acKw: 6, hvacInterlocked: true,
    evKw: 12, evMode: 'omitted', quoteLoads: [
      { name: 'Threshold load', watts: 1500 }, { name: 'Pool member', watts: 8000 },
    ] };
  const report = calc.buildSingleInspectorReport(input, [{ name: 'Unrated proposed', bucket: 'other' }]);
  assert.deepEqual(report.inventory.map(row => row[1]), ['Existing', 'Existing', 'Existing', 'Proposed']);
  assert.match(report.inventory.find(row => row[0] === 'Dryer')[5], /Pooled/);
  assert.match(report.inventory.find(row => row[0] === 'electric space heat')[5], /Pooled/);
  assert.match(report.inventory.find(row => row[0] === 'Unrated proposed')[4], /excluded/i);
  assert.match(report.excludedNote, /Threshold load.*1.50 kW.*1.5 kW/);
  assert.match(report.excludedNote, /EVSE.*12.00 kW.*omitted/);
  assert.match(report.excludedNote, /range.*9.60 kW.*gas/i);
  assert.match(report.excludedNote, /AC.*6.00 kW.*interlock/);
  assert.doesNotMatch(report.zeroNote, /electric range/);
  const managed = calc.buildSingleInspectorReport({ ...input, evMode: 'managed', evManagedKw: 3 }, [{ name: 'New EV', watts: 2000, bucket: 'evse' }]);
  assert.match(managed.inventory.find(row => row[0] === 'EVSE')[4], /EVEMS/);
  assert.equal(managed.inventory.find(row => row[0] === 'EVSE')[5], '3.00 kW');
  assert.equal(managed.inventory.find(row => row[0] === 'New EV')[5], '2.00 kW');
});
