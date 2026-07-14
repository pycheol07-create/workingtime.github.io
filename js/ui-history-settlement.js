// === js/ui-history-settlement.js ===
// 🧾 팀 결산 보고: 월/분기/년 단위로 종합 인사이트·생산성·인력운영·업무리포트·근태이력·경영지표·검수이력을
// 한 화면에 요약해서 보여주는 보고서 탭. 각 섹션의 실제 계산은 기존 모듈의 재사용 함수를 그대로 사용하고,
// 이 파일은 "기간 해석 + 압축 요약 + 렌더링"만 담당한다.

import * as State from './state.js';
import { LEAVE_TYPES } from './state.js';
import { getRegularMembersForCount, formatDuration } from './utils.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
    calculateReportKPIs,
    calculateReportAggregations,
    aggregateDaysToSingleData,
    calculatePeriodThroughputs,
    calculateAdvancedProductivity,
    calculateBenchmarkOEE,
    generateProductivityDiagnosis,
    analyzeUnitCost,
    getDiffHtmlForMetric
} from './ui-history-reports-logic.js';

import { aggregateManagementData } from './ui-history-management.js';

// ============================================================
// 모듈 상태
// ============================================================
let _productHistoryCache = null; // product_history 컬렉션 캐시 (검수이력용)
let _currentPeriod = { granularity: 'month', year: new Date().getFullYear(), sub: new Date().getMonth() + 1 };

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
    // year
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
    const wageMap = { ...(appConfig.memberWages || {}) };
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

// ============================================================
// 3. 섹션별 계산 함수
// ============================================================

// 공용 핵심 지표 번들 (종합 인사이트 / 생산성·효율성 카드가 공유)
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

