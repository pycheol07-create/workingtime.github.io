// === js/ui-ops-plan.js ===
// 📋 운영 리포트 '운영 계획' 탭(MVP-1 주간 계획서, 2026-11-05) — 입력 모으기 + 그리기.
//   숫자는 js/lib/plan-build.js buildWeekPlan 한 번. 수요·공급은 업무 예상 엔진(getStaffingOutlook, from·until)을 그대로 써서
//   인력 탭 '앞으로 인원 수급' 표와 같은 필요·가용·과부족이 나온다. 지난주 실적·최근 4주 기록 누락은 운영 리포트 모델(buildOpsModel).
//   기간은 '다음 주 월~일' 고정(날짜 트리 숨김 — js/lib/ops-report-route.js isOpsTreeless). [주간]만, 월간·연간은 준비 중.
//   저장 없음(Firestore 쓰기 없음 — 확정은 MVP-2). 액션 완료 체크만 이 브라우저 localStorage(키 = 액션 key).
//   [인쇄/PDF] = 지금 보이는 계획서를 body 바로 밑 사본(#ops-plan-print)으로 옮겨 브라우저 인쇄(PDF 저장은 인쇄 창에서).
// 금액·직원 이름 없음 — 휴무는 '수'만 받는다. 콘솔에도 이름·금액을 찍지 않는다.
// ⚠️ role=dialog·data-act 금지(업무마감봇 선택자).

import * as State from './state.js?v=202611051332';
import { escapeHtml as esc, getTodayDateString, getWeekOfYear } from './utils.js?v=202611051332';
import { aliasHistoryView, aliasTaskName } from './lib/task-alias-view.js?v=202611051332';
import { buildOpsModel, opsModelInputs } from './lib/ops-view-model.js?v=202611051332';
import { taskNameOf } from './lib/task-ids.js?v=202611051332';
import { buildWeekPlan } from './lib/plan-build.js?v=202611051332';
import { nextWeekRange, planSettingsOf, addDaysStr, OVERTIME_LAW_NOTE } from './lib/plan-week.js?v=202611051332';
import { getStaffingOutlook, ensureMibalHistory, precedingHolidayNameOf, getLoadedAccuracyHourErr } from './ui-history-prediction.js?v=202611051332';
import { fetchPlannedData } from './history-data-manager.js?v=202611051332';
import { onLeaveScheduleChanged } from './leave-schedule-sync.js?v=202611051332';

