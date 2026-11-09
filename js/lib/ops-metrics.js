// === js/lib/ops-metrics.js ===
// 운영 지표 단일 계산기 — 요약·생산성·인력·업무 리포트·팀 결산이 같은 정의로 숫자를 낸다(운영 리포트 1단계, 2026-11-05).
//
// 왜 모았나: 같은 '필요 인원·가동률·효율·손실'을 화면마다 다르게 셌다.
//   · 리포트·결산은 그 기간의 속도로 효율을 재서 구조상 늘 100% 근처였다(같은 기간 ÷ 같은 기간).
//   · 투입 인원이 어디는 '명부 − 휴가', 어디는 '업무 기록에 이름이 있는 사람'이었다.
//   · 생산성의 기타 손실은 '총시간 × 5% × 11,000원' 상수였다.
// 정의는 인력 화면(ui-history-staffing.js)의 것을 표준으로 삼는다 — 퇴사자·시스템계정·재실시간 처리가 검증돼 있다.
//
// 표준 정의
//   투입 인원   attendedMembers(출근 기록, 없으면 업무 기록) 의 운영일 평균. '명부 − 휴가'는 rosterAvg(참고)로만.
//   필요 인원   수요 분(평상시 속도) ÷ (1인 재실시간 × 가동률 설정) 의 운영일 평균.
//   가동률      업무 기록 분 ÷ 가용 분. 가용 = 재실시간(퇴근 기록 있는 사람) 또는 출근 인원 × 표준시간,
//               재실시간을 모르는 사람의 기록은 가용 = 기록으로 본다(분자·분모 같은 집합).
//               기록이 재실보다 많은 날은 가용 = 기록(그날 100%) — 넘치지 않는다.
//   효율        수요 분 ÷ 실제 업무 분. 수요 = 물량 ÷ 평상시 속도(속도를 모르는 업무는 실제 시간).
//   품질        (인건비 − 품질업무 인건비) ÷ 인건비. 시급이 하나도 없으면 시간 비율.
//   OEE         min(가동률,100%) × min(효율,100%) × 품질 — 평소보다 빨랐던 몫은 OEE 를 올리지 않는다(효율 표시 자체는 상한 없음).
//   인력        필요 인원(가동률 설정 반영)은 **출근 인원**과, 실작업 필요 인원(requiredWorkFTE, 가동률 설정 반영 전)은
//               실작업 인원과 비교한다. 출근 × 가동률 = 실작업 → × 효율 = 실작업 필요 → × 품질 = 유효 인력.
//   손실        가용 손실 = 재실 − 기록 · 성과 손실 = 실제 − 수요 · 품질 손실 = 품질업무. 금액은 시급표(wageMap)로만.
//   파트 묶기   업무 id 로(isTask) — 이름 부분 일치는 쓰지 않는다.
//   전기        previousPeriodOf — 직전 같은 단위 달력 기간(일은 직전 운영일).
//   매출·주문   revenueTotalOf · orderCountTotalOf.
//
// DOM·State 를 쓰지 않는다(appConfig·이력은 인자로) — node 시험(tests/ops-metrics.test.js)과 비교 도구(tools/ops-metrics-compare.mjs)가 그대로 부른다.

import { buildMemberHourlyWageMap, getWeekOfYear, toDateString } from '../utils.js?v=202611091115';
import { attendedMembers, presenceStats, isAttendanceEstimated, systemAccountSet, validMemberNames } from '../attendance-stats.js?v=202611091115';
import { dailyTaskStats, taskSpeedPerMinute } from '../task-throughput.js?v=202611091115';
import { revenueTotalOf, orderCountTotalOf } from '../revenue-channels.js?v=202611091115';
import { TASK, isTask } from './task-ids.js?v=202611091115';

const trim = (v) => (v == null ? '' : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []));
const num = (v) => Number(v) || 0;

/** 국내배송 한 주문(건)에 평균 상품 수 — 개 ↔ 건 병기용 어림값(생산성·리포트 화면이 같이 쓴다). */
export const DOMESTIC_ITEMS_PER_ORDER = 1.3;

/** OEE 판정 기준(%) — 2026-11-05 새 기준(가동률·효율 100% 상한). 결산 판정·총평이 같이 쓴다. */
export const OEE_LEVELS = Object.freeze({ warn: 70, good: 85 });

/** '여유 시간이 거의 없음(과부하)' 판정 기준(%) — 명부 안 사람의 가동률(overloadUtilOf)이 이 이상이면. 리포트 진단·막대 색이 같이 쓴다. */
export const OVERLOAD_UTIL = 95;

