// === js/ui-history-settlement.js ===
// 🧾 팀 결산 보고: 월/분기/년 단위로 종합 인사이트·생산성·인력운영·업무리포트·근태이력·경영지표·검수이력을
// 한 화면에 상세하게 요약해서 보여주는 보고서 탭. 각 섹션의 실제 계산은 기존 모듈의 재사용 함수를 그대로 사용하고,
// 이 파일은 "기간 해석 + 심층 집계 + 보고서 렌더링"을 담당한다.

import * as State from './state.js';
import { LEAVE_TYPES } from './state.js';
import { getRegularMembersForCount, formatDuration, buildMemberHourlyWageMap } from './utils.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
    calculateReportKPIs,
    calculateReportAggregations,
    aggregateDaysToSingleData,
    calculatePeriodThroughputs,
    calculateAdvancedProductivity,
    calculateBenchmarkOEE,
    generateProductivityDiagnosis,
    analyzeUnitCost
} from './ui-history-reports-logic.js';

import { aggregateManagementData } from './ui-history-management.js';

// ============================================================
// 모듈 상태
// ============================================================
let _productHistoryCache = null; // product_history 컬렉션 캐시 (검수이력용)
let _currentPeriod = { granularity: 'month', year: new Date().getFullYear(), sub: new Date().getMonth() + 1 };
let _chartInstances = [];

function destroyCharts() {
    _chartInstances.forEach(c => { try { c.destroy(); } catch (e) { /* noop */ } });
    _chartInstances = [];
}

// ============================================================
// 1. 기간 해석 유틸
// ============================================================
const pad2 = (n) => String(n).padStart(2, '0');

function getQuarterMonthKeys(year, quarter) {
    const startMonth = (quarter - 1) * 3 + 1;
    return [0, 1, 2].map(i => `${year}-${pad2(startMonth + i)}`);
}

function getFilteredDaysForPeriod(granularity, year, sub) {
    const all = State.allHistoryData || [];
    if (granularity === 'month') {
        const key = `${year}-${pad2(sub)}`;
        return all.filter(d => typeof d.id === 'string' && d.id.substring(0, 7) === key);
    }
    if (granularity === 'quarter') {
        const keys = new Set(getQuarterMonthKeys(year, sub));
        return all.filter(d => typeof d.id === 'string' && keys.has(d.id.substring(0, 7)));
    }
    const key = String(year);
    return all.filter(d => typeof d.id === 'string' && d.id.substring(0, 4) === key);
}

function getPreviousPeriod(granularity, year, sub) {
    if (granularity === 'month') {
        let m = sub - 1, y = year;
        if (m < 1) { m = 12; y -= 1; }
        return { year: y, sub: m };
    }
    if (granularity === 'quarter') {
        let q = sub - 1, y = year;
        if (q < 1) { q = 4; y -= 1; }
        return { year: y, sub: q };
    }
    return { year: year - 1, sub: null };
}

function getPeriodLabel(granularity, year, sub) {
    if (granularity === 'month') return `${year}년 ${sub}월`;
    if (granularity === 'quarter') return `${year}년 ${sub}분기`;
    return `${year}년`;
}

// 검수이력(product_history)은 history 문서가 없는 날짜도 포함해야 하므로 실제 달력 범위를 계산
function getPeriodDateRange(granularity, year, sub) {
    if (granularity === 'month') {
        const last = new Date(year, sub, 0);
        return { from: `${year}-${pad2(sub)}-01`, to: `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}` };
    }
    if (granularity === 'quarter') {
        const startMonth = (sub - 1) * 3 + 1;
        const last = new Date(year, startMonth + 3 - 1, 0);
        return { from: `${year}-${pad2(startMonth)}-01`, to: `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}` };
    }
    return { from: `${year}-01-01`, to: `${year}-12-31` };
}

// ============================================================
// 2. 공용 빌더 헬퍼
// ============================================================
function buildWageMap(dayArrays, appConfig) {
    const wageMap = buildMemberHourlyWageMap(appConfig.memberWages); // 월기본급 → 시급(÷209)
    dayArrays.flat().forEach(day => {
        (day.partTimers || []).forEach(pt => {
            if (pt && pt.name && !wageMap[pt.name]) wageMap[pt.name] = pt.wage || 0;
        });
    });
    return wageMap;
}

function buildMemberToPartMap(appConfig) {
    const map = new Map();
    (appConfig.teamGroups || []).forEach(group => {
        (group.members || []).forEach(member => map.set(member, group.name));
    });
    return map;
}

// 연차/반차 항목의 실제 사용일수 (반차=0.5, 다일 연차는 평일만 카운트) — ui-history-leave.js의 계산 방식과 동일한 패턴
function countLeaveDays(entry) {
    if (entry.type && entry.type.includes('반차')) return 0.5;
    const start = entry.startDate || entry.date || '';
    const end = entry.endDate || start;
    if (!start) return 1;
    if (!end || end === start) return 1;
    let count = 0;
    const s = new Date(start), e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 1;
    for (let dt = new Date(s); dt <= e; dt.setDate(dt.getDate() + 1)) {
        const dow = dt.getDay();
        if (dow !== 0 && dow !== 6) count++;
    }
    return count > 0 ? count : 1;
}

// 일자 정렬된 날짜별 총 처리량/매출 시계열 (차트용)
function buildDailySeries(days, valueFn) {
    const sorted = [...days].sort((a, b) => a.id.localeCompare(b.id));
    return {
        labels: sorted.map(d => d.id.slice(5)),
        values: sorted.map(d => valueFn(d))
    };
}

// ============================================================
// 3. 섹션별 계산 함수
// ============================================================

// 공용 핵심 지표 번들 (여러 섹션이 공유)
function computeCoreMetrics(currentDays, previousDays, appConfig) {
    const wageMap = buildWageMap([currentDays, previousDays], appConfig);
    const memberToPartMap = buildMemberToPartMap(appConfig);

    const curAgg = aggregateDaysToSingleData(currentDays, 'settlement-current');
    const prevAgg = aggregateDaysToSingleData(previousDays, 'settlement-previous');

    const curKPIs = calculateReportKPIs(curAgg, appConfig, wageMap);
    const prevKPIs = calculateReportKPIs(prevAgg, appConfig, wageMap);

    const curAggr = calculateReportAggregations(curAgg, appConfig, wageMap, memberToPartMap);
    const prevAggr = calculateReportAggregations(prevAgg, appConfig, wageMap, memberToPartMap);

    const curThroughputs = calculatePeriodThroughputs(currentDays);
    const prevThroughputs = calculatePeriodThroughputs(previousDays);

    const curProd = calculateAdvancedProductivity(currentDays, curAggr, curThroughputs, appConfig, wageMap);
    const prevProd = calculateAdvancedProductivity(previousDays, prevAggr, prevThroughputs, appConfig, wageMap);

    const benchmarkOEE = calculateBenchmarkOEE(State.allHistoryData, appConfig);
    const diagnosis = generateProductivityDiagnosis(curProd, prevProd, benchmarkOEE);

    return { wageMap, memberToPartMap, curKPIs, prevKPIs, curAggr, prevAggr, curProd, prevProd, benchmarkOEE, diagnosis };
}

