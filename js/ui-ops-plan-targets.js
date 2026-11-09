// === js/ui-ops-plan-targets.js ===
// 📋 운영 계획 — 목표 카드('현재 · 목표 · 차이 · 메우는 수단') + 목표 설정 겹침 창(#ops-plan-targets).
//   숫자는 js/lib/plan-targets.js. 저장은 관리자만(js/ops-plan-store.js saveTargets — 규칙도 관리자만). 다른 사람은 보기만.
//   인건비율은 돈 단계에서 — 이 창에 칸이 없다.
// ⚠️ role=dialog·data-act 금지(업무마감봇 선택자) — 겹침 창은 보통 영역(section)이다.

import { esc, n1, signed1, card, ok } from './ui-ops-plan-parts.js?v=202611091150';
import { TARGET_FIELDS, ADMIN_TARGET_FIELDS, HORIZONS, cleanTargetSet } from './lib/plan-targets.js?v=202611091150';
import { saveTargets } from './ops-plan-store.js?v=202611091150';
import { showToast } from './utils.js?v=202611091150';
import { higherOpenThan } from './modal-above.js?v=202611091150';

const $ = (id) => document.getElementById(id);
const SRC_TXT = { default: '제안', saved: '저장', override: '이 기간' };
const H_LABEL = { week: '주간', month: '월간', year: '연간' };
const F_LABEL = { qtyPerDay: '처리량(하루, 기준선)', uph: 'UPH(개/시)', oee: 'OEE(%)', fillRate: '인원 충족률(%)', effPct: '효율(%)', laborRatio: '인건비율(%)' };
// 인건비율은 관리자만 본다(확장-2)
const fieldsFor = (isAdmin) => TARGET_FIELDS.filter(f => isAdmin || !ADMIN_TARGET_FIELDS.includes(f));

/** 목표 카드 — rows = gapRows(...), src = targetsFor(...).src, note = 불러오기 상태 문구 */
export function targetsCardHtml(rows, src, { note = '', isAdmin = false } = {}) {
    const body = rows.map(r => `<tr>
        <td>${esc(r.label)}${r.baseline ? ' <span class="opv-chip">기준선</span>' : ''}</td>
        <td class="r">${ok(r.current) ? n1(r.current) : '—'}<span class="opv-note"> ${esc(r.unit)}</span></td>
        <td class="r">${ok(r.target) ? n1(r.target) : '—'}${src && src[r.key] ? ` <span class="opv-note">(${SRC_TXT[src[r.key]] || ''})</span>` : ''}</td>
        <td class="r">${r.baseline ? '—' : ok(r.diff) ? signed1(r.diff) : '—'}${!r.baseline && ok(r.hours) ? `<div class="opv-note">≈ ${n1(r.hours)}인시</div>` : ''}</td>
        <td class="opp-wrap">${esc(r.means)}</td></tr>`).join('');
    return card('목표', `${note ? `<p class="opv-note">${esc(note)}</p>` : ''}<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>지표</th><th class="r">현재(최근 8주)</th><th class="r">목표</th><th class="r" title="목표 − 현재, 아래는 그 차이를 이 기간 시간으로 바꾼 값">차이</th><th>차이를 메우는 수단</th></tr></thead>
        <tbody>${body}</tbody></table></div>
        <p class="opv-note">인원 충족률의 '현재'는 이 계획 기간 예측입니다. 인건비율 목표는 돈 단계에서 다룹니다.</p>`,
    `<button type="button" id="ops-plan-targets-open" class="opv-btn opp-noprint">${isAdmin ? '목표 설정' : '목표 보기'}</button>`);
}

// ── 겹침 창 ──────────────────────────────────────────────────────
let state = null;   // { doc, defaults, isAdmin, onSaved, returnFocus }

