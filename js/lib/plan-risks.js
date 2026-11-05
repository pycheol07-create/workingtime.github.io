// === js/lib/plan-risks.js ===
// 운영 계획 MVP-1 — 다음 주 리스크 표. 각 줄 = {key, kind, title, likelihood, impact, score, trigger, response, owner}.
//   likelihood·impact 는 1(낮음)~3(높음), score = likelihood × impact. 문장은 제안 말투("~를 검토해 보세요").
//   owner 는 역할(관리자·팀장·각 파트 담당)만 — 직원 이름은 넣지 않는다. 금액도 없다.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-week.test.js

export const RISK_LEVELS = Object.freeze({
    leaveMin: 2,            // 휴가 몰림 — 휴무 ≥ max(2, 명부 × 20%)
    leaveRatio: 0.2,
    plannedLow: 0.5,        // 예정 물량 입력 비율이 이보다 낮으면 '예측 불확실'
    accuracyErr: 0.2,       // 지난 업무 예상 시간 오차(비율) 절댓값이 이보다 크면 '예측 불확실'
    runMin: 2,              // 연속 부족 ≥ 2 업무일
    surgeRatio: 1.2,        // 공휴일 다음 첫 업무일 수요가 그 주 다른 업무일 평균의 1.2배 이상이면 '급증'
    recordNoteCodes: Object.freeze(['missingQty', 'stdHours', 'estimated', 'capped'])
});

const fmt = (id) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(id || ''));
    if (!m) return String(id || '');
    const w = '일월화수목금토'[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
    return `${Number(m[2])}/${Number(m[3])}(${w})`;
};
const r1 = (v) => Math.round(v * 10) / 10;

/** 휴가 몰림 기준 인원 — max(2, 명부 × 20%) */
export const leaveThresholdOf = (roster) => Math.max(RISK_LEVELS.leaveMin, Math.ceil((Number(roster) || 0) * RISK_LEVELS.leaveRatio - 1e-9));

/** 휴가 몰린 날 [{date, leaveCount, threshold, short}] */
export function leaveCrowdDays(days) {
    return (days || []).filter(d => d && d.workday && d.hasRow)
        .map(d => ({ date: d.date, leaveCount: d.leaveCount, threshold: leaveThresholdOf(d.rosterCount), short: d.gap < 0 }))
        .filter(x => x.leaveCount >= x.threshold);
}

/** 공휴일 다음 첫 업무일 중 수요가 몰린 날 [{date, holidayName, demandHours, avgOther, ratio}].
 *  afterHoliday(date) = 바로 앞 쉬는 날 묶음에 공휴일이 있으면 그 이름(UI 가 업무 예상 규칙으로 넘김). */
export function holidaySurgeDays(days, afterHoliday) {
    if (typeof afterHoliday !== 'function') return [];
    const wd = (days || []).filter(d => d && d.workday && d.hasRow);
    const out = [];
    wd.forEach(d => {
        const nm = afterHoliday(d.date);
        if (!nm) return;
        const others = wd.filter(x => x.date !== d.date && x.demandHours > 0);
        const avg = others.length ? others.reduce((t, x) => t + x.demandHours, 0) / others.length : 0;
        const ratio = avg > 0 ? d.demandHours / avg : null;
        if (ratio != null && ratio >= RISK_LEVELS.surgeRatio) out.push({ date: d.date, holidayName: nm, demandHours: d.demandHours, avgOther: r1(avg), ratio });
    });
    return out;
}

/**
 * 리스크 목록.
 * @param {object} p
 * @param {Array}  p.days         plan-week dayRowOf 행
 * @param {Array}  p.runs         plan-week shortRuns
 * @param {object} p.confidence   plan-week confidenceOf
 * @param {Array}  [p.recentNotes] 최근 4주 운영 리포트 모델 notes([{code, text, n}])
 * @param {number} [p.accuracyErr] 지난 업무 예상 평균 시간 오차 절댓값(비율, 예 0.25) — 모르면 null(리스크로 세지 않는다)
 * @param {Array}  [p.surges]     holidaySurgeDays 결과
 * @param {Array}  [p.bus]        한 사람 의존 — plan-skills redactForOutput(...).bus [{task, capable, leaveDays, candidateCount}] (이름 없음)
 *                                부르는 쪽(plan-build)이 계획 기간에 그 업무 인시가 있는 것만 넘긴다(S1 과제와 같은 조건)
 *                                그 사람 휴무가 계획 기간에 있으면 점수 2배(mult)
 * @returns {Array} score 높은 순
 */
