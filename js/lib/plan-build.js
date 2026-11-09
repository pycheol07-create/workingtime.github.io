// === js/lib/plan-build.js ===
// 운영 계획 MVP-1 — 주간 계획서 모델 한 벌. 화면(js/ui-ops-plan.js)은 이 결과를 그리기만 한다.
//   buildWeekPlan(input) → { meta{from,to,confidence,basis[]}, summary[1~3줄], days[], fillTotals, actions[], risks[], meeting{} }
//   수요·공급 = 업무 예상 엔진 행(getStaffingOutlook) 그대로 → plan-week 가 주간 표로, plan-risks 가 리스크, plan-rhythm 이 회의 자료.
//   액션 규칙 W1~W7: W1 부족일 → 알바·선처리·연장, W2 여유일 → 교육·정리·당겨 하기, W3 연속 부족 → 주 단위 알바 묶음·휴가 조정,
//     W4 휴가 몰림 → 분산 요청, W5 예정 물량 입력률 < 50% → 입력 요청, W6 공휴일 다음날 급증 → 오전 집중,
//     W7 최근 4주 같은 요일 3번 이상 부족 → 고정 알바 검토. 점수 = 영향 인시 × 확신 × 급함, 같은 대상 중복 제거, 상위 10.
//   출력에 직원 이름·금액이 없다(입력도 수만 받는다 — tests/plan-week.test.js 가 JSON 으로 확인).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-week.test.js

import {
    planSettingsOf, nextWeekRange, weekDaysOf, fillMix, shortRuns, confidenceOf, addDaysStr, dowOf
} from './plan-week.js?v=202611091628';
import { buildRisks, leaveCrowdDays, holidaySurgeDays, RISK_LEVELS } from './plan-risks.js?v=202611091628';
import { buildMeeting } from './plan-rhythm.js?v=202611091628';
import { weekConfidence } from './plan-confidence.js?v=202611091628';

export const ACTION_LIMIT = 10;
const CONF_FACTOR = { high: 1, mid: 0.7, low: 0.4 };
const r1 = (v) => Math.round(v * 10) / 10;
const h1 = (v) => `${r1(v).toFixed(1)}시간`;
const fmt = (id) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(id || ''));
    return m ? `${Number(m[2])}/${Number(m[3])}(${dowOf(id)})` : String(id || '');
};
const daysBetween = (a, b) => {
    const p = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
    const d = (p(b) - p(a)) / 86400000;
    return Number.isFinite(d) ? d : null;
};
/** 기한이 주말이면 그 앞 금요일로(공휴일은 보지 않음) */
const weekdayDue = (id) => {
    const w = dowOf(id);
    return w === '토' ? addDaysStr(id, -1) : w === '일' ? addDaysStr(id, -2) : id;
};
/** 급함 — 기한까지 남은 날(오늘 기준). 지났거나 3일 안 1.0 · 7일 안 0.8 · 그 뒤 0.6 */
const urgencyOf = (today, due) => {
    const n = today && due ? daysBetween(today, due) : null;
    if (n == null) return 0.6;
    return n <= 3 ? 1 : n <= 7 ? 0.8 : 0.6;
};

/** 최근 4주 운영 리포트 모델의 일자(staffDays)에서 요일별 부족 횟수 { '월': n, … } — 처리량이 있고 필요 인원을 계산한 날만(모델 규칙과 같음) */
export function weekdayShortCounts(recentModel, shortGap = 0.5) {
    const out = {};
    const list = (recentModel && Array.isArray(recentModel.staffDays)) ? recentModel.staffDays : [];
    if (!(recentModel && recentModel.meta && recentModel.meta.hasBaseline)) return out;
    list.filter(d => d && d.required > 0 && d.qty > 0 && d.gap < -shortGap).forEach(d => {
        const w = dowOf(d.date);
        if (w) out[w] = (out[w] || 0) + 1;
    });
    return out;
}

