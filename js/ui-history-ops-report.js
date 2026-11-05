// === js/ui-history-ops-report.js ===
// 📊 운영 리포트(데이터 관리 '분석' 화면) — 탭: 요약·생산성·인력·비용 + [보고서 만들기](팀 결산).
//   2026-11-05 통합 2단계(옛 화면 6개를 탭으로) → 같은 날 내용 통합: 탭 5 → 4, 탭 안은 새 화면(js/ui-ops-view.js)이
//   js/lib/ops-view-model.js buildOpsModel 한 번으로 그린다. 여기는 '어느 탭을 보이나·권한·기간·상세 표 열고 닫기·결산' 만 맡는다.
//     요약·생산성·인력·비용 = renderOpsTab (#ops-*-panel)
//     생산성 '상세 표' 펼침 = 옛 업무 리포트 표 4개(renderReport* {only:'tables'}, #report-view-container) — 권한 data.reports
//     업무 상세(업무 표 행) = 겹침 화면(#ops-task-detail) + 담당 변화(renderTaskOwnerTab, 최근 12개월)
//     [보고서 만들기] = initSettlementReport (#settlement-panel, 자체 월·분기·년 선택 — 날짜 트리 숨김) + [PDF 받기][엑셀 받기]
//   기간은 왼쪽 날짜 트리 하나. 날짜를 누르면 js/listeners-history.js → renderAnalyticsTab('ops') → renderOpsReport.
//   탭 권한(비용·보고서·상세 표·업무 상세의 담당 변화 = data.reports, 업무 표 = data.view, 나머지 = data.analysis)·옛 주소 이동은 js/lib/ops-report-route.js.
//   차트: 지금 보이는 탭만 그린다. 탭을 바꾸면 차트를 정리하고, 같은 기간 모델은 다시 계산하지 않는다(ui-ops-view 캐시).
//   옛 그리기 함수(renderDashboardTab·renderProductivityTab·renderStaffingTab)와 *Old 계산은 비교 도구(tools/ops-metrics-compare.mjs)가 써서 남겨 둔다 — 여기선 부르지 않는다.
// ⚠️ role=dialog·data-act 금지(업무마감봇 선택자). 직원 이름·금액을 콘솔에 찍지 않는다.

import * as State from './state.js?v=202611051206';
import { renderHistoryDateListByMode, updateGranularityButtons } from './app-history-logic.js?v=202611051206';
import { setTreeVisible, showPanelLoadError, clearPanelLoadError } from './history-list-controller.js?v=202611051206';
import { saveView } from './view-state.js?v=202611051206';
import { currentPerm, onPerm } from './feature-gate.js?v=202611051206';
import { can } from './lib/perm.js?v=202611051206';
import { showToast } from './utils.js?v=202611051206';
import {
    OPS_MAIN, allowedTabs, pickTab, tabOf, canSettle, canDetail, canOwner, canTaskTable, settlePresetOf
} from './lib/ops-report-route.js?v=202611051206';
import {
    renderOpsTab, renderDetailTables, invalidateOpsModel, destroyOpsCharts, openTaskDetail, closeTaskDetail
} from './ui-ops-view.js?v=202611051206';

const TAB_PANEL = {
    summary: 'ops-summary-panel', productivity: 'ops-productivity-panel', staffing: 'ops-staffing-panel', cost: 'ops-cost-panel'
};

const $ = (id) => document.getElementById(id);
const granNow = () => (State.context && State.context.globalGranularity) || 'day';
const keyNow = () => document.querySelector('.history-date-btn.is-on')?.dataset.key || '';

// 권한 — page-gate 판정(window.__perm), 없으면 app.js 가 넣은 State.appState.perm.
// 둘 다 아직 없으면 분석 탭만 연다(데이터 관리 입장 자체가 history.html 의 관리자 문지기를 지났다 = data.view). 비용·보고서·상세 표는 판정이 나와야 연다.
const permNow = () => currentPerm() || (State.appState && State.appState.perm) || null;
const canNow = (id) => {
    const p = permNow();
    if (p) return can(p, id);
    return id === 'data.analysis' || id === 'data.view';
};
const REPORTS = 'data.reports';