const $ = (id) => document.getElementById(id);
const ok = (v) => v != null && isFinite(v);
const n0 = (v) => (ok(v) ? Math.round(v).toLocaleString() : '—');
const n1 = (v) => (ok(v) ? (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
const pct0 = (v) => (ok(v) ? `${Math.round(v * 100)}%` : '—');
const fmtDay = (id) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(id || ''));
    if (!m) return esc(id || '');
    const w = '일월화수목금토'[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
    return `${Number(m[2])}/${Number(m[3])}(${w})`;
};
const card = (title, body, hint = '') => `<div class="opv-card">
    <div class="opv-card-head"><h4 class="opv-h">${esc(title)}</h4>${hint ? `<span class="opv-note">${hint}</span>` : ''}</div>
    ${body}
</div>`;
const kpi = (label, value, unit = '', sub = '') => `<div class="opv-kpi">
    <div class="opv-kpi-label">${esc(label)}</div>
    <div class="opv-kpi-value">${value}${value === '—' || !unit ? '' : `<span class="opv-kpi-unit">${esc(unit)}</span>`}</div>
    ${sub ? `<div class="opv-note">${sub}</div>` : ''}
</div>`;

// ── 캐시(기간·이력 길이·예정 물량 수·권한) ───────────────────────────
let cache = null;          // { sig, plan }
let token = 0;             // 늦게 끝난 앞 요청이 새 화면을 덮지 않게
let loaded = false;        // 예정 물량·미발 이력을 한 번 기다렸나
export function invalidateOpsPlan() { cache = null; }

// 예정 물량 합 — 같은 날 수를 고쳐도(건수는 그대로) 캐시가 바뀌게
const plannedSum = () => (State.plannedData || []).reduce((t, d) => t + Object.values((d && d.plannedQuantities) || {}).reduce((a, v) => a + (Number(v) || 0), 0), 0);
const sigOf = (from, ctx) => `${from}|${(State.allHistoryData || []).length}|${(State.plannedData || []).length}|${plannedSum()}|${ctx && ctx.canAnalysis === false ? 0 : 1}|${loaded ? 1 : 0}`;

/** 입력 모으기 → buildWeekPlan. DOM 을 읽지 않는다. */
function computePlan(today) {
    const cfg = State.appConfig || {};
    const range = nextWeekRange(today);
    const S = planSettingsOf(cfg);
    const prepNames = S.prepTaskIds.map(id => taskNameOf(id, cfg)).filter(Boolean);
    // 업무 예상 엔진 — 다음 주 월~일 업무일만(휴일 행은 엔진이 버림). 업무 이름은 지금 이름으로.
    const outlookRows = (getStaffingOutlook(7, { from: range.from, until: range.to }) || []).map(r => {
        const th = {};
        Object.entries(r.taskHours || {}).forEach(([k, v]) => { const nk = aliasTaskName(k, cfg) || k; th[nk] = (th[nk] || 0) + (Number(v) || 0); });
        return { ...r, taskHours: th };
    });
    const view = aliasHistoryView(State.allHistoryData || [], cfg) || [];
    // 최근 4주(오늘 제외) — 기록 누락·요일별 부족
    const from28 = addDaysStr(today, -28);
    const recentDays = view.filter(d => d && typeof d.id === 'string' && d.id >= from28 && d.id < today);
    const recentModel = recentDays.length
        ? buildOpsModel({ days: recentDays, allDays: view, ownerDays: false, cfg, today, canCost: false }) : null;
    // 지난주(이번 주 바로 앞의 끝난 주, 월~일)
    const t = new Date(`${today}T00:00:00`);
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7) - 7);
    const lastKey = getWeekOfYear(t);
    const inp = opsModelInputs('week', lastKey, view);
    const lastWeekModel = (inp.days || []).length
        ? buildOpsModel({ ...inp, allDays: view, ownerDays: false, cfg, today, canCost: false }) : null;
    return buildWeekPlan({
        today, range, outlookRows, cfg, prepNames,
        afterHoliday: precedingHolidayNameOf,
        recentModel, lastWeekModel, accuracyErr: getLoadedAccuracyHourErr()
    });
}

// ── 그리기 ────────────────────────────────────────────────────────
const CONF_CHIP = { high: 'is-ok', mid: 'is-warn', low: 'is-risk' };

function headHtml(p) {
    const c = p.meta.confidence;
    return `<div class="opp-head">
        <div class="ops-tabs opp-gran" aria-label="계획 기간">
            <button type="button" class="ops-tab is-on" aria-pressed="true">주간</button>
            <button type="button" class="ops-tab" disabled title="준비 중">월간 · 준비 중</button>
            <button type="button" class="ops-tab" disabled title="준비 중">연간 · 준비 중</button>
        </div>
        <span class="opv-note">다음 주 ${fmtDay(p.meta.from)} ~ ${fmtDay(p.meta.to)} · 저장하지 않는 미리보기입니다</span>
        <button type="button" id="ops-plan-print-btn" class="opv-btn opp-noprint" title="지금 보이는 계획서를 인쇄합니다(인쇄 창에서 PDF 로 저장 가능)">인쇄 / PDF</button>
    </div>
    <div class="opp-conf">
        <span class="opv-chip ${CONF_CHIP[c.level] || ''}">신뢰도 ${esc(c.label)}</span>
        <span class="opv-note">예정 물량을 넣은 업무일 ${c.planned}/${c.workdays}일(60% 이상 높음 · 30% 이상 보통)</span>
    </div>
    ${card('요약', `<ul class="opv-diag">${p.summary.map(s => `<li><span class="opv-dot"></span><span>${esc(s)}</span></li>`).join('')}</ul>`)}`;
}

function fillText(f) {
    const out = [];
    if (f.prep > 0) out.push(`선처리 ${n1(f.prep)}h`);
    if (f.overtime > 0) out.push(`연장 ${n1(f.overtime)}h (1인 ${n1(f.overtimePerPerson)}h)`);
    if (f.tempPeople > 0) out.push(`알바 ${f.tempPeople}명`);
    return out.join(' · ');
}