/**
 * 주간 계획서.
 * @param {object} input
 * @param {string} input.today        'YYYY-MM-DD'
 * @param {Array}  input.outlookRows  getStaffingOutlook(…, { from, until }) 행(업무일만)
 * @param {object} [input.cfg]        appConfig — cfg.opsPlan(있으면) 설정만 읽는다
 * @param {Array}  [input.prepNames]  선처리 가능 업무의 지금 이름(UI 가 taskNameOf 로 바꿔 넘김)
 * @param {Function} [input.holidayNameOf] (date) → 공휴일 이름 | '' (시험용, 없으면 앱 공휴일표)
 * @param {Function} [input.afterHoliday]  (date) → 바로 앞 쉬는 날 묶음의 공휴일 이름 | ''
 * @param {object} [input.recentModel]   최근 4주 운영 리포트 모델(buildOpsModel) — 기록 누락·요일별 부족
 * @param {object} [input.lastWeekModel] 지난주 운영 리포트 모델(주 단위) — 회의 자료
 * @param {number} [input.accuracyErr]   지난 업무 예상 평균 시간 오차(비율) — 모르면 null
 * @param {object} [input.range]         { from, to, dates } — 없으면 today 의 다음 주
 * @param {number} [input.recordRate]    최근 8주 기록률(0~1, plan-confidence recordRateOf) — 신뢰도 v2
 * @param {Array}  [input.bus]           한 사람 의존(이름 없음 — plan-skills redactForOutput(...).bus) → 리스크 + 교육 과제 S1
 */
