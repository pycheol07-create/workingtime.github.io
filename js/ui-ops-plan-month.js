// === js/ui-ops-plan-month.js ===
// 📋 운영 계획 — 월간 계획서(다음 달): 입력 모으기 + 그리기. 숫자는 js/lib/plan-month.js buildMonthPlan.
//   추세 = 물량 추세 예측(analysis-logic predictFutureTrends trend.deliveryFactor), 공급 = 업무 예상 가용 인원(수만).
//   금액·직원 이름 없음(담당 변경 과제도 업무 이름만). ⚠️ role=dialog·data-act 금지.

import * as State from './state.js?v=202611091406';
import { aliasHistoryView } from './lib/task-alias-view.js?v=202611091406';
import { buildOpsModel } from './lib/ops-view-model.js?v=202611091406';
import { baselineSpeeds, normalizedUtilization } from './lib/ops-metrics.js?v=202611091406';
import { taskNameOf, TASK } from './lib/task-ids.js?v=202611091406';
import { buildMonthPlan, ownerDropsOf, nextMonthRange } from './lib/plan-month.js?v=202611091406';
import { planSettingsOf, addDaysStr, OVERTIME_LAW_NOTE } from './lib/plan-week.js?v=202611091406';
import { predictFutureTrends } from './analysis-logic.js?v=202611091406';
import { availableStaffOf } from './ui-history-prediction.js?v=202611091406';
import { esc, n0, n1, pct0, fmtDay, card, kpi } from './ui-ops-plan-parts.js?v=202611091406';

/** 월간 계획 입력 모으기 → buildMonthPlan. models = { recentModel, prevModel, baseModel } (주간 쪽과 같이 씀), confirmedErrs = 지난 확정본 대비 오차(plan-compare monthErrsOf) */
export function computeMonthPlan(today, models, cfgPlan = null, confirmedErrs = []) {
    const cfg = cfgPlan || State.appConfig || {};   // cfgPlan = 설정 + OpsPlan/settings(연장 한도 등)
    const view = aliasHistoryView(State.allHistoryData || [], cfg) || [];
    const S = planSettingsOf(cfg);
    let trend = 1;
    try { const t = predictFutureTrends(view); trend = t && t.trend && Number(t.trend.deliveryFactor) > 0 ? Number(t.trend.deliveryFactor) : 1; }
    catch (e) { trend = 1; }
    let ownerDrops = [];
    try { ownerDrops = ownerDropsOf(view, { today, excludeTasks: [taskNameOf(TASK.admin, cfg)] }); }
    catch (e) { console.warn('운영 계획 담당 변경 비교 실패:', e && e.message); }
    const base = models.baseModel;
    const H = base ? Object.fromEntries((base.headline || []).map(h => [h.key, h])) : {};
    return buildMonthPlan({
        today, cfg, history: view, range: nextMonthRange(today),
        speeds: baselineSpeeds(view, { skipDate: today }), utilization: normalizedUtilization(cfg),
        trendFactor: trend, supplyOf: availableStaffOf,
        prepNames: S.prepTaskIds.map(id => taskNameOf(id, cfg)).filter(Boolean),
        recentModel: models.recentModel, prevModel: models.prevModel,
        baseQtyPerDay: H.qty ? H.qty.perDay : null, ownerDrops, confirmedErrs
    });
}

/** 지난달 실제(운영 리포트 모델 staffDays) — 계획 대비 실적용 */
export function lastMonthKeyOf(today) {
    const m = /^(\d{4})-(\d{2})/.exec(today || '');
    if (!m) return null;
    let y = Number(m[1]), mo = Number(m[2]) - 1;
    if (mo < 1) { y--; mo = 12; }
    return `${y}-${String(mo).padStart(2, '0')}`;
}

