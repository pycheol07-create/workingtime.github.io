// === js/ui-history-ops-report.js ===
// 📊 운영 리포트(데이터 관리 '분석' 화면, 2026-11-05 운영 리포트 통합 2단계) — 탭: 요약·생산성·업무별·인력·비용 + [결산 만들기].
//   새로 그리지 않는다. 예전 화면의 그리기 함수를 그대로 부르고, 그 함수들이 찾는 칸(id)은 components/modals-history.html 의
//   #ops-panel 안으로 옮겨 두었다. 계산은 1단계(js/lib/ops-metrics.js)가 맡고 여기는 '어느 탭에 무엇을 그리나' 만 정한다.
//     요약   = renderDashboardTab (#dashboard-panel)
//     생산성 = renderProductivityTab (#productivity-panel) — OEE·인력 손실 진단은 업무 리포트 안에 있어 '업무별' 로 안내
//     업무별 = renderReport{Daily,Weekly,Monthly,Yearly} (#report-*-view) + renderTaskOwnerTab(#taskowner-body, 자체 12개월)
//     인력   = renderStaffingTab (#staffing-panel, 앞으로의 인원 수급 포함)
//     비용   = 건당 출고원가(#kpi-unit-cost, 요약 그리기가 채움) + 손실 비용 표(#prod-coq-table-body, 생산성 그리기가 채움)
//     결산   = initSettlementReport (#settlement-panel, 자체 월·분기·년 선택 — 날짜 트리 숨김)
//   기간은 왼쪽 날짜 트리 하나. 날짜를 누르면 js/listeners-history.js → renderAnalyticsTab('ops') → renderOpsReport.
//   탭 권한(업무별·비용·결산 = data.reports, 나머지 = data.analysis)·옛 주소 이동은 js/lib/ops-report-route.js.
//   차트: 지금 보이는 탭만 그린다(숨은 캔버스에 그리지 않음). 같은 기간에 이미 그린 탭은 다시 열어도 다시 그리지 않는다.
//   TODO(1단계 C5 뒤): ops-metrics.opsSummary 를 기간 열쇠(periodKey)로 메모해 탭들이 같이 쓰고, 팀 결산 PDF 도 그 값을 재사용(설계 C10).
// ⚠️ role=dialog·data-act 금지(업무마감봇 선택자). 직원 이름·금액을 콘솔에 찍지 않는다.

import * as State from './state.js?v=202611051110';
import { renderDashboardTab } from './ui-history-dashboard.js?v=202611051110';
import { renderProductivityTab } from './ui-history-productivity.js?v=202611051110';
import { renderStaffingTab } from './ui-history-staffing.js?v=202611051110';
import { renderReportDaily, renderReportWeekly, renderReportMonthly, renderReportYearly } from './ui-history-reports.js?v=202611051110';
import { renderHistoryDateListByMode, updateGranularityButtons } from './app-history-logic.js?v=202611051110';
import { setTreeVisible, showPanelLoadError, clearPanelLoadError } from './history-list-controller.js?v=202611051110';
import { historyLoadFailed } from './history-data-manager.js?v=202611051110';
import { saveView } from './view-state.js?v=202611051110';
import { currentPerm, onPerm } from './feature-gate.js?v=202611051110';
import { can } from './lib/perm.js?v=202611051110';
import { showToast } from './utils.js?v=202611051110';
import {
    OPS_MAIN, allowedTabs, pickTab, canSettle, settlePresetOf
} from './lib/ops-report-route.js?v=202611051110';

const TAB_PANEL = {
    summary: 'dashboard-panel', productivity: 'productivity-panel', tasks: 'ops-tasks-panel',
    staffing: 'staffing-panel', cost: 'ops-cost-panel'
};
const REPORT_VIEW = { day: 'report-daily-view', week: 'report-weekly-view', month: 'report-monthly-view', year: 'report-yearly-view' };
const REPORT_RENDER = { day: renderReportDaily, week: renderReportWeekly, month: renderReportMonthly, year: renderReportYearly };

const $ = (id) => document.getElementById(id);
const granNow = () => (State.context && State.context.globalGranularity) || 'day';
const keyNow = () => document.querySelector('.history-date-btn.is-on')?.dataset.key || '';