function computeWorkforceSummary(currentDays, appConfig, core) {
    const workingDays = currentDays.filter(d => (d.workRecords || []).length > 0);
    const avgActiveMembers = workingDays.length > 0
        ? workingDays.reduce((s, d) => s + calculateReportKPIs(d, appConfig, core.wageMap).activeMembersCount, 0) / workingDays.length
        : 0;

    const partTimerNames = new Set();
    currentDays.forEach(d => (d.partTimers || []).forEach(p => { if (p && p.name) partTimerNames.add(p.name); }));

    const leaveSeen = new Set();
    let leaveDaysUsed = 0;
    currentDays.forEach(d => (d.onLeaveMembers || []).forEach(l => {
        if (!l || !l.type || !(l.type.includes('연차') || l.type.includes('반차'))) return;
        const key = `${l.member}|${l.type}|${l.startDate || l.date || ''}|${l.endDate || ''}`;
        if (leaveSeen.has(key)) return;
        leaveSeen.add(key);
        leaveDaysUsed += countLeaveDays(l);
    }));

    return {
        avgActiveMembers,
        regularMemberCount: getRegularMembersForCount(appConfig).size,
        partTimerCount: partTimerNames.size,
        leaveDaysUsed,
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

    const topAbsenceLate = Object.entries(memberCounts)
        .map(([member, counts]) => ({ member, absence: counts['결근'] || 0, late: counts['지각'] || 0, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
        .filter(m => m.absence > 0 || m.late > 0)
        .sort((a, b) => (b.absence - a.absence) || (b.late - a.late))
        .slice(0, 5);

    return { typeCounts, topAbsenceLate };
}

function computeWorkReportSummary(core) {
    const topTasksByQty = Object.entries(core.curAggr.taskSummary)
        .map(([task, s]) => ({ task, quantity: s.quantity || 0, cost: s.cost || 0, duration: s.duration || 0 }))
        .filter(t => t.quantity > 0 || t.duration > 0)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5);

    const partRows = Object.entries(core.curAggr.partSummary)
        .map(([part, s]) => ({ part, duration: s.duration, cost: s.cost, memberCount: s.members.size }))
        .sort((a, b) => b.duration - a.duration);

    return {
        topTasksByQty,
        partRows,
        taskCount: Object.keys(core.curAggr.taskSummary).length,
        memberCount: Object.keys(core.curAggr.memberSummary || {}).length
    };
}

function computeManagementSummary(currentDays, previousDays, appConfig, core) {
    const curMgmt = aggregateManagementData(currentDays);
    const prevMgmt = aggregateManagementData(previousDays);

    let unitCost = null;
    if ((appConfig.costCalcTasks || []).length > 0) {
        const curSingle = aggregateDaysToSingleData(currentDays, 'settlement-mgmt-current');
        unitCost = analyzeUnitCost(curSingle, appConfig, core.wageMap, curMgmt.revenue);
    }

    return { curMgmt, prevMgmt, unitCost };
}

function computeInspectionSummary(productHistoryCache, from, to) {
    let totalInspectedQty = 0, totalDefectQty = 0, totalInspectionCount = 0, totalDefectCount = 0;
    const productStats = {};
    const normalValues = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];

    (productHistoryCache || []).forEach(product => {
        const pName = product.id;
        (product.logs || []).forEach(log => {
            if (!log.date || log.date < from || log.date > to) return;

            const qty = Number(log.inboundQty) || Number(log.qty) || 0;
            totalInspectionCount += 1;
            totalInspectedQty += qty;

            if (!productStats[pName]) productStats[pName] = { totalQty: 0, defectQty: 0, inspCount: 0, defectCount: 0 };
            productStats[pName].totalQty += qty;
            productStats[pName].inspCount += 1;

            let isDefect = log.status === '불량';
            if (log.defects && Array.isArray(log.defects) && log.defects.length > 0) isDefect = true;
            if (log.checklist) {
                Object.entries(log.checklist).forEach(([key, val]) => {
                    if (key !== 'thickness' && val) {
                        const cleanVal = String(val).trim();
                        if (cleanVal && !normalValues.includes(cleanVal)) isDefect = true;
                    }
                });
            }

            if (isDefect) {
                totalDefectCount += 1;
                totalDefectQty += qty;
                productStats[pName].defectCount += 1;
                productStats[pName].defectQty += qty;
            }
        });
    });

    const qtyDefectRate = totalInspectedQty > 0 ? (totalDefectQty / totalInspectedQty * 100) : 0;
    const countDefectRate = totalInspectionCount > 0 ? (totalDefectCount / totalInspectionCount * 100) : 0;

    const topDefective = Object.entries(productStats)
        .map(([name, s]) => ({ name, defectCount: s.defectCount, defectQty: s.defectQty, totalQty: s.totalQty }))
        .filter(p => p.defectCount > 0)
        .sort((a, b) => b.defectCount - a.defectCount)
        .slice(0, 5);

    return {
        totalInspectedQty, totalDefectQty, totalInspectionCount, totalDefectCount,
        qtyDefectRate, countDefectRate, topDefective,
        productTypeCount: Object.keys(productStats).length
    };
}

// ============================================================
// 4. 렌더 헬퍼
// ============================================================
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sectionCard = (icon, title, bodyHtml) => `
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm p-5 print:break-inside-avoid">
        <h3 class="text-base font-bold text-gray-800 mb-3 flex items-center gap-1.5">${icon} ${title}</h3>
        ${bodyHtml}
    </div>`;

const statBlock = (label, value, diffHtml = '') => `
    <div class="bg-gray-50 rounded-lg p-3">
        <div class="text-[11px] text-gray-500 mb-0.5">${label}</div>
        <div class="text-lg font-extrabold text-gray-800">${value}</div>
        ${diffHtml ? `<div class="mt-0.5">${diffHtml}</div>` : ''}
    </div>`;

const emptyNote = (msg) => `<div class="text-xs text-gray-400 text-center py-4">${msg}</div>`;

// ============================================================
// 5. 섹션 렌더 함수
// ============================================================
function renderInsightSection(core, workingDaysCount) {
    if (workingDaysCount === 0) return sectionCard('📊', '종합 인사이트', emptyNote('해당 기간에 업무 기록이 없습니다.'));

    const d = core.diagnosis?.diagnosis;
    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            ${statBlock('총 근무시간', formatDuration(core.curKPIs.totalDuration), getDiffHtmlForMetric('totalDuration', core.curKPIs.totalDuration, core.prevKPIs.totalDuration))}
            ${statBlock('총 인건비', Math.round(core.curKPIs.totalCost).toLocaleString() + '원', getDiffHtmlForMetric('totalCost', core.curKPIs.totalCost, core.prevKPIs.totalCost))}
            ${statBlock('총 생산량', Math.round(core.curKPIs.totalQuantity).toLocaleString() + '개', getDiffHtmlForMetric('totalQuantity', core.curKPIs.totalQuantity, core.prevKPIs.totalQuantity))}
            ${statBlock('종합 생산 효율 (OEE)', core.curProd.oee.toFixed(0) + '%', getDiffHtmlForMetric('oee', core.curProd.oee, core.prevProd.oee))}
        </div>
        ${d ? `<div class="rounded-lg border p-3 ${d.bg}"><span class="font-bold ${d.color}">${d.icon} ${d.title}</span><div class="text-xs text-gray-600 mt-1">${d.desc}</div></div>` : ''}
        ${core.diagnosis?.commentHtml ? `<div class="text-xs text-gray-600 mt-2 leading-relaxed">${core.diagnosis.commentHtml}</div>` : ''}
    `;
    return sectionCard('📊', '종합 인사이트', body);
}

function renderProductivitySection(core, workingDaysCount) {
    if (workingDaysCount === 0) return sectionCard('🚀', '생산성 및 효율성', emptyNote('해당 기간에 업무 기록이 없습니다.'));

    const p = core.curProd, pp = core.prevProd;
    const body = `
        <div class="grid grid-cols-3 gap-2 mb-3">
            ${statBlock('시간 활용률', p.utilizationRate.toFixed(0) + '%', getDiffHtmlForMetric('utilizationRate', p.utilizationRate, pp.utilizationRate))}
            ${statBlock('업무 효율성', p.efficiencyRatio.toFixed(0) + '%', getDiffHtmlForMetric('efficiencyRatio', p.efficiencyRatio, pp.efficiencyRatio))}
            ${statBlock('품질 효율', p.qualityRatio.toFixed(0) + '%', getDiffHtmlForMetric('qualityRatio', p.qualityRatio, pp.qualityRatio))}
        </div>
        <div class="grid grid-cols-3 gap-2 mb-3 text-center">
            <div class="text-xs text-gray-500">가용 손실 <b class="text-gray-700">${Math.round(p.availabilityLossCost).toLocaleString()}원</b></div>
            <div class="text-xs text-gray-500">성능 손실 <b class="text-gray-700">${Math.round(p.performanceLossCost).toLocaleString()}원</b></div>
            <div class="text-xs text-gray-500">품질 손실 <b class="text-gray-700">${Math.round(p.qualityLossCost).toLocaleString()}원</b></div>
        </div>
        ${p.topPerformanceLossTasks && p.topPerformanceLossTasks.length > 0 ? `
        <div class="text-xs text-gray-500 mb-1 mt-2">⏱️ 속도 손실 상위 업무</div>
        <div class="space-y-1">
            ${p.topPerformanceLossTasks.map(t => `<div class="flex justify-between text-xs"><span>${esc(t.task)}</span><span class="text-red-500 font-bold">-${Math.round(t.lossMinutes).toLocaleString()}분</span></div>`).join('')}
        </div>` : ''}
    `;
    return sectionCard('🚀', '생산성 및 효율성', body);
}

function renderWorkforceSection(wf, core, workingDaysCount) {
    if (workingDaysCount === 0) return sectionCard('👥', '인력 운영', emptyNote('해당 기간에 업무 기록이 없습니다.'));

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            ${statBlock('일평균 근무인원', wf.avgActiveMembers.toFixed(1) + '명')}
            ${statBlock('정규 인원', wf.regularMemberCount + '명')}
            ${statBlock('파트타이머', wf.partTimerCount + '명')}
            ${statBlock('연차·반차 사용', wf.leaveDaysUsed.toFixed(1) + '일')}
        </div>
        <div class="grid grid-cols-3 gap-2 text-center">
            <div class="text-xs text-gray-500">투입 인력 <b class="text-gray-700">${core.curProd.availableFTE.toFixed(1)} FTE</b></div>
            <div class="text-xs text-gray-500">실작업 인력 <b class="text-gray-700">${core.curProd.workedFTE.toFixed(1)} FTE</b></div>
            <div class="text-xs text-gray-500">표준 필요인력 <b class="text-gray-700">${core.curProd.requiredFTE.toFixed(1)} FTE</b></div>
        </div>
    `;
    return sectionCard('👥', '인력 운영', body);
}

function renderWorkReportSection(wr, workingDaysCount) {
    if (workingDaysCount === 0) return sectionCard('📁', '업무 리포트', emptyNote('해당 기간에 업무 기록이 없습니다.'));

    const body = `
        <div class="grid grid-cols-2 gap-2 mb-3">
            ${statBlock('활동 인원', wr.memberCount + '명')}
            ${statBlock('수행 업무 종류', wr.taskCount + '종')}
        </div>
        ${wr.topTasksByQty.length > 0 ? `
        <div class="text-xs text-gray-500 mb-1">🏆 생산량 상위 업무</div>
        <div class="space-y-1 mb-3">
            ${wr.topTasksByQty.map(t => `<div class="flex justify-between text-xs"><span>${esc(t.task)}</span><span class="font-bold text-gray-700">${Math.round(t.quantity).toLocaleString()}개</span></div>`).join('')}
        </div>` : ''}
        ${wr.partRows.length > 0 ? `
        <div class="text-xs text-gray-500 mb-1">🧑‍🤝‍🧑 파트별 투입시간</div>
        <div class="space-y-1">
            ${wr.partRows.map(p => `<div class="flex justify-between text-xs"><span>${esc(p.part)} (${p.memberCount}명)</span><span class="font-bold text-gray-700">${formatDuration(p.duration)}</span></div>`).join('')}
        </div>` : ''}
    `;
    return sectionCard('📁', '업무 리포트', body);
}

function renderAttendanceSection(att) {
    const totalEvents = Object.values(att.typeCounts).reduce((a, b) => a + b, 0);
    if (totalEvents === 0) return sectionCard('🕒', '근태 이력', emptyNote('해당 기간에 근태 기록이 없습니다.'));

    const body = `
        <div class="grid grid-cols-3 md:grid-cols-4 gap-2 mb-3">
            ${LEAVE_TYPES.filter(t => att.typeCounts[t] > 0).map(t => statBlock(t, att.typeCounts[t] + '건')).join('')}
        </div>
        ${att.topAbsenceLate.length > 0 ? `
        <div class="text-xs text-gray-500 mb-1">⚠️ 결근·지각 상위 인원</div>
        <div class="space-y-1">
            ${att.topAbsenceLate.map(m => `<div class="flex justify-between text-xs"><span>${esc(m.member)}</span><span class="text-red-500 font-bold">결근 ${m.absence} · 지각 ${m.late}</span></div>`).join('')}
        </div>` : ''}
    `;
    return sectionCard('🕒', '근태 이력', body);
}

function renderManagementSection(mg) {
    if (mg.curMgmt.revenue === 0 && mg.curMgmt.orderCount === 0) return sectionCard('💹', '경영 지표', emptyNote('해당 기간에 입력된 경영 지표가 없습니다.'));

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            ${statBlock('총 매출', Math.round(mg.curMgmt.revenue).toLocaleString() + '원', getDiffHtmlForMetric('totalCost', mg.curMgmt.revenue, mg.prevMgmt.revenue))}
            ${statBlock('총 발주 건수', Math.round(mg.curMgmt.orderCount).toLocaleString() + '건')}
            ${statBlock('평균 재고금액', Math.round(mg.curMgmt.avgInventoryAmt).toLocaleString() + '원')}
            ${statBlock('평균 환율(USD)', mg.curMgmt.avgUsdRate > 0 ? mg.curMgmt.avgUsdRate.toFixed(1) : '-')}
        </div>
        ${mg.unitCost && mg.unitCost.isValid ? `
        <div class="grid grid-cols-3 gap-2 text-center">
            <div class="text-xs text-gray-500">개당 원가 <b class="text-gray-700">${Math.round(mg.unitCost.costs.total).toLocaleString()}원</b></div>
            <div class="text-xs text-gray-500">개당 마진 <b class="text-gray-700">${Math.round(mg.unitCost.profit.margin).toLocaleString()}원</b></div>
            <div class="text-xs text-gray-500">마진율 <b class="text-gray-700">${mg.unitCost.profit.marginRate.toFixed(1)}%</b></div>
        </div>` : ''}
    `;
    return sectionCard('💹', '경영 지표', body);
}

function renderInspectionSection(insp) {
    if (insp.totalInspectionCount === 0) return sectionCard('🔍', '검수 이력', emptyNote('해당 기간에 검수 기록이 없습니다.'));

    const body = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            ${statBlock('총 검수 수량', Math.round(insp.totalInspectedQty).toLocaleString() + '개')}
            ${statBlock('불량 수량', Math.round(insp.totalDefectQty).toLocaleString() + '개')}
            ${statBlock('수량 기준 불량률', insp.qtyDefectRate.toFixed(1) + '%')}
            ${statBlock('건수 기준 불량률', insp.countDefectRate.toFixed(1) + '%')}
        </div>
        ${insp.topDefective.length > 0 ? `
        <div class="text-xs text-gray-500 mb-1">⚠️ 불량 상위 제품</div>
        <div class="space-y-1">
            ${insp.topDefective.map(p => `<div class="flex justify-between text-xs"><span>${esc(p.name)}</span><span class="text-red-500 font-bold">불량 ${p.defectCount}건 / ${Math.round(p.defectQty).toLocaleString()}개</span></div>`).join('')}
        </div>` : ''}
    `;
    return sectionCard('🔍', '검수 이력', body);
}

// ============================================================
// 6. 엑셀 다운로드
// ============================================================
function downloadSettlementExcel(periodLabel, core, wf, wr, att, mg, insp) {
    try {
        const rows = [
            ['구분', '항목', '값'],
            ['종합 인사이트', '총 근무시간(분)', Math.round(core.curKPIs.totalDuration)],
            ['종합 인사이트', '총 인건비(원)', Math.round(core.curKPIs.totalCost)],
            ['종합 인사이트', '총 생산량(개)', Math.round(core.curKPIs.totalQuantity)],
            ['종합 인사이트', 'OEE(%)', core.curProd.oee.toFixed(1)],
            ['생산성·효율성', '시간 활용률(%)', core.curProd.utilizationRate.toFixed(1)],
            ['생산성·효율성', '업무 효율성(%)', core.curProd.efficiencyRatio.toFixed(1)],
            ['생산성·효율성', '품질 효율(%)', core.curProd.qualityRatio.toFixed(1)],
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
            ['검수이력', '총 검수 수량(개)', Math.round(insp.totalInspectedQty)],
            ['검수이력', '불량 수량(개)', Math.round(insp.totalDefectQty)],
            ['검수이력', '수량기준 불량률(%)', insp.qtyDefectRate.toFixed(1)],
            ['검수이력', '건수기준 불량률(%)', insp.countDefectRate.toFixed(1)]
        ];

        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        worksheet['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 16 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '팀 결산 보고');
        XLSX.writeFile(workbook, `팀결산보고_${periodLabel.replace(/\s/g, '')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
        console.error('결산 보고서 엑셀 다운로드 실패:', e);
        alert('엑셀 다운로드 중 오류가 발생했습니다.');
    }
}

// ============================================================
// 7. 메인 렌더 함수
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

    const { granularity, year, sub } = _currentPeriod;
    const periodLabel = getPeriodLabel(granularity, year, sub);
    const currentDays = getFilteredDaysForPeriod(granularity, year, sub);
    const prevPeriod = getPreviousPeriod(granularity, year, sub);
    const previousDays = getFilteredDaysForPeriod(granularity, prevPeriod.year, prevPeriod.sub);
    const workingDaysCount = currentDays.filter(d => (d.workRecords || []).length > 0).length;

    const core = computeCoreMetrics(currentDays, previousDays, appConfig);
    const wf = computeWorkforceSummary(currentDays, appConfig, core);
    const att = computeAttendanceSummary(currentDays);
    const wr = computeWorkReportSummary(core);
    const mg = computeManagementSummary(currentDays, previousDays, appConfig, core);
    const { from, to } = getPeriodDateRange(granularity, year, sub);
    const insp = computeInspectionSummary(_productHistoryCache, from, to);

    container.innerHTML = `
        <div class="flex items-center justify-between flex-wrap gap-2">
            <div>
                <h2 class="text-xl font-bold text-gray-800 dark:text-gray-100">🧾 팀 결산 보고 <span class="text-blue-600">· ${periodLabel}</span></h2>
                <p class="text-xs text-gray-500 mt-1">기간 내 팀 운영 전체 현황 요약 (근무 기록 ${currentDays.length}일 중 실근무 ${workingDaysCount}일)</p>
            </div>
        </div>
        ${buildPeriodControlsHtml()}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${renderInsightSection(core, workingDaysCount)}
            ${renderProductivitySection(core, workingDaysCount)}
            ${renderWorkforceSection(wf, core, workingDaysCount)}
            ${renderWorkReportSection(wr, workingDaysCount)}
            ${renderAttendanceSection(att)}
            ${renderManagementSection(mg)}
            ${renderInspectionSection(insp)}
        </div>
    `;

    const generatedAtEl = container.querySelector('#settle-generated-at');
    if (generatedAtEl) generatedAtEl.textContent = `생성: ${new Date().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}`;

    const downloadBtn = container.querySelector('#settle-download-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', () => downloadSettlementExcel(periodLabel, core, wf, wr, att, mg, insp));

    attachPeriodControlListeners(container, appConfig);
}

// ============================================================
// 8. 초기화 (탭 진입 시 1회 호출)
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