let deps = { periodData: () => [], rangeData: () => State.allHistoryData || [] };
let rendered = {};          // 탭 → 그린 기간 열쇠 (같은 기간이면 다시 안 그림)
let prevRawSub = null;      // 상세 표를 펼치기 전의 업무 기록 서브탭(닫을 때 되돌림)
// 권한 판정 전에 요청이 막혀(비용·보고서 → 요약) 열렸으면 그 요청을 기억해 두었다가 판정이 나오면 다시 연다.
// 그동안은 주소·기억(saveView)을 요청한 자리로 둔다 — 판정 전 새로고침이 요약으로 굳지 않게. 사용자가 탭을 고르면 지운다.
let pendingReq = null;
const setPending = (r) => { pendingReq = r; State.context.opsPending = r ? { sub: r.sub, settle: !!r.settle } : null; };
const saveOps = (tab, settle) => {
    if (pendingReq) saveView({ main: OPS_MAIN, sub: pendingReq.sub, settle: pendingReq.settle ? '1' : undefined, detail: undefined });
    else saveView({ main: OPS_MAIN, sub: tab, settle: settle ? '1' : undefined, detail: !settle && State.context.opsDetailOpen ? 'tables' : undefined });
};

const periodKey = () => `${granNow()}|${keyNow()}|${(State.allHistoryData || []).length}|${canNow(REPORTS) ? 1 : 0}`;
const viewCtx = () => ({ gran: granNow(), key: keyNow(), canCost: canNow(REPORTS), canTaskTable: canTaskTable(canNow), canOwner: canOwner(canNow) });

// 탭 줄 — 권한 없는 탭·[보고서 만들기]·상세 표 숨김. 지금 탭을 못 보게 되면 볼 수 있는 탭으로.
function applyTabVisibility() {
    const allowed = allowedTabs(canNow);
    document.querySelectorAll('#ops-tabbar .ops-tab').forEach(btn => {
        const ok = allowed.includes(btn.dataset.opsTab);
        btn.style.display = ok ? '' : 'none';
        btn.inert = !ok;
    });
    const settleBtn = $('ops-settle-btn');
    if (settleBtn) { const ok = canSettle(canNow); settleBtn.style.display = ok ? '' : 'none'; settleBtn.inert = !ok; }
    const tables = $('ops-fold-tables');
    if (tables) {
        const ok = canDetail(canNow);
        tables.style.display = ok ? '' : 'none';
        tables.inert = !ok;
        if (!ok && tables.open) tables.open = false;   // toggle 이 상세 표 모드를 끈다
    }
    return allowed;
}

const noteHtml = (tab) => {
    if (tab === 'cost') return '금액이 보이는 탭입니다.';
    return '';
};

// ── 상세 표(생산성 탭 펼침) ──────────────────────────────────────
// 정렬·필터·삭제·처리량 수정은 '업무 기록 서브탭 = report' 를 보고 움직인다(js/listeners-history.js) — 펼친 동안만 맞춘다.
function setDetailMode(on) {
    const c = State.context;
    c.opsDetailOpen = !!on;
    if (on) {
        if (c.activeMainHistoryTab !== 'report') prevRawSub = c.activeMainHistoryTab;
        c.activeMainHistoryTab = 'report';
    } else if (c.activeMainHistoryTab === 'report') {
        c.activeMainHistoryTab = prevRawSub && prevRawSub !== 'report' ? prevRawSub : 'work';
    }
}
function drawDetailTables() {
    try { renderDetailTables({ gran: granNow(), key: keyNow(), rangeData: deps.rangeData() }); }
    catch (err) { console.error('운영 리포트 상세 표 그리기 실패:', err && err.message); }
}
function closeDetailFolds() {
    const t = $('ops-fold-tables');
    if (t && t.open) t.open = false;      // toggle 이벤트가 상세 표 모드를 끈다
    const f = $('ops-fold-fillerror');
    if (f && f.open) f.open = false;
    setDetailMode(false);
}