// 권한 — page-gate 판정(window.__perm), 없으면 app.js 가 넣은 State.appState.perm.
// 둘 다 아직 없으면 분석 탭만 연다(데이터 관리 입장 자체가 history.html 의 관리자 문지기를 지났다). 업무별·비용·결산은 판정이 나와야 연다.
const permNow = () => currentPerm() || (State.appState && State.appState.perm) || null;
const canNow = (id) => {
    const p = permNow();
    if (p) return can(p, id);
    return id === 'data.analysis';
};
const REPORTS = 'data.reports';

let deps = { periodData: () => [], rangeData: () => State.allHistoryData || [] };
let rendered = {};          // 탭 → 그린 기간 열쇠 (같은 기간이면 다시 안 그림)
let prevRawSub = null;      // 업무별 탭에 들어오기 전의 업무 기록 서브탭(나갈 때 되돌림)
let ownerScrollPending = false;
let ownerKey = null;        // 업무 담당 변화 칸을 그린 이력·설정 — 날짜만 바뀌면 다시 계산하지 않는다
// 권한 판정 전에 요청이 막혀(업무별·비용·결산 → 요약) 열렸으면 그 요청을 기억해 두었다가 판정이 나오면 다시 연다.
// 그동안은 주소·기억(saveView)을 요청한 자리로 둔다 — 판정 전 새로고침이 요약으로 굳지 않게. 사용자가 탭을 고르면 지운다.
let pendingReq = null;
const setPending = (r) => { pendingReq = r; State.context.opsPending = r ? { sub: r.sub, settle: !!r.settle } : null; };
const saveOps = (tab, settle) => {
    if (pendingReq) saveView({ main: OPS_MAIN, sub: pendingReq.sub, settle: pendingReq.settle ? '1' : undefined });
    else saveView({ main: OPS_MAIN, sub: tab, settle: settle ? '1' : undefined });
};

const periodKey = () => `${granNow()}|${keyNow()}|${(State.allHistoryData || []).length}`;

// 탭 줄 — 권한 없는 탭·[결산 만들기] 숨김. 지금 탭을 못 보게 되면 볼 수 있는 탭으로.
function applyTabVisibility() {
    const allowed = allowedTabs(canNow);
    document.querySelectorAll('#ops-tabbar .ops-tab').forEach(btn => {
        const ok = allowed.includes(btn.dataset.opsTab);
        btn.style.display = ok ? '' : 'none';
        btn.inert = !ok;
    });
    const settleBtn = $('ops-settle-btn');
    if (settleBtn) { const ok = canSettle(canNow); settleBtn.style.display = ok ? '' : 'none'; settleBtn.inert = !ok; }
    return allowed;
}

// 탭 줄 옆 안내. 생산성의 '업무별' 링크는 업무별 탭 권한(data.reports)이 있을 때만.
const noteHtml = (tab) => {
    if (tab === 'productivity') return canNow(REPORTS)
        ? 'OEE(가동·속도·품질)와 인력 손실 진단은 <button type="button" class="ops-link" data-ops-goto="tasks">업무별</button> 탭 리포트에 있습니다.'
        : '';
    if (tab === 'tasks') return '아래 업무 담당 변화 칸은 최근 12개월 전체 기준입니다.';
    if (tab === 'cost') return '인건비가 보이는 탭입니다.';
    return '';
};

// 탭 하나를 보이게(그리지는 않음)
function showTab(tab) {
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

    // 업무 리포트의 정렬·필터·삭제·처리량 수정은 '업무 기록 서브탭 = report' 를 보고 움직인다(js/listeners-history.js) — 업무별 탭에서만 맞춘다
    const c = State.context;
    if (tab === 'tasks' && !settleOpen) {
        if (c.activeMainHistoryTab !== 'report') prevRawSub = c.activeMainHistoryTab;
        c.activeMainHistoryTab = 'report';
    } else if (c.activeMainHistoryTab === 'report') {
        c.activeMainHistoryTab = prevRawSub && prevRawSub !== 'report' ? prevRawSub : 'work';
    }
}

/** 운영 리포트를 떠날 때(다른 레일 화면) — 업무 기록 서브탭 표시를 되돌린다. */
export function leaveOpsReport() {
    const c = State.context;
    if (c && c.activeMainHistoryTab === 'report') c.activeMainHistoryTab = prevRawSub && prevRawSub !== 'report' ? prevRawSub : 'work';
}