// 생산성·효율성: 처리량(수량) 중심 — 시간/금액은 부가 지표로만 사용
function computeThroughputSummary(currentDays, core) {
    const workingDays = currentDays.filter(d => (d.workRecords || []).length > 0);
    const daily = buildDailySeries(currentDays, d => Object.values(d.taskQuantities || {}).reduce((s, q) => s + (Number(q) || 0), 0));

    const totalQuantity = core.curKPIs.totalQuantity;
    const prevTotalQuantity = core.prevKPIs.totalQuantity;
    const avgDailyQuantity = workingDays.length > 0 ? totalQuantity / workingDays.length : 0;
    const prevWorkingDaysCount = core.prevAggr ? Object.keys(core.prevAggr.taskSummary).length : 0;

    // 최고/최저 처리량일
    let peakDay = null, lowDay = null;
    daily.labels.forEach((label, i) => {
        const v = daily.values[i];
        if (v <= 0) return;
        if (!peakDay || v > peakDay.value) peakDay = { label, value: v };
        if (!lowDay || v < lowDay.value) lowDay = { label, value: v };
    });

    // 업무별 처리량 전체 분해 (share %, 전기간 대비, UPH는 참고용)
    const prevTaskQty = {};
    Object.entries(core.prevAggr.taskSummary).forEach(([task, s]) => { prevTaskQty[task] = s.quantity || 0; });

    const taskEntries = Object.entries(core.curAggr.taskSummary)
        .map(([task, s]) => ({
            task,
            quantity: s.quantity || 0,
            avgThroughput: s.avgThroughput || 0,
            avgStaff: s.avgStaff || 0,
            duration: s.duration || 0,
            prevQuantity: prevTaskQty[task] || 0
        }))
        .filter(t => t.quantity > 0 || t.duration > 0)
        .sort((a, b) => b.quantity - a.quantity);

    const taskTotalQty = taskEntries.reduce((sum, t) => sum + t.quantity, 0);
    taskEntries.forEach(t => {
        t.share = taskTotalQty > 0 ? (t.quantity / taskTotalQty * 100) : 0;
        t.changePct = t.prevQuantity > 0 ? ((t.quantity - t.prevQuantity) / t.prevQuantity * 100) : null;
    });

    return {
        daily, totalQuantity, prevTotalQuantity, avgDailyQuantity,
        workingDaysCount: workingDays.length, peakDay, lowDay, taskEntries
    };
}

function computeWorkforceSummary(currentDays, appConfig, core) {
    const workingDays = currentDays.filter(d => (d.workRecords || []).length > 0);
    const avgActiveMembers = workingDays.length > 0
        ? workingDays.reduce((s, d) => s + calculateReportKPIs(d, appConfig, core.wageMap).activeMembersCount, 0) / workingDays.length
        : 0;

    const partTimerNames = new Set();
    currentDays.forEach(d => (d.partTimers || []).forEach(p => { if (p && p.name) partTimerNames.add(p.name); }));

    const leaveSeen = new Set();
    let leaveDaysUsed = 0;
    const memberLeaveDays = {};
    currentDays.forEach(d => (d.onLeaveMembers || []).forEach(l => {
        if (!l || !l.type || !(l.type.includes('연차') || l.type.includes('반차'))) return;
        const key = `${l.member}|${l.type}|${l.startDate || l.date || ''}|${l.endDate || ''}`;
        if (leaveSeen.has(key)) return;
        leaveSeen.add(key);
        const days = countLeaveDays(l);
        leaveDaysUsed += days;
        memberLeaveDays[l.member] = (memberLeaveDays[l.member] || 0) + days;
    }));

    const topLeaveUsers = Object.entries(memberLeaveDays)
        .map(([member, days]) => ({ member, days }))
        .sort((a, b) => b.days - a.days)
        .slice(0, 8);

    // 파트별 인력 분포 (calculateReportAggregations의 partSummary 재사용)
    const partDistribution = Object.entries(core.curAggr.partSummary)
        .map(([part, s]) => ({ part, memberCount: s.members.size, duration: s.duration }))
        .sort((a, b) => b.memberCount - a.memberCount);

    return {
        avgActiveMembers,
        regularMemberCount: getRegularMembersForCount(appConfig).size,
        partTimerCount: partTimerNames.size,
        partTimerNames: [...partTimerNames],
        leaveDaysUsed,
        topLeaveUsers,
        partDistribution,
        workingDaysCount: workingDays.length
    };
}

function computeAttendanceSummary(currentDays) {
    const seen = new Set();
    const typeCounts = {};
    LEAVE_TYPES.forEach(t => { typeCounts[t] = 0; });
    const memberCounts = {};

    currentDays.forEach(day => {
        (day.onLeaveMembers || []).forEach(entry => {
            if (!entry || !entry.type || !entry.member) return;
            const start = entry.startDate || entry.date || '';
            const end = entry.endDate || start;
            const key = `${entry.member}|${entry.type}|${start}|${end}`;
            if (seen.has(key)) return;
            seen.add(key);

            typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1;
            if (!memberCounts[entry.member]) memberCounts[entry.member] = {};
            memberCounts[entry.member][entry.type] = (memberCounts[entry.member][entry.type] || 0) + 1;
        });
    });

    const memberRows = Object.entries(memberCounts)
        .map(([member, counts]) => ({
            member, counts,
            total: Object.values(counts).reduce((a, b) => a + b, 0),
            absence: counts['결근'] || 0,
            late: counts['지각'] || 0,
            outing: counts['외출'] || 0,
            earlyLeave: counts['조퇴'] || 0
        }))
        .sort((a, b) => (b.absence - a.absence) || (b.late - a.late) || (b.outing - a.outing) || (b.earlyLeave - a.earlyLeave) || (b.total - a.total))
        .slice(0, 10);

    const totalEvents = Object.values(typeCounts).reduce((a, b) => a + b, 0);

    return { typeCounts, memberRows, totalEvents };
}

function computeWorkReportSummary(core) {
    const taskEntries = Object.entries(core.curAggr.taskSummary)
        .map(([task, s]) => ({ task, quantity: s.quantity || 0, cost: s.cost || 0, duration: s.duration || 0, avgStaff: s.avgStaff || 0, workDays: s.workDays || 0 }))
        .filter(t => t.quantity > 0 || t.duration > 0)
        .sort((a, b) => b.duration - a.duration);

    const totalDuration = taskEntries.reduce((s, t) => s + t.duration, 0);
    taskEntries.forEach(t => { t.timeShare = totalDuration > 0 ? (t.duration / totalDuration * 100) : 0; });

    const memberEntries = Object.entries(core.curAggr.memberSummary || {})
        .map(([member, s]) => ({ member, duration: s.duration || 0, cost: s.cost || 0, taskCount: s.tasks ? s.tasks.size : 0, part: s.part || '' }))
        .sort((a, b) => b.duration - a.duration);

    const partRows = Object.entries(core.curAggr.partSummary)
        .map(([part, s]) => ({ part, duration: s.duration, cost: s.cost, memberCount: s.members.size }))
        .sort((a, b) => b.duration - a.duration);

    return {
        taskEntries, memberEntries, partRows,
        taskCount: taskEntries.length,
        memberCount: memberEntries.length
    };
}

