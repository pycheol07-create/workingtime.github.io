// === js/ui-ops-plan-parts.js ===
// 📋 운영 계획 탭 — 주간·월간·목표 화면이 같이 쓰는 그리기 조각(숫자 표시·카드·과제 목록·계획 대비 실적 카드).
//   그리기만 한다(숫자는 js/lib/plan-*.js). 금액·직원 이름 없음. ⚠️ role=dialog·data-act 금지.

import { escapeHtml as esc } from './utils.js?v=202611090952';

export { esc };
export const ok = (v) => v != null && isFinite(v);
export const n0 = (v) => (ok(v) ? Math.round(v).toLocaleString() : '—');
export const n1 = (v) => (ok(v) ? (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
export const pct0 = (v) => (ok(v) ? `${Math.round(v * 100)}%` : '—');
export const signed1 = (v) => (ok(v) ? (v > 0 ? '+' : v < 0 ? '−' : '±') + n1(Math.abs(v)) : '—');
export const fmtDay = (id) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(id || ''));
    if (!m) return esc(id || '');
    const w = '일월화수목금토'[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
    return `${Number(m[2])}/${Number(m[3])}(${w})`;
};
export const card = (title, body, hint = '') => `<div class="opv-card">
    <div class="opv-card-head"><h4 class="opv-h">${esc(title)}</h4>${hint ? `<span class="opv-note">${hint}</span>` : ''}</div>
    ${body}
</div>`;
export const kpi = (label, value, unit = '', sub = '') => `<div class="opv-kpi">
    <div class="opv-kpi-label">${esc(label)}</div>
    <div class="opv-kpi-value">${value}${value === '—' || !unit ? '' : `<span class="opv-kpi-unit">${esc(unit)}</span>`}</div>
    ${sub ? `<div class="opv-note">${sub}</div>` : ''}
</div>`;

export function fillText(f) {
    const out = [];
    if (f.prep > 0) out.push(`선처리 ${n1(f.prep)}h`);
    if (f.overtime > 0) out.push(`연장 ${n1(f.overtime)}h (1인 ${n1(f.overtimePerPerson)}h)`);
    if (f.tempPeople > 0) out.push(`알바 ${f.tempPeople}명`);
    return out.join(' · ');
}

/**
 * 과제 목록. done(key) → boolean, mode: 'local'(이 브라우저) | 'doc'(확정본, 관리자 저장) | 'view'(확정본, 보기만)
 */
export function actionsHtml(actions, { done = () => false, mode = 'local', title = '할 일 (우선순위)', empty = '따로 준비할 일이 없습니다.' } = {}) {
    if (!actions.length) return card(title, `<p class="opv-note">${esc(empty)}</p>`);
    const items = actions.map(a => {
        const d = !!done(a.key);
        return `<li class="opp-act${d ? ' is-done' : ''}">
            <label class="opp-act-check"><input type="checkbox" data-plan-done="${esc(a.key)}"${d ? ' checked' : ''}${mode === 'view' ? ' disabled' : ''}> <span class="opp-act-title">${esc(a.title)}</span></label>
            <div class="opv-note">근거: ${esc(a.basis)}</div>
            <div class="opv-note">기대 효과: ${esc(a.effect)} · 기한 ${a.due ? fmtDay(a.due) : '—'} · 담당 ${esc(a.role)} · ${esc(a.rule)}</div>
        </li>`;
    }).join('');
    const hint = mode === 'local' ? '점수 = 영향 시간 × 신뢰도 × 급함 · 체크는 이 브라우저에만 남습니다(확정하면 확정본에 저장)'
        : mode === 'doc' ? '점수 = 영향 시간 × 신뢰도 × 급함 · 체크는 확정본에 저장됩니다'
            : '점수 = 영향 시간 × 신뢰도 × 급함 · 체크는 관리자만 바꿀 수 있습니다';
    return card(title, `<ol class="opp-acts">${items}</ol>`, hint);
}

/** 지난 계획 대비 실적 카드 — cmp = plan-compare planVsActual 결과, label = '지난주(11/2~11/8)' 등 */
export function compareCardHtml(cmp, label) {
    if (!cmp) return '';
    const S = cmp.summary;
    const rows = cmp.rows.map(r => `<tr>
        <td>${fmtDay(r.date)}</td><td class="r">${n1(r.planReq)}</td><td class="r">${r.recorded ? n1(r.actualRequired) : '—'}</td>
        <td class="r">${r.recorded && ok(r.reqErrPct) ? signed1(r.reqErrPct) + '%' : '—'}</td>
        <td class="r">${n0(r.planSupply)}</td><td class="r">${r.recorded ? n0(r.actualAttended) : '—'}</td>
        <td class="r">${r.recorded ? n0(r.qty) : '—'}</td><td class="r">${r.recorded ? n1(r.uph) : '—'}</td>
        <td class="r">${r.recorded ? pct0(r.fillRate) : '—'}</td></tr>`).join('');
    return card(`지난 계획 대비 실적 — ${label}`, `<div class="opv-kpis">
        ${kpi('필요 인원 오차', ok(S.reqErrPct) ? signed1(S.reqErrPct) : '—', '%', `절댓값 평균 ${ok(S.reqAbsErrPct) ? n1(S.reqAbsErrPct) + '%' : '—'}`)}
        ${kpi('출근 vs 계획 공급', ok(S.supplyErrPct) ? signed1(S.supplyErrPct) : '—', '%')}
        ${kpi('충족률(실제)', pct0(S.fillRate), '', `부족한 날 계획 ${S.planShortDays}일 · 실제 ${S.actualShortDays}일`)}
        ${kpi('지킨 과제', `${S.actionsDone}/${S.actionsTotal}`, '', `확정본 v${S.version} · 기록 ${S.recordedDays}/${S.planDays}일`)}
    </div>
    <details class="opv-fold opp-gap"><summary>날짜별</summary><div class="opv-fold-body"><div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>날짜</th><th class="r">계획 필요</th><th class="r">실제 필요</th><th class="r">오차</th><th class="r">계획 공급</th><th class="r">실제 출근</th><th class="r">처리량</th><th class="r">UPH</th><th class="r">충족률</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div></details>`, '실제 = 운영 리포트와 같은 계산(처리량 입력 전인 날은 뺌 · UPH = 처리량 ÷ 업무 기록 시간)');
}