function renderTasks() {
    const gran = granNow();
    for (const [g, id] of Object.entries(REPORT_VIEW)) $(id)?.classList.toggle('hidden', g !== gran);
    const key = keyNow();
    const view = $(REPORT_VIEW[gran]);
    if (!key) {
        if (view) view.innerHTML = '<div class="text-center text-gray-500 py-12">왼쪽 목록에서 기간을 고르세요.</div>';
    } else {
        (REPORT_RENDER[gran] || renderReportDaily)(key, deps.rangeData(), State.appConfig, State.context);
    }
    renderOwnerSection();
}

// 업무 담당 변화 칸 — 메모리의 최근 12개월 전체(기간 트리와 무관). 이력 조회 실패면 오류와 [다시 시도].
function renderOwnerSection() {
    const sec = $('ops-owner-section');
    if (!sec) return;
    if (historyLoadFailed()) { showPanelLoadError(sec); ownerKey = null; return; }
    // 최근 12개월 전체를 본다 — 이력 배열·설정이 그대로면(날짜만 바뀜) 다시 계산하지 않는다
    const all = State.allHistoryData || [];
    const key = [all, all.length, State.appConfig];
    const same = !!ownerKey && ownerKey.every((x, i) => x === key[i]);
    import('./ui-history-task-owner.js?v=202611051110').then(mod => {
        clearPanelLoadError(sec);
        if (!same) { mod.renderTaskOwnerTab(); ownerKey = key; }
        if (ownerScrollPending) {
            ownerScrollPending = false;
            sec.scrollIntoView({ block: 'start' });
        }
    }).catch(err => {
        console.error('taskowner module load failed:', err);
        showPanelLoadError(sec);
    });
}

// 탭 하나 그리기. data 를 주면 그것(날짜 클릭이 넘긴 기간 이력), 없으면 지금 고른 기간.
function renderTab(tab, data) {
    const d = data || deps.periodData();
    const cfg = State.appConfig;
    try {
        if (tab === 'summary') renderDashboardTab(d, cfg);
        else if (tab === 'productivity') renderProductivityTab(d, cfg);
        else if (tab === 'staffing') renderStaffingTab(d, cfg);
        else if (tab === 'tasks') renderTasks();
        else if (tab === 'cost') {
            // 건당 출고원가는 요약 그리기가, 손실 비용 표는 생산성 그리기가 채운다(칸만 비용 탭으로 옮김).
            // TODO(운영 리포트 1단계 C5 뒤): ops-metrics 의 unitCost·laborCostPerItem·손실 금액으로 바꾸면 요약·생산성 차트를 숨은 채 다시 그리지 않아도 된다.
            renderDashboardTab(d, cfg);
            renderProductivityTab(d, cfg);
        }
    } catch (err) {
        console.error('운영 리포트 탭 그리기 실패:', tab, err && err.message);
    }
    if (tab === 'summary' || tab === 'productivity' || tab === 'cost') guardCostCells();
    rendered[tab] = periodKey();
    // 비용 탭은 숨은 요약·생산성 차트도 다시 만들었다(크기 0) — 그 탭은 열 때 다시 그린다
    if (tab === 'cost') { delete rendered.summary; delete rendered.productivity; }
}

// 비용 숫자(건당 출고원가·손실 비용 표)는 요약·생산성 그리기가 같이 채운다 — 비용 탭 권한이 없으면 비운다(숨은 칸에도 남기지 않게)
function guardCostCells() {
    if (canNow(REPORTS)) return;
    const unit = $('kpi-unit-cost');
    if (unit) unit.textContent = '—';
    const coq = $('prod-coq-table-body');
    if (coq) coq.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-400">권한이 없습니다.</td></tr>';
}

/** 날짜(기간)를 고르거나 이력이 새로 고쳐졌을 때 — js/listeners-history-tabs.js renderAnalyticsTab('ops'). 지금 탭만 그린다. */
export function renderOpsReport(filteredData) {
    if (State.context.opsSettleOpen) return;   // 팀 결산을 보는 중 — 결산은 자기 기간으로 그린다
    rendered = {};
    renderTab(State.context.activeOpsTab || 'summary', filteredData);
}