/** 과부하 판정에 쓰는 가동률 — 손실 계산과 같은 집합(재실시간을 아는 명부 안 사람)의 기록 분 ÷ 재실 분.
 *  명부 밖·퇴근 기록 없는 사람의 기록(가용 = 기록, 늘 100%)이 판정을 끌어올리지 않게. 없으면 utilizationRate. */
export const overloadUtilOf = (m) => (m && m.rosterUtilizationRate != null ? m.rosterUtilizationRate : (m ? m.utilizationRate : 0));

/** 분석 화면의 파트(업무 id). 요약은 앞 3개, 생산성은 4개를 쓴다. */
export const PARTS = Object.freeze([TASK.domestic, TASK.china, TASK.direct, TASK.ably]);

// ─────────────────────────────────────────────────────────
// 시급표 · 기준 속도 · 설정값
// ─────────────────────────────────────────────────────────

/** 이름 → 시급. 정직원은 월기본급 ÷ 209, 알바는 그날 등록한 시급(정직원 값이 있으면 그대로 둔다). */
export function wageMapOf(appConfig, days = []) {
    const map = buildMemberHourlyWageMap(appConfig?.memberWages);
    (days || []).forEach(d => arr(d?.partTimers).forEach(pt => {
        if (pt && pt.name && !map[pt.name]) map[pt.name] = num(pt.wage);
    }));
    return map;
}

/** 평상시 기준 속도(개/분) — 이력 전체의 합계 비율. 선택 기간과 무관해야 효율이 100% 로 붙지 않는다.
 *  until 을 주면 그날까지만 본다(옛 기간에 뒤 시점 속도가 섞이지 않게). skipDate 는 보통 오늘(물량이 덜 참). */
export function baselineSpeeds(allDays, { skipDate = null, until = null } = {}) {
    const list = Array.isArray(allDays) ? allDays : [];
    const use = until ? list.filter(d => d && typeof d.id === 'string' && d.id <= until) : list;
    return taskSpeedPerMinute(use, { mode: 'total', skipDate });
}

/** 기간 하루 문서들 중 마지막 날 id — baselineSpeeds 의 until 로 넘긴다(옛 기간에 뒤 시점 속도가 섞이지 않게). 없으면 null. */
export function lastDayIdOf(days) {
    let last = null;
    (days || []).forEach(d => { if (d && typeof d.id === 'string' && (!last || d.id > last)) last = d.id; });
    return last;
}

/** 가동률 설정 정규화. 0.8 도 80 도 받아 준다. 이상값이면 기본 0.8. */
export function normalizedUtilization(appConfig) {
    let u = Number(appConfig && appConfig.utilizationRate);
    if (!isFinite(u) || u <= 0) return 0.8;
    if (u > 1) u = u / 100;
    return (u > 0 && u <= 1) ? u : 0.8;
}

/** 그날 1인 표준 근무시간(h) — 재실시간을 못 구할 때의 폴백. 토·일은 주말 시간. */
export function stdDailyHoursOf(dateId, appConfig) {
    const stdHours = (appConfig && appConfig.standardDailyWorkHours) || { weekday: 8, weekend: 4 };
    const dateObj = dateId ? new Date(dateId + 'T00:00:00') : null;
    const dow = dateObj && !isNaN(dateObj.getTime()) ? dateObj.getDay() : 1;
    return (dow === 0 || dow === 6) ? (Number(stdHours.weekend) || 4) : (Number(stdHours.weekday) || 8);
}

// ─────────────────────────────────────────────────────────
// 하루 단위
// ─────────────────────────────────────────────────────────

/** 그날 수요(분). 기준 속도가 있는 업무는 물량 ÷ 속도, 없으면 실제 투입시간. */
export function demandMinutes(day, speeds) {
    const stats = dailyTaskStats(day);
    let total = 0;
    Object.entries(stats).forEach(([task, s]) => {
        const spd = Number(speeds && speeds[task]) || 0;
        const qty = Number(s.qty) || 0;
        const min = Number(s.minutes) || 0;
        total += (qty > 0 && spd > 0) ? (qty / spd) : min;
    });
    return total;
}

/** 운영일 = 출근 기록이 있거나 업무 기록이 있는 날. */
export function isOperatingDay(day, appConfig) {
    return attendedMembers(day, appConfig).size > 0 || arr(day?.workRecords).length > 0;
}

/**
 * 그날 인원·시간. 인력 화면의 하루 계산을 그대로 옮겼다(숫자 같음).
 * speeds 를 주면 수요·필요 인원까지 낸다.
 */