function computeManagementSummary(currentDays, previousDays, appConfig, core) {
    const curMgmt = aggregateManagementData(currentDays);
    const prevMgmt = aggregateManagementData(previousDays);
    const revenueDaily = buildDailySeries(currentDays, d => Number(d.management?.revenue) || 0);

    let unitCost = null;
    if ((appConfig.costCalcTasks || []).length > 0) {
        const curSingle = aggregateDaysToSingleData(currentDays, 'settlement-mgmt-current');
        unitCost = analyzeUnitCost(curSingle, appConfig, core.wageMap, curMgmt.revenue);
    }

    return { curMgmt, prevMgmt, unitCost, revenueDaily };
}

function computeInspectionSummary(productHistoryCache, from, to) {
    let totalInspectedQty = 0, totalDefectQty = 0, totalInspectionCount = 0, totalDefectCount = 0;
    const productStats = {};
    const defectReasonCounts = {};
    const normalValues = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];
    const labelMap = { fabric: '원단', color: '컬러', distortion: '뒤틀림', unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추', lining: '안감', pilling: '보풀', dye: '이염' };

    (productHistoryCache || []).forEach(product => {
        const pName = product.id;
        (product.logs || []).forEach(log => {
            if (!log.date || log.date < from || log.date > to) return;

            const qty = Number(log.inboundQty) || Number(log.qty) || 0;
            totalInspectionCount += 1;
            totalInspectedQty += qty;

            if (!productStats[pName]) productStats[pName] = { totalQty: 0, defectQty: 0, inspCount: 0, defectCount: 0, reasons: [] };
            productStats[pName].totalQty += qty;
            productStats[pName].inspCount += 1;

            let isDefect = log.status === '불량';
            const reasons = [];
            if (log.defects && Array.isArray(log.defects) && log.defects.length > 0) { isDefect = true; reasons.push(...log.defects); }
            if (log.checklist) {
                Object.entries(log.checklist).forEach(([key, val]) => {
                    if (key !== 'thickness' && val) {
                        const cleanVal = String(val).trim();
                        if (cleanVal && !normalValues.includes(cleanVal)) {
                            isDefect = true;
                            reasons.push(`${labelMap[key] || key}: ${cleanVal}`);
                        }
                    }
                });
            }

            if (isDefect) {
                totalDefectCount += 1;
                totalDefectQty += qty;
                productStats[pName].defectCount += 1;
                productStats[pName].defectQty += qty;
                const reasonList = reasons.length > 0 ? reasons : ['상태 불량/기타'];
                reasonList.forEach(r => { defectReasonCounts[r] = (defectReasonCounts[r] || 0) + 1; });
                productStats[pName].reasons.push(...reasonList);
            }
        });
    });

    const qtyDefectRate = totalInspectedQty > 0 ? (totalDefectQty / totalInspectedQty * 100) : 0;
    const countDefectRate = totalInspectionCount > 0 ? (totalDefectCount / totalInspectionCount * 100) : 0;

    const topDefective = Object.entries(productStats)
        .map(([name, s]) => ({
            name, defectCount: s.defectCount, defectQty: s.defectQty, totalQty: s.totalQty,
            commonReason: Object.entries(s.reasons.reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
        }))
        .filter(p => p.defectCount > 0)
        .sort((a, b) => b.defectCount - a.defectCount)
        .slice(0, 10);

    const topReasons = Object.entries(defectReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
        totalInspectedQty, totalDefectQty, totalInspectionCount, totalDefectCount,
        qtyDefectRate, countDefectRate, topDefective, topReasons,
        productTypeCount: Object.keys(productStats).length
    };
}

// ============================================================
// 4. 렌더 헬퍼
// ============================================================
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString();

// 섹션 컨테이너 (전체 폭 패널 — 카드 나열이 아니라 보고서 챕터처럼 구성)
const sectionPanel = (icon, title, subtitle, bodyHtml, accentClass = 'border-l-blue-500') => `
    <section class="bg-white border border-gray-200 ${accentClass} border-l-4 rounded-xl shadow-sm p-5 md:p-6 print:break-inside-avoid">
        <div class="flex items-baseline justify-between flex-wrap gap-1 mb-4 pb-3 border-b border-gray-100">
            <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">${icon} ${title}</h3>
            <p class="text-xs text-gray-400">${subtitle}</p>
        </div>
        ${bodyHtml}
    </section>`;

const heroStat = (label, value, unit, diffHtml, colorClass = 'text-gray-800') => `
    <div class="flex-1 min-w-[120px]">
        <div class="text-[11px] text-gray-500 mb-1">${label}</div>
        <div class="text-2xl md:text-3xl font-extrabold ${colorClass}">${value}<span class="text-xs font-semibold text-gray-400 ml-0.5">${unit}</span></div>
        ${diffHtml ? `<div class="mt-1">${diffHtml}</div>` : ''}
    </div>`;

const miniStat = (label, value, sub = '') => `
    <div class="bg-gray-50 rounded-lg p-3 text-center">
        <div class="text-[11px] text-gray-500 mb-0.5">${label}</div>
        <div class="text-base font-extrabold text-gray-800">${value}</div>
        ${sub ? `<div class="text-[10px] text-gray-400 mt-0.5">${sub}</div>` : ''}
    </div>`;

const progressBar = (pct, colorClass = 'bg-blue-500') => `
    <div class="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div class="h-1.5 rounded-full ${colorClass}" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></div>
    </div>`;

const changeBadge = (pct) => {
    if (pct === null || pct === undefined || !isFinite(pct)) return '<span class="text-[10px] text-gray-400">(신규)</span>';
    if (Math.abs(pct) < 0.5) return '<span class="text-[10px] text-gray-400">(-)</span>';
    const up = pct > 0;
    return `<span class="text-[10px] font-bold ${up ? 'text-blue-600' : 'text-red-500'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
};

const tableShell = (theadHtml, tbodyHtml, maxH = 'max-h-[420px]') => `
    <div class="overflow-x-auto overflow-y-auto ${maxH} border border-gray-100 rounded-lg">
        <table class="w-full text-sm text-left text-gray-600">
            <thead class="text-[11px] text-gray-700 uppercase bg-gray-100 sticky top-0"><tr>${theadHtml}</tr></thead>
            <tbody class="divide-y divide-gray-100">${tbodyHtml}</tbody>
        </table>
    </div>`;

const th = (label, align = 'left') => `<th class="px-3 py-2 text-${align} font-bold whitespace-nowrap">${label}</th>`;
const td = (content, align = 'left', extra = '') => `<td class="px-3 py-2 text-${align} ${extra}">${content}</td>`;

const emptyNote = (msg) => `<div class="text-xs text-gray-400 text-center py-6">${msg}</div>`;

const narrative = (text, tone = 'gray') => {
    const toneMap = {
        gray: 'bg-gray-50 border-gray-200 text-gray-700',
        blue: 'bg-blue-50 border-blue-200 text-blue-800',
        emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        red: 'bg-red-50 border-red-200 text-red-800',
        amber: 'bg-amber-50 border-amber-200 text-amber-800'
    };
    return `<div class="rounded-lg border p-3 text-xs leading-relaxed ${toneMap[tone] || toneMap.gray}">${text}</div>`;
};

// ============================================================
// 5. 차트 생성 (Chart.js)
// ============================================================
function createBarChart(canvasId, labels, values, label, colorHex) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === 'undefined') return null;
    const chart = new Chart(el, {
        type: 'bar',
        data: { labels, datasets: [{ label, data: values, backgroundColor: colorHex, borderRadius: 4, maxBarThickness: 28 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                y: { beginAtZero: true, grid: { borderDash: [4, 4] }, ticks: { font: { size: 10 } } }
            }
        }
    });
    _chartInstances.push(chart);
    return chart;
}

function createHorizontalBarChart(canvasId, labels, values, colorHex) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === 'undefined') return null;
    const chart = new Chart(el, {
        type: 'bar',
        data: { labels, datasets: [{ data: values, backgroundColor: colorHex, borderRadius: 4, maxBarThickness: 18 }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, grid: { borderDash: [4, 4] }, ticks: { font: { size: 10 } } },
                y: { grid: { display: false }, ticks: { font: { size: 10 } } }
            }
        }
    });
    _chartInstances.push(chart);
    return chart;
}

// ============================================================
// 6. 섹션 렌더 함수
// ============================================================

function renderExecutiveSummary(core, tp, wf, att, mg, insp, periodLabel, workingDaysCount) {
    if (workingDaysCount === 0) {
        return `
        <div class="bg-gradient-to-br from-gray-700 to-gray-900 rounded-2xl shadow-md p-6 text-white">
            <h2 class="text-xl font-bold mb-1">🧾 ${periodLabel} 팀 결산 보고</h2>
            <p class="text-sm text-gray-300">해당 기간에 업무 기록이 없어 요약할 내용이 없습니다.</p>
        </div>`;
    }

    const d = core.diagnosis?.diagnosis;
    let verdictIcon = '🟢', verdictText = '양호', verdictBg = 'bg-emerald-500';
    if (core.curProd.oee < 60) { verdictIcon = '🔴'; verdictText = '주의 필요'; verdictBg = 'bg-red-500'; }
    else if (core.curProd.oee < 80) { verdictIcon = '🟡'; verdictText = '보통'; verdictBg = 'bg-amber-500'; }

    const qtyChangeTxt = tp.prevTotalQuantity > 0
        ? `전기간(${fmt(tp.prevTotalQuantity)}개) 대비 ${tp.totalQuantity >= tp.prevTotalQuantity ? '+' : ''}${(((tp.totalQuantity - tp.prevTotalQuantity) / tp.prevTotalQuantity) * 100).toFixed(1)}%`
        : '전기간 데이터 없음';

    return `
    <div class="bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 rounded-2xl shadow-md p-6 md:p-8 text-white">
        <div class="flex items-start justify-between flex-wrap gap-3 mb-6">
            <div>
                <div class="text-xs text-slate-300 tracking-wide uppercase mb-1">Executive Summary</div>
                <h2 class="text-2xl font-extrabold">${periodLabel} 팀 결산 보고</h2>
            </div>
            <span class="inline-flex items-center gap-1.5 ${verdictBg} text-white text-sm font-bold px-3 py-1.5 rounded-full shadow">${verdictIcon} ${verdictText}</span>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>
                <div class="text-[11px] text-slate-300 mb-1">총 처리량</div>
                <div class="text-3xl font-extrabold">${fmt(tp.totalQuantity)}<span class="text-sm font-medium text-slate-300 ml-1">개</span></div>
                <div class="text-[11px] text-slate-300 mt-1">${qtyChangeTxt}</div>
            </div>
            <div>
                <div class="text-[11px] text-slate-300 mb-1">종합 생산 효율 (OEE)</div>
                <div class="text-3xl font-extrabold">${core.curProd.oee.toFixed(0)}<span class="text-sm font-medium text-slate-300 ml-1">%</span></div>
                <div class="text-[11px] text-slate-300 mt-1">${core.prevProd.oee > 0 ? `전기간 ${core.prevProd.oee.toFixed(0)}%` : '전기간 데이터 없음'}</div>
            </div>
            <div>
                <div class="text-[11px] text-slate-300 mb-1">일평균 근무인원</div>
                <div class="text-3xl font-extrabold">${wf.avgActiveMembers.toFixed(1)}<span class="text-sm font-medium text-slate-300 ml-1">명</span></div>
                <div class="text-[11px] text-slate-300 mt-1">파트타이머 ${wf.partTimerCount}명 포함</div>
            </div>
            <div>
                <div class="text-[11px] text-slate-300 mb-1">${mg.curMgmt.revenue > 0 ? '총 매출' : '검수 불량률'}</div>
                <div class="text-3xl font-extrabold">${mg.curMgmt.revenue > 0 ? fmt(mg.curMgmt.revenue) : insp.qtyDefectRate.toFixed(1)}<span class="text-sm font-medium text-slate-300 ml-1">${mg.curMgmt.revenue > 0 ? '원' : '%'}</span></div>
                <div class="text-[11px] text-slate-300 mt-1">${mg.curMgmt.revenue > 0 ? `발주 ${fmt(mg.curMgmt.orderCount)}건` : `검수 ${fmt(insp.totalInspectionCount)}건`}</div>
            </div>
        </div>

        ${d ? `<div class="bg-white/10 backdrop-blur rounded-lg p-4 text-sm leading-relaxed">
            <span class="font-bold">${d.icon} ${d.title}.</span> ${d.desc}
            ${core.diagnosis?.commentHtml ? `<div class="mt-2 text-slate-200 text-xs">${core.diagnosis.commentHtml}</div>` : ''}
        </div>` : ''}
    </div>`;
}

function renderProductivitySection(tp, core, workingDaysCount) {
    if (workingDaysCount === 0) return sectionPanel('🚀', '생산성 및 효율성', '처리량 중심 분석', emptyNote('해당 기간에 업무 기록이 없습니다.'), 'border-l-blue-500');

    const qtyChangePct = tp.prevTotalQuantity > 0 ? ((tp.totalQuantity - tp.prevTotalQuantity) / tp.prevTotalQuantity * 100) : null;
    const chartId = 'settle-chart-throughput';
    const maxQty = Math.max(1, ...tp.taskEntries.map(t => t.quantity));

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            ${heroStat('총 처리량', fmt(tp.totalQuantity), '개', changeBadge(qtyChangePct), 'text-blue-700')}
            ${heroStat('일평균 처리량', fmt(tp.avgDailyQuantity), '개/일', '', 'text-gray-800')}
            ${heroStat('최고 처리일', tp.peakDay ? fmt(tp.peakDay.value) : '-', tp.peakDay ? `개 (${tp.peakDay.label})` : '', '', 'text-emerald-600')}
            ${heroStat('최저 처리일', tp.lowDay ? fmt(tp.lowDay.value) : '-', tp.lowDay ? `개 (${tp.lowDay.label})` : '', '', 'text-gray-500')}
        </div>

        <div class="mb-5">
            <div class="text-xs font-bold text-gray-600 mb-2">📈 일별 처리량 추이</div>
            <div style="height:220px;"><canvas id="${chartId}"></canvas></div>
        </div>

        <div class="mb-5">
            <div class="text-xs font-bold text-gray-600 mb-2">🧩 업무별 처리량 분해 (점유율 · 전기간 대비)</div>
            ${tableShell(
                th('업무') + th('처리량', 'right') + th('점유율', 'right') + th('전기간 대비', 'right') + th('평균 투입인원', 'right') + th('처리속도(개/분)', 'right'),
                tp.taskEntries.map(t => `<tr>
                    ${td(esc(t.task))}
                    ${td(`<div class="flex items-center gap-2 justify-end"><span class="font-bold text-gray-800">${fmt(t.quantity)}</span></div>`, 'right')}
                    ${td(`<div class="w-24 inline-block align-middle mr-2">${progressBar(t.share, 'bg-blue-500')}</div><span class="text-xs text-gray-500">${t.share.toFixed(1)}%</span>`, 'right')}
                    ${td(changeBadge(t.changePct), 'right')}
                    ${td(t.avgStaff.toFixed(1) + '명', 'right')}
                    ${td(t.avgThroughput.toFixed(2), 'right')}
                </tr>`).join('') || '<tr><td colspan="6" class="text-center text-gray-400 py-6">데이터 없음</td></tr>'
            )}
        </div>

        <div class="text-xs font-bold text-gray-600 mb-2">⚙️ 효율성 부가 지표 (참고용)</div>
        <div class="grid grid-cols-3 gap-2 mb-3">
            ${miniStat('시간 활용률', core.curProd.utilizationRate.toFixed(0) + '%')}
            ${miniStat('업무 효율성', core.curProd.efficiencyRatio.toFixed(0) + '%')}
            ${miniStat('품질 효율', core.curProd.qualityRatio.toFixed(0) + '%')}
        </div>
        <div class="grid grid-cols-3 gap-2 text-center mb-3">
            <div class="text-[11px] text-gray-500">가용 손실 <b class="text-gray-700 block text-sm">${fmt(core.curProd.availabilityLossCost)}원</b></div>
            <div class="text-[11px] text-gray-500">성능 손실 <b class="text-gray-700 block text-sm">${fmt(core.curProd.performanceLossCost)}원</b></div>
            <div class="text-[11px] text-gray-500">품질 손실 <b class="text-gray-700 block text-sm">${fmt(core.curProd.qualityLossCost)}원</b></div>
        </div>
        ${core.curProd.topPerformanceLossTasks && core.curProd.topPerformanceLossTasks.length > 0 ? `
        <div class="text-[11px] text-gray-500 mb-1">⏱️ 속도 손실 상위 업무</div>
        <div class="space-y-1">
            ${core.curProd.topPerformanceLossTasks.map(t => `<div class="flex justify-between text-xs"><span>${esc(t.task)}</span><span class="text-red-500 font-bold">-${fmt(t.lossMinutes)}분</span></div>`).join('')}
        </div>` : ''}
    `;
    return { html: sectionPanel('🚀', '생산성 및 효율성', '처리량 중심 분석', body, 'border-l-blue-500'), chartId, chartData: tp.daily };
}

function renderWorkforceSection(wf, core, workingDaysCount) {
    if (workingDaysCount === 0) return sectionPanel('👥', '인력 운영', '인력 배치와 가동 현황', emptyNote('해당 기간에 업무 기록이 없습니다.'), 'border-l-violet-500');

    const fteMax = Math.max(core.curProd.availableFTE, core.curProd.workedFTE, core.curProd.requiredFTE, 1);

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            ${heroStat('일평균 근무인원', wf.avgActiveMembers.toFixed(1), '명', '', 'text-violet-700')}
            ${heroStat('정규 인원', wf.regularMemberCount, '명')}
            ${heroStat('파트타이머', wf.partTimerCount, '명')}
            ${heroStat('연차·반차 사용', wf.leaveDaysUsed.toFixed(1), '일')}
        </div>

        <div class="mb-5">
            <div class="text-xs font-bold text-gray-600 mb-2">⚖️ 투입 인력 비교 (FTE)</div>
            <div class="space-y-2">
                <div class="flex items-center gap-3 text-xs">
                    <span class="w-24 text-gray-500">가용 인력</span>
                    <div class="flex-1">${progressBar(core.curProd.availableFTE / fteMax * 100, 'bg-violet-400')}</div>
                    <span class="w-16 text-right font-bold text-gray-700">${core.curProd.availableFTE.toFixed(1)}</span>
                </div>
                <div class="flex items-center gap-3 text-xs">
                    <span class="w-24 text-gray-500">실작업 인력</span>
                    <div class="flex-1">${progressBar(core.curProd.workedFTE / fteMax * 100, 'bg-violet-500')}</div>
                    <span class="w-16 text-right font-bold text-gray-700">${core.curProd.workedFTE.toFixed(1)}</span>
                </div>
                <div class="flex items-center gap-3 text-xs">
                    <span class="w-24 text-gray-500">표준 필요인력</span>
                    <div class="flex-1">${progressBar(core.curProd.requiredFTE / fteMax * 100, 'bg-violet-600')}</div>
                    <span class="w-16 text-right font-bold text-gray-700">${core.curProd.requiredFTE.toFixed(1)}</span>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">🧑‍🤝‍🧑 파트별 인력 분포</div>
                ${tableShell(
                    th('파트') + th('인원', 'right') + th('투입시간', 'right'),
                    wf.partDistribution.map(p => `<tr>${td(esc(p.part))}${td(p.memberCount + '명', 'right')}${td(formatDuration(p.duration), 'right')}</tr>`).join('') || '<tr><td colspan="3" class="text-center text-gray-400 py-4">데이터 없음</td></tr>',
                    'max-h-[220px]'
                )}
            </div>
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">🏖️ 연차·반차 사용 상위 인원</div>
                ${tableShell(
                    th('이름') + th('사용일수', 'right'),
                    wf.topLeaveUsers.map(m => `<tr>${td(esc(m.member))}${td(m.days.toFixed(1) + '일', 'right')}</tr>`).join('') || '<tr><td colspan="2" class="text-center text-gray-400 py-4">사용 내역 없음</td></tr>',
                    'max-h-[220px]'
                )}
            </div>
        </div>
    `;
    return sectionPanel('👥', '인력 운영', '인력 배치와 가동 현황', body, 'border-l-violet-500');
}

function renderWorkReportSection(wr, workingDaysCount) {
    if (workingDaysCount === 0) return sectionPanel('📁', '업무 리포트', '업무별·인원별 상세', emptyNote('해당 기간에 업무 기록이 없습니다.'), 'border-l-indigo-500');

    const body = `
        <div class="grid grid-cols-2 gap-3 mb-5">
            ${heroStat('활동 인원', wr.memberCount, '명', '', 'text-indigo-700')}
            ${heroStat('수행 업무 종류', wr.taskCount, '종')}
        </div>

        <div class="mb-5">
            <div class="text-xs font-bold text-gray-600 mb-2">📋 업무별 상세 (투입시간 순)</div>
            ${tableShell(
                th('업무') + th('투입시간', 'right') + th('시간 점유율', 'right') + th('생산량', 'right') + th('인건비', 'right') + th('가동일수', 'right'),
                wr.taskEntries.map(t => `<tr>
                    ${td(esc(t.task))}
                    ${td(formatDuration(t.duration), 'right')}
                    ${td(`<div class="w-20 inline-block align-middle mr-2">${progressBar(t.timeShare, 'bg-indigo-500')}</div><span class="text-xs text-gray-500">${t.timeShare.toFixed(1)}%</span>`, 'right')}
                    ${td(fmt(t.quantity) + '개', 'right')}
                    ${td(fmt(t.cost) + '원', 'right')}
                    ${td(t.workDays + '일', 'right')}
                </tr>`).join('') || '<tr><td colspan="6" class="text-center text-gray-400 py-6">데이터 없음</td></tr>'
            )}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">🧑‍🤝‍🧑 파트별 요약</div>
                ${tableShell(
                    th('파트') + th('인원', 'right') + th('투입시간', 'right'),
                    wr.partRows.map(p => `<tr>${td(esc(p.part))}${td(p.memberCount + '명', 'right')}${td(formatDuration(p.duration), 'right')}</tr>`).join(''),
                    'max-h-[260px]'
                )}
            </div>
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">🙋 인원별 상세 (투입시간 순)</div>
                ${tableShell(
                    th('이름') + th('파트') + th('투입시간', 'right') + th('업무 수', 'right'),
                    wr.memberEntries.map(m => `<tr>${td(esc(m.member))}${td(esc(m.part))}${td(formatDuration(m.duration), 'right')}${td(m.taskCount + '종', 'right')}</tr>`).join(''),
                    'max-h-[260px]'
                )}
            </div>
        </div>
    `;
    return sectionPanel('📁', '업무 리포트', '업무별·인원별 상세', body, 'border-l-indigo-500');
}

function renderAttendanceSection(att) {
    if (att.totalEvents === 0) return sectionPanel('🕒', '근태 이력', '근태 유형별 분포', emptyNote('해당 기간에 근태 기록이 없습니다.'), 'border-l-amber-500');

    const chartId = 'settle-chart-attendance';
    const activeTypes = LEAVE_TYPES.filter(t => att.typeCounts[t] > 0);

    const body = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
            <div class="md:col-span-1">
                <div class="text-xs font-bold text-gray-600 mb-2">📊 근태 유형별 건수</div>
                <div style="height:${Math.max(140, activeTypes.length * 32)}px;"><canvas id="${chartId}"></canvas></div>
            </div>
            <div class="md:col-span-2">
                <div class="text-xs font-bold text-gray-600 mb-2">⚠️ 결근·지각·외출·조퇴 상위 인원</div>
                ${tableShell(
                    th('이름') + th('결근', 'right') + th('지각', 'right') + th('외출', 'right') + th('조퇴', 'right') + th('총 건수', 'right'),
                    att.memberRows.map(m => `<tr>
                        ${td(esc(m.member))}
                        ${td(m.absence > 0 ? `<span class="text-red-600 font-bold">${m.absence}</span>` : '0', 'right')}
                        ${td(m.late > 0 ? `<span class="text-orange-500 font-bold">${m.late}</span>` : '0', 'right')}
                        ${td(m.outing > 0 ? `<span class="text-amber-600 font-bold">${m.outing}</span>` : '0', 'right')}
                        ${td(m.earlyLeave > 0 ? `<span class="text-yellow-600 font-bold">${m.earlyLeave}</span>` : '0', 'right')}
                        ${td(m.total, 'right')}
                    </tr>`).join('') || '<tr><td colspan="6" class="text-center text-gray-400 py-4">결근·지각·외출·조퇴 없음</td></tr>',
                    'max-h-[260px]'
                )}
            </div>
        </div>
    `;
    return { html: sectionPanel('🕒', '근태 이력', '근태 유형별 분포', body, 'border-l-amber-500'), chartId, labels: activeTypes, values: activeTypes.map(t => att.typeCounts[t]) };
}

function renderManagementSection(mg) {
    if (mg.curMgmt.revenue === 0 && mg.curMgmt.orderCount === 0) return sectionPanel('💹', '경영 지표', '매출·재고·환율', emptyNote('해당 기간에 입력된 경영 지표가 없습니다.'), 'border-l-emerald-500');

    const chartId = 'settle-chart-revenue';
    const revenueChangePct = mg.prevMgmt.revenue > 0 ? ((mg.curMgmt.revenue - mg.prevMgmt.revenue) / mg.prevMgmt.revenue * 100) : null;

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            ${heroStat('총 매출', fmt(mg.curMgmt.revenue), '원', changeBadge(revenueChangePct), 'text-emerald-700')}
            ${heroStat('총 발주 건수', fmt(mg.curMgmt.orderCount), '건')}
            ${heroStat('평균 재고금액', fmt(mg.curMgmt.avgInventoryAmt), '원')}
            ${heroStat('평균 환율(USD)', mg.curMgmt.avgUsdRate > 0 ? mg.curMgmt.avgUsdRate.toFixed(1) : '-', '')}
            ${heroStat('평균 환율(CNY)', mg.curMgmt.avgCnyRate > 0 ? mg.curMgmt.avgCnyRate.toFixed(1) : '-', '')}
        </div>

        <div class="mb-5">
            <div class="text-xs font-bold text-gray-600 mb-2">📈 일별 매출 추이</div>
            <div style="height:200px;"><canvas id="${chartId}"></canvas></div>
        </div>

        ${mg.unitCost && mg.unitCost.isValid ? `
        <div class="text-xs font-bold text-gray-600 mb-2">💰 개당 원가 구조</div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
            ${miniStat('인건비', fmt(mg.unitCost.costs.labor) + '원')}
            ${miniStat('자재비', fmt(mg.unitCost.costs.material) + '원')}
            ${miniStat('배송비', fmt(mg.unitCost.costs.shipping) + '원')}
            ${miniStat('직진배송', fmt(mg.unitCost.costs.directDelivery) + '원')}
            ${miniStat('개당 원가 합계', fmt(mg.unitCost.costs.total) + '원')}
        </div>
        <div class="grid grid-cols-3 gap-2 text-center">
            <div class="text-[11px] text-gray-500">개당 매출 <b class="text-gray-700 block text-sm">${fmt(mg.unitCost.profit.revenuePerItem)}원</b></div>
            <div class="text-[11px] text-gray-500">개당 마진 <b class="text-gray-700 block text-sm">${fmt(mg.unitCost.profit.margin)}원</b></div>
            <div class="text-[11px] text-gray-500">마진율 <b class="text-gray-700 block text-sm">${mg.unitCost.profit.marginRate.toFixed(1)}%</b></div>
        </div>` : ''}
    `;
    return { html: sectionPanel('💹', '경영 지표', '매출·재고·환율', body, 'border-l-emerald-500'), chartId, chartData: mg.revenueDaily };
}

function renderInspectionSection(insp) {
    if (insp.totalInspectionCount === 0) return sectionPanel('🔍', '검수 이력', '입고 검수 품질 현황', emptyNote('해당 기간에 검수 기록이 없습니다.'), 'border-l-rose-500');

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            ${heroStat('총 검수 수량', fmt(insp.productTypeCount), 'SKU', `<span class="text-[10px] text-gray-400">총 수량 ${fmt(insp.totalInspectedQty)}개</span>`, 'text-rose-700')}
            ${heroStat('불량 수량', fmt(insp.totalDefectQty), '개')}
            ${heroStat('수량 기준 불량률', insp.qtyDefectRate.toFixed(1), '%', '', insp.qtyDefectRate >= 5 ? 'text-red-600' : 'text-gray-800')}
            ${heroStat('건수 기준 불량률', insp.countDefectRate.toFixed(1), '%', '', insp.countDefectRate >= 5 ? 'text-red-600' : 'text-gray-800')}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">⚠️ 불량 상위 제품</div>
                ${tableShell(
                    th('제품') + th('불량건수', 'right') + th('불량수량', 'right') + th('주요 불량사유'),
                    insp.topDefective.map(p => `<tr>
                        ${td(esc(p.name))}
                        ${td(`<span class="text-red-600 font-bold">${p.defectCount}</span>`, 'right')}
                        ${td(fmt(p.defectQty) + '개', 'right')}
                        ${td(esc(p.commonReason))}
                    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-gray-400 py-4">불량 없음</td></tr>',
                    'max-h-[300px]'
                )}
            </div>
            <div>
                <div class="text-xs font-bold text-gray-600 mb-2">📋 불량 사유 상위 항목</div>
                <div class="space-y-2">
                    ${insp.topReasons.map(([reason, count]) => {
                        const max = insp.topReasons[0][1] || 1;
                        return `<div>
                            <div class="flex justify-between text-xs mb-1"><span>${esc(reason)}</span><span class="font-bold text-gray-700">${count}건</span></div>
                            ${progressBar(count / max * 100, 'bg-rose-500')}
                        </div>`;
                    }).join('') || '<div class="text-xs text-gray-400 text-center py-6">불량 사유 없음</div>'}
                </div>
            </div>
        </div>
    `;
    return sectionPanel('🔍', '검수 이력', '입고 검수 품질 현황', body, 'border-l-rose-500');
}

// ============================================================
// 7. 엑셀 다운로드
// ============================================================
function downloadSettlementExcel(periodLabel, core, tp, wf, wr, att, mg, insp) {
    try {
        const rows = [
            ['구분', '항목', '값'],
            ['종합', '총 처리량(개)', Math.round(tp.totalQuantity)],
            ['종합', 'OEE(%)', core.curProd.oee.toFixed(1)],
            ['생산성·효율성', '일평균 처리량(개)', Math.round(tp.avgDailyQuantity)],
            ['생산성·효율성', '시간 활용률(%)', core.curProd.utilizationRate.toFixed(1)],
            ['생산성·효율성', '업무 효율성(%)', core.curProd.efficiencyRatio.toFixed(1)],
            ['생산성·효율성', '품질 효율(%)', core.curProd.qualityRatio.toFixed(1)],
            ...tp.taskEntries.map(t => ['업무별 처리량', t.task, Math.round(t.quantity)]),
            ['인력운영', '일평균 근무인원(명)', wf.avgActiveMembers.toFixed(1)],
            ['인력운영', '정규 인원(명)', wf.regularMemberCount],
            ['인력운영', '파트타이머(명)', wf.partTimerCount],
            ['인력운영', '연차·반차 사용(일)', wf.leaveDaysUsed.toFixed(1)],
            ['업무리포트', '활동 인원(명)', wr.memberCount],
            ['업무리포트', '수행 업무 종류(종)', wr.taskCount],
            ...LEAVE_TYPES.filter(t => att.typeCounts[t] > 0).map(t => ['근태이력', t + '(건)', att.typeCounts[t]]),
            ['경영지표', '총 매출(원)', Math.round(mg.curMgmt.revenue)],
            ['경영지표', '총 발주 건수', Math.round(mg.curMgmt.orderCount)],
            ['경영지표', '평균 재고금액(원)', Math.round(mg.curMgmt.avgInventoryAmt)],
            ['경영지표', '평균 환율(USD)', mg.curMgmt.avgUsdRate > 0 ? mg.curMgmt.avgUsdRate.toFixed(1) : ''],
            ['경영지표', '평균 환율(CNY)', mg.curMgmt.avgCnyRate > 0 ? mg.curMgmt.avgCnyRate.toFixed(1) : ''],
            ['검수이력', '총 검수 SKU(종)', insp.productTypeCount],
            ['검수이력', '총 검수 수량(개)', Math.round(insp.totalInspectedQty)],
            ['검수이력', '불량 수량(개)', Math.round(insp.totalDefectQty)],
            ['검수이력', '수량기준 불량률(%)', insp.qtyDefectRate.toFixed(1)],
            ['검수이력', '건수기준 불량률(%)', insp.countDefectRate.toFixed(1)]
        ];

        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        worksheet['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 16 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '팀 결산 보고');
        XLSX.writeFile(workbook, `팀결산보고_${periodLabel.replace(/\s/g, '')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
        console.error('결산 보고서 엑셀 다운로드 실패:', e);
        alert('엑셀 다운로드 중 오류가 발생했습니다.');
    }
}

