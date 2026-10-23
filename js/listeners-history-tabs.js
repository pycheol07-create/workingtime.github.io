// === js/listeners-history-tabs.js ===
import * as DOM from './dom-elements.js?v=202610231233';
import * as State from './state.js?v=202610231233';
import { getWeekOfYear } from './utils.js?v=202610231233';

import { renderDashboardTab } from './ui-history-dashboard.js?v=202610231233';
import { renderProductivityTab } from './ui-history-productivity.js?v=202610231233';
import { renderStaffingTab } from './ui-history-staffing.js?v=202610231233';
// 💡 실적 예측 함수 불러오기 추가
import { renderPredictionTab, renderForecastTab } from './ui-history-prediction.js?v=202610231233';
import { fetchAndRenderInspectionHistory } from './listeners-history-inspection.js?v=202610231233';
import * as UILeave from './ui-history-leave.js?v=202610231233';
import { switchHistoryView, renderHistoryDateListByMode, updateGranularityButtons } from './app-history-logic.js?v=202610231233';
import { setTreeVisible, showPanelLoadError, clearPanelLoadError } from './history-list-controller.js?v=202610231233';
import { confirmDiscardManagementEdits } from './ui-history-management.js?v=202610231233';
import { historyLoadFailed } from './history-data-manager.js?v=202610231233';
import { SECTIONS, TREELESS_SUBS, sectionIdFor } from './history-sections.js?v=202610231233';
import { saveView } from './view-state.js?v=202610231233';
import { initPageNav } from './page-nav.js?v=202610231233';

