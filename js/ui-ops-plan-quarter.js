// === js/ui-ops-plan-quarter.js ===
// 📋 운영 계획 v2 D2 — 분기 계획서(다음 분기) 그리기. 숫자는 js/lib/plan-quarter.js buildQuarterPlan(연간·로드맵·자동화·데이터 관리를 모은 것).
//   [분기 확정]은 운영 계획 머리 줄의 [계획 확정](OpsPlan/quarter_YYYY-Qn). 금액·이름 없음. ⚠️ role=dialog·data-act 금지.

import { esc, n1, card, fmtDay, ok } from './ui-ops-plan-parts.js?v=202611091628';

const SRC = { goals: '목표 연결(분기)', goalsYear: '목표 연결(연)', targets: '운영 목표(연)', none: '없음' };
const KIND = { year: '연간 과제', roadmap: '개선 로드맵', auto: '자동화', data: '데이터 관리' };

export function quarterBodyHtml(q, { done = () => false, makeBtn = null, itemsHtml = '' } = {}) {
    const obj = q.objectives.map(o => `<tr><td>${esc(o.label)}</td><td class="r">${ok(o.current) ? n1(o.current) : '—'}<span class="opv-note"> ${esc(o.unit)}</span></td>
        <td class="r">${ok(o.target) ? n1(o.target) : '—'}</td><td class="opv-note">${esc(SRC[o.source] || '')}</td>
        <td><div class="opp-bar" title="지금 ÷ 목표"><span style="width:${ok(o.target) && ok(o.current) && o.target > 0 ? Math.min(100, Math.round(o.current / o.target * 100)) : 0}%"></span></div></td></tr>`).join('');
    const init = q.initiatives.length ? `<ol class="opp-acts">${q.initiatives.map(i => `<li class="opp-act${done(i.key) ? ' is-done' : ''}">
        <span class="opp-act-title">${esc(i.title)}</span> ${makeBtn ? makeBtn(`quarter:${q.meta.key}:${i.key}`, { kind: i.kind === 'auto' ? 'auto' : i.kind === 'data' ? 'data' : 'initiative', title: i.title, role: i.role, quarter: q.meta.key, due: i.due, src: { rule: 'quarter' } }) : ''}
        <div class="opv-note">${esc(KIND[i.kind] || i.kind)} · 담당 ${esc(i.role)} · 기한 ${i.due ? fmtDay(i.due) : '—'}</div></li>`).join('')}</ol>`
        : '<p class="opv-note">이 분기에 배치된 과제가 없습니다.</p>';
    const st = q.staffing.map(s => `<tr class="${s.gap != null && s.gap < -0.5 ? 'is-short' : ''}"><td>${esc(s.month)}</td>
        <td class="r">${s.index == null ? '—' : n1(s.index)}</td><td class="r">${s.reqFTE == null ? '—' : n1(s.reqFTE)}</td><td class="r">${s.supplyFTE == null ? '—' : n1(s.supplyFTE)}</td>
        <td class="r">${s.gap == null ? '—' : (s.gap > 0 ? '+' : '') + n1(s.gap)}</td><td>${s.hireStartBy ? `채용 시작 ${fmtDay(s.hireStartBy)}` : ''}</td></tr>`).join('');
    return `
        ${card('분기 목표', `<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>지표</th><th class="r">지금(최근 8주)</th><th class="r">목표</th><th>목표 출처</th><th>진행</th></tr></thead>
            <tbody>${obj}</tbody></table></div><p class="opv-note">목표 연결(연 → 분기·월 나누기)은 연간 계획서 4장 [목표 연결 편집](관리자)에서 — 없으면 운영 목표(연)를 씁니다.</p>`)}
        ${card('핵심 과제', init, '연간 과제·개선 로드맵·자동화·데이터 관리에서 이 분기 것 5개까지')}
        ${card('월별 인력', `<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>달</th><th class="r">월 지수</th><th class="r">필요(명)</th><th class="r">공급(명)</th><th class="r">차이</th><th></th></tr></thead>
            <tbody>${st}</tbody></table></div>${q.meta.staffingFromYear ? '' : '<p class="opv-note">연간 계획의 달 숫자(1년치 기록)가 있어야 채워집니다.</p>'}`)}
        ${itemsHtml}
        ${card('주별 볼 숫자', `<ul class="opv-diag">${q.kpiWeekly.map(k => `<li><span class="opv-dot"></span><span>${esc(k.label)}</span></li>`).join('')}</ul>`, '주간 회의에서 매주 확인')}`;
}
