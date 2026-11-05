// === js/ui-ops-plan-items.js ===
// ✅ 운영 계획 v2 D4 — 실행 관리 화면 조각: 과제 목록(역할·기한·상태·진행·체크리스트·변경 이력), [과제로 만들기] 버튼 등록소, 목표 연결 편집 창(#ops-plan-goals).
//   저장은 js/ops-plan-items-store.js(과제)·js/ops-plan-store.js saveGoals(목표 연결). 숫자는 js/lib/plan-items.js · plan-cascade.js.
//   ⚠️ 이름·금액 없음 — 과제는 역할로만 보인다. 이력의 '누가'(이메일)는 그리지 않는다(언제·무엇만).
//   ⚠️ role=dialog·data-act 금지(업무마감봇 선택자) — 겹침 창은 section, 버튼은 data-pi-* 속성.

import { esc, n1, card, fmtDay, ok } from './ui-ops-plan-parts.js?v=202611052207';
import { STATUS_LABEL, ITEM_STATUS, roleLabel, isOverdue } from './lib/plan-items.js?v=202611052207';
import { GOAL_METRICS, GOAL_SLOTS, cleanGoals } from './lib/plan-yeardoc.js?v=202611052207';
import { buildGoalKpis } from './lib/plan-cascade.js?v=202611052207';
import { saveGoals } from './ops-plan-store.js?v=202611052207';
import { showToast } from './utils.js?v=202611052207';
import { higherOpenThan } from './modal-above.js?v=202611052207';

const $ = (id) => document.getElementById(id);
const KIND = { objective: '목표', initiative: '과제', milestone: '이정표', data: '데이터', auto: '자동화' };

// ── [과제로 만들기] 등록소 — 버튼은 key 만 들고, 초안(이름 없음)은 여기서 찾는다 ──
const drafts = new Map();
/** 초안 등록 → 버튼 HTML. items = 지금 과제 목록(같은 key 가 있으면 '과제 있음'). 관리자만 */
export function makeButton(key, draft, { items = [], isAdmin = false } = {}) {
    if (!isAdmin || !draft) return '';
    const k = String(key).slice(0, 80);
    drafts.set(k, { ...draft, src: { ...(draft.src || {}), key: k } });
    if ((items || []).some(i => i && i.src && i.src.key === k && i.status !== 'drop')) return '<span class="opv-chip is-ok opp-noprint">과제 있음</span>';
    return `<button type="button" class="opv-btn opp-noprint" data-pi-make="${esc(k)}">과제로 만들기</button>`;
}
export const draftOf = (key) => drafts.get(key) || null;