function daysHtml(p) {
    const rows = p.days.map(d => {
        if (!d.workday) {
            return `<tr class="opp-off"><td>${fmtDay(d.date)}</td><td colspan="8" class="opv-note">${d.holiday ? esc(d.holidayName || '공휴일') : '주말'} — 쉬는 날</td></tr>`;
        }
        if (!d.hasRow || d.failed) {
            return `<tr><td>${fmtDay(d.date)}</td><td colspan="8" class="opv-note">${d.failed ? '업무 예상 계산에 실패했습니다' : '업무 예상 범위 밖이라 숫자가 없습니다'}</td></tr>`;
        }
        const short = d.gap < 0;
        const gapTxt = d.gap === 0 ? '적정' : d.gap > 0 ? `+${d.gap}명` : `${d.gap}명`;
        const use = d.spareFTE > 0 ? `${d.recommend}명 <span class="opv-note">(교육·정리 ${d.spareFTE}명)</span>` : `${d.recommend}명`;
        return `<tr class="${short ? 'is-short' : ''}">
            <td>${fmtDay(d.date)}</td>
            <td class="r">${n1(d.demandHours)}</td>
            <td class="r">${n1(d.reqFTE)}</td>
            <td class="r">${d.supplyFTE}명${d.leaveCount ? ` <span class="opv-note">(휴무 ${d.leaveCount})</span>` : ''}</td>
            <td class="r"><b class="${short ? 'opv-down' : d.gap > 0 ? 'opv-up' : 'opv-flat'}">${gapTxt}</b></td>
            <td class="r">${pct0(d.fillRate)}</td>
            <td class="r">${use}</td>
            <td>${short ? esc(fillText(d.fill)) || '—' : '—'}</td>
            <td><span class="opv-chip ${d.hasPlanned ? 'is-warn' : ''}" title="${d.hasPlanned ? '저장해 둔 예정 물량으로 계산' : '예정 물량이 없어 실적 기반 추정'}">${d.hasPlanned ? '예정' : '추정'}</span></td>
        </tr>`;
    }).join('');
    return card('날짜별 계획', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>날짜</th><th class="r" title="그날 모든 업무의 인시 합계(업무 예상과 같음)">작업량(인시)</th><th class="r" title="반올림 전 필요 인원">필요</th>
        <th class="r" title="재직 − 휴무 − 관리자 개별업무">공급</th><th class="r" title="공급 − 필요(반올림) — 인력 탭 표와 같음">과부족</th><th class="r">충족률</th>
        <th class="r" title="필요 인원(올림), 공급을 넘지 않음">권장 투입</th><th>메우기</th><th>근거</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`, '수요·공급 = 업무 예상과 같은 계산');
}

function fillTotalsHtml(p) {
    const T = p.fillTotals;
    const S = p.meta.settings;
    return card('부족 메우기 합계', `<div class="opv-kpis">
        ${kpi('부족 합계', n1(T.need), '시간')}
        ${kpi('① 전날 선처리', n1(T.prep), '시간', '준비 기간 0일')}
        ${kpi('② 연장', n1(T.overtime), '시간', `1인 주 ${n1(T.overtimePerPersonWeek)}시간 / 상한 ${n1(S.overtimeWeeklyMax)}시간`)}
        ${kpi('③ 알바', n0(T.tempPeople), '명·일', `${n1(T.temp)}시간 · 요청 후 ${n0(T.leadDays.temp)}일`)}
    </div>
    <p class="opv-note opp-law">${esc(OVERTIME_LAW_NOTE)}</p>
    <p class="opv-note">지금 기준: 1인 하루 연장 ${n1(S.overtimeDailyMax)}시간 · 주 ${n1(S.overtimeWeeklyMax)}시간, 알바 1인일 ${n1(S.stdHours)}시간 · 요청 후 ${n0(S.tempLeadDays)}일(설정 화면은 준비 중 — 기본값).</p>`,
    '순서: 선처리 → 연장 → 알바 · 시간·인원만');
}

const doneOf = (key) => { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } };

function actionsHtml(p) {
    if (!p.actions.length) return card('할 일', '<p class="opv-note">다음 주에 따로 준비할 일이 없습니다.</p>');
    const items = p.actions.map(a => {
        const done = doneOf(a.key);
        return `<li class="opp-act${done ? ' is-done' : ''}">
            <label class="opp-act-check"><input type="checkbox" data-plan-done="${esc(a.key)}"${done ? ' checked' : ''}> <span class="opp-act-title">${esc(a.title)}</span></label>
            <div class="opv-note">근거: ${esc(a.basis)}</div>
            <div class="opv-note">기대 효과: ${esc(a.effect)} · 기한 ${a.due ? fmtDay(a.due) : '—'} · 담당 ${esc(a.role)} · ${esc(a.rule)}</div>
        </li>`;
    }).join('');
    return card('할 일 (우선순위)', `<ol class="opp-acts">${items}</ol>`, '점수 = 영향 시간 × 신뢰도 × 급함 · 체크는 이 브라우저에만 남습니다');
}

const notesLine = (p) => ((p.meta.notes || []).length ? `<p class="opv-note">${p.meta.notes.map(esc).join(' ')}</p>` : '');
function risksHtml(p) {
    if (!p.risks.length) return card('리스크', `${notesLine(p)}<p class="opv-note">눈에 띄는 리스크가 없습니다.</p>`);
    const lv = (v) => ['', '낮음', '보통', '높음'][v] || '—';
    const rows = p.risks.map(r => `<tr>
        <td>${esc(r.title)}</td><td class="r">${lv(r.likelihood)}</td><td class="r">${lv(r.impact)}</td><td class="r"><b>${r.score}</b></td>
        <td class="opp-wrap">${esc(r.trigger)}</td><td class="opp-wrap">${esc(r.response)}</td><td>${esc(r.owner)}</td></tr>`).join('');
    return card('리스크', `${notesLine(p)}<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>항목</th><th class="r">가능성</th><th class="r">영향</th><th class="r">점수</th><th>근거</th><th>대응 제안</th><th>담당</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`);
}

const ST_TXT = { off: ['', '쉼'], none: ['', '—'], short: ['is-risk', '부족'], spare: ['is-ok', '여유'], ok: ['', '적정'] };
function meetingHtml(p) {
    const M = p.meeting;
    const L = M.lastWeek;
    const last = L ? `<p class="opv-note">${fmtDay(L.from)} ~ ${fmtDay(L.to)} · 운영일 ${L.operatingDays}일</p><div class="opv-kpis">
        ${kpi('처리량', n0(L.qty), '개', `하루 평균 ${n0(L.qtyPerDay)}개`)}
        ${kpi('충족률', pct0(L.fillRate), '', `출근 ${n1(L.attended)} / 필요 ${n1(L.required)}명 · 부족한 날 ${L.shortDays == null ? '—' : L.shortDays}일`)}
        ${kpi('UPH', n1(L.uph), '개/시')}
        ${kpi('OEE', n1(L.oee), '%')}
    </div>` : '<p class="opv-note">지난주 기록이 없습니다.</p>';
    const week = `<div class="opp-week">${M.week.map(w => {
        const [cls, txt] = ST_TXT[w.status] || ['', ''];
        const extra = w.status === 'short' ? ` ${w.gap}명` : w.status === 'spare' ? ` +${w.spareFTE}명` : '';
        return `<div class="opp-week-day"><div class="opv-note">${fmtDay(w.date)}</div><span class="opv-chip ${cls}">${esc(txt)}${extra}</span></div>`;
    }).join('')}</div>`;
    const dec = M.decisions.length ? `<ul class="opv-diag">${M.decisions.map(d => `<li><span class="opv-dot ${d.late ? 'is-risk' : 'is-warn'}"></span><span>${esc(d.text)}${d.due ? ` <span class="opv-note">— ${fmtDay(d.due)}까지${d.late ? '(이미 지남 — 준비 기간이 모자랍니다)' : ''}</span>` : ''}</span></li>`).join('')}</ul>`
        : '<p class="opv-note">결정할 것이 없습니다.</p>';
    const top = M.topRisks.length ? `<ul class="opv-diag">${M.topRisks.map(r => `<li><span class="opv-dot is-warn"></span><span>${esc(r.title)} <span class="opv-note">— ${esc(r.response)} (${esc(r.owner)})</span></span></li>`).join('')}</ul>`
        : '<p class="opv-note">없음</p>';
    const sch = `<ul class="opv-diag">${M.schedule.map(s => `<li><span class="opv-dot"></span><span><b>${esc(s.when)}</b> ${esc(s.what)}</span></li>`).join('')}</ul>`;
    return card('주간 회의 자료', `<div class="opv-sub-title">지난주 실적</div>${last}
        <div class="opv-sub-title opp-gap">다음 주 날짜별</div>${week}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 opp-gap">
            <div><div class="opv-sub-title">결정할 것</div>${dec}</div>
            <div><div class="opv-sub-title">상위 리스크 3</div>${top}</div>
            <div><div class="opv-sub-title">다음 일정</div>${sch}</div>
        </div>`);
}

function basisHtml(p) {
    return `<p class="opv-note">${p.meta.basis.map(esc).join(' · ')}</p>`;
}

function paint(host, p) {
    host.innerHTML = `<div id="ops-plan-sheet" class="opv-stack">
        ${headHtml(p)}
        ${daysHtml(p)}
        ${fillTotalsHtml(p)}
        ${actionsHtml(p)}
        ${risksHtml(p)}
        ${meetingHtml(p)}
        ${basisHtml(p)}
    </div>`;
}

/** 운영 계획 탭 그리기 — js/ui-history-ops-report.js renderTab('plan'). ctx = { canAnalysis } */
export function renderOpsPlan(ctx = {}) {
    bindOnce();
    const host = $('ops-plan-body');
    if (!host) return;
    const today = getTodayDateString();
    const range = nextWeekRange(today);
    const my = ++token;
    const draw = () => {
        if (my !== token) return;
        const sig = sigOf(range.from, ctx);
        if (!cache || cache.sig !== sig) {
            try { cache = { sig, plan: computePlan(today) }; }
            catch (err) {
                console.error('운영 계획 계산 실패:', err && err.message);
                host.innerHTML = '<div class="opv-empty">운영 계획을 계산하지 못했습니다. 새로고침 후 다시 시도해 주세요.</div>';
                return;
            }
        }
        paint(host, cache.plan);
    };
    if (!(State.allHistoryData || []).length) { host.innerHTML = '<div class="opv-empty">기록을 불러오는 중...</div>'; return; }
    if (loaded) { draw(); return; }
    host.innerHTML = '<div class="opv-empty">예정 물량을 불러오는 중...</div>';
    // 업무 예상과 같은 숫자 — 예정 물량·미발 이력(입고일 국내배송)을 기다린 뒤 계산한다(인력 탭과 같은 순서)
    Promise.all([fetchPlannedData(), ensureMibalHistory()])
        .catch(() => {})
        .then(() => { loaded = true; cache = null; draw(); });
}

// ── 인쇄 ─────────────────────────────────────────────────────────
function printPlan() {
    const sheet = $('ops-plan-sheet');
    if (!sheet) return;
    let box = $('ops-plan-print');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'ops-plan-print';
    box.className = 'opp-print';
    box.innerHTML = `<h1 class="opp-print-title">주간 운영 계획서</h1>${sheet.innerHTML}`;
    box.querySelectorAll('.opp-noprint, .opp-gran').forEach(el => el.remove());
    box.querySelectorAll('input[type="checkbox"]').forEach(el => { el.disabled = true; });
    document.body.appendChild(box);
    document.documentElement.classList.add('opp-printing');
    const done = () => {
        document.documentElement.classList.remove('opp-printing');
        $('ops-plan-print')?.remove();
        window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (e) { done(); }
}

// ── 이벤트(한 번만) ───────────────────────────────────────────────
let bound = false;
function bindOnce() {
    if (bound) return;
    const panel = $('ops-plan-panel');
    if (!panel) return;
    bound = true;
    panel.addEventListener('click', (e) => {
        if (e.target.closest('#ops-plan-print-btn')) printPlan();
    });
    panel.addEventListener('change', (e) => {
        const cb = e.target.closest('input[data-plan-done]');
        if (!cb) return;
        const key = cb.dataset.planDone;
        try { if (cb.checked) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch (err) { /* 저장 못 해도 화면만 */ }
        cb.closest('.opp-act')?.classList.toggle('is-done', cb.checked);
    });
    // 휴무가 바뀌면 공급이 바뀐다 — 보이는 중이면 다시 그린다(읽기만)
    onLeaveScheduleChanged('ops-plan', () => {
        cache = null;
        const c = State.context || {};
        if (c.activeHistoryView === 'ops' && c.activeOpsTab === 'plan' && !c.opsSettleOpen && !panel.classList.contains('hidden')) renderOpsPlan();
    });
}
