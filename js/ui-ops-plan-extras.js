// === js/ui-ops-plan-extras.js ===
// 📋 운영 계획 확장-3 — 개선 로드맵 섹션(주간·월간·연간 공통) + 시뮬레이터 섹션. 숫자는 js/lib/plan-roadmap.js · plan-sim.js.
//   로드맵 [실행](관리자): 운영 마일스톤 등록 창(js/ui-history-milestones.js openEditModal)을 과제 제목·종류·오늘 날짜·planTaskKey 로 연다.
//   효과: 그 planTaskKey 로 등록된 마일스톤 날짜 전후 14일 KPI(effectOf). 표본 부족이면 '판단 보류'.
//   시뮬레이터: 슬라이더 3개(인원·물량·속도) — 금액(인건비·인건비율)은 관리자만(money.canMoney), 아니면 칸 자체가 없다.
// 금액·직원 이름 없음(로드맵은 업무명·원인만). ⚠️ role=dialog·data-act 금지.

import { esc, n1, card, ok, signed1 } from './ui-ops-plan-parts.js?v=202611131118';
import { CAUSE_LABEL } from './lib/plan-roadmap.js?v=202611131118';
import { simulate, SIM_RANGE } from './lib/plan-sim.js?v=202611131118';

const won = (v) => (ok(v) ? `${Math.round(v).toLocaleString()}원` : '—');

/** 로드맵 과제 → 실행 관리 초안(이름 없음) — 분기 '2027 1분기' → '2027-Q1' */
export function roadmapDraft(it) {
    const m = /^(\d{4}) (\d)분기$/.exec(String(it.quarter || ''));
    return { kind: 'initiative', title: it.title, role: it.role, quarter: m ? `${m[1]}-Q${m[2]}` : null, due: it.due || null,
        kpi: { metric: it.kpi.name, task: it.kpi.task || null, from: it.kpi.from, target: it.kpi.to }, src: { rule: 'roadmap', roadmapKey: it.key } };
}

