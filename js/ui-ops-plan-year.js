// === js/ui-ops-plan-year.js ===
// 📋 운영 계획 확장-3 — 연간 계획서(내년 1~12월): 입력 모으기 + 그리기. 숫자는 js/lib/plan-year.js buildYearPlan.
//   공급의 휴무 비율 = 작년 각 달 업무일의 (휴무 수 ÷ 명부) 평균 — 업무 예상과 같은 휴무 계산(availableStaffOf, 수만, 근태 읽기만).
//   성수기 준비 기간 = 관리자 비용 설정(채용 + 교육 주)이 있으면 그것, 없으면 6주.
//   금액 없음(연간 인건비·매출은 js/ui-ops-plan-budget.js — 관리자만). ⚠️ role=dialog·data-act 금지.

import * as State from './state.js?v=202611091342';
import { getRegularMembersForCount } from './utils.js?v=202611091342';
import { aliasHistoryView } from './lib/task-alias-view.js?v=202611091342';
import { baselineSpeeds, normalizedUtilization } from './lib/ops-metrics.js?v=202611091342';
import { buildYearPlan } from './lib/plan-year.js?v=202611091342';
import { addDaysStr } from './lib/plan-week.js?v=202611091342';
import { availableStaffOf } from './ui-history-prediction.js?v=202611091342';
import { esc, n1, card } from './ui-ops-plan-parts.js?v=202611091342';

/** 월 요약 띠 — 몇 달이 있나, 관리자는 [월 요약 다시 만들기](달 고르기) */
function monthlyBar(monthlies, months, isAdmin) {
    const n = monthlies == null ? null : monthlies.length;
    const have = new Set((monthlies || []).map(m => m.ym));
    const opts = months.slice().reverse().map(ym => `<option value="${ym}">${ym}${have.has(ym) ? '' : ' (없음)'}</option>`).join('');
    return `<p class="opv-note">월 요약(13개월 넘는 비교용): ${n == null ? '불러오는 중…' : `${n}개월`}${isAdmin ? ` <span class="opp-noprint">· <select id="ops-plan-monthly-ym" class="opp-inp opp-sel" aria-label="다시 만들 달">${opts}</select> <button type="button" id="ops-plan-monthly-rebuild" class="opv-btn">월 요약 다시 만들기</button></span>` : ''}</p>`;
}

/** 작년(최근 12개월) 달별 하루 휴무 비율 { 1..12: 0~1 } — 수만 */
function leaveRates(today) {
    const acc = {};
    for (let i = 1; i <= 365; i++) {
        const d = addDaysStr(today, -i);
        const w = new Date(`${d}T00:00:00`).getDay();
        if (w === 0 || w === 6) continue;
        const s = availableStaffOf(d);
        if (!s || !(s.roster > 0)) continue;
        const m = Number(d.slice(5, 7));
        const a = acc[m] || (acc[m] = { sum: 0, n: 0 });
        a.sum += s.onLeave / s.roster; a.n++;
    }
    const out = {};
    Object.entries(acc).forEach(([m, a]) => { if (a.n) out[m] = a.sum / a.n; });
    return out;
}

/** 연간 계획 입력 → buildYearPlan. leadWeeks = 관리자 비용 설정(채용 + 교육 주) 또는 null, monthlies = 월 요약(OpsMonthly) 목록 */
export function computeYearPlan(today, cfgPlan, { leadWeeks = null, monthlies = [], year = null } = {}) {
    const cfg = cfgPlan || State.appConfig || {};
    const view = aliasHistoryView(State.allHistoryData || [], cfg) || [];
    return buildYearPlan({
        allDays: view, today, cfg, speeds: baselineSpeeds(view, { skipDate: today }), utilization: normalizedUtilization(cfg),
        roster: getRegularMembersForCount(cfg, today).size, leaveRate: leaveRates(today), leadWeeks, monthlies, year
    });
}

export function yearBodyHtml(p, { isAdmin = false, monthlies = null, months = [] } = {}) {
    const band = `<p class="opv-notes"><b>기록 ${p.meta.monthsKnown || 0}개월 기준·참고용</b> — 신뢰도 ${esc(p.meta.confidence.label)}. 성장은 ${p.meta.growthKind === 'yoy' ? '전년 같은 달 대비' : '추정(같은 달 비교 아님)'}이고 퇴사 예정은 반영하지 못합니다.</p>`
        + monthlyBar(monthlies, months, isAdmin);
    if (p.meta.insufficient) {
        return band + card('연간 계획(내년)', `<p class="opv-note">1년치 기록 부족 — 연간은 참고용, 기록 유지. 최근 12개월 운영일 ${p.meta.opDays}일(기준 240일)이라 달별 숫자를 내지 않습니다.</p>`);
    }
    const rows = p.months.map(m => `<tr class="${m.gap != null && m.gap < -0.5 ? 'is-short' : ''}">
        <td>${m.m}월</td><td class="r">${m.workdays}</td>
        <td class="r">${m.index == null ? '<span class="opv-note" title="그 달 운영일이 15일 미만 — 지수 1 로 계산">빈 달</span>' : n1(m.index)}</td>
        <td class="r">${n1(m.reqFTE)}</td><td class="r">${n1(m.supplyFTE)}</td>
        <td class="r"><b class="${m.gap < -0.5 ? 'opv-down' : m.gap > 1 ? 'opv-up' : 'opv-flat'}">${m.gap > 0 ? '+' : ''}${n1(m.gap)}</b></td>
        <td>${m.peak ? '<span class="opv-chip is-risk">성수기</span>' : m.offpeak ? '<span class="opv-chip is-ok">비수기</span>' : ''}</td></tr>`).join('');
    const q = p.meta.quarters.map(x => (x.uph == null ? '—' : n1(x.uph))).join(' → ');
    return band + card('달별 계획(어림)', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>달</th><th class="r">업무일</th><th class="r" title="그 달 하루 평균 처리량 ÷ 12개월 평균">월 지수</th><th class="r">필요(명)</th><th class="r" title="지금 재직 정규 − 작년 같은 달 휴무 비율">공급(명)</th><th class="r">차이</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <p class="opv-note">성장 ${p.meta.growth == null ? '추정 불가' : `${n1((p.meta.growth - 1) * 100)}%(추정, 계산에는 ${n1(p.meta.growthUsed)}배)`} · 분기 UPH ${esc(q)} · 지금 명부 ${p.meta.roster}명</p>`,
    `최근 12개월 운영일 ${p.meta.opDays}일`);
}
