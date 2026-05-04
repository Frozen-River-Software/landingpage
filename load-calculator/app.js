(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LoadCalculator = api;
  }
})(typeof window !== "undefined" ? window : undefined, function () {
  const SQFT_TO_SQM = 0.09290304;

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function kwToW(kw) {
    return number(kw) * 1000;
  }

  function breakerWatts(amps, volts, qty = 1) {
    return number(amps) * number(volts) * Math.max(0, Math.floor(number(qty) || 0));
  }

  function toSquareMetres(value, unitSystem) {
    const area = number(value);
    return unitSystem === "ft2" ? area * SQFT_TO_SQM : area;
  }

  function ceilPortion(value, size) {
    return value > 0 ? Math.ceil(value / size) : 0;
  }

  function livingAreaM2(values, unitSystem) {
    const ground = toSquareMetres(values.ground, unitSystem);
    const above = toSquareMetres(values.above, unitSystem);
    const basement = toSquareMetres(values.basement, unitSystem);
    return {
      total: ground + above + basement * 0.75,
      aboveBasement: ground + above,
    };
  }

  function singleBasicLoad(areaM2) {
    if (areaM2 <= 0) return 0;
    return 5000 + ceilPortion(areaM2 - 90, 90) * 1000;
  }

  function apartmentBasicLoad(areaM2) {
    if (areaM2 <= 0) return 0;
    if (areaM2 <= 45) return 3500;
    if (areaM2 <= 90) return 5000;
    return 5000 + ceilPortion(areaM2 - 90, 90) * 1000;
  }

  function rangeDemandFromWatts(watts) {
    if (watts <= 0) return 0;
    return 6000 + Math.max(0, watts - 12000) * 0.4;
  }

  function rangeDemand(rangeKw) {
    return rangeDemandFromWatts(kwToW(rangeKw));
  }

  function heatingDemandFromWatts(watts, method) {
    if (watts <= 0) return 0;
    if (method === "residential-zoned") {
      return Math.min(watts, 10000) + Math.max(0, watts - 10000) * 0.75;
    }
    return watts;
  }

  function heatingDemand(heatKw, method) {
    return heatingDemandFromWatts(kwToW(heatKw), method);
  }

  function hvacDemand(heatW, acW, interlocked) {
    return interlocked ? Math.max(heatW, acW) : heatW + acW;
  }

  function evseDemand(evKw, mode, managedKw) {
    return evseDemandFromWatts(kwToW(evKw), mode, managedKw);
  }

  function evseDemandFromWatts(watts, mode, managedKw) {
    if (mode === "omitted") return 0;
    if (mode === "managed") return kwToW(managedKw);
    return number(watts);
  }

  function quoteLoadWatts(load) {
    if (number(load.watts) > 0) return number(load.watts);
    return breakerWatts(load.amps, load.volts || 240, load.qty || 1);
  }

  function splitQuoteLoads(loads) {
    return loads.reduce((groups, load) => {
      const bucket = load.bucket || "other";
      const next = {
        name: load.name || "Load",
        watts: quoteLoadWatts(load),
      };
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(next);
      return groups;
    }, { other: [], water: [], evse: [], ac: [], heat: [] });
  }

  function sumLoads(loads) {
    return loads.reduce((sum, load) => sum + number(load.watts), 0);
  }

  function singleOtherDemand(loads, hasRange) {
    const qualifying = loads
      .map((load) => ({ name: load.name || "Load", watts: number(load.watts) }))
      .filter((load) => load.watts > 1500);
    const total = qualifying.reduce((sum, load) => sum + load.watts, 0);
    if (total <= 0) return { demand: 0, total, qualifying };
    if (hasRange) return { demand: total * 0.25, total, qualifying };
    return {
      demand: Math.min(total, 6000) + Math.max(0, total - 6000) * 0.25,
      total,
      qualifying,
    };
  }

  function apartmentOtherDemandFromWatts(watts, hasRange) {
    const qualifying = watts > 1500 ? watts : 0;
    return hasRange ? qualifying * 0.25 : 6000 + qualifying * 0.25;
  }

  function apartmentOtherDemand(otherKw, hasRange) {
    return apartmentOtherDemandFromWatts(kwToW(otherKw), hasRange);
  }

  function ampsForWatts(watts, supplyMode) {
    if (supplyMode === "three-208") {
      return {
        amps: watts / (Math.sqrt(3) * 208),
        label: "at 208 V line-line, 3-phase",
      };
    }
    if (supplyMode === "three-240") {
      return {
        amps: watts / (Math.sqrt(3) * 240),
        label: "at 240 V line-line, 3-phase",
      };
    }
    return {
      amps: watts / 240,
      label: "at 240 V line-line, split-phase",
    };
  }

  function calculateSingle(input) {
    const area = livingAreaM2(input.area, input.unitSystem);
    const rangeConnectedW = input.gasRange
      ? 0
      : number(input.rangeKw) > 0
      ? kwToW(input.rangeKw)
      : breakerWatts(input.rangeAmps, 240, 1);
    const hasRange = rangeConnectedW > 0;
    const quoteLoads = splitQuoteLoads(input.quoteLoads || input.otherLoads || []);
    const basicW = singleBasicLoad(area.total);
    const rangeW = rangeDemandFromWatts(rangeConnectedW);
    const dryerConnectedW = number(input.dryerKw) > 0
      ? kwToW(input.dryerKw)
      : breakerWatts(input.dryerAmps, 240, 1);
    const waterW = kwToW(input.waterKw) + sumLoads(quoteLoads.water);
    const heatConnectedW = kwToW(input.heatKw) + sumLoads(quoteLoads.heat);
    const heatW = heatingDemandFromWatts(heatConnectedW, input.heatMethod);
    const acConnectedW = number(input.acKw) > 0
      ? kwToW(input.acKw)
      : breakerWatts(input.acAmps, 240, 1);
    const acW = acConnectedW + sumLoads(quoteLoads.ac);
    const hvacW = hvacDemand(heatW, acW, input.hvacInterlocked);
    const evConnectedW = number(input.evKw) > 0
      ? kwToW(input.evKw)
      : breakerWatts(input.evAmps, 240, 1);
    const evW = evseDemandFromWatts(evConnectedW, input.evMode, input.evManagedKw) + sumLoads(quoteLoads.evse);
    const fixedOtherLoads = dryerConnectedW > 0
      ? [{ name: "Dryer", watts: dryerConnectedW }]
      : [];
    const other = singleOtherDemand([...fixedOtherLoads, ...quoteLoads.other], hasRange);
    const itemA = basicW + hvacW + rangeW + waterW + evW + other.demand;
    const itemB = area.aboveBasement >= 80 ? 24000 : 14400;
    const totalW = Math.max(itemA, itemB);

    return {
      totalW,
      area,
      itemA,
      itemB,
      breakdown: [
        ["8-110 living area", area.total, "m2"],
        ["8-200(1)(a)(i-ii) basic load", basicW, "W"],
        ["Estimated connected range load", rangeConnectedW, "W"],
        ["Estimated connected dryer load", dryerConnectedW, "W"],
        ["8-200(1)(a)(iii), 62-118 heating/AC", hvacW, "W"],
        ["8-200(1)(a)(iv) range", rangeW, "W"],
        ["8-200(1)(a)(v) tankless / pool / spa water heat", waterW, "W"],
        ["8-200(1)(a)(vi), 8-106 EVSE", evW, "W"],
        ["8-200(1)(a)(vii) other loads", other.demand, "W"],
        ["8-200(1)(a) subtotal", itemA, "W"],
        ["8-200(1)(b) minimum comparison", itemB, "W"],
      ],
      notes: [
        "The result is the greater of Rule 8-200(1)(a) and Rule 8-200(1)(b).",
        "Breaker-size entries estimate connected load as breaker amps times selected voltage. Use nameplate kW where it is known.",
        "Basement living area is counted at 75% only where the height exceeds 1.8 m, per Rule 8-110.",
        "This tool is a design aid. Confirm final service and feeder sizing with the authority having jurisdiction.",
      ],
    };
  }

  function unitRangeConnectedWatts(group) {
    return number(group.rangeKw) > 0
      ? kwToW(group.rangeKw)
      : breakerWatts(group.rangeAmps, 240, 1);
  }

  function unitOtherConnectedWatts(group) {
    return number(group.otherKw) > 0
      ? kwToW(group.otherKw)
      : breakerWatts(group.otherAmps, 240, group.otherQty || 0);
  }

  function unitHeatAcEvLoads(group) {
    const acConnectedW = number(group.acKw) > 0
      ? kwToW(group.acKw)
      : breakerWatts(group.acAmps, 240, 1);
    const evConnectedW = number(group.evKw) > 0
      ? kwToW(group.evKw)
      : breakerWatts(group.evAmps, 240, 1);
    return {
      heatW: heatingDemand(group.heatKw, group.heatMethod),
      acW: acConnectedW,
      evW: evseDemandFromWatts(evConnectedW, group.evMode, group.evManagedKw),
    };
  }

  function expandApartmentUnitLoads(groups, unitSystem) {
    const units = [];
    const summaries = [];

    groups.forEach((group, index) => {
      const qty = Math.max(0, Math.floor(number(group.qty)));
      const areaM2 = toSquareMetres(group.area, unitSystem);
      const basicW = apartmentBasicLoad(areaM2);
      const rangeConnectedW = unitRangeConnectedWatts(group);
      const hasRange = rangeConnectedW > 0;
      const rangeW = rangeDemandFromWatts(rangeConnectedW);
      const waterW = kwToW(group.waterKw);
      const otherConnectedW = unitOtherConnectedWatts(group);
      const otherW = apartmentOtherDemandFromWatts(otherConnectedW, hasRange);
      const baseW = basicW + rangeW + waterW + otherW;
      const { heatW, acW, evW } = unitHeatAcEvLoads(group);

      for (let i = 0; i < qty; i += 1) {
        units.push({ baseW, heatW, acW, evW });
      }

      summaries.push({
        index: index + 1,
        qty,
        areaM2,
        baseW,
        heatW,
        acW,
        evW,
        rangeConnectedW,
        otherConnectedW,
      });
    });

    return { units, summaries };
  }

  function rowHousingUnitBaseLoad(group, unitSystem) {
    const areaM2 = toSquareMetres(group.area, unitSystem);
    const nonBasementAreaM2 = toSquareMetres(group.nonBasementArea || group.area, unitSystem);
    const basicW = singleBasicLoad(areaM2);
    const rangeConnectedW = unitRangeConnectedWatts(group);
    const hasRange = rangeConnectedW > 0;
    const rangeW = rangeDemandFromWatts(rangeConnectedW);
    const waterW = kwToW(group.waterKw);
    const otherConnectedW = unitOtherConnectedWatts(group);
    const otherLoads = otherConnectedW > 0
      ? [{ name: "Other unit loads", watts: otherConnectedW }]
      : [];
    const other = singleOtherDemand(otherLoads, hasRange);
    const itemA = basicW + rangeW + waterW + other.demand;
    const itemB = nonBasementAreaM2 >= 80 ? 24000 : 14400;

    return {
      areaM2,
      nonBasementAreaM2,
      baseW: Math.max(itemA, itemB),
      itemA,
      itemB,
      rangeConnectedW,
      otherConnectedW,
    };
  }

  function expandRowHousingUnitLoads(groups, unitSystem) {
    const units = [];
    const summaries = [];

    groups.forEach((group, index) => {
      const qty = Math.max(0, Math.floor(number(group.qty)));
      const base = rowHousingUnitBaseLoad(group, unitSystem);
      const { heatW, acW, evW } = unitHeatAcEvLoads(group);

      for (let i = 0; i < qty; i += 1) {
        units.push({ baseW: base.baseW, heatW, acW, evW });
      }

      summaries.push({
        index: index + 1,
        qty,
        areaM2: base.areaM2,
        nonBasementAreaM2: base.nonBasementAreaM2,
        baseW: base.baseW,
        itemA: base.itemA,
        itemB: base.itemB,
        heatW,
        acW,
        evW,
        rangeConnectedW: base.rangeConnectedW,
        otherConnectedW: base.otherConnectedW,
      });
    });

    return { units, summaries };
  }

  function diversifiedDwellingUnitLoad(unitBaseLoads) {
    const sorted = [...unitBaseLoads].sort((a, b) => b - a);
    let total = 0;
    const tiers = [
      { count: 1, factor: 1 },
      { count: 2, factor: 0.65 },
      { count: 2, factor: 0.4 },
      { count: 15, factor: 0.25 },
      { count: Infinity, factor: 0.1 },
    ];
    let cursor = 0;

    tiers.forEach((tier) => {
      const end = Math.min(sorted.length, cursor + tier.count);
      for (let i = cursor; i < end; i += 1) {
        total += sorted[i] * tier.factor;
      }
      cursor = end;
    });

    return total;
  }

  function multiCommonLoads(input) {
    return {
      commonEvW: evseDemand(input.commonEvKw, input.commonEvMode, input.commonEvManagedKw),
      commonLoadsW: kwToW(input.commonKw) * 0.75,
    };
  }

  function multiSeparateLoadTotals(expanded, input) {
    const heatW = expanded.units.reduce((sum, unit) => sum + unit.heatW, 0);
    const acW = expanded.units.reduce((sum, unit) => sum + unit.acW, 0);
    const hvacW = hvacDemand(heatW, acW, input.hvacInterlocked);
    const unitEvW = expanded.units.reduce((sum, unit) => sum + unit.evW, 0);
    const { commonEvW, commonLoadsW } = multiCommonLoads(input);

    return { hvacW, unitEvW, commonEvW, commonLoadsW };
  }

  function calculateApartmentBuilding(input) {
    const expanded = expandApartmentUnitLoads(input.groups || [], input.unitSystem);
    const baseLoads = expanded.units.map((unit) => unit.baseW);
    const totalUnitBaseW = baseLoads.reduce((sum, watts) => sum + watts, 0);
    const diversifiedUnitsW = diversifiedDwellingUnitLoad(baseLoads);
    const { hvacW, unitEvW, commonEvW, commonLoadsW } = multiSeparateLoadTotals(expanded, input);
    const separateLoadsW = hvacW + unitEvW + commonEvW + commonLoadsW;
    const totalW = diversifiedUnitsW + hvacW + unitEvW + commonEvW + commonLoadsW;

    return {
      totalW,
      unitCount: expanded.units.length,
      summaries: expanded.summaries,
      comparisonRows: [
        ["8-202(1)(a) unit loads before diversity", totalUnitBaseW, "W"],
        ["8-202(3)(a) diversified dwelling-unit load", diversifiedUnitsW, "W"],
        ["Heating/AC, EVSE, and common-load additions", separateLoadsW, "W"],
      ],
      comparisonNote: "Governing calculated load is diversified dwelling-unit load plus the separate additions shown here.",
      breakdown: [
        ["8-202 apartment/similar dwelling units included", expanded.units.length, "count"],
        ["8-202(1)(a) unit loads before diversity", totalUnitBaseW, "W"],
        ["8-202(3)(a) diversified apartment/similar load", diversifiedUnitsW, "W"],
        ["8-202(3)(b-c), 62-118 heating/AC", hvacW, "W"],
        ["8-202 unit EVSE at selected demand", unitEvW, "W"],
        ["8-202(3)(d), 8-106 common EVSE", commonEvW, "W"],
        ["8-202(3)(e) common loads at 75%", commonLoadsW, "W"],
      ],
      notes: [
        "Apartment and similar dwelling-unit loads use the Rule 8-202(1)(a) unit-load path before Rule 8-202(3)(a) diversity.",
        "The 60 A comparison in Rule 8-202(1)(b) is for an individual feeder from a main service and is not used in the multi-unit service diversity calculation.",
        "EVSE handling varies by installation details. Use the EVEMS options only where the conditions in Rule 8-106 are satisfied.",
      ],
    };
  }

  function calculateRowHousingBuilding(input) {
    const expanded = expandRowHousingUnitLoads(input.groups || [], input.unitSystem);
    const baseLoads = expanded.units.map((unit) => unit.baseW);
    const totalUnitBaseW = baseLoads.reduce((sum, watts) => sum + watts, 0);
    const diversifiedUnitsW = diversifiedDwellingUnitLoad(baseLoads);
    const { hvacW, unitEvW, commonEvW, commonLoadsW } = multiSeparateLoadTotals(expanded, input);
    const separateLoadsW = hvacW + unitEvW + commonEvW + commonLoadsW;
    const totalW = diversifiedUnitsW + hvacW + unitEvW + commonEvW + commonLoadsW;

    return {
      totalW,
      unitCount: expanded.units.length,
      summaries: expanded.summaries,
      comparisonRows: [
        ["8-200(1) per-unit loads before diversity", totalUnitBaseW, "W"],
        ["8-202(3)(a) diversified dwelling-unit load", diversifiedUnitsW, "W"],
        ["Heating/AC, EVSE, and common-load additions", separateLoadsW, "W"],
      ],
      comparisonNote: "Governing calculated load is diversified dwelling-unit load plus the separate additions shown here.",
      breakdown: [
        ["8-200(2) duplex/row-housing dwelling units included", expanded.units.length, "count"],
        ["8-200(1) per-unit loads before diversity", totalUnitBaseW, "W"],
        ["8-202(3)(a) diversified row-housing unit load", diversifiedUnitsW, "W"],
        ["8-202(3)(b-c), 62-118 heating/AC", hvacW, "W"],
        ["8-202 unit EVSE at selected demand", unitEvW, "W"],
        ["8-202(3)(d), 8-106 common EVSE", commonEvW, "W"],
        ["8-202(3)(e) common loads at 75%", commonLoadsW, "W"],
      ],
      notes: [
        "Rule 8-200(2) starts with each dwelling unit calculated under Rule 8-200(1); unit EVSE, electric space heat, and AC are added after the diversified base.",
        "A single unit of a duplex is a single dwelling. A service feeding both duplex units should use Duplex / row housing.",
        "Dwelling-unit loads are sorted from heaviest to lightest before applying the Rule 8-202(3)(a) demand tiers.",
        "EVSE handling varies by installation details. Use the EVEMS options only where the conditions in Rule 8-106 are satisfied.",
      ],
    };
  }

  function calculateMulti(input) {
    if (input.buildingType === "row-housing") {
      return calculateRowHousingBuilding(input);
    }
    return calculateApartmentBuilding(input);
  }

  return {
    calculateSingle,
    calculateMulti,
    calculateApartmentBuilding,
    calculateRowHousingBuilding,
    ampsForWatts,
    toSquareMetres,
    singleBasicLoad,
    apartmentBasicLoad,
    rangeDemand,
    heatingDemand,
    breakerWatts,
  };
});