export function buildRisks({ days = [], runs = [], confidence = null, recentNotes = [], accuracyErr = null, surges = [], bus = [] } = {}) {
    const L = RISK_LEVELS;
    const out = [];

    leaveCrowdDays(days).forEach(x => out.push({
        key: `leave:${x.date}`, kind: 'leave', title: `${fmt(x.date)} 휴가 몰림`,
        likelihood: 3, impact: x.short ? 3 : 2,
        trigger: `휴무 ${x.leaveCount}명 (기준 ${x.threshold}명 이상)`,
        response: x.short ? '그날 인원이 모자랍니다 — 휴가를 다른 날로 나눌 수 있는지 검토해 보세요.' : '휴가가 겹칩니다 — 다른 날로 나눌 수 있는지 검토해 보세요.',
        owner: '팀장'
    }));

    const notes = (recentNotes || []).filter(n => n && L.recordNoteCodes.includes(n.code));
    if (notes.length) {
        const total = notes.reduce((t, n) => t + (Number(n.n) || 0), 0);
        out.push({
            key: 'records', kind: 'records', title: '기록 누락(최근 4주)',
            likelihood: 2, impact: total >= 10 ? 3 : 2,
            trigger: notes.map(n => n.text).join(' · '),
            response: '처리량·출퇴근 기록을 빠짐없이 넣도록 안내해 보세요 — 빠지면 필요 인원이 틀려집니다.',
            owner: '각 파트 담당'
        });
    }

    const conf = confidence || { ratio: 0, planned: 0, workdays: 0 };
    const lowPlanned = conf.workdays > 0 && conf.ratio < L.plannedLow;
    const badAcc = accuracyErr != null && Number.isFinite(Number(accuracyErr)) && Math.abs(Number(accuracyErr)) > L.accuracyErr;
    if (lowPlanned || badAcc) {
        const parts = [];
        if (lowPlanned) parts.push(`예정 물량 입력 ${conf.planned}/${conf.workdays}일`);
        if (badAcc) parts.push(`지난 업무 예상 시간 오차 평균 ±${Math.round(Math.abs(Number(accuracyErr)) * 100)}%`);
        out.push({
            key: 'forecast', kind: 'forecast', title: '예측 불확실',
            likelihood: lowPlanned && badAcc ? 3 : 2, impact: 2,
            trigger: parts.join(' · '),
            response: '알고 있는 물량을 업무 예상 › 계획에 넣어 두면 이 계획서가 정확해집니다.',
            owner: '각 파트 담당'
        });
    }

    (runs || []).forEach(r => out.push({
        key: `run:${r.from}`, kind: 'run', title: `${fmt(r.from)}~${fmt(r.to)} 연속 부족`,
        likelihood: 3, impact: r.dates.length >= 3 ? 3 : 2,
        trigger: `부족한 업무일 ${r.dates.length}일 연속`,
        response: '하루씩 메우기보다 주 단위 알바 묶음이나 휴가 조정을 검토해 보세요.',
        owner: '관리자'
    }));

    (surges || []).forEach(s => out.push({
        key: `surge:${s.date}`, kind: 'surge', title: `${fmt(s.date)} 공휴일 다음 날 물량 급증`,
        likelihood: 2, impact: 2,
        trigger: `${s.holidayName} 다음 첫 업무일 · 작업량 ${r1(s.demandHours)}인시(다른 날 평균의 ${r1(s.ratio)}배)`,
        response: '오전에 인원을 모아 먼저 처리하는 배치를 권합니다.',
        owner: '팀장'
    }));

    (bus || []).forEach(b => out.push({
        key: `bus:${b.task}`, kind: 'bus', title: `${b.task} 한 사람 의존`,
        likelihood: b.leaveDays > 0 ? 3 : 2, impact: b.capable === 0 ? 3 : 2, mult: b.leaveDays > 0 ? 2 : 1,
        trigger: `최근 90일 '가능' 이상 ${b.capable}명${b.leaveDays > 0 ? ` · 그 사람 계획 기간 휴무 ${b.leaveDays}일` : ''}`,
        response: `1명 추가 교육을 권합니다(후보 ${b.candidateCount}명).`,
        owner: '팀장'
    }));

    out.forEach(x => { x.score = x.likelihood * x.impact * (x.mult || 1); });
    return out.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
}