// ============================================================
// 8. 메인 렌더 함수
// ============================================================
function buildPeriodControlsHtml() {
    const { granularity, year, sub } = _currentPeriod;
    const allYears = new Set((State.allHistoryData || []).map(d => (d.id || '').substring(0, 4)).filter(Boolean));
    allYears.add(String(year));
    const yearOptions = [...allYears].sort().reverse();

    const granBtn = (g, label) => `<button data-settle-gran="${g}" class="settle-gran-btn px-3 py-1.5 text-sm font-bold transition ${granularity === g ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}">${label}</button>`;

    let subOptions = '';
    if (granularity === 'month') {
        subOptions = Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<option value="${m}" ${sub === m ? 'selected' : ''}>${m}월</option>`).join('');
    } else if (granularity === 'quarter') {
        subOptions = [1, 2, 3, 4].map(q => `<option value="${q}" ${sub === q ? 'selected' : ''}>${q}분기</option>`).join('');
    }

    return `
        <div class="flex flex-wrap items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm print:hidden">
            <div class="flex items-center gap-2 flex-wrap">
                <div class="flex rounded-lg overflow-hidden border border-gray-300">
                    ${granBtn('month', '월')}${granBtn('quarter', '분기')}${granBtn('year', '년')}
                </div>
                <select id="settle-year-select" class="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                    ${yearOptions.map(y => `<option value="${y}" ${String(year) === y ? 'selected' : ''}>${y}년</option>`).join('')}
                </select>
                ${granularity !== 'year' ? `<select id="settle-sub-select" class="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">${subOptions}</select>` : ''}
                <button id="settle-generate-btn" class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-1.5 rounded-lg transition">📊 보고서 생성</button>
            </div>
            <div class="flex items-center gap-2">
                <span id="settle-generated-at" class="text-xs text-gray-400"></span>
                <button id="settle-download-btn" class="bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-3 py-1.5 rounded-lg transition">⬇️ 엑셀 다운로드</button>
            </div>
        </div>`;
}

function attachPeriodControlListeners(container, appConfig) {
    container.querySelectorAll('.settle-gran-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const gran = btn.dataset.settleGran;
            if (gran === _currentPeriod.granularity) return;
            if (gran === 'month') _currentPeriod = { granularity: 'month', year: _currentPeriod.year, sub: new Date().getMonth() + 1 };
            else if (gran === 'quarter') _currentPeriod = { granularity: 'quarter', year: _currentPeriod.year, sub: Math.floor(new Date().getMonth() / 3) + 1 };
            else _currentPeriod = { granularity: 'year', year: _currentPeriod.year, sub: null };
            renderSettlementReport(container, appConfig);
        });
    });

    const generateBtn = container.querySelector('#settle-generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', () => {
            const yearSel = container.querySelector('#settle-year-select');
            const subSel = container.querySelector('#settle-sub-select');
            _currentPeriod.year = Number(yearSel.value) || _currentPeriod.year;
            if (subSel) _currentPeriod.sub = Number(subSel.value) || _currentPeriod.sub;
            renderSettlementReport(container, appConfig);
        });
    }
}

export function renderSettlementReport(container, appConfig) {
    if (!container) return;
    appConfig = appConfig || State.appConfig || {};
    destroyCharts();

    const { granularity, year, sub } = _currentPeriod;
    const periodLabel = getPeriodLabel(granularity, year, sub);
    const currentDays = getFilteredDaysForPeriod(granularity, year, sub);
    const prevPeriod = getPreviousPeriod(granularity, year, sub);
    const previousDays = getFilteredDaysForPeriod(granularity, prevPeriod.year, prevPeriod.sub);
    const workingDaysCount = currentDays.filter(d => (d.workRecords || []).length > 0).length;

    const core = computeCoreMetrics(currentDays, previousDays, appConfig);
    const tp = computeThroughputSummary(currentDays, core);
    const wf = computeWorkforceSummary(currentDays, appConfig, core);
    const att = computeAttendanceSummary(currentDays);
    const wr = computeWorkReportSummary(core);
    const mg = computeManagementSummary(currentDays, previousDays, appConfig, core);
    const { from, to } = getPeriodDateRange(granularity, year, sub);
    const insp = computeInspectionSummary(_productHistoryCache, from, to);

    const prodResult = renderProductivitySection(tp, core, workingDaysCount);
    const attResult = renderAttendanceSection(att);
    const mgResult = renderManagementSection(mg);

    container.innerHTML = `
        <div class="flex items-center justify-between flex-wrap gap-2">
            <div>
                <h2 class="text-xl font-bold text-gray-800 dark:text-gray-100">🧾 팀 결산 보고 <span class="text-blue-600">· ${periodLabel}</span></h2>
                <p class="text-xs text-gray-500 mt-1">근무 기록 ${currentDays.length}일 중 실근무 ${workingDaysCount}일 기준</p>
            </div>
        </div>
        ${buildPeriodControlsHtml()}
        ${renderExecutiveSummary(core, tp, wf, att, mg, insp, periodLabel, workingDaysCount)}
        <div class="space-y-5">
            ${prodResult.html || prodResult}
            ${renderWorkforceSection(wf, core, workingDaysCount)}
            ${renderWorkReportSection(wr, workingDaysCount)}
            ${attResult.html || attResult}
            ${mgResult.html || mgResult}
            ${renderInspectionSection(insp)}
        </div>
    `;

    // 차트 인스턴스 생성 (DOM 마운트 이후)
    if (prodResult.chartId && prodResult.chartData) {
        createBarChart(prodResult.chartId, prodResult.chartData.labels, prodResult.chartData.values, '일별 처리량', '#2563eb');
    }
    if (attResult.chartId && attResult.labels && attResult.labels.length > 0) {
        createHorizontalBarChart(attResult.chartId, attResult.labels, attResult.values, '#f59e0b');
    }
    if (mgResult.chartId && mgResult.chartData) {
        createBarChart(mgResult.chartId, mgResult.chartData.labels, mgResult.chartData.values, '일별 매출', '#10b981');
    }

    const generatedAtEl = container.querySelector('#settle-generated-at');
    if (generatedAtEl) generatedAtEl.textContent = `생성: ${new Date().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}`;

    const downloadBtn = container.querySelector('#settle-download-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', () => downloadSettlementExcel(periodLabel, core, tp, wf, wr, att, mg, insp));

    attachPeriodControlListeners(container, appConfig);
}

// ============================================================
// 9. 초기화 (탭 진입 시 1회 호출)
// ============================================================
export async function initSettlementReport() {
    const container = document.getElementById('settlement-panel');
    if (!container) return;

    if (!_productHistoryCache) {
        try {
            const snapshot = await getDocs(collection(State.db, 'product_history'));
            _productHistoryCache = [];
            snapshot.forEach(d => _productHistoryCache.push({ id: d.id, ...d.data() }));
        } catch (e) {
            console.error('검수 이력(product_history) 로드 실패:', e);
            _productHistoryCache = [];
        }
    }

    renderSettlementReport(container, State.appConfig);
}