/** 과제 목록 카드. canEdit = 상태·진행·체크 바꾸기(분석 권한), isAdmin = (지금은 같은 칸 — 제목·기한은 다음 단계) */
export function itemsCardHtml(items, { title = '과제', hint = '', canEdit = true, today, empty = '과제가 없습니다.' } = {}) {
    const list = (items || []).slice().sort((a, b) => (a.status === 'drop') - (b.status === 'drop') || String(a.due || '9').localeCompare(String(b.due || '9')));
    if (!list.length) return card(title, `<p class="opv-note">${esc(empty)}</p>`, hint);
    const rows = list.map(it => {
        const over = isOverdue(it, today);
        const cl = it.checklist || [];
        const st = canEdit ? `<select class="opp-inp opp-sel" data-pi-status="${esc(it.id)}" aria-label="상태">${ITEM_STATUS.map(s => `<option value="${s}"${s === it.status ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>`
            : esc(STATUS_LABEL[it.status] || it.status);
        const pg = canEdit ? `<input type="number" min="0" max="100" step="10" class="opp-inp opp-num" data-pi-progress="${esc(it.id)}" value="${Number(it.progress) || 0}" aria-label="진행(%)">`
            : `${Number(it.progress) || 0}%`;
        const checks = cl.length ? `<details class="opp-pi-checks"><summary>${cl.filter(c => c.ok).length}/${cl.length}</summary>${cl.map((c, i) =>
            `<label class="opp-act-check"><input type="checkbox" data-pi-check="${esc(it.id)}" data-pi-idx="${i}"${c.ok ? ' checked' : ''}${canEdit ? '' : ' disabled'}> ${esc(c.t)}</label>`).join('')}</details>` : '—';
        return `<tr class="${over ? 'is-short' : ''}${it.status === 'drop' ? ' opp-off' : ''}">
            <td class="opp-wrap">${esc(it.title)}${it.kpi && it.kpi.metric ? `<div class="opv-note">지표 ${esc(it.kpi.metric)} ${ok(it.kpi.from) ? n1(it.kpi.from) : '—'} → ${ok(it.kpi.target) ? n1(it.kpi.target) : '—'}</div>` : ''}</td>
            <td>${esc(KIND[it.kind] || it.kind)}</td><td>${esc(roleLabel(it.role))}</td>
            <td>${it.due ? fmtDay(it.due) : '—'}${over ? ' <span class="opv-chip is-risk">기한 지남</span>' : ''}</td>
            <td>${st}</td><td>${pg}</td><td>${checks}</td>
            <td><button type="button" class="opv-btn opp-noprint" data-pi-log="${esc(it.id)}">이력</button><div id="pi-log-${esc(it.id)}" class="opv-note"></div></td></tr>`;
    }).join('');
    return card(title, `<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>과제</th><th>종류</th><th>담당</th><th>기한</th><th>상태</th><th>진행(%)</th><th>체크</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div><p class="opv-note">과제는 역할로만 적습니다(이름 없음). 상태·진행·체크를 바꾸면 변경 이력이 남습니다.</p>`, hint);
}

/** 변경 이력 그리기(누가는 빼고 언제·무엇) */
export function logHtml(log) {
    if (!log.length) return '이력 없음';
    const F = { status: '상태', progress: '진행', checklist: '체크', title: '제목', due: '기한', role: '담당', create: '만듦' };
    return `<ul class="opp-pi-log">${log.map(l => {
        const d = l.at ? new Date(l.at) : null;
        const when = d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
        const what = l.field === 'create' ? '만듦' : `${F[l.field] || l.field} ${esc(STATUS_LABEL[l.from] || l.from)} → ${esc(STATUS_LABEL[l.to] || l.to)}`;
        return `<li>${when} ${what}${l.note ? ` — ${esc(l.note)}` : ''}</li>`;
    }).join('')}</ul>`;
}

// ── 목표 연결 편집 창(관리자) ───────────────────────────────────────
const M_LABEL = { qtyPerDay: '처리량(하루)', uph: 'UPH', oee: 'OEE(%)', fillRate: '인원 충족률(%)', effPct: '효율(%)' };
let gst = null;   // { year, goals, targets, index, workdays, onSaved, returnFocus }

function goalsFormHtml() {
    const g = (gst.goals && gst.goals.kpis) || {};
    const ty = (gst.targets && gst.targets.year) || {};
    const mode = (gst.goals && gst.goals.mode) || 'auto';
    const yrs = GOAL_METRICS.map(m => `<label class="opp-field"><span class="opv-note">${M_LABEL[m]} — 연 목표</span>
        <input type="number" step="any" min="0" class="opp-inp" data-goal-year="${m}" value="${esc(String(g[m] && g[m].year != null ? g[m].year : (ty[m] != null ? ty[m] : '')))}"></label>`).join('');
    return `<p class="opv-note">연 목표를 넣으면 분기·월로 나눕니다 — 처리량(하루)은 월 지수(시즌 캘린더의 출고 지수)로 가중, 비율 지표는 같은 값. '직접 입력'이면 아래 표에서 칸을 고칠 수 있습니다(빈 칸은 나눈 값).</p>
        <div class="opp-fields">${yrs}
        <label class="opp-field"><span class="opv-note">나누는 방법</span><select class="opp-inp opp-sel" id="ops-goals-mode"><option value="auto"${mode === 'auto' ? ' selected' : ''}>자동 나눔</option><option value="manual"${mode === 'manual' ? ' selected' : ''}>직접 입력</option></select></label></div>
        <div id="ops-goals-preview" class="opp-gap"></div>
        <div class="opp-head"><button type="button" id="ops-goals-save" class="ops-make-btn">저장</button></div>`;
}
function readYear() {
    const y = {};
    document.querySelectorAll('#ops-plan-goals [data-goal-year]').forEach(i => { if (i.value !== '') y[i.dataset.goalYear] = Number(i.value); });
    return y;
}
function readManual() {
    const m = {};
    document.querySelectorAll('#ops-plan-goals [data-goal-cell]').forEach(i => {
        if (i.value === '' || i.dataset.auto === i.value) return;
        const [metric, slot] = i.dataset.goalCell.split(':');
        (m[metric] || (m[metric] = {}))[slot] = Number(i.value);
    });
    return m;
}
function drawPreview() {
    const mode = $('ops-goals-mode') ? $('ops-goals-mode').value : 'auto';
    const prev = (gst.goals && gst.goals.mode === 'manual' && gst.goals.kpis) || {};
    const manual = mode === 'manual' ? { ...prev, ...readManual() } : {};
    const kpis = buildGoalKpis(readYear(), { mode, manual, index: gst.index, workdays: gst.workdays });
    const auto = buildGoalKpis(readYear(), { mode: 'auto', index: gst.index, workdays: gst.workdays });
    const slots = GOAL_SLOTS.filter(s => s !== 'year');
    const rows = GOAL_METRICS.filter(m => kpis[m]).map(m => `<tr><td>${M_LABEL[m]}</td>${slots.map(s => {
        const v = kpis[m][s], a = auto[m] ? auto[m][s] : '';
        return `<td>${mode === 'manual' ? `<input type="number" step="any" class="opp-inp opp-num" data-goal-cell="${m}:${s}" data-auto="${a}" value="${v == null ? '' : v}">` : (ok(v) ? n1(v) : '—')}</td>`;
    }).join('')}</tr>`).join('');
    $('ops-goals-preview').innerHTML = rows ? `<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>지표</th>${slots.map(s => `<th class="r">${s.startsWith('q') ? s.slice(1) + '분기' : Number(s.slice(1)) + '월'}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p class="opv-note">연 목표를 넣으면 나눈 값이 보입니다.</p>';
}
function onGoalsKey(e) {
    if (e.key !== 'Escape' || !$('ops-plan-goals') || $('ops-plan-goals').classList.contains('hidden')) return;
    const host = $('history-modal');
    if (host && higherOpenThan(host)) return;
    e.stopPropagation(); e.preventDefault();
    closeGoalsEditor();
}
/** 목표 연결 편집 창 열기(관리자). index = 월 지수 {1..12}, workdays = 업무일 {1..12} */
export function openGoalsEditor({ year, goals, targets, index, workdays, onSaved }) {
    const box = $('ops-plan-goals');
    if (!box) return;
    gst = { year, goals, targets, index, workdays, onSaved, returnFocus: document.activeElement };
    $('ops-plan-goals-title').textContent = `${year}년 목표 연결 — 연 → 분기·월`;
    $('ops-plan-goals-body').innerHTML = goalsFormHtml();
    drawPreview();
    box.classList.remove('hidden');
    const under = $('ops-plan-panel');
    if (under) under.inert = true;
    document.addEventListener('keydown', onGoalsKey, true);
    if (!box.dataset.bound) {
        box.dataset.bound = '1';
        box.addEventListener('click', (e) => {
            if (e.target.closest('#ops-plan-goals-close')) { closeGoalsEditor(); return; }
            const b = e.target.closest('#ops-goals-save');
            if (b) saveGoalsFromForm(b);
        });
        box.addEventListener('change', (e) => { if (e.target && (e.target.id === 'ops-goals-mode' || e.target.dataset.goalYear)) drawPreview(); });
    }
    $('ops-plan-goals-close')?.focus();
}
export function closeGoalsEditor() {
    const box = $('ops-plan-goals');
    if (!box || box.classList.contains('hidden')) return;
    box.classList.add('hidden');
    const under = $('ops-plan-panel');
    if (under) under.inert = false;
    document.removeEventListener('keydown', onGoalsKey, true);
    const f = gst && gst.returnFocus;
    gst = null;
    if (f && document.contains(f) && typeof f.focus === 'function') f.focus();
}
async function saveGoalsFromForm(btn) {
    if (!gst) return;
    const mode = $('ops-goals-mode').value;
    const kpis = buildGoalKpis(readYear(), { mode, manual: mode === 'manual' ? readManual() : {}, index: gst.index, workdays: gst.workdays });
    const body = cleanGoals({ year: gst.year, mode, kpis });
    btn.disabled = true;
    try {
        await saveGoals(body);
        showToast('목표 연결을 저장했습니다.');
        const cb = gst.onSaved;
        closeGoalsEditor();
        if (cb) cb();
    } catch (err) {
        console.error('목표 연결 저장 실패:', err && err.code);
        showToast('목표 연결을 저장하지 못했습니다(권한 또는 연결).');
        btn.disabled = false;
    }
}