export function buildWeekPlan(input = {}) {
    const today = input.today || null;
    const S = planSettingsOf(input.cfg);
    const range = input.range && input.range.dates ? input.range : nextWeekRange(today);
    const days0 = weekDaysOf(range, input.outlookRows, { holidayNameOf: input.holidayNameOf, prepNames: input.prepNames || [] });
    const fill = fillMix(days0, S);
    const days = days0.map((d, i) => {
        const f = fill.days[i];
        // 다음 날 선처리에 쓴 여유는 이날 일이 된다 — 권장 투입·교육·정리 인원·남는 시간을 남은 여유로 다시 센다
        const used = d.workday && d.hasRow ? Math.max(0, d.spareHours - f.spareLeft) : 0;
        if (used > 0) {
            const hpp = d.hoursPerPerson || 8;
            const rec = Math.min(d.supplyFTE, Math.ceil(d.rawReq + used / hpp - 1e-9));
            d = { ...d, recommend: rec, spareFTE: Math.max(0, d.supplyFTE - rec), spareHours: f.spareLeft };
        }
        return {
            date: d.date, dow: d.dow, workday: d.workday, weekend: d.weekend, holiday: d.holiday, holidayName: d.holidayName,
            hasRow: d.hasRow, hasPlanned: d.hasPlanned, failed: d.failed,
            demandHours: d.demandHours, reqFTE: d.reqFTE, reqFTERounded: d.reqFTERounded, supplyFTE: d.supplyFTE,
            fillRate: d.fillRate, gap: d.gap, leaveCount: d.leaveCount, rosterCount: d.rosterCount,
            hoursPerPerson: d.hoursPerPerson, shortHours: d.shortHours, spareHours: d.spareHours, prepHours: d.prepHours,
            recommend: d.recommend, spareFTE: d.spareFTE, prepGiven: r1(used),
            fill: {
                prep: f.prep, overtime: f.overtime, overtimePerPerson: f.overtimePerPerson,
                temp: f.temp, tempPeople: f.tempPeople
            }
        };
    });
    const confidence = confidenceOf(days);
    const runs = shortRuns(days, RISK_LEVELS.runMin);
    const surges = holidaySurgeDays(days, input.afterHoliday);
    const recentNotes = (input.recentModel && Array.isArray(input.recentModel.notes)) ? input.recentModel.notes : [];
    const accuracyErr = input.accuracyErr != null && Number.isFinite(Number(input.accuracyErr)) ? Number(input.accuracyErr) : null;
    // 신뢰도 v2(plan-confidence) — 실측 오차·기록률·예정 입력. planned·workdays·ratio(예정 입력 통계)는 그대로 둔다
    Object.assign(confidence, (({ level, label, reasons, nextUpgrade }) => ({ level, label, reasons, nextUpgrade }))(weekConfidence({
        errPct: accuracyErr != null ? Math.abs(accuracyErr) * 100 : null, recordRate: input.recordRate, plannedRatio: confidence.workdays ? confidence.ratio : null
    })));
    // 다음 주 업무별 인시(업무 예상 taskHours 합) — 한 사람 의존은 다음 주에 그 업무가 있을 때만 리스크·과제(S1)
    //   보정 계획의 '계획 밖 반복 업무' 시간은 빼고 본다(riskTaskHours, 없으면 taskHours) — 확률로 붙인 시간만으로 리스크를 세우지 않게
    const weekHours = {};
    (input.outlookRows || []).forEach(r => {
        if (!r || !range.dates || !range.dates.includes(r.date)) return;
        Object.entries(r.riskTaskHours || r.taskHours || {}).forEach(([k, v]) => { weekHours[k] = (weekHours[k] || 0) + (Number(v) || 0); });
    });
    const bus = (Array.isArray(input.bus) ? input.bus : []).filter(b => b && (weekHours[b.task] || 0) > 0);
    const risks = buildRisks({ days, runs, confidence, recentNotes, accuracyErr, surges, bus });

    // ── 액션 W1~W7 ──
    const cf = CONF_FACTOR[confidence.level] || 0.4;
    const lead = S.tempLeadDays;
    const acts = [];
    const push = (a) => { a = { ...a, due: a.due ? weekdayDue(a.due) : a.due }; acts.push({ ...a, hours: r1(a.hours), score: r1(a.hours * cf * urgencyOf(today, a.due)), key: `opsplan:${range.from}:${a.rule}:${a.target}` }); };
    const work = days.filter(d => d.workday && d.hasRow);

    work.filter(d => d.gap < 0).forEach(d => {   // W1
        const f = d.fill;
        const mix = [];
        if (f.prep > 0) mix.push(`전날 선처리 ${h1(f.prep)}`);
        if (f.overtime > 0) mix.push(`연장 ${h1(f.overtime)}(1인 ${h1(f.overtimePerPerson)})`);
        if (f.tempPeople > 0) mix.push(`알바 ${f.tempPeople}명`);
        const due = f.tempPeople > 0 ? addDaysStr(d.date, -lead) : addDaysStr(d.date, -1);
        push({
            rule: 'W1', target: d.date, hours: d.shortHours, due, role: '관리자',
            title: `${fmt(d.date)} ${Math.abs(d.gap)}명 부족 — ${mix.join(' · ') || '메우기 방법'}을 검토해 보세요`,
            basis: `필요 ${d.reqFTE}명 · 공급 ${d.supplyFTE}명(휴무 ${d.leaveCount}명) · 부족 ${h1(d.shortHours)}`,
            effect: `부족 ${h1(d.shortHours)}을 메워 그날 물량을 끝낼 수 있습니다`
        });
    });
    const spareDays = work.filter(d => d.gap >= 0 && d.spareFTE >= 1);
    if (spareDays.length) {   // W2 — 여유일을 한 장으로(선처리에 쓰고 남은 여유만)
        const hrs = spareDays.reduce((t, d) => t + d.spareHours, 0);
        push({
            rule: 'W2', target: 'spare', hours: hrs, due: addDaysStr(spareDays[0].date, -1), role: '팀장',
            title: `다음 주 여유 ${spareDays.length}일(${spareDays.map(d => fmt(d.date)).join('·')}) — 교육·정리·당겨 하기를 권합니다`,
            basis: spareDays.map(d => `${fmt(d.date)} 여유 ${d.spareFTE}명`).join(' · ') + ` · 남는 시간 합 ${h1(hrs)}`,
            effect: '남는 시간을 다음 날 선처리나 교육으로 돌릴 수 있습니다'
        });
    }
    runs.forEach(r => {   // W3
        const hrs = r.dates.reduce((t, id) => t + (days.find(d => d.date === id)?.shortHours || 0), 0);
        push({
            rule: 'W3', target: r.from, hours: hrs, due: addDaysStr(r.from, -lead), role: '관리자',
            title: `${fmt(r.from)}~${fmt(r.to)} 연속 부족 — 주 단위 알바 묶음이나 휴가 조정을 검토해 보세요`,
            basis: `부족한 업무일 ${r.dates.length}일 연속 · 합계 ${h1(hrs)}`,
            effect: '하루씩 구하는 것보다 같은 사람을 이어서 쓰기 쉽습니다'
        });
    });
    leaveCrowdDays(days).forEach(x => {   // W4
        const d = days.find(y => y.date === x.date);
        push({
            rule: 'W4', target: x.date, hours: (d ? d.hoursPerPerson : 8) * (x.leaveCount - x.threshold + 1), due: addDaysStr(range.from, -3), role: '팀장',
            title: `${fmt(x.date)} 휴무 ${x.leaveCount}명 — 휴가를 다른 날로 나누는 요청을 검토해 보세요`,
            basis: `기준 ${x.threshold}명 이상(명부 20% 또는 2명)${x.short ? ' · 그날 인원 부족' : ''}`,
            effect: '그날 공급 인원이 늘어 부족이 줄어듭니다'
        });
    });
    if (confidence.workdays > 0 && confidence.ratio < RISK_LEVELS.plannedLow) {   // W5
        const unplanned = work.filter(d => !d.hasPlanned);
        push({
            rule: 'W5', target: 'planned', hours: unplanned.reduce((t, d) => t + d.demandHours, 0) * 0.2, due: addDaysStr(range.from, -3), role: '각 파트 담당',
            title: `다음 주 예정 물량 입력을 요청합니다 (지금 ${confidence.planned}/${confidence.workdays}일)`,
            basis: '예정 물량이 없는 날은 지난 실적으로 어림한 값입니다',
            effect: '계획서 신뢰도가 올라갑니다'
        });
    }
    surges.forEach(s => {   // W6
        push({
            rule: 'W6', target: s.date, hours: Math.max(0, s.demandHours - s.avgOther), due: addDaysStr(s.date, -1), role: '팀장',
            title: `${fmt(s.date)} ${s.holidayName} 다음 날 — 오전에 인원을 모아 먼저 처리하길 권합니다`,
            basis: `작업량 ${r1(s.demandHours)}인시 · 다른 업무일 평균 ${r1(s.avgOther)}인시`,
            effect: '밀린 물량을 오전에 털어 오후 출고를 지킬 수 있습니다'
        });
    });
    const wdShort = weekdayShortCounts(input.recentModel);
    const seenDow = new Set();
    work.forEach(d => {   // W7
        const n = wdShort[d.dow] || 0;
        if (n < 3 || seenDow.has(d.dow)) return;
        seenDow.add(d.dow);
        push({
            rule: 'W7', target: d.dow, hours: Math.max(d.shortHours, d.hoursPerPerson || 8), due: range.from, role: '관리자',
            title: `매주 ${d.dow}요일 고정 알바를 검토해 보세요`,
            basis: `최근 4주 ${d.dow}요일 ${n}번 부족`,
            effect: '매주 반복되는 부족을 미리 막습니다'
        });
    });
    // S1 — 한 사람 의존 업무 교육(점수 = 다음 주 그 업무 인시 × 위험(휴무 겹치면 2))
    bus.forEach(b => {
        const h = weekHours[b.task] || 0;
        if (!(h > 0)) return;
        push({
            rule: 'S1', target: b.task, hours: h * (b.leaveDays > 0 ? 2 : 1), due: range.from, role: '팀장',
            title: `${b.task} 업무 가능 인원 ${b.capable}명 — 1명 추가 교육을 권합니다(후보 ${b.candidateCount}명)`,
            basis: `최근 90일 '가능' 이상 ${b.capable}명${b.leaveDays > 0 ? ` · 그 사람 다음 주 휴무 ${b.leaveDays}일` : ''} · 다음 주 ${h1(h)}`,
            effect: '한 사람이 빠져도 업무가 멈추지 않습니다'
        });
    });
    const uniq = new Map();
    acts.forEach(a => { const p = uniq.get(a.key); if (!p || a.score > p.score) uniq.set(a.key, a); });
    const actions = [...uniq.values()].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).slice(0, ACTION_LIMIT);

    // ── 요약 1~3줄 ──
    const shortN = work.filter(d => d.gap < 0).length;
    const spareN = work.filter(d => d.gap >= 0 && d.spareFTE >= 1).length;
    const T = fill.totals;
    const summary = [];
    if (!work.length) summary.push(`다음 주(${fmt(range.from)}~${fmt(range.to)}) 계산할 업무일이 없습니다.`);
    else {
        summary.push(`다음 주(${fmt(range.from)}~${fmt(range.to)}) 업무일 ${work.length}일 중 부족 ${shortN}일 · 여유 ${spareN}일입니다.`);
        if (T.need > 0) {
            const mix = [];
            if (T.prep > 0) mix.push(`선처리 ${h1(T.prep)}`);
            if (T.overtime > 0) mix.push(`연장 ${h1(T.overtime)}`);
            if (T.tempPeople > 0) mix.push(`알바 ${T.tempPeople}명·일`);
            summary.push(`부족 ${h1(T.need)}은 ${mix.join(' · ')}로 메우는 것을 검토해 보세요.`);
        } else summary.push('부족한 날이 없습니다 — 여유 인원은 교육·정리에 돌리는 것을 권합니다.');
    }
    summary.push(`신뢰도 ${confidence.label} — 예정 물량 입력 ${confidence.planned}/${confidence.workdays}일.`);

    const meeting = buildMeeting({ lastWeekModel: input.lastWeekModel || null, days, fill, risks, range, today, tempLeadDays: lead });

    return {
        meta: {
            from: range.from, to: range.to, today,
            confidence,
            settings: {
                overtimeDailyMax: S.overtimeDailyMax, overtimeWeeklyMax: S.overtimeWeeklyMax, overtimePremium: S.overtimePremium,
                tempLeadDays: S.tempLeadDays, stdHours: S.stdHours
            },
            notes: accuracyErr == null ? ['예측 정확도 미확인 — 비교할 지난 계획 스냅샷이 없거나 읽지 못해 지난 예상 오차를 리스크에 넣지 못했습니다.'] : [],
            basis: [
                '필요·공급·과부족 = 업무 예상과 같은 계산(인력 탭 \'앞으로 인원 수급\' 표와 같은 숫자)',
                `예정 물량 ${confidence.planned}/${confidence.workdays}일 · 나머지는 지난 실적으로 어림`,
                '공급 = 재직 인원 − 그날 휴무 − 관리자 개별업무 인원',
                `메우기 순서: 전날 선처리 → 연장(1인 하루 ${S.overtimeDailyMax}시간·주 ${S.overtimeWeeklyMax}시간까지) → 알바(1인일 ${S.stdHours}시간, 요청 후 ${S.tempLeadDays}일)`
            ]
        },
        summary: summary.slice(0, 3),
        days,
        fillTotals: { ...T, leadDays: fill.leadDays },
        actions,
        risks,
        meeting
    };
}