if (typeof document !== "undefined") {
  const app = window.LoadCalculator;
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

  const els = {
    modeButtons: $$("[data-mode]"),
    unitSystem: $("#unit-system"),
    mainBreakerAmps: $("#main-breaker-amps"),
    supplyMode: $("#supply-mode"),
    resetButton: $("#reset-calculator"),
    singleForm: $("#single-form"),
    multiForm: $("#multi-form"),
    singlePanel: $("#single-panel"),
    multiPanel: $("#multi-panel"),
    summary: $(".summary"),
    resultKw: $("#result-kw"),
    resultAmps: $("#result-amps"),
    ampsLabel: $("#amps-label"),
    ruleComparison: $("#rule-comparison"),
    panelWarning: $("#panel-warning"),
    breakdown: $("#breakdown-list"),
    notes: $("#note-list"),
    singleLoads: $("#single-other-loads"),
    multiBuildingType: $("#multi-building-type"),
    unitGroups: $("#unit-groups"),
    loadTemplate: $("#load-row-template"),
    groupTemplate: $("#unit-group-template"),
  };

  let activeMode = "single";
  const presetLoads = {
    "ac-20": { name: "Air conditioner", qty: 1, amps: 20, volts: 240, bucket: "ac" },
    "ac-30": { name: "Air conditioner", qty: 1, amps: 30, volts: 240, bucket: "ac" },
    "ac-40": { name: "Air conditioner", qty: 1, amps: 40, volts: 240, bucket: "ac" },
    "range-40": { name: "Range", qty: 1, amps: 40, volts: 240, bucket: "other" },
    "range-50": { name: "Range", qty: 1, amps: 50, volts: 240, bucket: "other" },
    "range-60": { name: "Range", qty: 1, amps: 60, volts: 240, bucket: "other" },
    "dryer-30": { name: "Clothes dryer", qty: 1, amps: 30, volts: 240, bucket: "other" },
    "hot-tub-50": { name: "Hot tub / spa", qty: 1, amps: 50, volts: 240, bucket: "water" },
    "hot-tub-60": { name: "Hot tub / spa", qty: 1, amps: 60, volts: 240, bucket: "water" },
    "tankless-40": { name: "Tankless water heater", qty: 1, amps: 40, volts: 240, bucket: "water" },
    "tankless-50": { name: "Tankless water heater", qty: 1, amps: 50, volts: 240, bucket: "water" },
    "tankless-60": { name: "Tankless water heater", qty: 1, amps: 60, volts: 240, bucket: "water" },
    "steam-30": { name: "Steamer", qty: 1, amps: 30, volts: 240, bucket: "water" },
    "steam-40": { name: "Steamer", qty: 1, amps: 40, volts: 240, bucket: "water" },
    "wall-oven-30": { name: "Wall oven", qty: 1, amps: 30, volts: 240, bucket: "other" },
    "evse-50": { name: "EV charger", qty: 1, amps: 50, volts: 240, bucket: "evse" },
    "evse-60": { name: "EV charger", qty: 1, amps: 60, volts: 240, bucket: "evse" },
  };

  function readValue(id) {
    return $(id).value;
  }

  function readChecked(id) {
    return $(id).checked;
  }

  function positiveNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function addKwToInput(selector, watts) {
    const input = $(selector);
    input.value = ((positiveNumber(input.value) * 1000 + watts) / 1000).toFixed(1);
  }

  function addMultiPresetLoad(preset) {
    const watts = breakerWatts(preset.amps, preset.volts, preset.qty);
    if (preset.bucket === "evse") {
      addKwToInput("#multi-common-ev", watts);
    } else {
      addKwToInput("#multi-common", watts);
    }
  }

  function addSingleLoad(values = {}) {
    const node = els.loadTemplate.content.firstElementChild.cloneNode(true);
    const defaults = {
      name: "Load",
      qty: 1,
      amps: 30,
      volts: 240,
      bucket: "other",
    };
    const next = { ...defaults, ...values };
    $("[data-load-name]", node).value = next.name;
    $("[data-load-qty]", node).value = next.qty;
    $("[data-load-amps]", node).value = next.amps;
    $("[data-load-volts]", node).value = next.volts;
    $("[data-load-bucket]", node).value = next.bucket;
    $("[data-remove-load]", node).addEventListener("click", () => {
      node.remove();
      render();
    });
    node.addEventListener("input", render);
    els.singleLoads.append(node);
  }

  function addUnitGroup(values = {}) {
    const node = els.groupTemplate.content.firstElementChild.cloneNode(true);
      const defaults = {
        qty: 4,
        area: 650,
        nonBasementArea: 650,
        rangeAmps: 40,
      rangeVolts: 240,
      rangeKw: 0,
      otherAmps: 30,
      otherVolts: 240,
      otherQty: 1,
      otherKw: 0,
      waterKw: 0,
      evAmps: 0,
      evKw: 0,
      evMode: "full",
      evManagedKw: 0,
      heatKw: 0,
      heatMethod: "residential-zoned",
      acAmps: 0,
      acKw: 0,
    };
    const next = { ...defaults, ...values };
    $("[data-unit-qty]", node).value = next.qty;
    $("[data-unit-area]", node).value = next.area;
    $("[data-unit-non-basement-area]", node).value = next.nonBasementArea;
    $("[data-unit-range-amps]", node).value = next.rangeAmps;
    $("[data-unit-range-kw]", node).value = next.rangeKw;
    $("[data-unit-other-amps]", node).value = next.otherAmps;
    $("[data-unit-other-qty]", node).value = next.otherQty;
    $("[data-unit-other-kw]", node).value = next.otherKw;
    $("[data-unit-ac-amps]", node).value = next.acAmps;
    $("[data-unit-ac-kw]", node).value = next.acKw;
    $("[data-unit-ev-amps]", node).value = next.evAmps;
    $("[data-unit-ev-kw]", node).value = next.evKw;
    $("[data-unit-water]", node).value = next.waterKw;
    $("[data-unit-ev-mode]", node).value = next.evMode;
    $("[data-unit-ev-managed]", node).value = next.evManagedKw;
    $("[data-unit-heat]", node).value = next.heatKw;
    $("[data-unit-heat-method]", node).value = next.heatMethod;
    $("[data-remove-group]", node).addEventListener("click", () => {
      node.remove();
      render();
    });
    node.addEventListener("input", render);
    node.addEventListener("change", render);
    els.unitGroups.append(node);
  }

  function singleInput() {
    return {
      unitSystem: els.unitSystem.value,
      area: {
        ground: readValue("#single-ground"),
        above: readValue("#single-above"),
        basement: readValue("#single-basement"),
      },
      rangeAmps: readValue("#single-range-amps"),
      rangeVolts: 240,
      rangeKw: readValue("#single-range-kw"),
      gasRange: readChecked("#single-gas-range"),
      dryerAmps: readValue("#single-dryer-amps"),
      dryerKw: readValue("#single-dryer-kw"),
      dryerVolts: 240,
      waterKw: readValue("#single-water"),
      heatKw: readValue("#single-heat"),
      heatMethod: readValue("#single-heat-method"),
      acAmps: readValue("#single-ac-amps"),
      acKw: readValue("#single-ac-kw"),
      hvacInterlocked: readChecked("#single-hvac-interlock"),
      evAmps: readValue("#single-ev-amps"),
      evKw: readValue("#single-ev-kw"),
      evMode: readValue("#single-ev-mode"),
      evManagedKw: readValue("#single-ev-managed"),
      quoteLoads: $$(".load-row", els.singleLoads).map((row) => ({
        name: $("[data-load-name]", row).value,
        qty: $("[data-load-qty]", row).value,
        amps: $("[data-load-amps]", row).value,
        volts: $("[data-load-volts]", row).value,
        bucket: $("[data-load-bucket]", row).value,
      })),
    };
  }

  function multiInput() {
    return {
      unitSystem: els.unitSystem.value,
      buildingType: els.multiBuildingType.value,
      groups: $$(".unit-group", els.unitGroups).map((row) => ({
        qty: $("[data-unit-qty]", row).value,
        area: $("[data-unit-area]", row).value,
        nonBasementArea: $("[data-unit-non-basement-area]", row).value,
        rangeAmps: $("[data-unit-range-amps]", row).value,
        rangeVolts: 240,
        rangeKw: $("[data-unit-range-kw]", row).value,
        otherAmps: $("[data-unit-other-amps]", row).value,
        otherVolts: 240,
        otherQty: $("[data-unit-other-qty]", row).value,
        otherKw: $("[data-unit-other-kw]", row).value,
        waterKw: $("[data-unit-water]", row).value,
        evAmps: $("[data-unit-ev-amps]", row).value,
        evKw: $("[data-unit-ev-kw]", row).value,
        evMode: $("[data-unit-ev-mode]", row).value,
        evManagedKw: $("[data-unit-ev-managed]", row).value,
        heatKw: $("[data-unit-heat]", row).value,
        heatMethod: $("[data-unit-heat-method]", row).value,
        acAmps: $("[data-unit-ac-amps]", row).value,
        acKw: $("[data-unit-ac-kw]", row).value,
      })),
      commonKw: readValue("#multi-common"),
      commonEvKw: readValue("#multi-common-ev"),
      commonEvMode: readValue("#multi-common-ev-mode"),
      commonEvManagedKw: readValue("#multi-common-ev-managed"),
      hvacInterlocked: readChecked("#multi-hvac-interlock"),
    };
  }

  function formatWatts(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return `${(value / 1000).toLocaleString(undefined, {
        maximumFractionDigits: 2,
        minimumFractionDigits: value >= 1000 ? 1 : 0,
      })} kW`;
    }
    return "0 kW";
  }

  function formatArea(value) {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} m2`;
  }

  function formatAmps(value) {
    return `${Math.ceil(value).toLocaleString()} A`;
  }

  function displayedLoadWatts(result) {
    return result.totalW;
  }

  function breakdownValue(row) {
    const [label, value, unit] = row;
    if (unit === "m2") return [label, formatArea(value)];
    if (unit === "count") return [label, String(value)];
    return [label, formatWatts(value)];
  }

  function renderBreakdown(rows) {
    els.breakdown.innerHTML = "";
    rows.forEach((row) => {
      const [label, value] = breakdownValue(row);
      const item = document.createElement("div");
      item.className = "breakdown-row";
      item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      els.breakdown.append(item);
    });
  }

  function renderNotes(notes) {
    els.notes.innerHTML = "";
    notes.forEach((note) => {
      const item = document.createElement("li");
      item.textContent = note;
      els.notes.append(item);
    });
  }

  function comparisonValue(row, supplyMode) {
    const [, value, unit] = row;
    if (unit === "W") {
      const amps = app.ampsForWatts(value, supplyMode).amps;
      return `${formatWatts(value)} / ${formatAmps(amps)}`;
    }
    return breakdownValue(row)[1];
  }

  function renderComparisonRows(rows, note, supplyMode) {
    els.ruleComparison.innerHTML = "";
    rows.forEach((row) => {
      const [label] = row;
      const item = document.createElement("div");
      const rowLabel = document.createElement("span");
      const rowValue = document.createElement("strong");
      rowLabel.textContent = label;
      rowValue.textContent = comparisonValue(row, supplyMode);
      item.append(rowLabel, rowValue);
      els.ruleComparison.append(item);
    });
    if (note) {
      const noteEl = document.createElement("p");
      noteEl.textContent = note;
      els.ruleComparison.append(noteEl);
    }
    els.ruleComparison.classList.remove("hidden");
  }

  function renderRuleComparison(result, supplyMode) {
    if (Array.isArray(result.comparisonRows) && result.comparisonRows.length) {
      renderComparisonRows(result.comparisonRows, result.comparisonNote, supplyMode);
      return;
    }

    if (!Number.isFinite(result.itemA) || !Number.isFinite(result.itemB)) {
      els.ruleComparison.classList.add("hidden");
      els.ruleComparison.innerHTML = "";
      return;
    }

    const itemAGoverns = result.itemA >= result.itemB;
    renderComparisonRows([
      ["Option A: 8-200(1)(a) entered-load subtotal", result.itemA, "W"],
      ["Option B: 8-200(1)(b) minimum comparison", result.itemB, "W"],
    ], itemAGoverns
      ? "Governing: Option A is larger than the service minimum."
      : "Governing: Option B service minimum is larger than entered loads.",
    supplyMode);
  }

  function renderPanelWarning(result, calculatedAmps) {
    const breakerAmps = positiveNumber(els.mainBreakerAmps.value);
    if (breakerAmps <= 0 || !Number.isFinite(calculatedAmps)) {
      els.summary.classList.remove("is-over-main-80", "is-over-main-100");
      els.panelWarning.className = "panel-warning hidden";
      els.panelWarning.textContent = "";
      return;
    }

    const percent = calculatedAmps / breakerAmps;
    const optionAGoverns = Number.isFinite(result.itemA) && Number.isFinite(result.itemB) && result.itemA > result.itemB;
    const showCaution = optionAGoverns && percent >= 0.8 && percent <= 1;
    els.summary.classList.toggle("is-over-main-80", showCaution);
    els.summary.classList.toggle("is-over-main-100", percent > 1);
    if (percent > 1) {
      els.panelWarning.className = "panel-warning is-danger";
      els.panelWarning.textContent = `Warning: governing calculated load exceeds selected ${breakerAmps} A main.`;
    } else if (showCaution) {
      els.panelWarning.className = "panel-warning is-caution";
      els.panelWarning.textContent = `Caution: Option A governs and is over 80% of selected ${breakerAmps} A main.`;
    } else {
      els.panelWarning.className = "panel-warning is-ok";
      els.panelWarning.textContent = `OK: selected ${breakerAmps} A main meets the governing calculated load.`;
    }
  }

  function updateConditionalFields() {
    const gasRange = readChecked("#single-gas-range");
    $$("[data-single-range-field]").forEach((field) => {
      field.classList.toggle("is-disabled", gasRange);
      $$("input, select", field).forEach((control) => {
        control.disabled = gasRange;
      });
    });

    const singleHeatMethod = $("[data-single-heat-method-field]");
    if (singleHeatMethod) {
      const show = positiveNumber(readValue("#single-heat")) > 0;
      singleHeatMethod.classList.toggle("hidden", !show);
      singleHeatMethod.hidden = !show;
    }

    $$(".unit-group", els.unitGroups).forEach((row) => {
      const heatMethod = $("[data-unit-heat-method-field]", row);
      if (heatMethod) {
        const show = positiveNumber($("[data-unit-heat]", row).value) > 0;
        heatMethod.classList.toggle("hidden", !show);
        heatMethod.hidden = !show;
      }
    });
  }

  function render() {
    updateConditionalFields();
    const result = activeMode === "single"
      ? app.calculateSingle(singleInput())
      : app.calculateMulti(multiInput());
    const displayW = displayedLoadWatts(result);
    const ampResult = app.ampsForWatts(displayW, els.supplyMode.value);
    els.resultKw.textContent = formatWatts(displayW);
    els.resultAmps.textContent = formatAmps(ampResult.amps);
    els.ampsLabel.textContent = ampResult.label;
    renderRuleComparison(result, els.supplyMode.value);
    renderPanelWarning(result, ampResult.amps);
    renderBreakdown(result.breakdown);
    renderNotes(result.notes);
  }

  function switchMode(mode) {
    activeMode = mode;
    els.modeButtons.forEach((button) => {
      const selected = button.dataset.mode === mode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    els.singlePanel.classList.toggle("hidden", mode !== "single");
    els.multiPanel.classList.toggle("hidden", mode !== "multi");
    render();
  }

  function resetCalculator() {
    els.unitSystem.value = "ft2";
    els.mainBreakerAmps.value = "100";
    els.supplyMode.value = "single-240";
    els.singleForm.reset();
    els.multiForm.reset();
    els.singleLoads.innerHTML = "";
    els.unitGroups.innerHTML = "";
    addUnitGroup();
    switchMode("single");
  }

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => switchMode(button.dataset.mode));
  });
  els.resetButton.addEventListener("click", resetCalculator);

  $("#add-single-load").addEventListener("click", () => {
    addSingleLoad();
    render();
  });
  $$("[data-preset-load]").forEach((button) => {
    button.addEventListener("click", () => {
      addSingleLoad(presetLoads[button.dataset.presetLoad]);
      render();
    });
  });
  $$("[data-multi-preset-load]").forEach((button) => {
    button.addEventListener("click", () => {
      addMultiPresetLoad(presetLoads[button.dataset.multiPresetLoad]);
      render();
    });
  });
  $("#add-unit-group").addEventListener("click", () => {
    addUnitGroup({ qty: 1 });
    render();
  });

  document.addEventListener("input", (event) => {
    if (
      event.target.closest("form")
      || event.target === els.unitSystem
      || event.target === els.mainBreakerAmps
      || event.target === els.supplyMode
    ) {
      render();
    }
  });
  document.addEventListener("change", render);

  addUnitGroup();
  render();
}