// 좌측 트리 단위(globalGranularity) → 각 로우데이터 서브탭의 뷰 이름 매핑
const SUBTAB_VIEW = {
    work:       { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' },
    attendance: { day: 'attendance-daily', week: 'attendance-weekly', month: 'attendance-monthly', year: 'attendance-yearly' },
    report:     { day: 'report-daily', week: 'report-weekly', month: 'report-monthly', year: 'report-yearly' },
    personal:   { day: 'personal-daily', week: 'personal-weekly', month: 'personal-monthly', year: 'personal-yearly' },
    management: { day: 'management-daily', week: 'management-weekly', month: 'management-monthly', year: 'management-yearly' }
};

// 선택된 트리 노드(키)와 단위로부터 해당 기간의 이력 데이터 배열을 만든다 (분석 탭용)
export const getPeriodFilteredData = (granularity, key) => {
    const all = State.allHistoryData || [];
    if (!key) return [];
    if (granularity === 'week') {
        return all.filter(d => {
            try { return getWeekOfYear(new Date(d.id + "T00:00:00")) === key; } catch (e) { return false; }
        });
    }
    if (granularity === 'month') return all.filter(d => typeof d.id === 'string' && d.id.substring(0, 7) === key);
    if (granularity === 'year') return all.filter(d => typeof d.id === 'string' && d.id.substring(0, 4) === key);
    // day (기본)
    return all.filter(d => d.id === key);
};

// 분석 탭(대시보드/생산성/인력/예측)을 선택 기간 데이터로 렌더링
export const renderAnalyticsTab = (mainView, filteredData) => {
    if (mainView === 'dashboard') renderDashboardTab(filteredData, State.appConfig);
    else if (mainView === 'productivity') renderProductivityTab(filteredData, State.appConfig);
    else if (mainView === 'staffing') renderStaffingTab(filteredData, State.appConfig);
    else if (mainView === 'prediction') renderPredictionTab(State.allHistoryData); // 예측은 전체 이력 사용
};

// 공용 헬퍼 함수 (기간 필터링된 이력 데이터 반환)
export const getFilteredHistoryData = () => {
    return (State.context.historyStartDate || State.context.historyEndDate)
        ? State.allHistoryData.filter(d => {
            const date = d.id;
            const start = State.context.historyStartDate;
            const end = State.context.historyEndDate;
            if (start && end) return date >= start && date <= end;
            if (start) return date >= start;
            if (end) return date <= end;
            return true;
        })
        : State.allHistoryData;
};

const TREELESS_SUBTABS = TREELESS_SUBS;   // 검수·연차 (js/history-sections.js)

// 검수/연차 등 트리를 쓰지 않는 서브탭 진입 처리
const loadTreelessSubTab = (subTabName) => {
    if (subTabName === 'inspection') fetchAndRenderInspectionHistory();
    else if (subTabName === 'leave') UILeave.initLeaveManagement();
};

// 직원 선택 셀렉트 채우기 (개인 리포트)
const populatePersonalMemberSelect = () => {
    if (DOM.personalReportMemberSelect && DOM.personalReportMemberSelect.options.length <= 1) {
        const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
        const partTimers = (State.appState.partTimers || []).map(p => p.name);
        const allMembers = [...new Set([...staff, ...partTimers])].sort();

        DOM.personalReportMemberSelect.innerHTML = '<option value="">직원 선택...</option>';
        allMembers.forEach(m => {
            const op = document.createElement('option'); op.value = m; op.textContent = m;
            DOM.personalReportMemberSelect.appendChild(op);
        });

        if (State.appState.currentUser && allMembers.includes(State.appState.currentUser)) {
            DOM.personalReportMemberSelect.value = State.appState.currentUser;
            State.context.personalReportMember = State.appState.currentUser;
        }
    }
};

// 활성 로우데이터 서브탭을 현재 단위(globalGranularity)로 렌더링
const renderActiveRawSubTab = (subTabName) => {
    const gran = State.context.globalGranularity || 'day';
    if (subTabName === 'personal') populatePersonalMemberSelect();
    const map = SUBTAB_VIEW[subTabName];
    if (map) switchHistoryView(map[gran] || map.day);
};

// 2. 화면 전환 — 메인탭·업무 기록 서브탭. (H1, 2026-10-16: 예전 탭 버튼 클릭 리스너 본문을 함수로 뺐다. 동작은 같다)
const MAIN_PANELS = {
    dashboard: 'dashboard-panel', productivity: 'productivity-panel', staffing: 'staffing-panel',
    prediction: 'prediction-panel', forecast: 'forecast-panel', rawdata: 'rawdata-panel',
    milestones: 'milestones-panel', settlement: 'settlement-panel'
};
const SUB_PANELS = {
    work: 'work-history-panel', attendance: 'attendance-history-panel', report: 'report-panel',
    personal: 'personal-report-panel', management: 'management-panel',
    inspection: 'inspection-history-panel', leave: 'history-leave-panel'
};

// 메인 화면을 연다. rawdata 면 sub(없으면 지금 서브탭, 처음이면 업무 이력)까지 연다.
async function activateMainTab(tabName, sub) {
    State.context.activeHistoryView = tabName;
    saveView({ main: tabName });   // 새로고침해도 이 탭으로 돌아오도록

    for (const [name, id] of Object.entries(MAIN_PANELS)) {
        const panel = document.getElementById(id);
        if (panel) panel.classList.toggle('hidden', tabName !== name);
    }

    // ⛔ 이력 조회 실패 — 업무 예상·물량 추세는 목록(오류 표시)을 숨기므로 패널에 직접 오류를 보인다.
    //    그대로 그리면 오늘 1행으로 계산한 값이 정상처럼 보인다. [다시 시도]가 성공하면 이 탭을 다시 연다.
    if ((tabName === 'forecast' || tabName === 'prediction') && historyLoadFailed()) {
        setTreeVisible(false);
        showPanelLoadError(document.getElementById(MAIN_PANELS[tabName]));
        return;
    }

    // 📐 업무 예상 탭: 오늘·내일 자동 예측 + 상세 시뮬레이션 (미래 기준이라 기간 트리 숨김)
    if (tabName === 'forecast') {
        try {
            setTreeVisible(false);
            renderForecastTab();
        } catch (err) {
            console.error('forecast tab render failed:', err);
        }
        return;
    }

    // 📈 물량 추세 예측: 전체 이력으로 그린다 — 기간을 고를 일이 없어 트리 숨김(H1).
    //    예전에도 날짜를 눌러도 같은 전체 이력으로 다시 그렸다(renderAnalyticsTab 'prediction').
    if (tabName === 'prediction') {
        setTreeVisible(false);
        renderAnalyticsTab('prediction', []);
        return;
    }

    // 📍 마일스톤 탭: 처음 들어올 때 1회 구독 + 리스너 바인딩
    if (tabName === 'milestones') {
        try {
            const mod = await import('./ui-history-milestones.js?v=202610231233');
            mod.subscribeMilestones();
            mod.bindMilestoneListeners();
            clearPanelLoadError(document.getElementById(MAIN_PANELS[tabName]));   // 앞서 실패해 띄운 오류 상자
            // 기간 트리 숨김 (마일스톤은 자체 리스트 사용)
            setTreeVisible(false);
        } catch (err) {
            console.error('milestones module load failed:', err);
            // 모듈을 못 받았다(대개 인터넷) — 빈 화면 대신 오류와 [다시 시도]
            showPanelLoadError(document.getElementById(MAIN_PANELS[tabName]));
        }
        return; // 아래의 분석 탭 폴백 로직 스킵
    }

    // 🧾 팀 결산 보고 탭: 월/분기/년 단위 종합 요약 보고서 (자체 기간 선택 UI 사용)
    if (tabName === 'settlement') {
        try {
            const mod = await import('./ui-history-settlement.js?v=202610231233');
            clearPanelLoadError(document.getElementById(MAIN_PANELS[tabName]));   // 앞서 실패해 띄운 오류 상자
            await mod.initSettlementReport();
            setTreeVisible(false);
        } catch (err) {
            console.error('settlement module load failed:', err);
            showPanelLoadError(document.getElementById(MAIN_PANELS[tabName]));
        }
        return;
    }

    const gran = State.context.globalGranularity || 'day';

    if (tabName === 'rawdata') {
        // 기간 트리 노출 여부는 서브탭이 결정
        activateSubTab(sectionIdFor('rawdata', sub, State.context.activeMainHistoryTab));
    } else {
        // 분석 탭: 공용 사이드바 표시 + 트리 렌더(자동 선택 시 node-click이 분석 렌더링)
        setTreeVisible(true);
        updateGranularityButtons(gran);
        await renderHistoryDateListByMode(gran);
        if (!document.querySelector('.history-date-btn.is-on')) {
            renderAnalyticsTab(tabName, []); // 데이터 없을 때 폴백
        }
    }
}

// 업무 기록 서브탭(업무 이력·근태·리포트·개인·경영·검수·연차)을 연다.
function activateSubTab(subTabName) {
    State.context.activeMainHistoryTab = subTabName;
    saveView({ main: 'rawdata', sub: subTabName });

    for (const [key, id] of Object.entries(SUB_PANELS)) {
        const panel = document.getElementById(id);
        if (panel) panel.classList.toggle('hidden', key !== subTabName);
    }

    // 공용 사이드바: 트리를 쓰지 않는 탭에서는 숨김
    setTreeVisible(!TREELESS_SUBTABS.includes(subTabName));

    if (TREELESS_SUBTABS.includes(subTabName)) loadTreelessSubTab(subTabName);
    else renderActiveRawSubTab(subTabName);
}

let sectionNav = null;   // 좌측 레일(js/page-nav.js) — 켜짐 표시만 맡는다

/** 데이터 관리 14개 화면 중 하나를 연다(js/history-sections.js 의 id). 첫 화면·레일·해시 복원이 모두 이것을 부른다. */
export async function showSection(id) {
    const s = SECTIONS[id];
    if (!s) return;
    if (sectionNav) sectionNav.setActive(id);
    await activateMainTab(s.main, s.sub);
}

// 좌측 레일 연결 — 항목을 누르면(다른 화면 코드의 [data-main-tab="…"].click() 포함) showSection.
// 대시보드(index)에는 레일이 없다(H0 — 데이터 관리 모달을 싣지 않는다) → 아무것도 하지 않는다.
export function setupHistoryTabsListeners() {
    sectionNav = initPageNav(document.getElementById('history-section-nav'), {
        onSelect: (id) => {
            // 경영지표 화면을 떠나거나 다시 열면 입력칸이 새로 그려진다 — 저장 안 한 입력이 있으면 먼저 묻고,
            // 취소하면 레일 켜짐 표시(page-nav 가 이미 바꿈)를 지금 화면으로 되돌린다.
            if (!confirmDiscardManagementEdits('저장하지 않은 경영지표 입력이 있습니다. 저장하지 않고 다른 화면으로 갈까요?')) {
                if (sectionNav) sectionNav.setActive('management');
                return;
            }
            showSection(id).catch(err => console.error('화면 전환 실패:', err));
        },
        storageKey: 'pageNav.history.collapsed'
    });

    setupGranularityListeners();
}

// 3. 좌측 사이드바의 일/주/월/년 단위 버튼 리스너
function setupGranularityListeners() {
    const controls = document.getElementById('history-granularity-controls');
    if (!controls) return;

    controls.addEventListener('click', async (e) => {
        const btn = e.target.closest('.history-gran-btn');
        if (!btn) return;
        const gran = btn.dataset.granularity;
        if (!gran) return;
        // 경영지표 화면은 단위를 바꾸면 입력칸이 새로 그려진다 — 상태를 바꾸기 전에 묻는다
        if (!confirmDiscardManagementEdits('저장하지 않은 경영지표 입력이 있습니다. 저장하지 않고 단위를 바꿀까요?')) return;

        State.context.globalGranularity = gran;
        saveView({ gran });
        updateGranularityButtons(gran);

        const mainView = State.context.activeHistoryView || 'rawdata';

        if (mainView !== 'rawdata') {
            await renderHistoryDateListByMode(gran);
            if (!document.querySelector('.history-date-btn.is-on')) {
                renderAnalyticsTab(mainView, []);
            }
            return;
        }

        const sub = State.context.activeMainHistoryTab || 'work';
        if (TREELESS_SUBTABS.includes(sub)) return; // 단위 개념이 없는 탭
        renderActiveRawSubTab(sub);
    });
}