function formHtml() {
    const { doc, defaults, isAdmin } = state;
    const F = fieldsFor(isAdmin);
    const rows = HORIZONS.map(h => `<tr><td><b>${H_LABEL[h]}</b></td>${F.map(f => {
        const saved = doc && doc[h] && ok(doc[h][f]) ? doc[h][f] : '';
        const ph = defaults && ok(defaults[f]) ? n1(defaults[f]) : '';
        return `<td><input type="number" step="0.1" min="0" class="opp-inp" data-h="${h}" data-f="${f}" value="${esc(String(saved))}" placeholder="${esc(ph)}"${isAdmin ? '' : ' disabled'} aria-label="${H_LABEL[h]} ${esc(F_LABEL[f])}"></td>`;
    }).join('')}</tr>`).join('');
    return `<p class="opv-note">빈 칸 = 제안값(흐린 숫자, 최근 8주 평소 기준 UPH +5% · OEE +3%p · 충족률 95% · 효율 유지). 처리량은 목표가 아니라 기준선입니다.</p>
        <div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>기간</th>${F.map(f => `<th>${esc(F_LABEL[f])}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
        ${isAdmin ? '<div class="opp-head"><button type="button" id="ops-plan-targets-save" class="ops-make-btn">저장</button></div>'
            : '<p class="opv-note">목표 저장은 관리자만 할 수 있습니다 — 지금은 보기만 됩니다.</p>'}`;
}

function onKey(e) {
    if (e.key !== 'Escape' || !isOpen()) return;
    const host = $('history-modal');
    if (host && higherOpenThan(host)) return;
    e.stopPropagation(); e.preventDefault();
    closeTargetsEditor();
}
const isOpen = () => !!($('ops-plan-targets') && !$('ops-plan-targets').classList.contains('hidden'));

/** 목표 창 열기. doc = OpsPlan/targets(없으면 null), defaults = 제안값, onSaved = 저장 뒤 다시 그리기 */
export function openTargetsEditor({ doc, defaults, isAdmin, onSaved }) {
    const box = $('ops-plan-targets');
    if (!box) return;
    state = { doc, defaults, isAdmin, onSaved, returnFocus: document.activeElement };
    $('ops-plan-targets-body').innerHTML = formHtml();
    box.classList.remove('hidden');
    const under = $('ops-plan-panel');
    if (under) under.inert = true;
    document.addEventListener('keydown', onKey, true);
    if (!box.dataset.bound) {
        box.dataset.bound = '1';
        box.addEventListener('click', (e) => {
            if (e.target.closest('#ops-plan-targets-close')) { closeTargetsEditor(); return; }
            if (e.target.closest('#ops-plan-targets-save')) save(e.target.closest('#ops-plan-targets-save'));
        });
    }
    $('ops-plan-targets-close')?.focus();
}

export function closeTargetsEditor() {
    const box = $('ops-plan-targets');
    if (!box || box.classList.contains('hidden')) return;
    box.classList.add('hidden');
    const under = $('ops-plan-panel');
    if (under) under.inert = false;
    document.removeEventListener('keydown', onKey, true);
    const f = state && state.returnFocus;
    state = null;
    if (f && document.contains(f) && typeof f.focus === 'function') f.focus();
}

async function save(btn) {
    if (!state || !state.isAdmin) return;
    const out = { week: {}, month: {}, year: {}, overrides: (state.doc && state.doc.overrides) || {} };
    document.querySelectorAll('#ops-plan-targets .opp-inp').forEach(inp => {
        if (inp.value !== '') out[inp.dataset.h][inp.dataset.f] = Number(inp.value);
    });
    HORIZONS.forEach(h => { out[h] = cleanTargetSet(out[h]); });
    btn.disabled = true;
    try {
        await saveTargets(out);
        showToast('목표를 저장했습니다.');
        const cb = state.onSaved;
        closeTargetsEditor();
        if (cb) cb();
    } catch (err) {
        console.error('운영 계획 목표 저장 실패:', err && err.code);
        showToast('목표를 저장하지 못했습니다(권한 또는 연결). 잠시 뒤 다시 시도해 주세요.');
        btn.disabled = false;
    }
}