// 탭 하나를 보이게(그리지는 않음)
function showTab(tab) {
    const prevTab = State.context.activeOpsTab;
    State.context.activeOpsTab = tab;
    document.querySelectorAll('#ops-tabbar .ops-tab').forEach(btn => {
        const on = btn.dataset.opsTab === tab;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const settleOpen = !!State.context.opsSettleOpen;
    for (const [t, id] of Object.entries(TAB_PANEL)) $(id)?.classList.toggle('hidden', settleOpen || t !== tab);
    $('ops-settle-wrap')?.classList.toggle('hidden', !settleOpen);
    const note = $('ops-tab-note');
    if (note) note.innerHTML = settleOpen ? '' : noteHtml(tab);
    closeTaskDetail();
    // 다른 탭(또는 결산)으로 — 차트를 정리하고 생산성 펼침(상세 표·채우기→오류)을 닫는다. 돌아오면 다시 그린다.
    if (prevTab !== tab || settleOpen) {
        destroyOpsCharts();
        if (prevTab) delete rendered[prevTab];
        if (tab !== 'productivity' || settleOpen) closeDetailFolds();
    }
}

/** 운영 리포트를 떠날 때(다른 레일 화면) — 업무 기록 서브탭 표시를 되돌리고 차트·겹침 화면을 정리한다. */
export function leaveOpsReport() {
    closeTaskDetail();
    destroyOpsCharts();
    rendered = {};
    if (State.context) closeDetailFolds();
}

// 탭 하나 그리기. 모델은 지금 고른 기간(단위·키)으로 만든다 — data 는 쓰지 않는다(날짜 클릭이 넘긴 기간과 같은 기간).
function renderTab(tab) {
    try {
        renderOpsTab(tab, viewCtx());
    } catch (err) {
        console.error('운영 리포트 탭 그리기 실패:', tab, err && err.message);
    }
    rendered[tab] = periodKey();
    if (tab === 'productivity' && State.context.opsDetailOpen) drawDetailTables();
}

/** 날짜(기간)를 고르거나 이력이 새로 고쳐졌을 때 — js/listeners-history-tabs.js renderAnalyticsTab('ops'). 지금 탭만 그린다. */
export function renderOpsReport() {
    invalidateOpsModel();
    rendered = {};
    if (State.context.opsSettleOpen) return;   // 팀 결산을 보는 중 — 결산은 자기 기간으로 그린다
    renderTab(State.context.activeOpsTab || 'summary');
}

// 날짜 트리 보이기 — 처음 들어왔거나(팀 결산으로 바로 들어온 경우) 결산에서 돌아올 때. 날짜 목록을 그리면 맨 위 날짜가 눌려 지금 탭이 그려진다.
async function showTreeAndRender() {
    setTreeVisible(true);
    const gran = granNow();
    updateGranularityButtons(gran);
    if (!document.querySelector('#history-date-list .history-date-btn')) {
        rendered = {};
        await renderHistoryDateListByMode(gran);
        if (!document.querySelector('.history-date-btn.is-on')) renderOpsReport();
        return;
    }
    const tab = State.context.activeOpsTab || 'summary';
    if (rendered[tab] !== periodKey()) renderTab(tab);
}

// 요청 뒤처리(옛 주소) — 상세 표 펼치기·업무 상세(담당 변화) 열기. 생산성 탭이 열린 뒤에.
function applyExtras({ detail = false, owner = false } = {}) {
    if (State.context.activeOpsTab !== 'productivity' || State.context.opsSettleOpen) return;
    if (detail && canDetail(canNow)) {
        const t = $('ops-fold-tables');
        if (t && !t.open) t.open = true;          // toggle → 상세 표 그리기
    }
    if (owner && canOwner(canNow)) openTaskDetail(null, viewCtx());   // 담당 변화 = 리포트 권한
}

/** 레일에서 '운영 리포트' 를 열 때(옛 주소·기억 복원 포함). sub = 열 탭, settle = 보고서(팀 결산), detail = 상세 표, owner = 업무 상세(담당 변화). */
export async function openOpsReport({ sub, settle = false, detail = false, owner = false } = {}) {
    const allowed = applyTabVisibility();
    const want = sub || State.context.activeOpsTab;
    let tab = pickTab(want, allowed);
    // 판정 전이라 막힌 요청은 기억(판정이 나오면 onPerm 이 다시 연다)
    const blocked = (want && tab !== tabOf(want)) || (settle && !canSettle(canNow)) || (detail && !canDetail(canNow)) || (owner && !canOwner(canNow));
    setPending(blocked && !permNow() ? { sub: want || 'summary', settle: !!settle, detail: !!detail, owner: !!owner } : null);
    if (!tab) {
        setTreeVisible(false);
        for (const id of Object.values(TAB_PANEL)) $(id)?.classList.add('hidden');
        const note = $('ops-tab-note');
        if (note) note.textContent = '볼 수 있는 탭이 없습니다(권한).';
        return;
    }
    if (settle && canSettle(canNow)) tab = 'cost'; else settle = false;
    State.context.opsSettleOpen = settle;
    showTab(tab);
    if (settle) { await openSettlement(null); return; }
    saveOps(tab, false);

    setTreeVisible(true);
    const gran = granNow();
    updateGranularityButtons(gran);
    rendered = {};
    await renderHistoryDateListByMode(gran);        // 날짜 목록이 맨 위(또는 지금) 날짜를 눌러 지금 탭을 그린다
    if (!document.querySelector('.history-date-btn.is-on')) renderOpsReport();   // 데이터 없을 때
    applyExtras({ detail, owner });
}

// 탭 버튼(사용자)
function selectTab(tab) {
    if (!applyTabVisibility().includes(tab)) return;
    setPending(null);   // 사용자가 고른 탭(또는 판정 뒤 다시 연 탭)이 먼저다
    const wasSettle = !!State.context.opsSettleOpen;
    State.context.opsSettleOpen = false;
    showTab(tab);
    saveOps(tab, false);
    if (wasSettle) { showTreeAndRender().catch(e => console.error('운영 리포트 기간 목록 실패:', e)); return; }
    if (rendered[tab] !== periodKey()) renderTab(tab);
}

// ── [보고서 만들기] = 팀 결산 ─────────────────────────────────────
let settleMod = null;
// 결산 열기 — preset 이 있으면(왼쪽에서 월·년을 고른 상태) 결산 선택기를 그 기간으로 맞춰 다시 만든다.
async function openSettlement(preset) {
    if (!canSettle(canNow)) return;
    setPending(null);
    State.context.opsSettleOpen = true;
    showTab(State.context.activeOpsTab || 'cost');
    setTreeVisible(false);
    saveOps('cost', true);
    const panel = $('settlement-panel');
    try {
        settleMod = await import('./ui-history-settlement.js?v=202611051206');
        clearPanelLoadError(panel);   // 앞서 실패해 띄운 오류 상자
        // downloads:false = 결산 화면 머리 줄의 [엑셀][PDF] 를 그리지 않음(받기는 위 줄의 [PDF 받기][엑셀 받기])
        await settleMod.initSettlementReport({ downloads: false });
        if (preset) applySettlePreset(panel, preset);
    } catch (err) {
        console.error('settlement module load failed:', err && err.message);
        showPanelLoadError(panel);
    }
}

// 결산 화면의 선택기를 눌러 기간을 맞춘다(결산 모듈의 기간 상태는 밖에서 못 바꾼다 — 화면 조작 그대로).
function applySettlePreset(panel, p) {
    if (!panel || !p) return;
    panel.querySelector(`[data-settle-gran="${p.granularity}"]`)?.click();   // 같은 단위면 아무 일 없음, 다르면 다시 그림
    const y = panel.querySelector('#settle-year-select');
    if (!y) return;
    if (![...y.options].some(o => o.value === String(p.year))) {
        // 결산 연도 목록에 없는 해 — 결산 기본(이번 달)으로 연다
        panel.querySelector('[data-settle-gran="month"]')?.click();
        showToast(p.year + '년은 결산 연도 목록에 없어 이번 달 결산으로 열었습니다.');
        return;
    }
    y.value = String(p.year);
    const s = panel.querySelector('#settle-sub-select');
    if (s && p.sub != null) s.value = String(p.sub);
    panel.querySelector('#settle-generate-btn')?.click();
}

// [PDF 받기][엑셀 받기] — 화면에 보이는 결산(같은 기간·같은 숫자)을 받는다. 결산 모듈의 downloadSettlement 가 없으면(옛 모듈) 결산 화면의 버튼을 대신 누른다.
async function downloadSettle(kind, btn) {
    if (!canSettle(canNow)) return;
    try {
        if (!settleMod) settleMod = await import('./ui-history-settlement.js?v=202611051206');
        if (typeof settleMod.downloadSettlement === 'function') {
            const done = await settleMod.downloadSettlement(kind, btn);
            if (done === false) showToast('먼저 보고서를 만들어 주세요.');
            return;
        }
        const inner = $('settlement-panel')?.querySelector(kind === 'pdf' ? '#settle-pdf-btn' : '#settle-download-btn');
        if (inner) inner.click(); else showToast('먼저 보고서를 만들어 주세요.');
    } catch (err) {
        console.error('결산 받기 실패:', kind, err && err.message);
        showToast('받기에 실패했습니다. 잠시 뒤 다시 시도해 주세요.');
    }
}

/** 한 번만 — 탭 줄·[보고서 만들기]·[PDF 받기][엑셀 받기]·상세 표 펼침 연결. d.periodData() = 지금 고른 기간 이력, d.rangeData() = 상세 표용 이력. */
export function initOpsReport(d = {}) {
    deps = { ...deps, ...d };
    const panel = $('ops-panel');
    if (!panel || panel.dataset.opsBound === '1') return;
    panel.dataset.opsBound = '1';

    panel.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.ops-tab[data-ops-tab]');
        if (tabBtn) { selectTab(tabBtn.dataset.opsTab); return; }
        const go = e.target.closest('[data-ops-goto]');
        if (go) { selectTab(go.dataset.opsGoto); return; }
        if (e.target.closest('#ops-settle-btn')) {
            openSettlement(settlePresetOf(granNow(), keyNow())).catch(err => console.error('보고서 열기 실패:', err && err.message));
            return;
        }
        if (e.target.closest('#ops-settle-back')) { selectTab(State.context.activeOpsTab || 'summary'); return; }
        const pdf = e.target.closest('#ops-settle-pdf');
        if (pdf) { downloadSettle('pdf', pdf); return; }
        const xlsx = e.target.closest('#ops-settle-xlsx');
        if (xlsx) { downloadSettle('excel', xlsx); return; }
    });

    // 상세 표 펼침 — 열면 상세 표 모드(업무 기록 서브탭 = report)로 표를 그리고, 닫으면 되돌린다. toggle 은 버블링하지 않는다.
    $('ops-fold-tables')?.addEventListener('toggle', (e) => {
        const t = e.currentTarget;
        if (t.open && !canDetail(canNow)) { t.open = false; return; }
        setDetailMode(t.open);
        if (t.open) drawDetailTables();
        if (State.context.activeHistoryView === OPS_MAIN && !State.context.opsSettleOpen) saveOps(State.context.activeOpsTab || 'productivity', false);
    });

    // 방향키로 탭 이동(보이는 탭만)
    $('ops-tabbar')?.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const tabs = [...document.querySelectorAll('#ops-tabbar .ops-tab')].filter(b => b.style.display !== 'none');
        const i = tabs.indexOf(document.activeElement);
        if (i < 0) return;
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        selectTab(next.dataset.opsTab);
        e.preventDefault();
    });

    // 권한 판정이 나오거나 바뀌면 탭 줄을 다시 맞춘다. 판정 전에 막혔던 요청은 이제 되면 그 탭·결산으로 다시 연다.
    // 지금 탭을 못 보게 됐으면 요약으로. 금액 칸은 모델이 권한으로 가리므로 지금 탭을 다시 그린다.
    onPerm(() => {
        const allowed = applyTabVisibility();
        invalidateOpsModel();
        if (State.context.activeHistoryView !== OPS_MAIN) { rendered = {}; return; }
        const note = $('ops-tab-note');
        if (note && !State.context.opsSettleOpen) note.innerHTML = noteHtml(State.context.activeOpsTab || 'summary');
        if (pendingReq) {
            const r = pendingReq;
            if (r.settle && canSettle(canNow)) {
                openSettlement(null).catch(err => console.error('보고서 열기 실패:', err && err.message));
                return;
            }
            const t = pickTab(r.sub, allowed);
            if (t && t === tabOf(r.sub)) {
                selectTab(t);
                applyExtras({ detail: r.detail, owner: r.owner });
                return;
            }
            setPending(null);   // 끝내 안 됨 — 주소를 지금 화면으로
            saveOps(State.context.activeOpsTab || 'summary', State.context.opsSettleOpen);
        }
        const cur = State.context.activeOpsTab || 'summary';
        const settleDenied = State.context.opsSettleOpen && !canSettle(canNow);
        if (!allowed.includes(cur) || settleDenied) {
            const t = pickTab('summary', allowed);
            if (t) selectTab(t);
            return;
        }
        if (!State.context.opsSettleOpen) { rendered = {}; renderTab(cur); }
    });
}