export function dayStaff(day, appConfig, speeds = null) {
    const system = systemAccountSet(appConfig);
    const valid = validMemberNames(day, appConfig);
    const countable = (n) => n !== '' && !system.has(n) && valid.has(n);
    const nameOf = (r) => (r && r.member != null ? String(r.member).trim() : '');

    const attended = attendedMembers(day, appConfig);
    const records = arr(day?.workRecords);
    const workers = new Set(records.map(nameOf).filter(countable));

    let recordMinutes = 0, offRosterMinutes = 0;
    records.forEach(r => {
        const d = Number(r && r.duration) || 0;
        recordMinutes += d;
        if (!countable(nameOf(r))) offRosterMinutes += d;
    });

    const stdHours = stdDailyHoursOf(day?.id, appConfig);
    const presence = presenceStats(day, appConfig, attended);
    const usedPresence = presence.counted > 0;
    const availHours = usedPresence ? presence.avgMinutesPerPerson / 60 : stdHours;

    // 손실·가동률의 분자·분모는 같은 사람 집합 — 재실시간은 퇴근 기록이 있는 사람만 잡힌다
    let potential, workedForLoss, potentialMembers;
    if (usedPresence) {
        potential = presence.totalMinutes;
        potentialMembers = presence.countedMembers;
        workedForLoss = records.filter(r => presence.countedMembers.has(nameOf(r)))
            .reduce((s, r) => s + (Number(r.duration) || 0), 0);
    } else {
        potential = attended.size * stdHours * 60;
        potentialMembers = attended;
        workedForLoss = records.filter(r => countable(nameOf(r)))
            .reduce((s, r) => s + (Number(r.duration) || 0), 0);
    }
    const lossMinutes = potential > workedForLoss ? potential - workedForLoss : 0;

    const out = {
        attended, workers, records, recordMinutes, offRosterMinutes,
        estimated: isAttendanceEstimated(day, appConfig),
        presence, usedPresence, availHours, stdHours,
        potential, potentialMembers, workedForLoss, lossMinutes,
        demandMinutes: null, requiredFTE: 0
    };
    if (speeds) {
        const utilization = normalizedUtilization(appConfig);
        out.demandMinutes = demandMinutes(day, speeds);
        if (availHours > 0 && utilization > 0) {
            out.requiredFTE = (out.demandMinutes / 60) / (availHours * utilization);
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────
// 기간 단위
// ─────────────────────────────────────────────────────────

/**
 * 인력 지표(인력 화면 카드의 숫자). days = 그 기간의 하루 문서들(지금 이름으로 합친 사본).
 * 운영일만 분모로 센다. speeds 가 없으면 필요 인원·수요는 0.
 */
export function staffing(days, appConfig, { speeds = null } = {}) {
    const operatingDays = (days || []).filter(d => isOperatingDay(d, appConfig));
    const perDay = operatingDays.map(d => ({ day: d, s: dayStaff(d, appConfig, speeds) }));

    let sumAttended = 0, sumWorked = 0, sumRequired = 0, totalLossMinutes = 0, donutWorkMinutes = 0;
    let offRosterMinutes = 0, sumPresenceMinutes = 0, presenceDays = 0, estimatedDays = 0, stdHourDays = 0;
    let sumPotential = 0, sumRecordMinutes = 0, sumDemandMinutes = 0, sumAvailableMinutes = 0;

    perDay.forEach(({ s }) => {
        sumAttended += s.attended.size;
        sumWorked += s.workers.size;
        if (s.estimated) estimatedDays++;
        offRosterMinutes += s.offRosterMinutes;
        if (s.usedPresence) { sumPresenceMinutes += s.presence.avgMinutesPerPerson; presenceDays++; }
        else stdHourDays++;
        sumRequired += s.requiredFTE;
        donutWorkMinutes += s.workedForLoss;
        totalLossMinutes += s.lossMinutes;
        sumPotential += s.potential;
        sumRecordMinutes += s.recordMinutes;
        // 재실시간을 모르는 사람(퇴근 기록 없음·명부 밖)의 기록은 가용 = 기록으로 본다.
        // 기록이 재실보다 많으면 가용 = 기록(가동률이 100% 를 넘지 않게) → 가용 − 기록 = 손실 분과 같다.
        sumAvailableMinutes += Math.max(s.potential, s.workedForLoss) + Math.max(0, s.recordMinutes - s.workedForLoss);
        if (s.demandMinutes != null) sumDemandMinutes += s.demandMinutes;
    });

    const dayCount = operatingDays.length;
    return {
        operatingDays, perDay, dayCount,
        avgActual: dayCount > 0 ? sumAttended / dayCount : 0,
        avgWorked: dayCount > 0 ? sumWorked / dayCount : 0,
        avgRequired: dayCount > 0 ? sumRequired / dayCount : 0,
        avgPresenceHours: presenceDays > 0 ? (sumPresenceMinutes / presenceDays) / 60 : 0,
        totalLossMinutes, donutWorkMinutes, offRosterMinutes,
        presenceDays, stdHourDays, estimatedDays,
        utilizationSetting: normalizedUtilization(appConfig),
        hasBaseline: !!speeds && Object.values(speeds).some(v => Number(v) > 0),
        sumPotential, sumRecordMinutes, sumDemandMinutes, sumAvailableMinutes
    };
}

/** 효율(%) = 수요 분 ÷ 실제 업무 분. */
export const efficiency = (demandMin, actualMin) => (actualMin > 0 ? (demandMin / actualMin) * 100 : 0);

/** 기간 하루 문서들을 한 문서로 합친다(건당 출고원가 계산용). */
function mergeDays(days, id) {
    const out = { id, workRecords: [], taskQuantities: {}, management: { revenue: 0, orderCount: 0 } };
    (days || []).forEach(day => {
        arr(day?.workRecords).forEach(r => out.workRecords.push({ ...r, date: day.id }));
        Object.entries(day?.taskQuantities || {}).forEach(([t, q]) => { out.taskQuantities[t] = (out.taskQuantities[t] || 0) + num(q); });
        const m = day?.management || {};
        out.management.revenue += revenueTotalOf(m);
        out.management.orderCount += orderCountTotalOf(m);
    });
    return out;
}

/**
 * 건당 출고원가 — 옛 analyzeUnitCost 를 그대로 옮김(ui-history-reports-productivity.js 가 같은 이름으로 다시 내보낸다).
 * 인건비(원가 계산 업무) ÷ 가장 많은 업무 물량 + 고정 자재·배송비 + 플랫폼 배송(날짜 수 × 고정비) ÷ 물량.
 */
export const unitCost = (data, appConfig, wageMap, totalRevenue = 0) => {
    const costCalcTasks = new Set(appConfig.costCalcTasks || []);
    const fixedMaterialCost = Number(appConfig.fixedMaterialCost) || 0;
    const fixedShippingCost = Number(appConfig.fixedShippingCost) || 0;
    const fixedDirectDeliveryCost = Number(appConfig.fixedDirectDeliveryCost) || 0;

    let targetLaborCost = 0;
    let maxTaskQuantity = 0;

    const records = arr(data.workRecords);
    const quantities = data.taskQuantities || {};

    records.forEach(r => {
        if (costCalcTasks.has(r.task)) {
            const duration = Number(r.duration) || 0;
            const wage = wageMap[r.member] || 0;
            targetLaborCost += (duration / 60) * wage;
        }
    });

    costCalcTasks.forEach(task => {
        const qty = Number(quantities[task]) || 0;
        if (qty > maxTaskQuantity) maxTaskQuantity = qty;
    });

    const perItemLaborCost = maxTaskQuantity > 0 ? (targetLaborCost / maxTaskQuantity) : 0;

    const uniqueDates = new Set();
    records.filter(r => isTask(r.task, TASK.direct, appConfig)).forEach(r => {
        const d = r.date || data.id;
        if (d) uniqueDates.add(d);
    });

    const directDeliveryCount = uniqueDates.size;
    const totalDirectCost = directDeliveryCount * fixedDirectDeliveryCost;
    const perItemDirectCost = maxTaskQuantity > 0 ? (totalDirectCost / maxTaskQuantity) : 0;

    const totalUnitCost = perItemLaborCost + fixedMaterialCost + fixedShippingCost + perItemDirectCost;

    let salesCount = Number(data.management?.orderCount) || 0;
    if (salesCount === 0) salesCount = maxTaskQuantity;

    let revenuePerItem = 0, margin = 0, marginRate = 0;
    if (salesCount > 0 && totalRevenue > 0) {
        revenuePerItem = totalRevenue / salesCount;
        margin = revenuePerItem - totalUnitCost;
        marginRate = (margin / revenuePerItem) * 100;
    }

    return {
        targetTasks: Array.from(costCalcTasks),
        baseQuantity: salesCount,
        costs: {
            labor: perItemLaborCost,
            material: fixedMaterialCost,
            shipping: fixedShippingCost,
            directDelivery: perItemDirectCost,
            directDeliveryCount: directDeliveryCount,
            total: totalUnitCost
        },
        profit: { revenuePerItem, margin, marginRate },
        isValid: costCalcTasks.size > 0 && (salesCount > 0 || maxTaskQuantity > 0)
    };
};

/** 개당 인건비 = 기간 인건비 ÷ 기간 총 물량. (건당 출고원가와 다른 숫자 — 이름을 나눠 쓴다) */
export const laborCostPerItem = (totalCost, totalQuantity) => (totalQuantity > 0 ? totalCost / totalQuantity : 0);

/** 업무 이름 → 파트(업무 id). 지금 이름·옛 이름이 그 업무일 때만 — 부분 일치 없음. */
export function partOf(task, appConfig, parts = PARTS) {
    if (!task) return null;
    return parts.find(id => isTask(task, id, appConfig)) || null;
}

/** 파트별 { duration, qty, members } + total(전체). members 는 기록의 이름(trim). */
export function partSummary(days, appConfig, parts = PARTS) {
    const mk = () => ({ duration: 0, qty: 0, members: new Set() });
    const out = { total: mk() };
    parts.forEach(id => { out[id] = mk(); });
    (days || []).forEach(day => {
        arr(day?.workRecords).forEach(r => {
            const d = Number(r && r.duration) || 0;
            const m = trim(r && r.member);
            const p = partOf(r && (r.task || r.taskType), appConfig, parts);
            if (p) { out[p].duration += d; if (m) out[p].members.add(m); }
            out.total.duration += d;
            if (m) out.total.members.add(m);
        });
        Object.entries(day?.taskQuantities || {}).forEach(([task, q]) => {
            const qty = num(q);
            const p = partOf(task, appConfig, parts);
            if (p) out[p].qty += qty;
            out.total.qty += qty;
        });
    });
    return out;
}

/** 명부 인원(참고) — 그날 재직 정직원 − 휴가자 − 시스템계정 + 휴가 아닌 알바. 옛 '평균 근무 인원' 정의. */
function rosterCountOf(day, appConfig) {
    const leave = new Set(arr(day?.onLeaveMembers).map(e => e && e.member));
    const system = systemAccountSet(appConfig);
    const regular = [...validMemberNames({ id: day?.id }, appConfig)]
        .filter(n => !leave.has(n) && !system.has(n)).length;
    const pts = arr(day?.partTimers).filter(pt => pt && !leave.has(pt.name)).length;
    return regular + pts;
}

/**
 * 한 기간의 운영 지표 전부.
 * opts.speeds  — 평상시 기준 속도(baselineSpeeds). 없으면 allDays 에서 만든다(skipDate·until 반영).
 * opts.wageMap — 시급표. 없으면 wageMapOf(appConfig, days).
 * 반환 객체의 utilizationRate…avgCostPerMinute 는 옛 calculateAdvancedProductivity 와 같은 칸 이름이다(리포트·결산 화면이 그대로 읽음).
 */
export function periodMetrics(days, appConfig, { speeds = null, wageMap = null } = {}) {
    const cfg = appConfig || {};
    const list = Array.isArray(days) ? days : [];
    const wages = wageMap || wageMapOf(cfg, list);
    const st = staffing(list, cfg, { speeds });
    const quality = new Set(cfg.qualityCostTasks || []);

    let totalCost = 0, qualityCost = 0, qualityMinutes = 0, availabilityLossCost = 0, totalQuantity = 0;
    let revenue = 0, orders = 0;
    const tasks = {};   // 업무 → { minutes, qty, cost }
    const T = (t) => (tasks[t] || (tasks[t] = { minutes: 0, qty: 0, cost: 0 }));
    const wageOf = (name) => wages[name] != null ? (Number(wages[name]) || 0) : (Number(wages[trim(name)]) || 0);

    st.perDay.forEach(({ s }) => {
        s.records.forEach(r => {
            if (!r) return;
            const d = Number(r.duration) || 0;
            const c = (d / 60) * wageOf(r.member);
            totalCost += c;
            if (r.task) { const t = T(r.task); t.minutes += d; t.cost += c; }
            if (quality.has(r.task)) { qualityCost += c; qualityMinutes += d; }
        });
        // 가용 손실 금액 = 그날 손실 분 × 손실을 낸 사람들 평균 분당 시급
        if (s.lossMinutes > 0 && s.potentialMembers.size > 0) {
            let w = 0;
            s.potentialMembers.forEach(n => { w += wageOf(n); });
            availabilityLossCost += s.lossMinutes * (w / s.potentialMembers.size) / 60;
        }
    });
    list.forEach(day => {
        Object.entries(day?.taskQuantities || {}).forEach(([t, q]) => {
            const qty = num(q);
            totalQuantity += qty;
            if (qty > 0) T(t).qty += qty;
        });
        const m = day?.management || {};
        revenue += revenueTotalOf(m);
        orders += orderCountTotalOf(m);
    });

    const actual = st.sumRecordMinutes;
    const demand = speeds ? st.sumDemandMinutes : 0;
    const utilizationRate = st.sumAvailableMinutes > 0 ? (actual / st.sumAvailableMinutes) * 100 : 0;
    const efficiencyRatio = speeds ? efficiency(demand, actual) : 0;
    const qualityRatio = totalCost > 0 ? ((totalCost - qualityCost) / totalCost) * 100
        : (actual > 0 ? ((actual - qualityMinutes) / actual) * 100 : 100);
    // OEE 에서만 가동률·효율을 100% 로 자른다(평소보다 빠른 몫이 OEE 를 100% 위로 올리지 않게)
    const cap = (v) => Math.min(100, Math.max(0, v));
    const oee = (cap(utilizationRate) / 100) * (cap(efficiencyRatio) / 100) * (qualityRatio / 100) * 100;

    // 인력 — 출근 → (가동률) → 실작업 → (효율) → 실작업 필요 → (품질) → 유효 인력.
    // 필요 인원(requiredFTE, 인력 화면과 같음)은 가동률 설정으로 나눈 값이라 출근 인원과 비교한다.
    const availableFTE = st.avgActual;
    const workedFTE = availableFTE * (utilizationRate / 100);
    const requiredWorkFTE = st.sumAvailableMinutes > 0 ? availableFTE * (demand / st.sumAvailableMinutes) : 0;
    const requiredFTE = st.avgRequired;
    const qualityFTE = requiredWorkFTE * (qualityRatio / 100);

    const avgCostPerMinute = actual > 0 ? totalCost / actual : 0;
    const availabilityLossMinutes = st.totalLossMinutes;
    const performanceLossMinutes = speeds ? Math.max(0, actual - demand) : 0;
    const performanceLossCost = performanceLossMinutes * avgCostPerMinute;
    const qualityLossCost = qualityCost;
    const totalLossCost = availabilityLossCost + performanceLossCost + qualityLossCost;

    const perfTasks = [];
    const qualityTasks = [];
    Object.entries(tasks).forEach(([task, t]) => {
        const spd = Number(speeds && speeds[task]) || 0;
        if (spd > 0 && t.qty > 0) {
            const std = t.qty / spd;
            if (t.minutes > std) {
                perfTasks.push({
                    task, lossMinutes: t.minutes - std,
                    actualSpeed: (t.minutes > 0 ? t.qty / t.minutes : 0).toFixed(2),
                    stdSpeed: spd.toFixed(2)
                });
            }
        }
        if (quality.has(task) && t.cost > 0) qualityTasks.push({ task, cost: t.cost, minutes: t.minutes });
    });

    const rosterAvg = st.dayCount > 0
        ? st.operatingDays.reduce((s, d) => s + rosterCountOf(d, cfg), 0) / st.dayCount : 0;

    return {
        // 옛 calculateAdvancedProductivity 와 같은 칸
        utilizationRate, efficiencyRatio, qualityRatio, oee,
        availableFTE, workedFTE, requiredFTE, qualityFTE, requiredWorkFTE,
        utilizationSetting: st.utilizationSetting,
        rosterUtilizationRate: st.sumPotential > 0 ? (st.donutWorkMinutes / st.sumPotential) * 100 : utilizationRate,
        totalLossCost, availabilityLossCost, performanceLossCost, qualityLossCost,
        totalStandardAvailableMinutes: st.sumAvailableMinutes,
        totalActualWorkedMinutes: actual,
        totalStandardMinutesNeeded: demand,
        topPerformanceLossTasks: perfTasks.sort((a, b) => b.lossMinutes - a.lossMinutes).slice(0, 3),
        topQualityLossTasks: qualityTasks.sort((a, b) => b.cost - a.cost).slice(0, 3),
        avgCostPerMinute,
        // 새 칸
        staffing: st, wageMap: wages, tasks,
        availabilityLossMinutes, performanceLossMinutes, qualityLossMinutes: qualityMinutes,
        totalCost, totalQuantity, revenue, orders,
        laborCostPerItem: laborCostPerItem(totalCost, totalQuantity),
        unitCost: unitCost(mergeDays(list, 'ops-period'), cfg, wages, revenue),
        rosterAvg
    };
}

/**
 * 최근 운영일 n 일의 하루 OEE 평균(벤치마크). 하루 OEE 가 0 인 날은 뺀다(옛 정의와 같음).
 * skipDate(보통 오늘)는 뺀다.
 */
export function benchmarkOEE(allDays, appConfig, { speeds, wageMap = null, skipDate = null, n = 30 } = {}) {
    const days = (allDays || [])
        .filter(d => d && typeof d.id === 'string' && d.id !== skipDate && arr(d.workRecords).length > 0)
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, n);
    let sum = 0, cnt = 0;
    days.forEach(d => {
        const m = periodMetrics([d], appConfig, { speeds, wageMap: wageMap || wageMapOf(appConfig, [d]) });
        if (m.oee > 0) { sum += m.oee; cnt++; }
    });
    return cnt > 0 ? sum / cnt : null;
}

// ─────────────────────────────────────────────────────────
// 기간 키
// ─────────────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, '0');
const weekKeyOf = (id) => { try { return getWeekOfYear(new Date(id + 'T00:00:00')); } catch (e) { return null; } };

/** 하루 id 가 그 단위의 키에 드는가. 단위 day·week('YYYY-Www')·month('YYYY-MM')·year('YYYY'). */
export function periodKeyOfDay(unit, id) {
    if (typeof id !== 'string') return null;
    if (unit === 'day') return id.slice(0, 10);
    if (unit === 'week') return weekKeyOf(id);
    if (unit === 'month') return id.slice(0, 7);
    if (unit === 'year') return id.slice(0, 4);
    return null;
}

/** 그 기간에 드는 하루 문서들. */
export function periodDaysOf(unit, key, allDays) {
    if (!key) return [];
    return (allDays || []).filter(d => d && periodKeyOfDay(unit, d.id) === key);
}

/** ISO 주 키 'YYYY-Www' 의 월요일(Date, 로컬). */
function mondayOfWeekKey(key) {
    const m = /^(\d{4})-W(\d{2})$/.exec(key || '');
    if (!m) return null;
    const jan4 = new Date(Number(m[1]), 0, 4);
    const mon1 = new Date(jan4);
    mon1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const out = new Date(mon1);
    out.setDate(mon1.getDate() + (Number(m[2]) - 1) * 7);
    return out;
}

/** 직전 같은 단위의 키. 일은 달력상 전날(운영일 고르기는 previousPeriodOf). */
export function previousKeyOf(unit, key) {
    if (!key) return null;
    if (unit === 'day') {
        const d = new Date(key + 'T00:00:00');
        if (isNaN(d.getTime())) return null;
        d.setDate(d.getDate() - 1);
        return toDateString(d);
    }
    if (unit === 'week') {
        const mon = mondayOfWeekKey(key);
        if (!mon) return null;
        mon.setDate(mon.getDate() - 7);
        return getWeekOfYear(mon);
    }
    if (unit === 'month') {
        const m = /^(\d{4})-(\d{2})$/.exec(key);
        if (!m) return null;
        let y = Number(m[1]), mo = Number(m[2]) - 1;
        if (mo < 1) { mo = 12; y -= 1; }
        return `${y}-${pad2(mo)}`;
    }
    if (unit === 'year') return /^\d{4}$/.test(key) ? String(Number(key) - 1) : null;
    return null;
}

/**
 * 전기(직전 같은 단위 달력 기간). 일은 직전 운영일(업무 기록이나 출근 기록이 있는 날).
 * 반환 { key, days } — 없으면 key null·days [].
 */
export function previousPeriodOf(unit, key, allDays) {
    if (unit === 'day') {
        const has = (d) => arr(d?.workRecords).length > 0
            || (d?.dailyAttendance && typeof d.dailyAttendance === 'object' && Object.keys(d.dailyAttendance).length > 0);
        const prev = (allDays || [])
            .filter(d => d && typeof d.id === 'string' && d.id < key && has(d))
            .sort((a, b) => b.id.localeCompare(a.id))[0];
        return prev ? { key: prev.id, days: [prev] } : { key: null, days: [] };
    }
    const pk = previousKeyOf(unit, key);
    return { key: pk, days: pk ? periodDaysOf(unit, pk, allDays) : [] };
}

/**
 * '평소 대비' 기준 기간(요약 화면) — 옛 getBaselinePeriod 를 그대로 옮김.
 *  일: 최근 7일 · 주: 최근 4주 · 월: 작년 같은 달 → 없으면 최근 3개월 · 년: 전년도.
 * @returns { data, type, description, range } — data 빈 배열이면 비교 기준 없음
 */
export function rollingBaselineOf(granularity, selectedKey, allHistoryData) {
    const none = { data: [], type: 'none', description: '비교용 기준 데이터 없음', range: null };
    if (!selectedKey || !Array.isArray(allHistoryData) || allHistoryData.length === 0) return none;

    if (granularity === 'day') {
        const target = new Date(selectedKey + 'T00:00:00');
        if (isNaN(target.getTime())) return none;
        const start = new Date(target); start.setDate(start.getDate() - 7);
        const end   = new Date(target); end.setDate(end.getDate() - 1);
        const startStr = toDateString(start);
        const endStr   = toDateString(end);
        const data = allHistoryData.filter(d => d.id >= startStr && d.id <= endStr);
        if (data.some(d => (d.workRecords||[]).length > 0)) {
            return { data, type: 'rolling', description: `최근 7일 평균 (${startStr} ~ ${endStr})`, range: `${startStr} ~ ${endStr}` };
        }
        return none;
    }

    if (granularity === 'week') {
        const allWeekKeys = [...new Set(allHistoryData.map(d => weekKeyOf(d.id)).filter(Boolean))].sort();
        const idx = allWeekKeys.indexOf(selectedKey);
        if (idx <= 0) return none;
        const prevKeys = allWeekKeys.slice(Math.max(0, idx - 4), idx);
        if (prevKeys.length === 0) return none;
        const data = allHistoryData.filter(d => prevKeys.includes(weekKeyOf(d.id)));
        const desc = prevKeys.length >= 4
            ? `최근 4주 평균 (${prevKeys[0]} ~ ${prevKeys[prevKeys.length-1]})`
            : `최근 ${prevKeys.length}주 평균 (${prevKeys.join(', ')})`;
        return { data, type: prevKeys.length >= 4 ? 'rolling' : 'rolling_short', description: desc, range: `${prevKeys[0]} ~ ${prevKeys[prevKeys.length-1]}` };
    }

    if (granularity === 'month') {
        const m = selectedKey.match(/^(\d{4})-(\d{2})$/);
        if (!m) return none;
        const year = parseInt(m[1], 10);
        const mm = m[2];
        const yoyKey = `${year - 1}-${mm}`;
        const yoyData = allHistoryData.filter(d => typeof d.id === 'string' && d.id.substring(0,7) === yoyKey);
        if (yoyData.some(d => (d.workRecords||[]).length > 0)) {
            return { data: yoyData, type: 'yoy', description: `작년 같은 달 (${yoyKey})`, range: yoyKey };
        }
        const allMonthKeys = [...new Set(allHistoryData.map(d => typeof d.id === 'string' ? d.id.substring(0,7) : null).filter(Boolean))].sort();
        const idx = allMonthKeys.indexOf(selectedKey);
        if (idx <= 0) return { ...none, description: `${yoyKey} 데이터 없고 직전 월도 없어 비교 불가` };
        const prevKeys = allMonthKeys.slice(Math.max(0, idx - 3), idx);
        const data = allHistoryData.filter(d => prevKeys.includes(d.id.substring(0,7)));
        const desc = (prevKeys.length >= 3 ? `최근 3개월 평균` : `최근 ${prevKeys.length}개월 평균`)
            + ` (${prevKeys[0]} ~ ${prevKeys[prevKeys.length-1]}) — 작년 동월(${yoyKey}) 데이터 없어 폴백`;
        return { data, type: 'rolling_fallback', description: desc, range: `${prevKeys[0]} ~ ${prevKeys[prevKeys.length-1]}` };
    }

    if (granularity === 'year') {
        if (!/^\d{4}$/.test(selectedKey)) return none;
        const year = parseInt(selectedKey, 10);
        const prevYearKey = String(year - 1);
        const prevYearData = allHistoryData.filter(d => typeof d.id === 'string' && d.id.substring(0,4) === prevYearKey);
        if (prevYearData.some(d => (d.workRecords||[]).length > 0)) {
            return { data: prevYearData, type: 'yoy', description: `전년도 (${prevYearKey})`, range: prevYearKey };
        }
        return { ...none, description: `전년도(${prevYearKey}) 데이터 없어 비교 불가` };
    }

    return none;
}

/**
 * 현재·전기 한 쌍. days·prevDays 는 지금 이름으로 합친 사본(aliasHistoryView)을 넘길 것.
 * opts.speeds 가 없으면 allDays 에서 평상시 속도를 만든다(skipDate·until).
 */
export function opsSummary(days, prevDays, allDays, appConfig, { speeds = null, wageMap = null, skipDate = null, until = null } = {}) {
    const sp = speeds || baselineSpeeds(allDays, { skipDate, until });
    const wages = wageMap || wageMapOf(appConfig, [...(days || []), ...(prevDays || [])]);
    const cur = periodMetrics(days, appConfig, { speeds: sp, wageMap: wages });
    const prev = periodMetrics(prevDays, appConfig, { speeds: sp, wageMap: wages });
    const hasPrev = prev.staffing.dayCount > 0;   // 전기가 비면 증감은 전부 null
    const pct = (a, b) => (hasPrev && b > 0 ? ((a - b) / b) * 100 : null);
    const pp = (a, b) => (hasPrev ? a - b : null);
    return {
        speeds: sp, wageMap: wages, cur, prev,
        change: {
            availableFTE: pct(cur.availableFTE, prev.availableFTE),
            requiredFTE: pct(cur.requiredFTE, prev.requiredFTE),
            utilizationRate: pp(cur.utilizationRate, prev.utilizationRate),
            efficiencyRatio: pp(cur.efficiencyRatio, prev.efficiencyRatio),
            oee: pp(cur.oee, prev.oee),
            totalQuantity: pct(cur.totalQuantity, prev.totalQuantity),
            revenue: pct(cur.revenue, prev.revenue)
        }
    };
}