export function monthBodyHtml(p) {
    const T = p.fillTotals, S = p.meta.settings;
    const weeks = p.weeks.map(w => `<tr class="${w.shortDays ? 'is-short' : ''}">
        <td>${fmtDay(w.from)} ~ ${fmtDay(w.to)}</td><td class="r">${w.workdays}</td><td class="r">${n1(w.reqAvg)}</td><td class="r">${n1(w.supplyAvg)}</td>
        <td class="r">${w.shortDays ? `<b class="opv-down">${w.shortDays}일</b>` : '0'}</td><td class="r">${n1(w.need)}</td>
        <td>${[w.fill.prep > 0 ? `선처리 ${n1(w.fill.prep)}h` : '', w.fill.overtime > 0 ? `연장 ${n1(w.fill.overtime)}h` : '', w.fill.tempPeople > 0 ? `알바 ${w.fill.tempPeople}인일` : ''].filter(Boolean).join(' · ') || '—'}</td>
        <td>${w.leaveCrowd.length ? `<span class="opv-chip is-warn">휴가 몰림 ${w.leaveCrowd.length}일</span>` : ''}</td></tr>`).join('');
    const dayRows = p.days.map(d => {
        if (!d.workday) return `<tr class="opp-off"><td>${fmtDay(d.date)}</td><td colspan="6" class="opv-note">${d.holiday ? esc(d.holidayName || '공휴일') : '주말'}</td></tr>`;
        if (!d.hasRow) return `<tr><td>${fmtDay(d.date)}</td><td colspan="6" class="opv-note">기록이 모자라 숫자가 없습니다</td></tr>`;
        const gapTxt = d.gap === 0 ? '적정' : d.gap > 0 ? `+${d.gap}명` : `${d.gap}명`;
        return `<tr class="${d.gap < 0 ? 'is-short' : ''}"><td>${fmtDay(d.date)}</td><td class="r">${n0(d.qty)}</td><td class="r">${n1(d.reqFTE)}</td>
            <td class="r">${d.supplyFTE}명${d.leaveCount ? ` <span class="opv-note">(휴무 ${d.leaveCount})</span>` : ''}</td>
            <td class="r"><b class="${d.gap < 0 ? 'opv-down' : d.gap > 0 ? 'opv-up' : 'opv-flat'}">${gapTxt}</b></td><td class="r">${pct0(d.fillRate)}</td>
            <td class="r">${d.recommend}명${d.spareFTE > 0 ? ` <span class="opv-note">(교육·정리 ${d.spareFTE})</span>` : ''}</td></tr>`;
    }).join('');
    return `
        ${card('주차별 계획', `<div class="opv-table-wrap"><table class="opv-table">
            <thead><tr><th>주</th><th class="r">업무일</th><th class="r">필요 평균</th><th class="r">공급 평균</th><th class="r">부족한 날</th><th class="r">부족(h)</th><th>메우기</th><th></th></tr></thead>
            <tbody>${weeks}</tbody></table></div>`, `추세 ${n1(p.meta.trendFactor)} · 계절 ${p.meta.season.used ? n1(p.meta.season.ratio) : '1(작년 기록 부족)'}`)}
        <details class="opv-fold"><summary>일별 계획 <span class="opv-fold-hint">예상 처리량·필요·공급·과부족</span></summary><div class="opv-fold-body"><div class="opv-table-wrap"><table class="opv-table">
            <thead><tr><th>날짜</th><th class="r">예상 처리량</th><th class="r">필요</th><th class="r">공급</th><th class="r">과부족</th><th class="r">충족률</th><th class="r">권장 투입</th></tr></thead>
            <tbody>${dayRows}</tbody></table></div></div></details>
        ${card('부족 메우기 합계', `<div class="opv-kpis">
            ${kpi('부족 합계', n1(T.need), '시간')}
            ${kpi('① 전날 선처리', n1(T.prep), '시간', '준비 기간 0일')}
            ${kpi('② 연장', n1(T.overtime), '시간', `주마다 1인 ${n1(S.overtimeWeeklyMax)}시간까지`)}
            ${kpi('③ 알바', n0(T.tempPeople), '인일', `${n1(T.temp)}시간 · 요청 후 ${n0(S.tempLeadDays)}일`)}
        </div><p class="opv-note opp-law">${esc(OVERTIME_LAW_NOTE)}</p>
        <p class="opv-note">지금 기준: 1인 하루 연장 ${n1(S.overtimeDailyMax)}시간 · 주 ${n1(S.overtimeWeeklyMax)}시간, 알바 1인일 ${n1(S.stdHours)}시간(관리자 [비용·설정]에서 바꿈).</p>`,
        '주마다 선처리 → 연장 → 알바 · 시간·인원만')}`;
}

export const monthRangeLabel = (p) => `${fmtDay(p.meta.from)} ~ ${fmtDay(p.meta.to)}`;
export { addDaysStr };
