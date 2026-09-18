const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('./app.js');

function resultFor(waterKw = 0, ground = 100) {
  return calc.calculateSingle({ unitSystem: 'm2', area: { ground, above: 0, basement: 0 }, gasRange: true,
    rangeAmps: 0, dryerAmps: 0, waterKw, quoteLoads: [] });
}
function check(result, mainBreakerAmps, extra = {}) {
  return calc.evaluateServiceCapacity(calc.ampsForWatts(result.totalW, 'single-240').amps, { mainBreakerAmps, ...extra });
}

test('both Item A and Item B compare directly against service capacity', () => {
  const a = resultFor(21);
  assert.ok(a.itemA > a.itemB);
  assert.equal(a.totalW, 27000);
  assert.equal(check(a, 125).passes, true);
  assert.equal(check(a, 125).applicableAmps, 125);
  const b = resultFor();
  assert.ok(b.itemB > b.itemA);
  assert.equal(check(b, 100).passes, true);
  assert.equal(check(b, 100).applicableAmps, 100);
  assert.equal(check(resultFor(18), 100).passes, true); // Item A == Item B
});

test('exact capacity passes; any unrounded excess fails', () => {
  assert.equal(check(resultFor(24), 125).passes, true);
  assert.equal(check(resultFor(24.00001), 125).passes, false);
  assert.equal(check(resultFor(24.1), 125).passes, false);
});

test('future explicit service restrictions are separate and never inferred', () => {
  const amps = 170;
  assert.equal(calc.evaluateServiceCapacity(amps, { mainBreakerAmps: 200 }).applicableAmps, 200);
  const capacity = calc.evaluateServiceCapacity(amps, { mainBreakerAmps: 200, serviceConductorAmps: 180 });
  assert.equal(capacity.applicableAmps, 180);
  assert.equal(capacity.passes, true);
  assert.equal(calc.evaluateServiceCapacity(amps, { mainBreakerAmps: 200, serviceConductorAmps: 180, utilityAhjLimitAmps: 160 }).passes, false);
  assert.equal(calc.evaluateServiceCapacity(amps, { mainBreakerAmps: 200, serviceConductorAmps: '', utilityAhjLimitAmps: null }).applicableAmps, 200);
});

test('invalid or missing capacities cannot silently produce PASS', () => {
  for (const mainBreakerAmps of [0, '', undefined, -1, Infinity, 'bad']) {
    assert.equal(calc.evaluateServiceCapacity(100, { mainBreakerAmps }).evaluated, false);
    assert.equal(calc.evaluateServiceCapacity(100, { mainBreakerAmps }).passes, false);
  }
  for (const utilityAhjLimitAmps of [0, -10, Infinity, 'bad']) {
    assert.equal(calc.evaluateServiceCapacity(100, { mainBreakerAmps: 200, utilityAhjLimitAmps }).evaluated, false);
  }
  for (const field of ['serviceConductorAmps', 'utilityAhjLimitAmps']) {
    for (const value of [[], [200], {}, true, false]) {
      const check = calc.evaluateServiceCapacity(0.5, { mainBreakerAmps: 200, [field]: value });
      assert.equal(check.evaluated, false, `${field} must reject nonnumeric types`);
      assert.equal(check.passes, false);
    }
  }
  for (const amps of [NaN, Infinity, -1]) assert.equal(calc.evaluateServiceCapacity(amps, { mainBreakerAmps: 100 }).passes, false);
});
