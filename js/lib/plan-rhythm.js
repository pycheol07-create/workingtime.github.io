// === js/lib/plan-rhythm.js ===
// 운영 계획 MVP-1 — 주간 회의 자료 모델(지난주 실적 · 다음 주 날짜별 부족/여유 · 결정할 것 · 상위 리스크 3 · 다음 일정).
//   지난주 실적은 운영 리포트 모델(js/lib/ops-view-model.js buildOpsModel, 주 단위)의 숫자를 그대로 옮긴다 — 다시 계산하지 않는다.
//   금액·직원 이름 없음.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-week.test.js

import { addDaysStr } from './plan-week.js?v=202611100920';

const fmt = (id) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(id || ''));
    if (!m) return String(id || '');
    const w = '일월화수목금토'[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
    return `${Number(m[2])}/${Number(m[3])}(${w})`;
};
const fin = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

/** 운영 리포트 모델(주) → 지난주 실적 칸. 모델이 없거나 비면 null. */
export function lastWeekOf(opsModel) {
    if (!opsModel || !opsModel.meta || opsModel.meta.empty) return null;
    const H = Object.fromEntries((opsModel.headline || []).map(h => [h.key, h]));
    const S = opsModel.staffing || {};
    const att = fin(S.attended), req = fin(S.required);
    return {
        from: opsModel.meta.from, to: opsModel.meta.to, operatingDays: opsModel.meta.operatingDays,
        qty: fin(H.qty && H.qty.value), qtyPerDay: fin(H.qty && H.qty.perDay),
        uph: fin(H.uph && H.uph.value), oee: fin(H.oee && H.oee.value),
        attended: att, required: req,
        fillRate: att != null && req != null && req > 0 ? Math.min(1, att / req) : null,
        shortDays: opsModel.problems ? opsModel.problems.shortDayCount : null
    };
}

/** 다음 주 날짜별 한 줄 — off(쉬는 날)·short(부족)·spare(여유 ≥ 1명)·ok·none(숫자 없음) */
export function weekStatusOf(days) {
    return (days || []).map(d => {
        let status = 'ok';
        if (!d.workday) status = 'off';
        else if (!d.hasRow) status = 'none';
        else if (d.gap < 0) status = 'short';
        else if (d.spareFTE >= 1) status = 'spare';
        return { date: d.date, dow: d.dow, status, gap: d.gap, spareFTE: d.spareFTE, holidayName: d.holidayName || '' };
    });
}

/**
 * 회의 자료.
 * @param {object} p
 * @param {object} [p.lastWeekModel] 운영 리포트 모델(지난주, 주 단위)
 * @param {Array}  p.days    plan-week 행
 * @param {object} p.fill    plan-week fillMix 결과
 * @param {Array}  p.risks   plan-risks buildRisks 결과
 * @param {object} p.range   { from, to }
 * @param {string} p.today
 * @param {number} [p.tempLeadDays]
 */
export function buildMeeting({ lastWeekModel = null, days = [], fill = null, risks = [], range = {}, today = null, tempLeadDays = 3 } = {}) {
    const decisions = [];
    const fd = (fill && fill.days) || [];
    fd.filter(x => x.tempPeople > 0).forEach(x => {
        let due = addDaysStr(x.date, -tempLeadDays);
        const w = due ? new Date(`${due}T00:00:00`).getDay() : 1;
        if (w === 6) due = addDaysStr(due, -1); else if (w === 0) due = addDaysStr(due, -2);   // 주말이면 앞 금요일
        decisions.push({
            key: `temp:${x.date}`, kind: 'temp',
            text: `${fmt(x.date)} 알바 ${x.tempPeople}명 요청 여부`,
            due, late: !!(today && due && due < today)
        });
    });
    (risks || []).filter(r => r.kind === 'leave').forEach(r => decisions.push({
        key: `leave:${r.key}`, kind: 'leave', text: `${r.title} — 휴가 조정 여부`, due: range.from ? addDaysStr(range.from, -3) : null, late: !!(today && range.from && addDaysStr(range.from, -3) < today)
    }));
    const schedule = [
        { when: '매주 월요일 오전', what: '주간 계획서 확인(이 화면) · 지난주 실적 돌아보기' }
    ];
    const firstTemp = decisions.filter(d => d.kind === 'temp').map(d => d.due).filter(Boolean).sort()[0];
    if (firstTemp) schedule.push({ when: `${fmt(firstTemp)}까지`, what: `첫 알바 요청(투입 ${tempLeadDays}일 전)` });
    if (range.from) schedule.push({ when: `${fmt(addDaysStr(range.from, -3))}까지`, what: '다음 주 예정 물량 입력(업무 예상 › 계획)' });
    return {
        lastWeek: lastWeekOf(lastWeekModel),
        week: weekStatusOf(days),
        decisions,
        topRisks: (risks || []).slice(0, 3).map(r => ({ key: r.key, title: r.title, trigger: r.trigger, response: r.response, owner: r.owner })),
        schedule
    };
}