// 날짜 트리 보이기 — 처음 들어왔거나(팀 결산으로 바로 들어온 경우) 결산에서 돌아올 때. 날짜 목록을 그리면 맨 위 날짜가 눌려 지금 탭이 그려진다.
async function showTreeAndRender() {
    setTreeVisible(true);
    const gran = granNow();
    updateGranularityButtons(gran);
    if (!document.querySelector('#history-date-list .history-date-btn')) {
        rendered = {};
        await renderHistoryDateListByMode(gran);
        if (!document.querySelector('.history-date-btn.is-on')) renderOpsReport([]);
        return;
    }
    const tab = State.context.activeOpsTab || 'summary';
    if (rendered[tab] !== periodKey()) renderTab(tab);
}

/** 레일에서 '운영 리포트' 를 열 때(옛 주소·기억 복원 포함). sub = 열 탭, settle = 팀 결산, owner = 업무 담당 변화 칸으로. */
export async function openOpsReport({ sub, settle = false, owner = false } = {}) {
    const allowed = applyTabVisibility();
    const want = sub || State.context.activeOpsTab;
    let tab = pickTab(want, allowed);
    // 판정 전이라 막힌 요청은 기억(판정이 나오면 onPerm 이 다시 연다)
    const blocked = (want && want !== tab) || (settle && !canSettle(canNow));
    setPending(blocked && !permNow() ? { sub: want || 'summary', settle: !!settle, owner: !!owner } : null);
    if (!tab) {
        setTreeVisible(false);
        for (const id of Object.values(TAB_PANEL)) $(id)?.classList.add('hidden');
        const note = $('ops-tab-note');
        if (note) note.textContent = '볼 수 있는 탭이 없습니다(권한).';
        return;
    }
    if (settle && canSettle(canNow)) tab = 'cost'; else settle = false;
    ownerScrollPending = !!owner && tab === 'tasks';
    State.context.opsSettleOpen = settle;
    showTab(tab);
    if (settle) { await openSettlement(null); return; }
    saveOps(tab, false);

    setTreeVisible(true);
    const gran = granNow();
    updateGranularityButtons(gran);
    rendered = {};
    await renderHistoryDateListByMode(gran);        // 날짜 목록이 맨 위(또는 지금) 날짜를 눌러 지금 탭을 그린다
    if (!document.querySelector('.history-date-btn.is-on')) renderOpsReport([]);   // 데이터 없을 때
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

// 팀 결산 열기 — preset 이 있으면(왼쪽에서 월·년을 고른 상태) 결산 선택기를 그 기간으로 맞춰 다시 만든다.
async function openSettlement(preset) {
    if (!canSettle(canNow)) return;
    setPending(null);
    State.context.opsSettleOpen = true;
    showTab('cost');
    setTreeVisible(false);
    saveOps('cost', true);
    const panel = $('settlement-panel');
    try {
        const mod = await import('./ui-history-settlement.js?v=202611051110');
        clearPanelLoadError(panel);   // 앞서 실패해 띄운 오류 상자
        await mod.initSettlementReport();
        if (preset) applySettlePreset(panel, preset);
    } catch (err) {
        console.error('settlement module load failed:', err);
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

/** 한 번만 — 탭 줄·[결산 만들기]·[비용 탭으로] 연결. d.periodData() = 지금 고른 기간 이력, d.rangeData() = 업무 리포트용 이력. */
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
            openSettlement(settlePresetOf(granNow(), keyNow())).catch(err => console.error('팀 결산 열기 실패:', err));
            return;
        }
        if (e.target.closest('#ops-settle-back')) selectTab('cost');
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
    // 지금 탭을 못 보게 됐으면 요약으로. 비용 칸·안내 링크도 권한대로 다시 맞춘다.
    onPerm(() => {
        const allowed = applyTabVisibility();
        guardCostCells();
        if (State.context.activeHistoryView !== OPS_MAIN) return;
        const note = $('ops-tab-note');
        if (note && !State.context.opsSettleOpen) note.innerHTML = noteHtml(State.context.activeOpsTab || 'summary');
        if (pendingReq) {
            const r = pendingReq;
            if (r.settle && canSettle(canNow)) {
                openSettlement(null).catch(err => console.error('팀 결산 열기 실패:', err));
                return;
            }
            if (allowed.includes(r.sub)) {
                ownerScrollPending = !!r.owner && r.sub === 'tasks';
                selectTab(r.sub);
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
        }
    });
}