/** 개선 로드맵 — items = attachMilestones(buildRoadmap(...).items, ...) */
export function roadmapHtml(rm, { isAdmin = false, loading = false, makeBtn = null } = {}) {
    if (!rm || !rm.items.length) return card('개선 로드맵', '<p class="opv-note">최근 4주 손실(가용·성과·품질·기록 품질)에서 뽑을 과제가 없습니다.</p>');
    const st = (it) => {
        if (it.status !== 'running') return loading ? '<span class="opv-note">확인 중…</span>' : '<span class="opv-chip">계획</span>';
        const e = it.effect || {};
        const eff = e.status === 'ok'
            ? `효과 <b class="${esc(e.better === true ? 'opv-up' : e.better === false ? 'opv-down' : 'opv-flat')}">${esc(e.pct == null ? '—' : `${e.pct > 0 ? '+' : ''}${n1(e.pct)}%`)}</b> <span class="opv-note">(${esc(n1(e.before))} → ${esc(n1(e.after))})</span>`
            : '<span class="opv-note">효과 판단 보류(전후 14일 표본 부족)</span>';
        return `<span class="opv-chip is-ok">실행됨 ${esc(it.startedAt)}</span> ${eff}`;
    };
    const rows = rm.items.map(it => `<tr>
        <td>${it.quarter ? esc(it.quarter) : '<span class="opv-note">대기</span>'}</td>
        <td class="opp-wrap">${esc(it.title)}</td><td>${esc(CAUSE_LABEL[it.cause] || it.cause)}</td><td>${esc(it.role)}</td>
        <td class="r">${esc(n1(it.targetEffectHours))}</td>
        <td class="opp-wrap">${esc(it.kpi.name)} ${esc(ok(it.kpi.from) ? n1(it.kpi.from) : '—')} → ${esc(ok(it.kpi.to) ? n1(it.kpi.to) : '—')}</td>
        <td class="opp-wrap">${st(it)}</td>
        <td>${isAdmin && it.status !== 'running' ? `<button type="button" class="opv-btn opp-noprint" data-plan-roadmap="${esc(it.key)}" title="운영 마일스톤으로 등록하고 효과를 잽니다">실행</button>` : ''}
            ${makeBtn ? makeBtn(`roadmap:${it.key}:${it.quarter || ''}`, roadmapDraft(it)) : ''}</td></tr>`).join('');
    return card('개선 로드맵', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>분기</th><th>과제</th><th>원인</th><th>담당</th><th class="r" title="한 달 어림 — 손실 시간 × 회복 비율">효과(인시/월)</th><th>지표 지금 → 목표</th><th>상태</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <p class="opv-note">분기 배치 = 효과 ÷ 난이도 큰 순, 분기당 3개까지. 효과는 운영 마일스톤 날짜 전후 14일 비교(운영 마일스톤 화면과 따로 계산).</p>`, '최근 4주 손실에서');
}

/** 시뮬레이터 카드(슬라이더) — 결과 칸은 simResultHtml 로 채운다 */
export function simHtml(base, lever) {
    const sl = (k, label, unit, step) => {
        const [lo, hi] = SIM_RANGE[k];
        return `<label class="opp-field"><span class="opv-note">${esc(label)} <b data-sim-val="${k}">${lever[k] > 0 ? '+' : ''}${esc(lever[k])}${esc(unit)}</b></span>
            <input type="range" class="opp-range" data-sim="${k}" min="${esc(lo)}" max="${esc(hi)}" step="${esc(step)}" value="${esc(lever[k])}" aria-label="${esc(label)}"></label>`;
    };
    return `<div id="ops-plan-sim" class="opp-noprint">${card('시뮬레이터', `<div class="opp-fields">
        ${sl('staffDelta', '인원', '명', 1)}${sl('qtyPct', '물량', '%', 5)}${sl('speedPct', '처리 속도', '%', 5)}</div>
        <div id="ops-plan-sim-result" class="opp-gap">${simResultHtml(base, lever)}</div>
        <p class="opv-note">지금 계획 결과에 산식만 적용한 어림입니다(계획을 다시 계산하지 않음). OEE 는 가동 비율·속도만 반영한 근사입니다.</p>`, '기본 대비')}</div>`;
}

export function simResultHtml(base, lever) {
    if (!base || !base.rows.length) return '<p class="opv-note">계산할 행이 없습니다.</p>';
    const r = simulate(base, lever);
    const B = r.base;
    const pct = (v) => (ok(v) ? `${Math.round(v * 100)}%` : '—');
    const d = (a, b, f = (x) => n1(x), unit = '') => `${esc(a == null ? '—' : f(a) + unit)} <span class="opv-note">(기본 ${esc(b == null ? '—' : f(b) + unit)}${esc(a != null && b != null ? `, ${signed1(a - b)}` : '')})</span>`;
    const money = r.laborCost != null || (base.money && base.money.canMoney);
    return `<div class="opv-table-wrap"><table class="opv-table"><tbody>
        <tr><td>인원 충족률(메우기 전)</td><td class="r">${pct(r.fillRate)} <span class="opv-note">(기본 ${pct(B.fillRate)})</span></td></tr>
        <tr><td>필요 인원(평균)</td><td class="r">${d(r.reqFTE, B.reqFTE, n1, '명')}</td></tr>
        <tr><td>메울 시간</td><td class="r">${d(r.shortHours, B.shortHours, n1, 'h')}</td></tr>
        <tr><td>OEE(근사)</td><td class="r">${d(r.oee, B.oee, n1, '%')}</td></tr>
        ${money ? `<tr><td>인건비(관리자)</td><td class="r">${esc(won(r.laborCost))} <span class="opv-note">(기본 ${esc(won(B.laborCost))})</span></td></tr>
        <tr><td>인건비율(관리자)</td><td class="r">${esc(ok(r.laborRatio) ? `${n1(r.laborRatio * 100)}%` : '—')} <span class="opv-note">(기본 ${esc(ok(B.laborRatio) ? `${n1(B.laborRatio * 100)}%` : '—')})</span></td></tr>` : ''}
    </tbody></table></div>`;
}
