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

  function connectedWatts(knownKw, amps, volts = 240, qty = 1) {
    return number(knownKw) > 0 ? kwToW(knownKw) * Math.max(0, Math.floor(number(qty) || 1)) : breakerWatts(amps, volts, qty);
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
    if (supplyMode === "single-208") {
      return {
        amps: watts / 208,
        label: "at 208 V line-line, single-phase",
      };
    }
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
    const waterConnectedW = connectedWatts(input.waterKw, input.waterAmps, 240, 1);
    const waterW = waterConnectedW + sumLoads(quoteLoads.water);
    const heatConnectedW = connectedWatts(input.heatKw, input.heatAmps, 240, 1) + sumLoads(quoteLoads.heat);
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
      // Report evidence comes from the same intermediates as the result, not a second rules engine.
      components: { basicW, rangeConnectedW, rangeW, dryerConnectedW, waterConnectedW, waterW,
        heatConnectedW, heatW, acConnectedW, acW, hvacW, evConnectedW, evW, other, hasRange },
      breakdown: [
        ["8-110 living area", area.total, "m2"],
        ["8-200(1)(a)(i-ii) basic load", basicW, "W"],
        ["Estimated connected range load", rangeConnectedW, "W"],
        ["Estimated connected dryer load", dryerConnectedW, "W"],
        ["8-200(1)(a)(iii), 62-118 heating/AC", hvacW, "W"],
        ["8-200(1)(a)(iv) range", rangeW, "W"],
        ["Estimated connected tankless / pool / spa water heat", waterConnectedW, "W"],
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
      : breakerWatts(group.otherAmps, 240, 1);
  }

  function unitWaterConnectedWatts(group) {
    return connectedWatts(group.waterKw, group.waterAmps, 240, 1);
  }

  function unitHeatConnectedWatts(group) {
    return connectedWatts(group.heatKw, group.heatAmps, 240, 1);
  }

  function unitHeatAcEvLoads(group, quoteLoads = splitQuoteLoads(group.quoteLoads || [])) {
    const acConnectedW = number(group.acKw) > 0
      ? kwToW(group.acKw)
      : breakerWatts(group.acAmps, 240, 1);
    const evConnectedW = number(group.evKw) > 0
      ? kwToW(group.evKw)
      : breakerWatts(group.evAmps, 240, 1);
    return {
      heatW: heatingDemandFromWatts(unitHeatConnectedWatts(group) + sumLoads(quoteLoads.heat), group.heatMethod),
      acW: acConnectedW + sumLoads(quoteLoads.ac),
      evW: evseDemandFromWatts(evConnectedW, group.evMode, group.evManagedKw) + sumLoads(quoteLoads.evse),
    };
  }

  function unitLivingAreaM2(group, unitSystem) {
    if (group.area && typeof group.area === "object") {
      return livingAreaM2(group.area, unitSystem);
    }
    const total = toSquareMetres(group.area, unitSystem);
    const aboveBasement = toSquareMetres(group.nonBasementArea || group.area, unitSystem);
    return { total, aboveBasement };
  }

  function loadUnitCount(load, groupQty) {
    const raw = number(load.unitCount);
    if (raw <= 0) return groupQty;
    return Math.min(groupQty, Math.floor(raw));
  }

  function expandGroupsByPartialUnitLoads(groups) {
    return groups.flatMap((group, groupIndex) => {
      const qty = Math.max(0, Math.floor(number(group.qty)));
      const loads = group.quoteLoads || [];
      if (qty <= 0 || !loads.some((load) => number(load.unitCount) > 0 && number(load.unitCount) < qty)) {
        return [{ ...group, sourceIndex: group.sourceIndex || groupIndex + 1 }];
      }

      const loadSets = Array.from({ length: qty }, () => []);
      loads.forEach((load) => {
        const count = loadUnitCount(load, qty);
        for (let i = 0; i < count; i += 1) loadSets[i].push(load);
      });

      const grouped = new Map();
      loadSets.forEach((set) => {
        const key = set.map((load) => `${load.name}|${load.qty}|${load.amps}|${load.volts}|${load.bucket}`).join("||");
        if (!grouped.has(key)) grouped.set(key, { qty: 0, quoteLoads: set });
        grouped.get(key).qty += 1;
      });

      let splitIndex = 0;
      return [...grouped.values()].map((entry) => {
        splitIndex += 1;
        return {
          ...group,
          qty: entry.qty,
          quoteLoads: entry.quoteLoads,
          sourceIndex: `${group.sourceIndex || groupIndex + 1}.${splitIndex}`,
        };
      });
    });
  }

  function expandApartmentUnitLoads(groups, unitSystem) {
    const units = [];
    const summaries = [];

    expandGroupsByPartialUnitLoads(groups).forEach((group, index) => {
      const qty = Math.max(0, Math.floor(number(group.qty)));
      const area = unitLivingAreaM2(group, unitSystem);
      const areaM2 = area.total;
      const quoteLoads = splitQuoteLoads(group.quoteLoads || []);
      const basicW = apartmentBasicLoad(areaM2);
      const rangeConnectedW = unitRangeConnectedWatts(group);
      const hasRange = rangeConnectedW > 0;
      const rangeW = rangeDemandFromWatts(rangeConnectedW);
      const waterW = unitWaterConnectedWatts(group) + sumLoads(quoteLoads.water);
      const otherConnectedW = unitOtherConnectedWatts(group) + sumLoads(quoteLoads.other);
      const otherW = apartmentOtherDemandFromWatts(otherConnectedW, hasRange);
      const baseW = basicW + rangeW + waterW + otherW;
      const { heatW, acW, evW } = unitHeatAcEvLoads(group, quoteLoads);

      for (let i = 0; i < qty; i += 1) {
        units.push({ baseW, heatW, acW, evW });
      }

      summaries.push({
        index: group.sourceIndex || index + 1,
        qty,
        areaM2,
        basicW,
        rangeW,
        waterW,
        otherW,
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
    const area = unitLivingAreaM2(group, unitSystem);
    const areaM2 = area.total;
    const nonBasementAreaM2 = area.aboveBasement;
    const quoteLoads = splitQuoteLoads(group.quoteLoads || []);
    const basicW = singleBasicLoad(areaM2);
    const rangeConnectedW = unitRangeConnectedWatts(group);
    const hasRange = rangeConnectedW > 0;
    const rangeW = rangeDemandFromWatts(rangeConnectedW);
    const waterW = unitWaterConnectedWatts(group) + sumLoads(quoteLoads.water);
    const otherConnectedW = unitOtherConnectedWatts(group);
    const otherLoads = otherConnectedW > 0
      ? [{ name: "Other unit loads", watts: otherConnectedW }]
      : [];
    const other = singleOtherDemand([...otherLoads, ...quoteLoads.other], hasRange);
    const itemA = basicW + rangeW + waterW + other.demand;
    const itemB = nonBasementAreaM2 >= 80 ? 24000 : 14400;

    return {
      areaM2,
      nonBasementAreaM2,
      baseW: Math.max(itemA, itemB),
      basicW,
      rangeW,
      waterW,
      otherW: other.demand,
      itemA,
      itemB,
      rangeConnectedW,
      otherConnectedW,
    };
  }

  function expandRowHousingUnitLoads(groups, unitSystem) {
    const units = [];
    const summaries = [];

    expandGroupsByPartialUnitLoads(groups).forEach((group, index) => {
      const qty = Math.max(0, Math.floor(number(group.qty)));
      const base = rowHousingUnitBaseLoad(group, unitSystem);
      const quoteLoads = splitQuoteLoads(group.quoteLoads || []);
      const { heatW, acW, evW } = unitHeatAcEvLoads(group, quoteLoads);

      for (let i = 0; i < qty; i += 1) {
        units.push({ baseW: base.baseW, heatW, acW, evW });
      }

      summaries.push({
        index: group.sourceIndex || index + 1,
        qty,
        areaM2: base.areaM2,
        nonBasementAreaM2: base.nonBasementAreaM2,
        baseW: base.baseW,
        basicW: base.basicW,
        rangeW: base.rangeW,
        waterW: base.waterW,
        otherW: base.otherW,
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

  function multiProposedLoadTotals(input) {
    const quoteLoads = splitQuoteLoads(input.proposedLoads || []);
    return {
      commonProposedW: sumLoads([
        ...quoteLoads.other,
        ...quoteLoads.water,
        ...quoteLoads.ac,
        ...quoteLoads.heat,
      ]),
      evProposedW: sumLoads(quoteLoads.evse),
    };
  }

  function multiCommonLoads(input) {
    const { commonProposedW, evProposedW } = multiProposedLoadTotals(input);
    return {
      commonEvW: evseDemand(input.commonEvKw, input.commonEvMode, input.commonEvManagedKw) + evProposedW,
      commonLoadsW: (kwToW(input.commonKw) + commonProposedW) * 0.75,
      commonProposedW,
      evProposedW,
    };
  }

  function multiSeparateLoadTotals(expanded, input) {
    const heatW = expanded.units.reduce((sum, unit) => sum + unit.heatW, 0);
    const acW = expanded.units.reduce((sum, unit) => sum + unit.acW, 0);
    const hvacW = hvacDemand(heatW, acW, input.hvacInterlocked);
    const unitEvW = expanded.units.reduce((sum, unit) => sum + unit.evW, 0);
    const { commonEvW, commonLoadsW, commonProposedW, evProposedW } = multiCommonLoads(input);

    return { hvacW, unitEvW, commonEvW, commonLoadsW, commonProposedW, evProposedW };
  }

  function calculateApartmentBuilding(input) {
    const expanded = expandApartmentUnitLoads(input.groups || [], input.unitSystem);
    const baseLoads = expanded.units.map((unit) => unit.baseW);
    const totalUnitBaseW = baseLoads.reduce((sum, watts) => sum + watts, 0);
    const diversifiedUnitsW = diversifiedDwellingUnitLoad(baseLoads);
    const { hvacW, unitEvW, commonEvW, commonLoadsW, commonProposedW, evProposedW } = multiSeparateLoadTotals(expanded, input);
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
        ["Proposed non-EVSE common connected load", commonProposedW, "W"],
        ["Proposed EVSE common connected load", evProposedW, "W"],
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
    const { hvacW, unitEvW, commonEvW, commonLoadsW, commonProposedW, evProposedW } = multiSeparateLoadTotals(expanded, input);
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
        ["Proposed non-EVSE common connected load", commonProposedW, "W"],
        ["Proposed EVSE common connected load", evProposedW, "W"],
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

  // Keep unrounded engine values; round only text (up to eight decimal places).
  function reportNumber(value) {
    return String(Number(Number(value).toFixed(8)));
  }

  function singleReportStage(input, supplyMode) {
    const result = calculateSingle(input);
    const c = result.components;
    const n = reportNumber;
    const k = (watts) => n(watts / 1000);
    const steps = [];
    const add = (key, label, formula, value, unit = "W") => steps.push({ key, label, formula, value, unit });
    const a = input.area;
    const effective = number(a.ground) + number(a.above) + number(a.basement) * 0.75;
    const areaUnit = input.unitSystem === "ft2" ? "ft²" : "m²";
    add("area", "8-110 effective living area", `${n(number(a.ground))} + ${n(number(a.above))} + (${n(number(a.basement))} × 75%) = ${n(effective)} ${areaUnit}; ${n(effective)} ${areaUnit}${input.unitSystem === "ft2" ? " × 0.09290304" : " × 1"} = ${n(result.area.total)} m²`, result.area.total, "m²");
    add("basic", "8-200(1)(a)(i–ii) basic load", result.area.total > 0
      ? `5 + ceil((${n(result.area.total)} − 90) ÷ 90) × 1 = ${k(c.basicW)} kW (additional portions clamped to zero below 90 m²)`
      : "No positive area entered: basic load = 0 kW", c.basicW);
    add("range", "8-200(1)(a)(iv) range", c.hasRange
      ? `6 + max(0, ${k(c.rangeConnectedW)} − 12) × 40% = ${k(c.rangeW)} kW`
      : "No electric range included: 0 kW", c.rangeW);
    add("ac", "AC: existing + proposed/additional", `${k(c.acConnectedW)} + ${k(c.acW - c.acConnectedW)} = ${k(c.acW)} kW (100% before heat/AC interlock)`, c.acW);
    const additional = splitQuoteLoads(input.quoteLoads || input.otherLoads || []);
    add("heat", "62-118 heat demand", `Connected heat = ${k(c.heatConnectedW - sumLoads(additional.heat))} + ${k(sumLoads(additional.heat))} = ${k(c.heatConnectedW)} kW; ` + (input.heatMethod === "residential-zoned"
      ? `min(${k(c.heatConnectedW)}, 10) + max(0, ${k(c.heatConnectedW)} − 10) × 75% = ${k(c.heatW)} kW`
      : `${k(c.heatConnectedW)} × 100% = ${k(c.heatW)} kW`), c.heatW);
    add("hvac", "8-200(1)(a)(iii) heat / AC", input.hvacInterlocked
      ? `Interlocked: max(${k(c.heatW)}, ${k(c.acW)}) = ${k(c.hvacW)} kW`
      : `Not interlocked: ${k(c.heatW)} + ${k(c.acW)} = ${k(c.hvacW)} kW`, c.hvacW);
    add("water", "8-200(1)(a)(v) water heat at 100%", `${k(c.waterConnectedW)} + ${k(sumLoads(additional.water))} = ${k(c.waterW)} kW`, c.waterW);
    const evBasis = input.evMode === "managed" ? `EVEMS maximum ${k(kwToW(input.evManagedKw))} kW`
      : input.evMode === "omitted" ? "Existing EVSE omitted under selected 8-106 option: 0 kW"
      : `${k(c.evConnectedW)} kW × 100%`;
    add("ev", "8-200(1)(a)(vi), 8-106 EVSE", `${evBasis} + ${k(sumLoads(additional.evse))} kW additional/proposed EVSE at 100% = ${k(c.evW)} kW`, c.evW);
    const otherSum = c.other.qualifying.map(load => k(load.watts)).join(" + ") || "0";
    add("other", "8-200(1)(a)(vii) other loads", c.hasRange
      ? `(${otherSum}) × 25% = ${k(c.other.demand)} kW`
      : `T = (${otherSum}) = ${k(c.other.total)} kW; min(T, 6) + max(0, T − 6) × 25% = ${k(c.other.demand)} kW`, c.other.demand);
    add("itemA", "Item A — entered-load subtotal", `${[c.basicW, c.hvacW, c.rangeW, c.waterW, c.evW, c.other.demand].map(k).join(" + ")} = ${k(result.itemA)} kW (basic + HVAC + range + water + EVSE + other)`, result.itemA);
    add("minimum", "Item B — minimum, excluding basement", `(${n(number(a.ground))} + ${n(number(a.above))}) ${areaUnit} × ${input.unitSystem === "ft2" ? "0.09290304" : "1"} = ${n(result.area.aboveBasement)} m²; ${n(result.area.aboveBasement)} ${result.area.aboveBasement >= 80 ? "≥" : "<"} 80 m² → ${k(result.itemB)} kW`, result.itemB);
    add("governing", "Governing load — larger of A and B", `max(${k(result.itemA)}, ${k(result.itemB)}) = ${k(result.totalW)} kW; ${result.itemA > result.itemB ? "Item A" : "Item B minimum"} governs`, result.totalW);
    const denominator = { "single-208": "208 V", "three-208": "(√3 × 208 V)", "three-240": "(√3 × 240 V)" }[supplyMode] || "240 V";
    add("itemAAmps", "Item A current — before minimum comparison", `${n(result.itemA)} W ÷ ${denominator} = ${n(ampsForWatts(result.itemA, supplyMode).amps)} A (not the governing service requirement when Item B is larger)`, ampsForWatts(result.itemA, supplyMode).amps, "A");
    add("amps", "Governing current conversion", `${n(result.totalW)} W ÷ ${denominator} = ${n(ampsForWatts(result.totalW, supplyMode).amps)} A (displayed summary rounds up to whole A)`, ampsForWatts(result.totalW, supplyMode).amps, "A");
    return { result, steps };
  }

  // UI adapter only: a positive per-item nameplate entry becomes the existing watts input.
  // Keep the historical zero/blank -> breaker fallback, and state that explicitly in reports.
  function prepareLoadInput(load) {
    const prepared = { ...load };
    if (number(load.kw) > 0) prepared.watts = kwToW(load.kw) * Math.max(1, Math.floor(number(load.qty) || 1));
    return prepared;
  }

  function describeLoadRating(load) {
    const connectedW = quoteLoadWatts(load);
    const qty = Math.max(1, Math.floor(number(load.qty) || 1));
    const kwEntered = load.kw !== undefined && load.kw !== null && String(load.kw).trim() !== "";
    const ratingText = number(load.kw) > 0 ? `Entered nameplate rating: ${reportNumber(number(load.kw))} kW per item (unverified)`
      : kwEntered ? "Entered 0 kW; zero does not override breaker fallback"
      : "Unknown — nameplate rating not supplied";
    const breakerBasis = load.ratingBasis === "breaker-estimate" || number(load.watts) <= 0;
    const isEstimate = breakerBasis && connectedW > 0;
    const formula = !breakerBasis
      ? number(load.kw) > 0 ? `${reportNumber(number(load.kw))} kW × ${qty} = ${reportNumber(connectedW / 1000)} kW (entered rating)`
        : `${reportNumber(connectedW)} W ÷ 1000 = ${reportNumber(connectedW / 1000)} kW (entered connected watts; source not verified)`
      : `${reportNumber(number(load.amps))} A × ${reportNumber(number(load.volts) || 240)} V × ${qty} = ${reportNumber(connectedW / 1000)} kW${isEstimate ? " — BREAKER ESTIMATE, not equipment nameplate" : " — no connected load entered; absence not verified"}`;
    return { ratingText, connectedW, formula, isEstimate };
  }

  function singleLoadInventory(input, proposedLoads, result) {
    const fixed = [
      ["range", "Existing range", "range", "rangeConnectedW"],
      ["dryer", "Existing dryer", "other", "dryerConnectedW"],
      ["ac", "Existing AC", "ac", "acConnectedW"],
      ["water", "Existing tankless / pool / spa water heat", "water", "waterConnectedW"],
      ["heat", "Existing electric space heat", "heat", null],
      ["ev", "Existing EVSE", "evse", "evConnectedW"],
    ].map(([key, name, bucket, component]) => {
      const kw = input[`${key}Kw`];
      const watts = component ? result.components[component] : connectedWatts(kw, input.heatAmps, 240, 1);
      return { key, name, bucket, kw, amps: input[`${key}Amps`], volts: 240, qty: 1,
        ...(number(kw) > 0 ? { watts } : {}), ...(input.equipment?.[key] || {}), scope: "Existing fixed input" };
    });
    return [...fixed,
      ...(input.quoteLoads || input.otherLoads || []).map(load => ({ ...load, scope: "Existing / already planned additional" })),
      ...proposedLoads.map(load => ({ ...load, scope: "Proposed addition" })),
    ].map(load => {
      const rating = describeLoadRating(load);
      const bucket = load.bucket || "other";
      let treatment;
      if (load.key === "range" && input.gasRange) {
        rating.connectedW = 0;
        rating.isEstimate = false;
        rating.formula = "Excluded by gas range / no electric range selection; entered electric inputs not used";
        treatment = "No electric range demand";
      } else if (bucket === "other") {
        treatment = rating.connectedW <= 1500 ? "≤ 1.5 kW per entered row: excluded from other-load demand"
          : result.components.hasRange ? `${reportNumber(rating.connectedW / 1000)} × 25% = ${reportNumber(rating.connectedW * 0.25 / 1000)} kW`
          : "Included in pooled no-range total: first 6 kW at 100%, remainder at 25%; see worked calculation";
      } else {
        treatment = {
          range: result.components.hasRange
            ? "6 kW + 40% of connected rating above 12 kW; see range calculation"
            : "No electric range load entered: 0 kW demand; absence not verified",
          water: `${reportNumber(rating.connectedW / 1000)} × 100% = ${reportNumber(rating.connectedW / 1000)} kW`,
          ac: "100% into AC total; then selected heat/AC interlock applies",
          heat: "Into heat total; selected heat demand and interlock apply to combined load",
          evse: load.key === "ev" ? `Existing EVSE: ${input.evMode || "full"} mode; see EV calculation` : "Additional / proposed EVSE added at 100%; not limited by existing EVEMS entry",
        }[bucket] || "Unknown bucket; not included by current engine — verify selection";
      }
      return { ...load, ...rating, name: load.name || "Load", bucket, treatment,
        model: load.model || "Not supplied", source: load.source || "Not supplied" };
    });
  }

  function buildSingleReportTrace(input, proposedLoads = [], supplyMode = "single-240") {
    const before = singleReportStage(input, supplyMode);
    const after = singleReportStage({ ...input, quoteLoads: [...(input.quoteLoads || input.otherLoads || []), ...proposedLoads] }, supplyMode);
    const loads = singleLoadInventory(input, proposedLoads, after.result);
    const warnings = [
      "Planning aid only. Equipment/source text is user-entered and has not been verified. Unknown rating is not a verified 0 kW load.",
      "Existing calculation behavior retained: 0 kW does not override a breaker estimate. To enter no connected load, clear the rating and set breaker amps to 0; verify absence on site.",
      "Other-load eligibility is tested on each entered row total (> 1.5 kW), including its quantity. Range presets in the additional-load list remain in the other bucket, not the primary range formula. Verify classifications.",
      "Panel pass/fail uses the pre-existing Item-B-versus-80% policy. This report does not validate that policy or EVEMS/interlock eligibility; confirm the applicable requirements with the authority having jurisdiction.",
    ];
    if (loads.some(load => load.isEstimate)) warnings.unshift("BREAKER ESTIMATE WARNING: one or more loads use breaker A × V, not equipment input/nameplate power. Replace estimates with verified equipment ratings before relying on this calculation.");
    if (loads.some(load => load.bucket === "evse" && load.key !== "ev")) warnings.push("Existing engine behavior: additional / proposed EVSE is added at 100% after the existing EVSE management/omission calculation; it is not capped by that EVEMS maximum.");
    return { before, after, loads, warnings };
  }

  return {
    prepareLoadInput,
    describeLoadRating,
    buildSingleReportTrace,
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
    mainBreakerLabel: $("#main-breaker-label"),
    supplyMode: $("#supply-mode"),
    supplyModeLabel: $("#supply-mode-label"),
    panelSupplyField: $("#panel-supply-field"),
    panelSupplyMode: $("#panel-supply-mode"),
    resetButton: $("#reset-calculator"),
    exportButton: $("#export-pdf"),
    singleForm: $("#single-form"),
    multiForm: $("#multi-form"),
    reportProject: $("#report-project"),
    reportPermit: $("#report-permit"),
    reportAddress: $("#report-address"),
    reportCustomer: $("#report-customer"),
    reportPreparedBy: $("#report-prepared-by"),
    reportDate: $("#report-date"),
    printReport: $("#print-report"),
    singlePanel: $("#single-panel"),
    multiPanel: $("#multi-panel"),
    summary: $(".summary"),
    resultKw: $("#result-kw"),
    resultAmps: $("#result-amps"),
    ampsLabel: $("#amps-label"),
    ruleComparison: $("#rule-comparison"),
    panelCheck: $("#panel-check"),
    panelWarning: $("#panel-warning"),
    serviceFeederCheck: $("#service-feeder-check"),
    proposedLoadHelp: $("#proposed-load-help"),
    multiProposedTarget: $("#multi-proposed-target"),
    multiProposedGroup: $("#multi-proposed-group"),
    multiProposedUnitQty: $("#multi-proposed-unit-qty"),
    breakdown: $("#breakdown-list"),
    notes: $("#note-list"),
    singleLoads: $("#single-other-loads"),
    proposedLoads: $("#proposed-loads"),
    addProposedLoadButton: $("#add-proposed-load"),
    multiBuildingType: $("#multi-building-type"),
    unitGroups: $("#unit-groups"),
    loadTemplate: $("#load-row-template"),
    proposedLoadTemplate: $("#proposed-load-row-template"),
    groupTemplate: $("#unit-group-template"),
  };

  let activeMode = "single";
  let latestResult = null;
  let latestAmpResult = null;
  let printReportPrepared = false;
  const PANEL_LOAD_LIMIT_FACTOR = 0.8;
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

  function addLoadRow(container, values = {}) {
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
    ["kw", "model", "source"].forEach(key => { $(`[data-load-${key}]`, node).value = next[key] ?? ""; });
    const unitCount = $("[data-load-unit-count]", node);
    if (unitCount) unitCount.value = next.unitCount || "";
    $("[data-remove-load]", node).addEventListener("click", () => {
      node.remove();
      render();
    });
    node.addEventListener("input", render);
    container.append(node);
    return node;
  }

  function addSingleLoad(values = {}) {
    addLoadRow(els.singleLoads, values);
  }

  function loadRows(container) {
    return $$(".load-row", container).map((row) => app.prepareLoadInput({
      name: $("[data-load-name]", row).value,
      kw: $("[data-load-kw]", row).value,
      model: $("[data-load-model]", row).value,
      source: $("[data-load-source]", row).value,
      qty: $("[data-load-qty]", row).value,
      amps: $("[data-load-amps]", row).value,
      volts: $("[data-load-volts]", row).value,
      bucket: $("[data-load-bucket]", row).value,
      unitCount: $("[data-load-unit-count]", row)?.value || "",
    }));
  }

  function hasConnectedLoadRow(row) {
    const qty = loadQty($("[data-load-qty]", row).value);
    const amps = $("[data-load-amps]", row).value;
    const volts = $("[data-load-volts]", row).value;
    return app.describeLoadRating(app.prepareLoadInput({ amps, volts, qty, kw: $("[data-load-kw]", row).value })).connectedW > 0;
  }

  function loadQty(value) {
    return Math.max(1, Math.floor(positiveNumber(value) || 1));
  }

  function addProposedLoad(values = {}) {
    const node = els.proposedLoadTemplate.content.firstElementChild.cloneNode(true);
    const defaults = {
      name: "Load to add",
      qty: 1,
      amps: 0,
      volts: 240,
      kw: "",
      bucket: "other",
    };
    const next = { ...defaults, ...values };
    $("[data-proposed-load-name]", node).value = next.name;
    $("[data-proposed-load-qty]", node).value = next.qty;
    $("[data-proposed-load-amps]", node).value = next.amps;
    $("[data-proposed-load-volts]", node).value = next.volts;
    $("[data-proposed-load-kw]", node).value = next.kw;
    $("[data-proposed-load-bucket]", node).value = next.bucket;
    ["model", "source"].forEach(key => { $(`[data-proposed-load-${key}]`, node).value = next[key] ?? ""; });
    $("[data-remove-proposed-load]", node).addEventListener("click", () => {
      node.remove();
      render();
    });
    node.addEventListener("input", render);
    els.proposedLoads.append(node);
  }

  function proposedLoadDetail(row) {
    const qty = loadQty($("[data-proposed-load-qty]", row).value);
    const amps = $("[data-proposed-load-amps]", row).value;
    const volts = $("[data-proposed-load-volts]", row).value;
    const kw = $("[data-proposed-load-kw]", row).value;
    const knownKw = positiveNumber(kw);
    const breakerW = app.breakerWatts(amps, volts, qty);
    const connectedW = knownKw > 0 ? knownKw * 1000 * qty : breakerW;
    const load = {
      name: fieldText($("[data-proposed-load-name]", row), "Proposed load"),
      kw,
      model: $("[data-proposed-load-model]", row).value,
      source: $("[data-proposed-load-source]", row).value,
      qty,
      amps,
      volts,
      bucket: $("[data-proposed-load-bucket]", row).value,
      ratingBasis: knownKw > 0 ? "nameplate" : "breaker-estimate",
    };
    if (knownKw > 0) load.watts = connectedW;
    return {
      load,
      qty,
      knownKw,
      breakerW,
      connectedW,
      voltsText: selectedText($("[data-proposed-load-volts]", row)),
      bucketText: selectedText($("[data-proposed-load-bucket]", row)),
    };
  }

  function proposedLoadDetails(includeInactive = false) {
    return $$(".proposed-load-row", els.proposedLoads)
      .map((row) => proposedLoadDetail(row))
      .filter((detail) => includeInactive || detail.connectedW > 0);
  }

  function unitLoadDetail(row, groupIndex, scope) {
    const qty = loadQty($("[data-load-qty]", row).value);
    const amps = $("[data-load-amps]", row).value;
    const volts = $("[data-load-volts]", row).value;
    const connectedW = app.describeLoadRating(app.prepareLoadInput({ amps, volts, qty, kw: $("[data-load-kw]", row).value })).connectedW;
    const bucket = $("[data-load-bucket]", row);
    return {
      name: fieldText($("[data-load-name]", row), "Unit load"),
      scope: `Group ${groupIndex + 1} ${scope}`,
      qty,
      amps,
      connectedW,
      voltsText: selectedText($("[data-load-volts]", row)),
      bucketText: selectedText(bucket),
      bucket: bucket.value,
    };
  }

  function proposedLoads() {
    return proposedLoadDetails().map((detail) => detail.load);
  }

  function hasProposedLoad() {
    return proposedLoadDetails().length > 0;
  }

  function addUnitGroup(values = {}) {
    const node = els.groupTemplate.content.firstElementChild.cloneNode(true);
    const defaults = {
      qty: 4,
      area: {
        ground: 650,
        basement: 0,
        above: 0,
      },
      rangeAmps: 40,
      rangeVolts: 240,
      rangeKw: "",
      otherAmps: 30,
      otherVolts: 240,
      otherKw: "",
      waterAmps: 0,
      waterKw: "",
      evAmps: 0,
      evKw: "",
      evMode: "full",
      evManagedKw: 0,
      heatAmps: 0,
      heatKw: "",
      heatMethod: "residential-zoned",
      acAmps: 0,
      acKw: "",
    };
    const next = { ...defaults, ...values };
    const area = typeof next.area === "object"
      ? { ...defaults.area, ...next.area }
      : { ground: next.area, basement: 0, above: 0 };
    $("[data-unit-qty]", node).value = next.qty;
    $("[data-unit-ground]", node).value = area.ground;
    $("[data-unit-basement]", node).value = area.basement;
    $("[data-unit-above]", node).value = area.above;
    $("[data-unit-range-amps]", node).value = next.rangeAmps;
    $("[data-unit-range-kw]", node).value = next.rangeKw;
    $("[data-unit-other-amps]", node).value = next.otherAmps;
    $("[data-unit-other-kw]", node).value = next.otherKw;
    $("[data-unit-ac-amps]", node).value = next.acAmps;
    $("[data-unit-ac-kw]", node).value = next.acKw;
    $("[data-unit-ev-amps]", node).value = next.evAmps;
    $("[data-unit-ev-kw]", node).value = next.evKw;
    $("[data-unit-water-amps]", node).value = next.waterAmps;
    $("[data-unit-water]", node).value = next.waterKw;
    $("[data-unit-ev-mode]", node).value = next.evMode;
    $("[data-unit-ev-managed]", node).value = next.evManagedKw;
    $("[data-unit-heat-amps]", node).value = next.heatAmps;
    $("[data-unit-heat]", node).value = next.heatKw;
    $("[data-unit-heat-method]", node).value = next.heatMethod;
    const unitLoads = $("[data-unit-loads]", node);
    (next.quoteLoads || []).forEach((load) => addLoadRow(unitLoads, load));
    $("[data-remove-group]", node).addEventListener("click", () => {
      node.remove();
      render();
    });
    $("[data-add-unit-load]", node).addEventListener("click", () => {
      addLoadRow(unitLoads);
      render();
    });
    $$("[data-unit-preset-load]", node).forEach((button) => {
      button.addEventListener("click", () => {
        addLoadRow(unitLoads, presetLoads[button.dataset.unitPresetLoad]);
        render();
      });
    });
    node.addEventListener("input", render);
    node.addEventListener("change", render);
    els.unitGroups.append(node);
  }

  function singleInput(options = {}) {
    const includeProposed = options.includeProposed !== false;
    const quoteLoads = loadRows(els.singleLoads);
    if (includeProposed) quoteLoads.push(...proposedLoads());

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
      equipment: Object.fromEntries(["range", "dryer", "ac", "water", "heat", "ev"].map(key => [key, {
        model: readValue(`#single-${key}-model`), source: readValue(`#single-${key}-source`),
      }])),
      dryerAmps: readValue("#single-dryer-amps"),
      dryerKw: readValue("#single-dryer-kw"),
      dryerVolts: 240,
      waterAmps: readValue("#single-water-amps"),
      waterKw: readValue("#single-water"),
      heatAmps: readValue("#single-heat-amps"),
      heatKw: readValue("#single-heat"),
      heatMethod: readValue("#single-heat-method"),
      acAmps: readValue("#single-ac-amps"),
      acKw: readValue("#single-ac-kw"),
      hvacInterlocked: readChecked("#single-hvac-interlock"),
      evAmps: readValue("#single-ev-amps"),
      evKw: readValue("#single-ev-kw"),
      evMode: readValue("#single-ev-mode"),
      evManagedKw: readValue("#single-ev-managed"),
      quoteLoads,
    };
  }

  function multiProposedTarget(groups) {
    const groupCount = groups.length;
    const requestedGroup = Math.floor(positiveNumber(els.multiProposedGroup.value) || 1);
    const groupIndex = groupCount > 0 ? Math.min(Math.max(requestedGroup, 1), groupCount) - 1 : 0;
    const groupQty = groupCount > 0 ? Math.max(0, Math.floor(positiveNumber(groups[groupIndex].qty))) : 0;
    const requestedQty = Math.floor(positiveNumber(els.multiProposedUnitQty.value) || 1);
    const unitQty = groupQty > 0 ? Math.min(Math.max(requestedQty, 1), groupQty) : 0;
    return { groupIndex, unitQty };
  }

  function groupsWithProposedUnitLoads(groups, loads) {
    if (!loads.length || !groups.length) return groups;
    const target = multiProposedTarget(groups);
    if (target.unitQty <= 0) return groups;
    return groups.flatMap((group, index) => {
      if (index !== target.groupIndex) return [group];
      const groupQty = Math.max(0, Math.floor(positiveNumber(group.qty)));
      const unaffectedQty = Math.max(0, groupQty - target.unitQty);
      const proposedGroup = {
        ...group,
        qty: target.unitQty,
        quoteLoads: [...(group.quoteLoads || []), ...loads],
        proposedUnitTarget: true,
        originalGroupIndex: index,
      };
      if (unaffectedQty <= 0) return [proposedGroup];
      return [
        { ...group, qty: unaffectedQty, originalGroupIndex: index },
        proposedGroup,
      ];
    });
  }

  function multiInput(options = {}) {
    const includeProposed = options.includeProposed !== false;
    const proposedUnitLoads = includeProposed ? proposedLoads() : [];
    const groups = $$(".unit-group", els.unitGroups).map((row) => {
      const existingUnitLoads = loadRows($("[data-unit-loads]", row));
      return {
        qty: $("[data-unit-qty]", row).value,
        area: {
          ground: $("[data-unit-ground]", row).value,
          basement: $("[data-unit-basement]", row).value,
          above: $("[data-unit-above]", row).value,
        },
        rangeAmps: $("[data-unit-range-amps]", row).value,
        rangeVolts: 240,
        rangeKw: $("[data-unit-range-kw]", row).value,
        otherAmps: $("[data-unit-other-amps]", row).value,
        otherVolts: 240,
        otherKw: $("[data-unit-other-kw]", row).value,
        waterAmps: $("[data-unit-water-amps]", row).value,
        waterKw: $("[data-unit-water]", row).value,
        evAmps: $("[data-unit-ev-amps]", row).value,
        evKw: $("[data-unit-ev-kw]", row).value,
        evMode: $("[data-unit-ev-mode]", row).value,
        evManagedKw: $("[data-unit-ev-managed]", row).value,
        heatAmps: $("[data-unit-heat-amps]", row).value,
        heatKw: $("[data-unit-heat]", row).value,
        heatMethod: $("[data-unit-heat-method]", row).value,
        acAmps: $("[data-unit-ac-amps]", row).value,
        acKw: $("[data-unit-ac-kw]", row).value,
        quoteLoads: existingUnitLoads,
        existingUnitLoads,
      };
    });
    const target = multiProposedTarget(groups);
    return {
      unitSystem: els.unitSystem.value,
      buildingType: els.multiBuildingType.value,
      groups: groupsWithProposedUnitLoads(groups, proposedUnitLoads),
      enteredGroups: groups,
      proposedTargetGroup: target.groupIndex + 1,
      proposedTargetUnitQty: target.unitQty,
      commonKw: readValue("#multi-common"),
      commonEvKw: readValue("#multi-common-ev"),
      commonEvMode: readValue("#multi-common-ev-mode"),
      commonEvManagedKw: readValue("#multi-common-ev-managed"),
      hvacInterlocked: readChecked("#multi-hvac-interlock"),
      proposedLoads: [],
      proposedUnitLoads,
    };
  }

  function isPartialUnitLoad(load, groupQty) {
    const count = positiveNumber(load.unitCount);
    return count > 0 && count < groupQty;
  }

  function selectedUnitSingleInput(includeProposed = false) {
    const input = multiInput({ includeProposed: false });
    const target = multiProposedTarget(input.enteredGroups || input.groups);
    const group = (input.enteredGroups || input.groups)[target.groupIndex] || (input.enteredGroups || input.groups)[0];
    if (!group) return singleInput({ includeProposed });

    const groupQty = Math.max(0, Math.floor(positiveNumber(group.qty)));
    const baseLoads = (group.existingUnitLoads || group.quoteLoads || [])
      .filter((load) => !isPartialUnitLoad(load, groupQty));
    const quoteLoads = includeProposed
      ? [...baseLoads, ...proposedLoads()]
      : baseLoads;

    return {
      unitSystem: input.unitSystem,
      area: group.area,
      rangeAmps: group.rangeAmps,
      rangeVolts: 240,
      rangeKw: group.rangeKw,
      gasRange: positiveNumber(group.rangeAmps) <= 0 && positiveNumber(group.rangeKw) <= 0,
      dryerAmps: group.otherAmps,
      dryerKw: group.otherKw,
      dryerVolts: 240,
      waterAmps: group.waterAmps,
      waterKw: group.waterKw,
      heatAmps: group.heatAmps,
      heatKw: group.heatKw,
      heatMethod: group.heatMethod,
      acAmps: group.acAmps,
      acKw: group.acKw,
      hvacInterlocked: input.hvacInterlocked,
      evAmps: group.evAmps,
      evKw: group.evKw,
      evMode: group.evMode,
      evManagedKw: group.evManagedKw,
      quoteLoads,
    };
  }

  function panelEvaluationResults(beforeResult, afterResult) {
    if (activeMode !== "multi") {
      return { before: beforeResult, after: afterResult, checkMode: "single" };
    }
    const before = app.calculateSingle(selectedUnitSingleInput(false));
    const after = app.calculateSingle(selectedUnitSingleInput(true));
    before.panelLabel = "Selected unit before proposed loads";
    after.panelLabel = "Selected unit after proposed loads";
    return { before, after, checkMode: "single" };
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

  function formatAmpsOneDecimal(value) {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} A`;
  }

  function itemBMinimumGoverns(result) {
    return Number.isFinite(result?.itemA) && Number.isFinite(result?.itemB) && result.itemB >= result.itemA;
  }

  function panelLimitFactor(result, checkMode = activeMode) {
    if (checkMode !== "single") return 1;
    return itemBMinimumGoverns(result) ? 1 : PANEL_LOAD_LIMIT_FACTOR;
  }

  function panelLimitAmps(breakerAmps, result, checkMode = activeMode) {
    return breakerAmps * panelLimitFactor(result, checkMode);
  }

  function panelLimitBasis(result, checkMode = activeMode) {
    if (checkMode !== "single") {
      return "Multi-family calculated load compared directly to the selected service or feeder breaker";
    }
    return itemBMinimumGoverns(result)
      ? "8-200(1)(b) minimum governs; compare to selected main with no 80% reduction"
      : "8-200(1)(a) entered-load subtotal governs; Calgary 80% maximum applies";
  }

  function panelLimitLabel(breakerAmps, result, checkMode = activeMode) {
    if (itemBMinimumGoverns(result)) {
      return `${formatAmps(breakerAmps)} (selected main; no 80% reduction under 8-200(1)(b))`;
    }
    if (checkMode !== "single") return `${formatAmps(breakerAmps)} selected service/feeder`;
    return `${formatAmps(panelLimitAmps(breakerAmps, result, checkMode))} (80% of ${formatAmps(breakerAmps)})`;
  }

  function panelLimitShortLabel(result, checkMode = activeMode) {
    if (checkMode !== "single") return "selected service/feeder";
    return itemBMinimumGoverns(result) ? "selected main" : "80% limit";
  }

  function panelMarginText(amps, limitAmps, result, checkMode = activeMode) {
    const margin = Math.abs(limitAmps - amps);
    if (margin < 0.05) return `at ${panelLimitShortLabel(result, checkMode)}`;
    return amps < limitAmps
      ? `${formatAmpsOneDecimal(margin)} below ${panelLimitShortLabel(result, checkMode)}`
      : `${formatAmpsOneDecimal(margin)} over ${panelLimitShortLabel(result, checkMode)}`;
  }

  function formatReportDate(value) {
    if (!value) return "Not provided";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function todayInputValue() {
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    return new Date(today.getTime() - offset).toISOString().slice(0, 10);
  }

  function displayedLoadWatts(result) {
    return result.totalW;
  }

  function standardProtectionSize(amps) {
    const sizes = [60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000, 1200, 1600, 2000, 2500, 3000, 4000];
    return sizes.find((size) => amps <= size) || Math.ceil(amps / 100) * 100;
  }

  function serviceFeederCheck(beforeResult, afterResult) {
    if (activeMode !== "multi") return null;
    const beforeAmps = app.ampsForWatts(displayedLoadWatts(beforeResult), els.supplyMode.value).amps;
    const afterAmps = app.ampsForWatts(displayedLoadWatts(afterResult), els.supplyMode.value).amps;
    const expectedProtectionA = standardProtectionSize(beforeAmps);
    const exceedsExpected = afterAmps > expectedProtectionA;
    return {
      beforeAmps,
      afterAmps,
      expectedProtectionA,
      exceedsExpected,
      supplyLabel: selectedText(els.supplyMode),
    };
  }

  function serviceFeederCheckRows(check) {
    if (!check) return [];
    return [
      ["Existing aggregate calculated amps", formatAmps(check.beforeAmps)],
      ["Estimated existing upstream protection", formatAmps(check.expectedProtectionA)],
      ["After-proposed aggregate calculated amps", formatAmps(check.afterAmps)],
      ["Supply basis", check.supplyLabel],
      ["Status", check.exceedsExpected
        ? "After-proposed load is above the estimated existing upstream protection size. Use approved load management or confirm the actual upstream rating before relying on this reference."
        : "After-proposed load is within the estimated existing upstream protection size. Confirm the actual upstream rating where required for approval."],
    ];
  }

  function appendServiceFeederStatusCards(parent, check) {
    if (!check) return;
    const list = createEl("div", "print-status-list print-status-list--upstream");
    [
      {
        label: "Existing aggregate",
        text: "Reference",
        passes: true,
        rows: [
          ["Calculated amps", formatAmps(check.beforeAmps)],
          ["Estimated protection", formatAmps(check.expectedProtectionA)],
          ["Main feed type", check.supplyLabel],
        ],
      },
      {
        label: "After proposed aggregate",
        text: check.exceedsExpected ? "Review" : "Within",
        passes: !check.exceedsExpected,
        rows: [
          ["Calculated amps", formatAmps(check.afterAmps)],
          ["Estimated protection", formatAmps(check.expectedProtectionA)],
          ["Main feed type", check.supplyLabel],
          ["Margin", check.exceedsExpected
            ? `${formatAmpsOneDecimal(check.afterAmps - check.expectedProtectionA)} over estimate`
            : `${formatAmpsOneDecimal(check.expectedProtectionA - check.afterAmps)} below estimate`],
        ],
      },
    ].forEach((checkCard) => {
      const card = createEl("div", `print-status-card ${checkCard.passes ? "is-pass" : "is-fail"}`);
      const heading = createEl("div", "print-status-heading");
      heading.append(createEl("span", "", checkCard.label));
      heading.append(createEl("strong", "print-status-badge", checkCard.text.toUpperCase()));
      card.append(heading);

      const metrics = createEl("dl", "print-status-metrics");
      checkCard.rows.forEach(([label, value]) => {
        metrics.append(createEl("dt", "", label));
        metrics.append(createEl("dd", "", value));
      });
      card.append(metrics);
      list.append(card);
    });
    parent.append(list);
  }

  function breakdownValue(row) {
    const [label, value, unit] = row;
    if (unit === "m2") return [label, formatArea(value)];
    if (unit === "count") return [label, String(value)];
    return [label, formatWatts(value)];
  }

  function isUsedBreakdownRow(row) {
    const [, value, unit] = row;
    if (unit === "count") return positiveNumber(value) > 0;
    if (unit === "m2") return positiveNumber(value) > 0;
    return positiveNumber(value) > 0;
  }

  function printBreakdownRows(result) {
    return result.breakdown.filter(isUsedBreakdownRow).map((row) => breakdownValue(row));
  }

  function selectedText(select) {
    return select.options[select.selectedIndex]?.textContent || select.value;
  }

  function panelSupplyMode() {
    return activeMode === "single"
      ? els.supplyMode.value
      : els.panelSupplyMode?.value || "single-240";
  }

  function panelSupplyText() {
    return activeMode === "single"
      ? selectedText(els.supplyMode)
      : selectedText(els.panelSupplyMode);
  }

  function fieldText(input, fallback = "Not provided") {
    const value = String(input?.value || "").trim();
    return value || fallback;
  }

  function valueWithUnit(value, unit) {
    const text = String(value || "").trim();
    return text ? `${text} ${unit}` : `0 ${unit}`;
  }

  function yesNo(value) {
    return value ? "Yes" : "No";
  }

  function createEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appendTable(parent, headings, rows, options = {}) {
    const table = createEl("table", options.className || "print-table");
    if (options.showHead !== false) {
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      headings.forEach((heading) => headerRow.append(createEl("th", "", heading)));
      thead.append(headerRow);
      table.append(thead);
    }

    const tbody = document.createElement("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell) => tr.append(createEl("td", "", cell)));
      tbody.append(tr);
    });
    table.append(tbody);
    parent.append(table);
  }

  function appendPanelStatusCards(parent, beforeResult, afterResult, checkMode = activeMode) {
    const breakerAmps = positiveNumber(els.mainBreakerAmps.value);
    if (breakerAmps <= 0) return;
    const list = createEl("div", "print-status-list");
    [
      panelCheckStatus(beforeResult, beforeResult.panelLabel || "Before proposed loads", checkMode),
      panelCheckStatus(afterResult, afterResult.panelLabel || "After proposed loads", checkMode),
    ].forEach((check) => {
      const card = createEl("div", `print-status-card ${check.passes ? "is-pass" : "is-fail"}`);
      const heading = createEl("div", "print-status-heading");
      heading.append(createEl("span", "", check.label));
      heading.append(createEl("strong", "print-status-badge", check.text.toUpperCase()));
      card.append(heading);

      const metrics = createEl("dl", "print-status-metrics");
      [
        ["Calculated load", formatWatts(displayedLoadWatts(check.result))],
        ["Calculated amps", formatAmps(check.ampResult.amps)],
        [activeMode === "multi" ? "Selected unit panel" : "Selected main", formatAmps(breakerAmps)],
        ["Required max", check.limitLabel],
        [activeMode === "multi" ? "Panel type" : "Amps basis", check.supplyLabel],
        ["Rule basis", check.basis],
        ["Margin", panelMarginText(check.ampResult.amps, check.limitAmps, check.result, check.checkMode)],
      ].forEach(([label, value]) => {
        metrics.append(createEl("dt", "", label));
        metrics.append(createEl("dd", "", value));
      });
      card.append(metrics);
      list.append(card);
    });
    parent.append(list);
  }

  function selectedUnitComparisonRows(beforeResult, afterResult) {
    if (activeMode !== "multi") return [];
    return [
      ["Before proposed loads", formatWatts(beforeResult.itemA), formatWatts(beforeResult.itemB), formatWatts(displayedLoadWatts(beforeResult))],
      ["After proposed loads", formatWatts(afterResult.itemA), formatWatts(afterResult.itemB), formatWatts(displayedLoadWatts(afterResult))],
    ];
  }

  function appendSelectedUnitComparison(parent, beforeResult, afterResult) {
    const rows = selectedUnitComparisonRows(beforeResult, afterResult);
    if (!rows.length) return;
    appendTable(parent, [
      "Selected unit check",
      "8-200(1)(a) entered-load subtotal",
      "8-200(1)(b) minimum",
      "Governing selected-unit load",
    ], rows, { className: "print-table print-unit-comparison-table" });

    if (afterResult.itemB >= afterResult.itemA && displayedLoadWatts(beforeResult) === displayedLoadWatts(afterResult)) {
      parent.append(createEl(
        "p",
        "print-note",
        `The proposed load increases the selected unit 8-200(1)(a) subtotal from ${formatWatts(beforeResult.itemA)} to ${formatWatts(afterResult.itemA)}, but the selected-unit calculated load remains ${formatWatts(afterResult.itemB)} because 8-200(1)(b) is still the larger value.`
      ));
    }
  }

  function panelDecision(beforeResult, afterResult, checkMode = activeMode) {
    const breakerAmps = positiveNumber(els.mainBreakerAmps.value);
    const before = panelCheckStatus(beforeResult, beforeResult.panelLabel || "Before proposed loads", checkMode);
    const after = panelCheckStatus(afterResult, afterResult.panelLabel || "After proposed loads", checkMode);
    const checkLabel = activeMode === "multi" ? "selected unit panel check" : "selected main breaker check";
    if (after.passes) {
      return {
        passes: true,
        title: "PASS AFTER PROPOSED LOADS",
        detail: `The entered values pass the ${checkLabel}; this is not approval to install. Calculated load after the proposed loads is ${formatAmps(after.ampResult.amps)}, which is ${panelMarginText(after.ampResult.amps, after.limitAmps, after.result, after.checkMode)} against ${after.limitLabel}. ${after.basis}.`,
      };
    }
    if (!before.passes) {
      return {
        passes: false,
        title: "FAIL BEFORE PROPOSED LOADS",
        detail: `Existing calculated load is ${formatAmps(before.ampResult.amps)}, which is already ${panelMarginText(before.ampResult.amps, before.limitAmps, before.result, before.checkMode)} before the proposed loads are included. ${before.basis}.`,
      };
    }
    return {
      passes: false,
      title: "LOAD MANAGEMENT REQUIRED",
      detail: `Load management is required to add the proposed load(s). The proposed loads push the calculated load to ${formatAmps(after.ampResult.amps)}, which is ${panelMarginText(after.ampResult.amps, after.limitAmps, after.result, after.checkMode)} against ${after.limitLabel}. ${after.basis}.`,
    };
  }

  function appendProposedLoadDecision(parent, beforeResult, afterResult, checkMode = activeMode) {
    const decision = panelDecision(beforeResult, afterResult, checkMode);
    const banner = createEl("div", `print-decision-banner ${decision.passes ? "is-pass" : "is-fail"}`);
    banner.append(createEl("strong", "", decision.title));
    banner.append(createEl("p", "", decision.detail));
    parent.append(banner);

    appendTable(parent, ["Proposed load", "Scope", "Qty", "Connected load", "Input basis", "Demand bucket"], proposedLoadDetailRows(), {
      className: "print-table print-proposed-table",
    });
    parent.append(createEl(
      "p",
      "print-note",
      "Load management note: the existing EVEMS entry does not cap additional/proposed EVSE rows in this calculator. Do not substitute a managed limit for the physical nameplate rating without separately documenting the control and confirming the applicable calculation method. PASS is a planning comparison, not approval to install."
    ));
    appendSelectedUnitComparison(parent, beforeResult, afterResult);
    appendPanelStatusCards(parent, beforeResult, afterResult, checkMode);
  }

  function splitCodeReference(label) {
    const optionMatch = String(label).match(/^(Option [A-Z]:)\s+((?:\d+-\d+(?:\([^)]+\))*|62-\d+)(?:,\s*(?:\d+-\d+(?:\([^)]+\))*|62-\d+))*)\s+(.+)$/);
    if (optionMatch) return [optionMatch[2], `${optionMatch[1]} ${optionMatch[3]}`];
    const match = String(label).match(/^((?:\d+-\d+(?:\([^)]+\))*|62-\d+)(?:,\s*(?:\d+-\d+(?:\([^)]+\))*|62-\d+))*)\s+(.+)$/);
    if (!match) return ["General", label];
    return [match[1], match[2]];
  }

  function appendCalculationList(parent, rows) {
    if (!rows.length) return;
    const list = createEl("div", "print-calculation-list");
    rows.forEach(([label, value]) => {
      const [reference, description] = splitCodeReference(label);
      const item = createEl("div", "print-calculation-row");
      const text = createEl("div", "print-calculation-text");
      text.append(createEl("span", "print-code-tag", reference));
      text.append(createEl("strong", "", description));
      item.append(text, createEl("span", "print-calculation-value", value));
      list.append(item);
    });
    parent.append(list);
  }

  function appendSection(parent, title) {
    const section = createEl("section", "print-section");
    section.append(createEl("h2", "", title));
    parent.append(section);
    return section;
  }

  function reportMetadataRows() {
    return [
      ["Project", els.reportProject.value],
      ["Permit #", els.reportPermit.value],
      ["Address", els.reportAddress.value],
      ["Customer", els.reportCustomer.value],
      ["Prepared by", els.reportPreparedBy.value],
      ["Report date", els.reportDate.value ? formatReportDate(els.reportDate.value) : ""],
    ].filter(([, value]) => String(value || "").trim());
  }

  function appendSignatureSection(parent) {
    const section = appendSection(parent, "Review And Sign-Off");
    const grid = createEl("div", "print-signature-grid");
    [
      "Signature",
      "Printed name",
      "Company",
      "Date",
    ].forEach((labelText) => {
      const field = createEl("div", "print-signature-field");
      field.append(createEl("div", "print-signature-line"));
      field.append(createEl("span", "", labelText));
      grid.append(field);
    });
    section.append(grid);
  }

  function reportContextRows(result, ampResult) {
    const breakerAmps = positiveNumber(els.mainBreakerAmps.value);
    const dwelling = activeMode === "single"
      ? "Single dwelling"
      : selectedText(els.multiBuildingType);
    const contextMode = activeMode === "multi" ? "single" : activeMode;
    const panelLimit = breakerAmps > 0
      ? panelLimitLabel(breakerAmps, result, contextMode)
      : "Not evaluated";
    const panelBasis = breakerAmps > 0
      ? panelLimitBasis(result, contextMode)
      : "Not evaluated";
    const rows = [
      ["Dwelling type", dwelling],
      [activeMode === "multi" ? "Selected unit panel" : "Selected main breaker", selectedText(els.mainBreakerAmps)],
      ["Panel check basis", panelBasis],
      ["Required maximum", panelLimit],
    ];
    if (activeMode === "multi") {
      rows.push(
        ["Panel type", panelSupplyText()],
        ["Main feed type", selectedText(els.supplyMode)]
      );
    } else {
      rows.push(["Amps basis", selectedText(els.supplyMode)]);
    }
    rows.push(
      ["Calculated amps", `${formatAmps(ampResult.amps)} ${ampResult.label}`],
      ["Governing load", formatWatts(displayedLoadWatts(result))]
    );
    return rows;
  }

  function proposedLoadRows() {
    const details = proposedLoadDetails();
    if (!details.length) return [["Proposed loads", "None entered"]];
    return [
      ["Proposed load count", String(details.length)],
      ["Combined proposed load", formatWatts(details.reduce((sum, detail) => sum + detail.connectedW, 0))],
    ];
  }

  function panelCheckRows(beforeResult, afterResult, checkMode = activeMode) {
    const breakerAmps = positiveNumber(els.mainBreakerAmps.value);
    if (breakerAmps <= 0) return [];
    return [
      panelCheckStatus(beforeResult, beforeResult.panelLabel || "Before proposed loads", checkMode),
      panelCheckStatus(afterResult, afterResult.panelLabel || "After proposed loads", checkMode),
    ].map((check) => [
      check.label,
      `${check.text}: ${formatWatts(displayedLoadWatts(check.result))} / ${formatAmps(check.ampResult.amps)} against ${check.limitLabel}. ${check.basis}`,
    ]);
  }

  function proposedLoadDetailRows() {
    const target = activeMode === "multi"
      ? `Unit group ${readValue("#multi-proposed-group") || "1"}, ${readValue("#multi-proposed-unit-qty") || "1"} unit(s)`
      : "Dwelling unit";
    const details = proposedLoadDetails().map((detail) => ({ ...detail, scope: target }));
    if (!details.length) return [["None entered", "-", "-", "-", "-", "-"]];
    return [
      ...details.map((detail) => [
        detail.load ? detail.load.name : detail.name,
        detail.scope,
        String(detail.qty),
        formatWatts(detail.connectedW),
        `${app.describeLoadRating(detail.load).formula}; Model: ${detail.load.model || "Not supplied"}; Source: ${detail.load.source || "Not supplied"}`,
        detail.bucketText,
      ]),
      [
        "Combined proposed load",
        "-",
        "-",
        formatWatts(details.reduce((sum, detail) => sum + detail.connectedW, 0)),
        "Total connected load package",
        "-",
      ],
    ];
  }

  function singleInputRows(input) {
    return [
      ["Ground floor", valueWithUnit(input.area.ground, input.unitSystem)],
      ["Basement over 1.8 m", valueWithUnit(input.area.basement, input.unitSystem)],
      ["Upper floors above ground floor", valueWithUnit(input.area.above, input.unitSystem)],
      ["Gas range / no electric range", yesNo(input.gasRange)],
      ["Heat demand method", heatMethodLabel(input.heatMethod)],
      ["Heating and AC interlocked", yesNo(input.hvacInterlocked)],
      ["Existing EVSE demand mode", evModeLabel(input.evMode)],
      ["Existing EVEMS maximum", valueWithUnit(input.evManagedKw, "kW")],
      ["Equipment ratings and additional loads", "Every input is listed individually in the equipment inventory, including unknown ratings and zero-connected rows."],
    ];
  }

  function multiInputRows(input, result) {
    const enteredGroups = input.enteredGroups || input.groups;
    const existingUnitLoadRows = enteredGroups.reduce((sum, group) => sum + (group.existingUnitLoads || []).length, 0);
    const proposedUnitLoadRows = (input.proposedUnitLoads || []).length;
    return [
      ["Calculation path", selectedText(els.multiBuildingType)],
      ["Unit groups", String(enteredGroups.length)],
      ["Dwelling units included", String(result.unitCount || 0)],
      ["Existing unit load rows", String(existingUnitLoadRows)],
      ["Proposed unit load rows", String(proposedUnitLoadRows)],
      ["Proposed target", `Group ${input.proposedTargetGroup || 1}, ${input.proposedTargetUnitQty || 1} unit(s)`],
      ["Unit heating and AC interlocked", yesNo(input.hvacInterlocked)],
      ["Common lighting / power", valueWithUnit(input.commonKw, "kW")],
      ["Common EVSE", `${valueWithUnit(input.commonEvKw, "kW")} / ${selectedText($("#multi-common-ev-mode"))}`],
      ["Common EVEMS maximum", valueWithUnit(input.commonEvManagedKw, "kW")],
      ["Proposed load rows", String(input.proposedLoads.length)],
    ];
  }

  function heatMethodLabel(value) {
    return value === "full"
      ? "100% connected heat"
      : "Room thermostats: first 10 kW plus 75%";
  }

  function evModeLabel(value) {
    if (value === "managed") return "EVEMS maximum";
    if (value === "omitted") return "Omit under 8-106(11)";
    return "100% demand";
  }

  function printTableColumns(headings, rows, required = []) {
    const requiredIndexes = new Set(required);
    const keepIndexes = headings
      .map((_, index) => index)
      .filter((index) => requiredIndexes.has(index) || rows.some((row) => {
        const value = row[index];
        return !String(value || "").match(/^(0(?:\.0+)? kW|0 m2|0|-)$/);
      }));
    return {
      headings: keepIndexes.map((index) => headings[index]),
      rows: rows.map((row) => keepIndexes.map((index) => row[index])),
    };
  }

  function demandBucketText(value) {
    return {
      other: "Dryer / other over 1500 W",
      water: "Tankless / pool / spa water heat",
      evse: "EVSE",
      ac: "Air conditioning",
      heat: "Electric space heat",
    }[value] || value || "-";
  }

  function unitLoadReportRows(input) {
    return (input.enteredGroups || input.groups).flatMap((group, index) => {
      const rowsFor = (loads, scope) => (loads || [])
        .map((load) => {
          const qty = loadQty(load.qty);
          const rating = app.describeLoadRating(load);
          const connectedW = rating.connectedW;
          const groupQty = Math.max(0, Math.floor(positiveNumber(group.qty)));
          const unitCount = load.unitCount ? Math.min(Math.floor(positiveNumber(load.unitCount)), groupQty) : groupQty;
          return {
            row: [
              `Group ${index + 1}`,
              scope,
              load.name || "Unit load",
              String(qty),
              unitCount > 0 ? String(unitCount) : "All",
              formatWatts(connectedW),
              `${rating.ratingText}; ${rating.formula}; Model: ${load.model || "Not supplied"}; Source: ${load.source || "Not supplied"}`,
              demandBucketText(load.bucket),
            ],
            connectedW,
          };
        })
        .map((entry) => entry.row);
      return [
        ...rowsFor(group.existingUnitLoads, "Existing per unit"),
      ];
    });
  }

  function appendUnitGroupDetails(parent, input, result) {
    if (activeMode !== "multi" || !Array.isArray(result.summaries) || !result.summaries.length) return;
    const section = appendSection(parent, "Unit Group Calculation Details");
    if (input.buildingType === "row-housing") {
      const table = printTableColumns([
        "Group",
        "Qty",
        "Area",
        "Non-basement area",
        "Basic",
        "Range",
        "Water heat",
        "Dryer / other",
        "8-200(1)(a)",
        "8-200(1)(b)",
        "Base before diversity",
        "Heat",
        "AC",
        "EVSE",
      ], result.summaries.map((summary) => [
        String(summary.index),
        String(summary.qty),
        formatArea(summary.areaM2),
        formatArea(summary.nonBasementAreaM2),
        formatWatts(summary.basicW),
        formatWatts(summary.rangeW),
        formatWatts(summary.waterW),
        formatWatts(summary.otherW),
        formatWatts(summary.itemA),
        formatWatts(summary.itemB),
        formatWatts(summary.baseW),
        formatWatts(summary.heatW),
        formatWatts(summary.acW),
        formatWatts(summary.evW),
      ]), [0, 1, 2, 3, 8, 9, 10]);
      appendTable(section, table.headings, table.rows, { className: "print-table print-unit-table" });
    } else {
      const table = printTableColumns([
        "Group",
        "Qty",
        "Area",
        "Basic",
        "Range",
        "Water heat",
        "Dryer / other",
        "Unit base before diversity",
        "Heat",
        "AC",
        "EVSE",
      ], result.summaries.map((summary) => [
        String(summary.index),
        String(summary.qty),
        formatArea(summary.areaM2),
        formatWatts(summary.basicW),
        formatWatts(summary.rangeW),
        formatWatts(summary.waterW),
        formatWatts(summary.otherW),
        formatWatts(summary.baseW),
        formatWatts(summary.heatW),
        formatWatts(summary.acW),
        formatWatts(summary.evW),
      ]), [0, 1, 2, 7]);
      appendTable(section, table.headings, table.rows, { className: "print-table print-unit-table" });
    }
    const unitLoadRows = unitLoadReportRows(input);
    if (unitLoadRows.length) {
      appendTable(section, ["Group", "Scope", "Load", "Qty", "Units with load", "Connected load", "Input basis", "Demand bucket"], unitLoadRows, {
        className: "print-table print-unit-table",
      });
    }
    appendCalculationList(section, comparisonRowsForReport(result, els.supplyMode.value));
  }

  function assumptionRows(input) {
    const rows = [
      ["Breaker-size entries", "Breaker entries estimate connected load as amps times volts. Use nameplate kW where known, especially for permit evidence."],
    ];

    if (activeMode === "single") {
      rows.push(
        ["Heat demand method", heatMethodLabel(input.heatMethod)],
        ["Heating and AC interlock", yesNo(input.hvacInterlocked)],
        ["EVSE demand mode", `${evModeLabel(input.evMode)}${input.evMode === "managed" ? ` / EVEMS max ${valueWithUnit(input.evManagedKw, "kW")}` : ""}`],
        ["Proposed loads", "Proposed loads are added to the selected demand bucket and compared before/after against the selected main breaker."]
      );
      return rows;
    }

    rows.push(
      ["Calculation path", selectedText(els.multiBuildingType)],
      ["Unit heat demand methods", input.groups.map((group, index) => `Group ${index + 1}: ${heatMethodLabel(group.heatMethod)}`).join("; ") || "No unit groups"],
      ["Unit heating and AC interlock", yesNo(input.hvacInterlocked)],
      ["Unit EVSE demand modes", input.groups.map((group, index) => `Group ${index + 1}: ${evModeLabel(group.evMode)}${group.evMode === "managed" ? `, max ${valueWithUnit(group.evManagedKw, "kW")}` : ""}`).join("; ") || "No unit groups"],
      ["Common EVSE demand mode", `${evModeLabel(input.commonEvMode)}${input.commonEvMode === "managed" ? ` / EVEMS max ${valueWithUnit(input.commonEvManagedKw, "kW")}` : ""}`],
      ["Proposed loads", "In multi-family mode, proposed loads are applied to the selected dwelling-unit group and affected-unit quantity only. The after-proposed calculation splits that group so unchanged units stay unchanged."]
    );
    return rows;
  }

  function appendAssumptionsSection(parent, input) {
    const section = appendSection(parent, "Assumptions / Eligibility");
    appendTable(section, ["Item", "Basis"], assumptionRows(input), {
      className: "print-table print-assumptions-table",
    });
  }

  function comparisonRowsForReport(result, supplyMode) {
    if (Array.isArray(result.comparisonRows) && result.comparisonRows.length) {
      return result.comparisonRows.map((row) => [row[0], comparisonValue(row, supplyMode)]);
    }
    if (Number.isFinite(result.itemA) && Number.isFinite(result.itemB)) {
      return [
        ["Option A: 8-200(1)(a) entered-load subtotal", comparisonValue(["", result.itemA, "W"], supplyMode)],
        ["Option B: 8-200(1)(b) minimum comparison", comparisonValue(["", result.itemB, "W"], supplyMode)],
      ];
    }
    return [];
  }

  function appendSingleWorkedReport(parent, trace) {
    const comparison = appendSection(parent, "Before / After — Item A versus Item B");
    appendTable(comparison, ["Scenario", "Item A subtotal", "Item B minimum", "Governing load"], [
      ["Before proposed loads", formatWatts(trace.before.result.itemA), formatWatts(trace.before.result.itemB), formatWatts(trace.before.result.totalW)],
      ["After proposed loads", formatWatts(trace.after.result.itemA), formatWatts(trace.after.result.itemB), formatWatts(trace.after.result.totalW)],
    ]);
    comparison.append(createEl("p", "print-note", `Item A changes from ${formatWatts(trace.before.result.itemA)} to ${formatWatts(trace.after.result.itemA)}. The governing result is separately selected as max(Item A, Item B) in each scenario; a load addition can leave that result unchanged while the minimum still governs.`));

    const inventory = appendSection(parent, "Equipment Inventory — Existing and Proposed");
    inventory.classList.add("print-page-start");
    inventory.append(createEl("p", "print-note", "All ratings and identification below are entered information, not verified equipment data. Connected input power is not the final demand. Unknown inputs and zero-connected rows remain visible; they are not proof of absent equipment. Each additional row includes its quantity before the existing threshold logic is applied."));
    appendTable(inventory, ["Equipment / scope / source", "Rating and connected-load arithmetic", "Demand treatment"], trace.loads.map(load => [
      `${load.name}\n${load.scope}\nQty: ${load.qty || 1}\nModel: ${load.model}\nSource / nameplate notes: ${load.source}`,
      `${load.ratingText}\n${load.formula}\nEntered breaker: ${load.amps === undefined || load.amps === "" ? "Not supplied" : load.amps + " A"}; voltage: ${load.volts || 240} V`,
      `${demandBucketText(load.bucket)}\n${load.treatment}`,
    ]), { className: "print-table print-inventory-table" });

    [["Before proposed loads", trace.before], ["After proposed loads", trace.after]].forEach(([title, stage]) => {
      const section = appendSection(parent, `Worked Calculation — ${title}`);
      section.classList.add("print-page-start");
      section.append(createEl("p", "print-note", "Arithmetic uses unrounded calculation values. Display text is rounded to at most eight decimal places. Heat, AC, water and EV additions include all rows assigned to that bucket in this scenario."));
      appendTable(section, ["Step / reference", "Substitution and result"], stage.steps.map(s => [s.label, s.formula]), { className: "print-table print-worked-table" });
    });
    const caveats = appendSection(parent, "Input Evidence and Calculation Limitations");
    const list = createEl("ul", "print-notes");
    trace.warnings.forEach(warning => list.append(createEl("li", "", warning)));
    caveats.append(list);
  }

  function appendMultiRatingEvidence(parent, input) {
    const section = appendSection(parent, "Multi-family Input Evidence and Report Scope");
    section.classList.add("print-page-start");
    section.append(createEl("p", "print-note", "Full before/after worked arithmetic is currently provided for single dwellings. Multi-family exports retain the existing group calculations and diversity result, with individual input evidence below. These are not a full worked diversity or selected-unit audit. Existing partial-unit allocation and panel-check policies are unchanged; verify their applicability."));
    const rows = [];
    (input.enteredGroups || input.groups).forEach((group, index) => {
      ["range", "other", "ac", "water", "heat", "ev"].forEach(key => {
        const rating = app.describeLoadRating(app.prepareLoadInput({ kw: group[`${key}Kw`], amps: group[`${key}Amps`], volts: 240, qty: 1 }));
        rows.push([`Group ${index + 1}: ${key} (per unit)`, `${rating.ratingText}\n${rating.formula}`, "Model / source: not supplied for fixed group inputs"]);
      });
      (group.existingUnitLoads || group.quoteLoads || []).forEach(load => {
        const rating = app.describeLoadRating(load);
        rows.push([`Group ${index + 1}: ${load.name || "Additional load"}\nUnits with load: ${load.unitCount || "All"}`, `${rating.ratingText}\n${rating.formula}`, `Bucket: ${demandBucketText(load.bucket)}\nModel: ${load.model || "Not supplied"}\nSource: ${load.source || "Not supplied"}`]);
      });
    });
    proposedLoadDetails(true).forEach(detail => {
      const rating = app.describeLoadRating(detail.load);
      rows.push([`Proposed: ${detail.load.name}\nGroup ${input.proposedTargetGroup}, ${input.proposedTargetUnitQty} unit(s)`, `${rating.ratingText}\n${rating.formula}`, `Bucket: ${detail.bucketText}\nModel: ${detail.load.model || "Not supplied"}\nSource: ${detail.load.source || "Not supplied"}`]);
    });
    appendTable(section, ["Equipment / scope", "Input basis", "Identification / source"], rows, { className: "print-table print-inventory-table" });
  }

  function renderPrintReport(result, ampResult) {
    const report = els.printReport;
    const input = activeMode === "single" ? singleInput({ includeProposed: false }) : multiInput({ includeProposed: true });
    const beforeResult = activeMode === "single"
      ? app.calculateSingle(singleInput({ includeProposed: false }))
      : app.calculateMulti(multiInput({ includeProposed: false }));
    const panelEval = panelEvaluationResults(beforeResult, result);
    report.innerHTML = "";

    const header = createEl("header", "print-header");
    header.append(createEl("p", "print-eyebrow", "CSA C22.1:24 Section 8"));
    header.append(createEl("h1", "", "CEC Residential Load Calculation"));
    header.append(createEl("p", "print-subtitle", "Residential service and feeder calculated load report for customer and authority review."));
    report.append(header);
    report.append(createEl("p", "print-evidence-warning", "PLANNING AID — NOT EQUIPMENT VERIFICATION. BREAKER ESTIMATES: where used, A × V is not nameplate input power. Blank ratings mean unknown, not verified zero. Verify ratings, interlocks, EV management eligibility and applicable local requirements before relying on any PASS result."));

    const meta = appendSection(report, "Project Information");
    appendTable(meta, ["Field", "Value"], [
      ...reportMetadataRows(),
    ], { className: "print-table print-meta-table", showHead: false });

    if (hasProposedLoad()) {
      const proposed = appendSection(report, "Proposed Load Decision");
      appendProposedLoadDecision(proposed, panelEval.before, panelEval.after, panelEval.checkMode);
    }

    const feederCheck = serviceFeederCheck(beforeResult, result);
    if (feederCheck) {
      const feeder = appendSection(report, "Estimated Upstream Service / Feeder Reference");
      appendServiceFeederStatusCards(feeder, feederCheck);
      appendTable(feeder, ["Item", "Value"], serviceFeederCheckRows(feederCheck), {
        className: "print-table print-assumptions-table",
      });
      if (feederCheck.exceedsExpected) {
        feeder.append(createEl("p", "print-note", "Advisory: the proposed load is above this estimated upstream protection size. If approved load management limits or removes the proposed demand, rerun the check using the managed maximum. Otherwise, confirm the actual upstream rating before relying on this reference."));
      }
    }

    const summary = createEl("section", "print-summary");
    [
      ["Governing load", formatWatts(displayedLoadWatts(result))],
      ["Calculated amps", formatAmps(ampResult.amps)],
      [activeMode === "multi" ? "Main feed type" : "Amps basis", ampResult.label],
      [activeMode === "multi" ? "Unit panel status" : "Main breaker status", els.panelWarning.textContent || "Not evaluated"],
    ].forEach(([label, value]) => {
      const card = createEl("div", "print-summary-card");
      card.append(createEl("span", "", label));
      card.append(createEl("strong", "", value));
      summary.append(card);
    });
    report.append(summary);

    const context = appendSection(report, "Calculation Context");
    appendTable(context, ["Item", "Value"], reportContextRows(
      panelEval.after,
      app.ampsForWatts(displayedLoadWatts(panelEval.after), panelSupplyMode())
    ));

    const inputs = appendSection(report, "Entered Inputs");
    appendTable(inputs, ["Input", "Value"], activeMode === "single"
      ? singleInputRows(input)
      : multiInputRows(input, result));

    if (activeMode === "single") {
      appendSingleWorkedReport(report, app.buildSingleReportTrace(input, proposedLoadDetails(true).map(detail => detail.load), els.supplyMode.value));
    } else {
      appendUnitGroupDetails(report, input, result);
      appendMultiRatingEvidence(report, input);
    }
    appendAssumptionsSection(report, input);

    const comparison = appendSection(report, "Code Comparison");
    appendCalculationList(comparison, comparisonRowsForReport(result, els.supplyMode.value));
    if (result.comparisonNote) comparison.append(createEl("p", "print-note", result.comparisonNote));

    const breakdownRows = printBreakdownRows(result);
    if (breakdownRows.length) {
      const breakdown = appendSection(report, "Detailed Breakdown");
      appendCalculationList(breakdown, breakdownRows);
    }

    const notes = appendSection(report, "Notes");
    const noteList = createEl("ul", "print-notes");
    [
      ...result.notes,
      "This report cites calculation rule references only and does not reproduce CSA C22.1 text.",
      "This report is a planning aid. Confirm final service, feeder, conductor, and overcurrent sizing with the authority having jurisdiction.",
    ].forEach((note) => noteList.append(createEl("li", "", note)));
    notes.append(noteList);

    appendSignatureSection(report);

    const footer = createEl("footer", "print-footer");
    footer.textContent = "CSA C22.1:24 Section 8 planning aid. Verify with the authority having jurisdiction before construction or permit submission.";
    report.append(footer);
  }

  function renderBreakdown(rows) {
    els.breakdown.innerHTML = "";
    rows.forEach((row) => {
      const [label, value] = breakdownValue(row);
      const item = document.createElement("div");
      item.className = "breakdown-row";
      item.append(createEl("span", "", label), createEl("strong", "", value));
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

    const itemAGoverns = result.itemA > result.itemB;
    renderComparisonRows([
      ["Option A: 8-200(1)(a) entered-load subtotal", result.itemA, "W"],
      ["Option B: 8-200(1)(b) minimum comparison", result.itemB, "W"],
    ], itemAGoverns
      ? "Governing: Option A is larger than the service minimum."
      : "Governing: Option B service minimum is equal to or larger than entered loads.",
    supplyMode);
  }

  function renderPanelWarning(result, calculatedAmps, beforeResult = result, checkMode = activeMode) {
    const breakerAmps = positiveNumber(els.mainBreakerAmps.value);
    if (breakerAmps <= 0 || !Number.isFinite(calculatedAmps)) {
      els.summary.classList.remove("is-over-main-80", "is-over-main-100");
      els.panelWarning.className = "panel-warning hidden";
      els.panelWarning.textContent = "";
      return;
    }

    const check = panelCheckStatus(result, result.panelLabel || "Current calculated load", checkMode);
    const beforeCheck = panelCheckStatus(beforeResult, beforeResult.panelLabel || "Before proposed loads", checkMode);
    const failedBefore = !beforeCheck.passes;
    const showCaution = checkMode === "single" && !itemBMinimumGoverns(result) && check.passes && calculatedAmps >= check.limitAmps * 0.9;
    els.summary.classList.toggle("is-over-main-80", showCaution);
    els.summary.classList.toggle("is-over-main-100", !check.passes);
    if (!check.passes) {
      els.panelWarning.className = "panel-warning is-danger";
      els.panelWarning.textContent = failedBefore
        ? `Fail before proposed loads: existing calculated load is ${formatAmps(beforeCheck.ampResult.amps)} against ${beforeCheck.limitLabel}. ${beforeCheck.basis}.`
        : `Load management is required to add the proposed load(s): proposed loads push the calculation to ${formatAmps(check.ampResult.amps)} against ${check.limitLabel}. ${check.basis}.`;
    } else if (showCaution) {
      els.panelWarning.className = "panel-warning is-caution";
      els.panelWarning.textContent = `Caution: calculated load is close to ${check.limitLabel}. ${check.basis}.`;
    } else {
      els.panelWarning.className = "panel-warning is-ok";
      els.panelWarning.textContent = `OK: calculated load passes against ${check.limitLabel}. ${check.basis}.`;
    }
  }

  function panelCheckStatus(result, label, checkMode = activeMode) {
    const breakerAmps = positiveNumber(els.mainBreakerAmps.value);
    const ampResult = app.ampsForWatts(displayedLoadWatts(result), panelSupplyMode());
    const limitAmps = panelLimitAmps(breakerAmps, result, checkMode);
    const usesSelectedMain = checkMode === "single" && itemBMinimumGoverns(result);
    const passes = breakerAmps > 0 && (usesSelectedMain ? ampResult.amps <= limitAmps : ampResult.amps <= limitAmps);
    return {
      label,
      result,
      ampResult,
      breakerAmps,
      limitAmps,
      limitLabel: panelLimitLabel(breakerAmps, result, checkMode),
      basis: panelLimitBasis(result, checkMode),
      supplyLabel: panelSupplyText(),
      checkMode,
      passes,
      text: passes ? "Pass" : "Fail",
    };
  }

  function renderPanelCheck(beforeResult, afterResult, checkMode = activeMode) {
    const breakerAmps = positiveNumber(els.mainBreakerAmps.value);
    if (breakerAmps <= 0) {
      els.panelCheck.className = "panel-check hidden";
      els.panelCheck.innerHTML = "";
      return;
    }

    const checks = [
      panelCheckStatus(beforeResult, beforeResult.panelLabel || "Before proposed loads", checkMode),
      panelCheckStatus(afterResult, afterResult.panelLabel || "After proposed loads", checkMode),
    ];
    els.panelCheck.innerHTML = "";
    checks.forEach((check) => {
      const card = createEl("div", `panel-check-card ${check.passes ? "is-pass" : "is-fail"}`);
      card.append(createEl("span", "panel-check-label", check.label));
      card.append(createEl("strong", "", check.text));
      card.append(createEl("small", "", `${formatWatts(displayedLoadWatts(check.result))} / ${formatAmps(check.ampResult.amps)} against ${check.limitLabel}`));
      els.panelCheck.append(card);
    });
    els.panelCheck.className = "panel-check";
  }

  function renderServiceFeederCheck(beforeResult, afterResult) {
    const check = serviceFeederCheck(beforeResult, afterResult);
    if (!check) {
      els.serviceFeederCheck.className = "service-feeder-check hidden";
      els.serviceFeederCheck.innerHTML = "";
      return;
    }

    els.serviceFeederCheck.className = `service-feeder-check ${check.exceedsExpected ? "is-danger" : "is-ok"}`;
    els.serviceFeederCheck.innerHTML = "";
    els.serviceFeederCheck.append(createEl("strong", "", `Estimated existing upstream protection: ${formatAmps(check.expectedProtectionA)}`));
    els.serviceFeederCheck.append(createEl(
      "span",
      "",
      `Existing aggregate is ${formatAmps(check.beforeAmps)}; after proposed is ${formatAmps(check.afterAmps)}.`
    ));
    els.serviceFeederCheck.append(createEl(
      "span",
      "",
      check.exceedsExpected
        ? "Advisory: proposed load is above this estimated upstream protection size. Use approved load management or confirm the actual upstream rating before relying on this reference."
        : "Reference only: confirm the actual upstream rating where required for approval."
    ));
  }

  function updateProposedLoadControls() {
    const multiMode = activeMode === "multi";
    els.mainBreakerLabel.textContent = multiMode ? "Unit panel" : "Main breaker";
    els.supplyModeLabel.textContent = multiMode ? "Main feed type" : "Amps basis";
    els.panelSupplyField.classList.toggle("hidden", !multiMode);
    els.panelSupplyField.hidden = !multiMode;
    els.multiProposedTarget.classList.toggle("hidden", !multiMode);
    els.multiProposedTarget.hidden = !multiMode;
    els.proposedLoadHelp.textContent = multiMode
      ? "Use this for the load being added to the selected dwelling unit group. For a normal AC add, set units receiving proposed load to 1."
      : "Use this for the new load package being checked against the selected main breaker. The panel check compares the dwelling before and after all proposed loads are added.";

    $("[data-proposed-load-bucket]", els.proposedLoadTemplate.content).querySelector('[value="other"]').textContent = multiMode
      ? "Dryer / other over 1500 W"
      : "Dryer / other over 1500 W";
    $("[data-proposed-load-bucket]", els.proposedLoadTemplate.content).querySelector('[value="evse"]').textContent = multiMode
      ? "EVSE"
      : "EVSE";

    $$("[data-proposed-load-bucket]").forEach((select) => {
      const other = select.querySelector('[value="other"]');
      const evse = select.querySelector('[value="evse"]');
      other.textContent = "Dryer / other over 1500 W";
      evse.textContent = "EVSE";
      ["water", "ac", "heat"].forEach((value) => {
        select.querySelector(`[value="${value}"]`).disabled = false;
      });
    });
  }

  function updateConditionalFields() {
    updateProposedLoadControls();
    const gasRange = readChecked("#single-gas-range");
    $$("[data-single-range-field]").forEach((field) => {
      field.classList.toggle("is-disabled", gasRange);
      $$("input, select", field).forEach((control) => {
        control.disabled = gasRange;
      });
    });

    const singleHeatMethod = $("[data-single-heat-method-field]");
    if (singleHeatMethod) {
      const show = positiveNumber(readValue("#single-heat")) > 0 || positiveNumber(readValue("#single-heat-amps")) > 0;
      singleHeatMethod.classList.toggle("hidden", !show);
      singleHeatMethod.hidden = !show;
    }

    $$(".unit-group", els.unitGroups).forEach((row) => {
      const heatMethod = $("[data-unit-heat-method-field]", row);
      if (heatMethod) {
        const show = positiveNumber($("[data-unit-heat]", row).value) > 0 || positiveNumber($("[data-unit-heat-amps]", row).value) > 0;
        heatMethod.classList.toggle("hidden", !show);
        heatMethod.hidden = !show;
      }
    });
  }

  function render() {
    updateConditionalFields();
    const beforeResult = activeMode === "single"
      ? app.calculateSingle(singleInput({ includeProposed: false }))
      : app.calculateMulti(multiInput({ includeProposed: false }));
    const result = activeMode === "single"
      ? app.calculateSingle(singleInput({ includeProposed: true }))
      : app.calculateMulti(multiInput({ includeProposed: true }));
    const displayW = displayedLoadWatts(result);
    const ampResult = app.ampsForWatts(displayW, els.supplyMode.value);
    const panelEval = panelEvaluationResults(beforeResult, result);
    const panelAmpResult = app.ampsForWatts(displayedLoadWatts(panelEval.after), panelSupplyMode());
    latestResult = result;
    latestAmpResult = ampResult;
    els.resultKw.textContent = formatWatts(displayW);
    els.resultAmps.textContent = formatAmps(ampResult.amps);
    els.ampsLabel.textContent = ampResult.label;
    renderRuleComparison(result, els.supplyMode.value);
    renderPanelCheck(panelEval.before, panelEval.after, panelEval.checkMode);
    renderPanelWarning(panelEval.after, panelAmpResult.amps, panelEval.before, panelEval.checkMode);
    renderServiceFeederCheck(beforeResult, result);
    renderBreakdown(result.breakdown);
    renderNotes(result.notes);
  }

  function exportPdf() {
    try {
      render();
      renderPrintReport(latestResult, latestAmpResult);
      printReportPrepared = true;
      window.print();
    } catch (error) {
      printReportPrepared = false;
      console.error("PDF export failed", error);
      window.alert(`PDF export failed: ${error.message}`);
    }
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
    els.panelSupplyMode.value = "single-240";
    els.reportDate.value = todayInputValue();
    els.singleForm.reset();
    els.multiForm.reset();
    els.singleLoads.innerHTML = "";
    els.proposedLoads.innerHTML = "";
    els.unitGroups.innerHTML = "";
    addProposedLoad();
    addUnitGroup();
    switchMode("single");
  }

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => switchMode(button.dataset.mode));
  });
  els.resetButton.addEventListener("click", resetCalculator);
  els.exportButton.addEventListener("click", exportPdf);

  $("#add-single-load").addEventListener("click", () => {
    addSingleLoad();
    render();
  });
  els.addProposedLoadButton.addEventListener("click", () => {
    addProposedLoad();
    render();
  });
  $$("[data-preset-load]").forEach((button) => {
    button.addEventListener("click", () => {
      addSingleLoad(presetLoads[button.dataset.presetLoad]);
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
      || event.target === els.panelSupplyMode
    ) {
      render();
    }
  });
  document.addEventListener("change", render);

  els.reportDate.value = todayInputValue();
  window.addEventListener("beforeprint", () => {
    if (!printReportPrepared) {
      render();
      renderPrintReport(latestResult, latestAmpResult);
    }
  });
  window.addEventListener("afterprint", () => {
    printReportPrepared = false;
  });

  addUnitGroup();
  addProposedLoad();
  render();
}
