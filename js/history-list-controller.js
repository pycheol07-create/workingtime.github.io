// === js/history-list-controller.js ===
// 설명: 이력 모달의 좌측 날짜 목록 관리, 탭 전환, 데이터 로딩 등 네비게이션 컨트롤러입니다.

import * as DOM from './dom-elements.js?v=202610261114';
import * as State from './state.js?v=202610261114';
import { showToast, getTodayDateString, getWeekOfYear, getAllTaskKeys } from './utils.js?v=202610261114';
import { augmentHistoryWithPersistentLeave } from './history-enricher.js?v=202610261114';
import { fetchAllHistoryData, refreshRecentHistory, syncTodayToHistory, getDailyDocRef, selfHealRecentHistory, historyLoadFailed,
         fetchPlannedData, getPlannedQuantitiesForDate, getUpcomingPlannedDateStrings, clearLocalCache } from './history-data-manager.js?v=202610261114';
import { checkMissingQuantities } from './analysis-logic.js?v=202610261114';
import { historyDotState } from './lib/history-dot.js?v=202610261114';
import { startPlannedAutosave, flushPlannedAutosave, startPlannedLive, stopPlannedLive } from './planned-autosave.js?v=202610261114';
import { renderQuantityModalInputs, applyPlannedPrefill } from './ui.js?v=202610261114';
import { plannedPrefill, doneTasksOf } from './lib/planned-prefill.js?v=202610261114';
import { aliasNameMap, aliasTaskName } from './lib/task-alias-view.js?v=202610261114';
import { getIncomingQtyByDateFromCache } from './widget-incoming-schedule.js?v=202610261114';
import { getAutoQuantitiesForDate, getTransmitQuantitiesForDate, ensureMibalHistory } from './ui-history-prediction.js?v=202610261114';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let isRenderingList = false;
let renderListQueue = null;

// 이력이 없거나 못 읽었을 때 비우는 화면들
const HISTORY_VIEW_IDS = [
    'history-daily-view', 'history-weekly-view', 'history-monthly-view',
    'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view',
    'report-daily-view', 'report-weekly-view', 'report-monthly-view', 'report-yearly-view'
];

// 판정(historyLoadFailed)은 history-data-manager 의 공용 함수 — 봇 훅·업무 예상 탭과 같은 조건이다.

const LOAD_ERROR_HTML = '<div class="p-4 text-center text-sm text-red-600 dark:text-red-400">'
    + '<p class="mb-3">이력을 불러오지 못했습니다(인터넷 연결 확인)</p>'
    + '<button type="button" data-action="retry-history-load" class="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-semibold">다시 시도</button>'
    + '</div>';

const bindRetry = (root) => {
    root.querySelectorAll('[data-action="retry-history-load"]').forEach(btn => {
        btn.addEventListener('click', () => { btn.disabled = true; retryHistoryLoad(); });
    });
};

// [다시 시도] — 처음부터 다시 읽고, 성공하면 실패 전에 열려 있던 화면을 다시 연다.
//   loadAndRenderHistoryList 는 상태값만 '업무 이력' 으로 바꾸고 보이는 패널은 그대로 두므로
//   (처음 열린 빈 '요약' 이 남고 날짜를 누르면 숨은 패널에 그려졌다) showSection 으로 패널까지 다시 연다.
//   showSection 은 listeners-history-tabs.js 에 있고 그쪽이 이 파일을 import 하므로 동적 import(순환 방지).
let retrying = false;
export const retryHistoryLoad = async () => {
    if (retrying) return;
    retrying = true;
    const prevMain = State.context.activeHistoryView;
    const prevSub = State.context.activeMainHistoryTab;
    try {
        await loadAndRenderHistoryList();
        if (historyLoadFailed()) return;   // 또 실패 — 오류 화면은 그대로
        clearPanelLoadErrors();
        const { sectionIdFor } = await import('./history-sections.js?v=202610261114');
        const { showSection } = await import('./listeners-history-tabs.js?v=202610261114');
        await showSection(sectionIdFor(prevMain, prevSub) || 'insight');
    } catch (e) {
        console.error('이력 다시 시도 실패:', e);
    } finally {
        retrying = false;
        // 또 실패했으면 남아 있는 [다시 시도] 버튼(업무 예상·물량 추세 패널 등)을 다시 누를 수 있게
        document.querySelectorAll('[data-action="retry-history-load"]').forEach(b => { b.disabled = false; });
    }
};

// 목록에 오류와 [다시 시도], 각 화면은 비운다.
const showHistoryLoadError = () => {
    DOM.historyDateList.innerHTML = '<li>' + LOAD_ERROR_HTML + '</li>';
    HISTORY_VIEW_IDS.forEach(viewId => {
        const viewEl = document.getElementById(viewId);
        if (viewEl) viewEl.innerHTML = '';
    });
    bindRetry(DOM.historyDateList);
};

// 목록을 숨기는 화면(업무 예상·물량 추세 예측)용 — 패널 맨 위에 같은 오류를 두고 나머지 내용은 잠시 숨긴다.
//   패널 안의 고정 틀(머리글·버튼)을 지우지 않으려고 innerHTML 을 갈지 않는다. 다시 시도가 성공하면 원래대로.
export const showPanelLoadError = (panel) => {
    if (!panel) return;
    let box = panel.querySelector(':scope > [data-history-load-error]');
    if (!box) {
        box = document.createElement('div');
        box.setAttribute('data-history-load-error', '');
        box.className = 'm-4 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800';
        panel.prepend(box);
    }
    box.innerHTML = LOAD_ERROR_HTML;
    Array.from(panel.children).forEach(ch => {
        if (ch === box || ch.classList.contains('hidden')) return;
        ch.classList.add('hidden');
        ch.setAttribute('data-hidden-by-load-error', '');
    });
    bindRetry(box);
};

const clearPanelLoadErrors = (root = document) => {
    root.querySelectorAll('[data-history-load-error]').forEach(el => el.remove());
    root.querySelectorAll('[data-hidden-by-load-error]').forEach(el => {
        el.classList.remove('hidden');
        el.removeAttribute('data-hidden-by-load-error');
    });
};

/** 한 패널의 오류 상자만 걷어낸다 — 마일스톤·팀 결산처럼 모듈을 다시 받아 성공했을 때. */
export const clearPanelLoadError = (panel) => { if (panel) clearPanelLoadErrors(panel); };

export const loadAndRenderHistoryList = async () => {
    if (!DOM.historyDateList) return;
    DOM.historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500 text-sm">이력 로딩 중...</div></li>';

    await fetchAllHistoryData();
    // ⛔ 조회 실패(받아 둔 이력도 없음) — '저장된 이력이 없습니다'로 보이면 안 된다.
    //    아래 refresh·syncToday·selfHeal 을 돌리면 오늘 한 줄만 끼어들어 정상처럼 보이므로 여기서 멈춘다.
    if (historyLoadFailed()) {
        showHistoryLoadError();
        return;
    }
    // 🔄 최근 14일은 서버에서 다시 받는다 — 매출·재고 자동입력이 밖에서 쓴 값이 캐시 때문에 안 보이던 문제.
    //    반드시 augmentHistoryWithPersistentLeave 보다 앞(아래 순서 유지). 이유는 함수 주석 참고.
    await refreshRecentHistory();
    await syncTodayToHistory();

    // 📅 예정 물량(미래 7일) 로드 — 목록 상단 '예정' 그룹 + 예측 연동에 사용
    try { await fetchPlannedData(); } catch (e) { console.warn('예정 물량 로드 건너뜀:', e); }
    // 화면에 있는 동안 실시간 구독 — 다른 PC·탭이 넣은 예정 물량이 10분 캐시를 기다리지 않고 남색 점으로 보인다
    startPlannedLive(refreshPlannedGroup);
    watchHistoryClose();

    // 🩺 마감 누락 자동 복구: history가 빈 최근 날을 daily_data에서 자동으로 되살림(실패해도 목록 렌더는 계속)
    try { await selfHealRecentHistory(); } catch (e) { console.warn('selfHeal 건너뜀:', e); }

    augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);

    if (State.allHistoryData.length === 0) {
        DOM.historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500 text-sm">저장된 이력이 없습니다.</div></li>';
        HISTORY_VIEW_IDS.forEach(viewId => {
            const viewEl = document.getElementById(viewId);
            if (viewEl) viewEl.innerHTML = '';
        });
        return;
    }

    // 메인 탭(대시보드·생산성 …) 표시는 건드리지 않는다 — 예전엔 없는 'work' 메인 탭을 켜려다 모든 탭의 선택 표시를 지웠다
    // (숨은 기간 탭 줄 #history-tabs 등은 H1(2026-10-16)에서 지웠다 — 기간은 좌측 트리·기간 바의 일/주/월/년이 정한다)

    // 패널 가시성 초기화
    if (DOM.workHistoryPanel) DOM.workHistoryPanel.classList.remove('hidden');
    if (DOM.attendanceHistoryPanel) DOM.attendanceHistoryPanel.classList.add('hidden');
    if (DOM.trendAnalysisPanel) DOM.trendAnalysisPanel.classList.add('hidden');
    if (DOM.reportPanel) DOM.reportPanel.classList.add('hidden');

    document.getElementById('history-daily-view')?.classList.remove('hidden');
    document.getElementById('history-weekly-view')?.classList.add('hidden');
    document.getElementById('history-monthly-view')?.classList.add('hidden');
    document.getElementById('history-attendance-daily-view')?.classList.add('hidden');
    document.getElementById('history-attendance-weekly-view')?.classList.add('hidden');
    document.getElementById('history-attendance-monthly-view')?.classList.add('hidden');
    document.getElementById('report-daily-view')?.classList.remove('hidden');
    document.getElementById('report-weekly-view')?.classList.add('hidden');
    document.getElementById('report-monthly-view')?.classList.add('hidden');
    document.getElementById('report-yearly-view')?.classList.add('hidden');

    State.context.activeMainHistoryTab = 'work';
    State.context.activeHistoryView = 'rawdata';
    State.context.globalGranularity = 'day';
    State.context.reportSortState = {};
    State.context.currentReportParams = null;

    updateGranularityButtons('day');
    await renderHistoryDateListByMode('day');
};

// 📅 미래 7일 '예정 물량' 그룹 HTML (day 모드에서 목록 최상단에 표시)
const buildPlannedGroupHtml = () => {
    const dates = getUpcomingPlannedDateStrings(7);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const incoming = getIncomingQtyByDateFromCache();
    const items = dates.map(dateStr => {
        const planned = getPlannedQuantitiesForDate(dateStr);
        // 업무 예상 화면에서 '0으로 저장'한 값도 들어올 수 있다 — 지정 여부(hasData)와
        // 실제 물량이 있는 개수(count)를 나눠서 본다.
        const hasData = Object.keys(planned).length > 0;
        const count = Object.values(planned).filter(v => Number(v) > 0).length;
        const chinaIncoming = Math.round(Number(incoming[dateStr]) || 0);
        const d = new Date(dateStr + 'T00:00:00');
        const wd = isNaN(d.getDay()) ? '' : ` (${days[d.getDay()]})`;
        const rightLabel = hasData
            ? `<span class="ml-auto text-[11px] text-indigo-500 shrink-0">${count > 0 ? `${count}개 입력` : '0으로 지정'}</span>`
            : (chinaIncoming > 0
                ? `<span class="ml-auto text-[11px] text-blue-500 shrink-0">입고 ${chinaIncoming.toLocaleString()}</span>`
                : `<span class="ml-auto text-[11px] text-gray-400 shrink-0">미입력</span>`);
        return `
            <li>
                <button data-key="${dateStr}" class="planned-date-btn w-full text-left py-2 px-2.5 text-[13px] rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-center gap-2 shrink-0 text-gray-600 dark:text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30">
                    <span class="inline-block w-1.5 h-1.5 rounded-full ${hasData ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'} shrink-0"></span>
                    <span class="whitespace-nowrap tracking-tight shrink-0">${dateStr}${wd}</span>
                    ${rightLabel}
                </button>
            </li>`;
    }).join('');
    return `
        <li class="mb-2 planned-group">
            <button class="accordion-toggle w-full flex justify-between items-center py-2.5 px-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0">
                <div class="flex items-center gap-2 shrink-0">
                    <span class="font-bold text-[14px] text-indigo-700 dark:text-indigo-300 whitespace-nowrap tracking-tight shrink-0">예정 물량 (미래 7일)</span>
                </div>
                <svg class="w-4 h-4 text-indigo-400 transform transition-transform duration-200 shrink-0 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            <ul class="accordion-content mt-1 space-y-0.5 overflow-hidden transition-all duration-300 block border-l-2 border-indigo-100 dark:border-indigo-800 ml-2 pl-1.5">
                ${items}
            </ul>
        </li>`;
};

// 아코디언(묶음 머리글) 열고 닫기
function onAccordionToggle() {
    const content = this.nextElementSibling;
    const icon = this.querySelector('svg');
    const folderIcon = this.querySelector('.folder-icon');

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.classList.add('rotate-180');
        if(folderIcon) folderIcon.textContent = '📂';
    } else {
        content.classList.add('hidden');
        icon.classList.remove('rotate-180');
        if(folderIcon) folderIcon.textContent = '📁';
    }
}

const bindPlannedButtons = (root) => {
    root.querySelectorAll('.planned-date-btn').forEach(btn => {
        btn.addEventListener('click', () => openPlannedQuantityModal(btn.dataset.key));
    });
};

// 📅 '예정 물량' 묶음만 다시 그린다 — 실시간 구독·자동 저장 뒤. 목록 전체를 다시 그리지 않으므로
//    보던 날짜(선택)·스크롤·다른 묶음의 열림 상태가 그대로다. 열림/닫힘은 지금 상태를 이어받는다.
const refreshPlannedGroup = () => {
    const list = DOM.historyDateList;
    const old = list && list.querySelector(':scope > li.planned-group');
    if (!old) return;
    const holder = document.createElement('ul');
    holder.innerHTML = buildPlannedGroupHtml().trim();
    const fresh = holder.firstElementChild;
    if (!fresh) return;
    const wasOpen = !old.querySelector('.accordion-content')?.classList.contains('hidden');
    if (!wasOpen) {
        fresh.querySelector('.accordion-content')?.classList.add('hidden');
        fresh.querySelector('.accordion-toggle svg')?.classList.remove('rotate-180');
    }
    if (fresh.innerHTML === old.innerHTML) return;   // 바뀐 것 없음(내 저장의 구독 알림 등)
    fresh.querySelector('.accordion-toggle')?.addEventListener('click', onAccordionToggle);
    bindPlannedButtons(fresh);
    old.replaceWith(fresh);
};

// 데이터관리가 대시보드 안의 창(#history-modal)으로 열렸다 닫히면 구독을 끝낸다.
// history.html 에서는 이 창이 화면 본체라 닫히지 않는다 — 그때는 페이지를 떠날 때(pagehide) 끝난다(planned-autosave.js).
let historyCloseObserver = null;
const watchHistoryClose = () => {
    const hm = DOM.historyModal;
    if (historyCloseObserver || !hm || typeof MutationObserver !== 'function') return;
    historyCloseObserver = new MutationObserver(() => {
        if (hm.classList.contains('hidden')) stopPlannedLive();
    });
    historyCloseObserver.observe(hm, { attributes: true, attributeFilter: ['class'] });
};

// 📅 예정 물량 입력 모달 (기존 처리량 모달 재사용, 저장은 plannedData로)
//    [저장] 없이 고친 칸만 약 1초 뒤 자동 저장한다(js/planned-autosave.js). 아래 버튼은 [닫기] — 남은 저장을 보내고 닫는다.
export const openPlannedQuantityModal = async (dateStr) => {
    if (!dateStr) return;
    // 입고일 국내배송에 미발이 더해진다 — 이력을 읽기 전에 채우면 미발 없는 값이 칸에 깔리고,
    // 그 칸을 고치면 미발 없는 값 기준으로 저장된다.
    let 미발읽음 = false;
    try { 미발읽음 = await ensureMibalHistory(); } catch (e) {}
    const allTasks = getAllTaskKeys(State.appConfig);

    // 자동 추정값(업무 예상 시뮬레이션과 동일한 계산 — 지난 7회 평균 / AI / 입고일정)을 먼저 깔고,
    // 이미 수기로 저장해 둔 예정값이 있으면 그 값으로 덮는다.
    // → 화면을 열자마자 시뮬레이션과 같은 값이 보이고, 여기서 고친 값이 시뮬레이션에 그대로 반영된다.
    const auto = getAutoQuantitiesForDate(dateStr);
    const saved = getPlannedQuantitiesForDate(dateStr);
    // 📤 직진·에이블리 전송값은 저장값보다 앞선다 — 실제 계산에 쓰이는 값을 보여 주되 **표시만** 한다.
    //    그 칸은 읽기 전용이고 자동 저장하지 않는다 — 원래 저장값은 그대로 남는다.
    let transmit = {};
    try { transmit = getTransmitQuantitiesForDate(dateStr) || {}; } catch (e) { transmit = {}; }
    const transmitVals = Object.fromEntries(Object.entries(transmit).map(([k, v]) => [k, v.value]));
    const planned = { ...auto, ...saved, ...transmitVals };

    renderQuantityModalInputs(planned, allTasks, [], []);

    // 전송값이 걸린 칸은 읽기 전용 + 안내(이 모달의 기존 작은 안내 글씨와 같은 크기).
    // 입력칸은 모달을 열 때마다 새로 만들어지므로(renderQuantityModalInputs) 다른 모드로 새지 않는다.
    Object.entries(transmit).forEach(([task, v]) => {
        const input = document.getElementById(`modal-quantity-${task}`);
        if (!input || !input.parentElement) return;
        input.readOnly = true;
        input.classList.add('bg-sky-50', 'text-sky-900', 'cursor-not-allowed');
        const zero = document.getElementById(`modal-confirm-zero-${task}`);
        if (zero) zero.disabled = true;
        const note = document.createElement('p');
        note.className = 'mt-1 text-xs font-medium text-sky-700';
        note.textContent = v.source === 'refill'
            ? '채우기 지시서 우선 적용(그날 지시서 줄 수) — 저장해도 지시서 값이 우선 적용되고, 이 칸의 기존 저장값은 그대로 둡니다.'
            : v.source === 'transmit-none'
            ? '전 근무일 전송 없음 — 0 으로 적용(출고 자료 기준). 저장해도 이 값이 우선 적용되고, 이 칸의 기존 저장값(0 제외)은 그대로 둡니다.'
            : '전송값 우선 적용(로케이션 전송) — 저장해도 전송값이 우선 적용되고, 이 칸의 기존 저장값(0 제외)은 그대로 둡니다.';
        if (v.detail) note.title = v.detail;
        input.insertAdjacentElement('afterend', note);
    });

    const title = document.getElementById('quantity-modal-title');
    if (title) title.textContent = `${dateStr} 예정 물량 입력`;

    const hint = document.getElementById('planned-auto-hint');
    if (hint) {
        hint.textContent = '자동 추정값(국내배송=AI 예측 + 입고일엔 미발수량 · 중국제작=입고일정 · 그 외=지난 7회 업무량 평균)이 미리 채워져 있습니다. 칸에 숫자를 치면 [저장] 없이 그 칸만 바로 저장되고(약 1초 뒤), 업무 예상 시뮬레이션에도 그대로 적용됩니다(자동 추정값을 그대로 다시 쳐도 그 값으로 고정). 0 을 넣으면 그 날 그 업무는 0 으로 저장되고, 칸을 비우면 저장값을 지우고 자동 추정값으로 돌아갑니다.'
            + (미발읽음 ? '' : ' 미발수량 이력을 불러오지 못해 국내배송에 미발수량이 빠졌을 수 있습니다 — 중국 입고일이면 고치기 전에 국내배송 값을 확인하세요.');
        hint.classList.remove('hidden');
    }

    State.context.quantityModalContext.mode = 'planned';
    State.context.quantityModalContext.dateKey = dateStr;
    // [닫기] — 남은 자동 저장을 바로 보내고, 실패·숫자 오류면 창을 닫지 않는다(listeners-form-quantity.js 가 false 를 본다).
    //   📤 전송값 칸은 읽기 전용이라 자동 저장 대상이 아니다 — 그 업무의 기존 저장값은 그대로 남는다.
    State.context.quantityModalContext.onConfirm = async () => {
        const r = await flushPlannedAutosave();
        if (r === 'ok') return true;
        showToast(r === 'invalid' ? '0 이상 정수만 저장됩니다 — 빨간 칸을 고쳐 주세요.'
            : r === 'timeout' ? '저장이 늦어지고 있습니다(연결되면 자동 전송) — 확인하려면 [다시 시도]를 눌러 주세요.'
            : '예정 물량을 저장하지 못했습니다 — [다시 시도]를 눌러 주세요.', true);
        return false;
    };
    State.context.quantityModalContext.onCancel = () => {};

    const cBtn = document.getElementById('confirm-quantity-btn');
    const xBtn = document.getElementById('cancel-quantity-btn');
    if (cBtn && !cBtn.disabled) cBtn.textContent = '닫기';
    if (xBtn) xBtn.classList.add('hidden');   // 자동 저장이라 '취소'(되돌리기)가 없다 — 다른 모드는 renderQuantityModalInputs 가 다시 보인다

    // 비교 기준 = 저장값만(전송값 칸 제외). 자동 추정값은 기준이 아니다 — 그 값을 그대로 다시 치면 고정 저장된다.
    const savedBase = {};
    Object.entries(saved || {}).forEach(([k, v]) => {
        if (Object.prototype.hasOwnProperty.call(transmit, k)) return;
        savedBase[k] = v;
        // 0 으로 저장된 칸은 '0' 으로 보인다(renderQuantityModalInputs 는 0 을 빈칸으로 그린다 — 빈칸은 '저장값 없음' 이라 구별해야 한다)
        if (Number(v) === 0) {
            const input = document.getElementById(`modal-quantity-${k}`);
            if (input && !input.readOnly) input.value = '0';
        }
    });

    startPlannedAutosave({
        dateStr,
        container: document.getElementById('modal-task-quantity-inputs'),
        statusEl: document.getElementById('planned-autosave-status'),
        initial: savedBase,                    // 저장값 — 이것과 달라진 칸만 저장한다
        skipTasks: Object.keys(transmit),
        onSaved: refreshPlannedGroup
    });

    const modalEl = document.getElementById('quantity-modal');
    if (modalEl) modalEl.classList.remove('hidden');
};

export const renderHistoryDateListByMode = async (mode = 'day', selectedKey = null) => {
    if (!DOM.historyDateList) return;
    // 첫 조회가 실패한 뒤 탭 전환(showSection) 등이 목록을 다시 그리면 '오늘 한 줄' 목록이 된다 — 오류를 유지한다.
    if (historyLoadFailed()) { showHistoryLoadError(); return; }

    if (isRenderingList) {
        renderListQueue = { mode, selectedKey };
        return;
    }
    isRenderingList = true;

    try {
        await syncTodayToHistory(); 
        augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);

        const filteredData = (State.context.historyStartDate || State.context.historyEndDate)
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

        let keys = [];

        if (mode === 'day') {
            keys = filteredData.map(d => d.id);
        } else if (mode === 'week') {
            const weekSet = new Set(filteredData.map(d => getWeekOfYear(new Date(d.id + "T00:00:00"))));
            keys = Array.from(weekSet).sort((a, b) => b.localeCompare(a));
        } else if (mode === 'month') {
            const monthSet = new Set(filteredData.map(d => d.id.substring(0, 7)));
            keys = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
        } else if (mode === 'year') {
            const yearSet = new Set(filteredData.map(d => d.id.substring(0, 4)));
            keys = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
        }

        keys = [...new Set(keys)];

        if (keys.length === 0) {
            DOM.historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500 text-sm">데이터 없음</div></li>';
        } else {
            const groupedKeys = {};
            keys.forEach(key => {
                let groupName = '전체 이력';
                if (mode === 'day') {
                    groupName = `${key.substring(0, 4)}년 ${key.substring(5, 7)}월`;
                } else if (mode === 'week' || mode === 'month') {
                    groupName = `${key.substring(0, 4)}년`;
                }
                
                if (!groupedKeys[groupName]) groupedKeys[groupName] = [];
                groupedKeys[groupName].push(key);
            });

            // 📅 미래 7일 예정 물량 그룹을 목록 최상단에 (day 모드에서만)
            let htmlContent = (mode === 'day') ? buildPlannedGroupHtml() : '';
            let isFirstGroup = true;

            let targetGroupName = null;
            if (selectedKey) {
                for (const [gName, gKeys] of Object.entries(groupedKeys)) {
                    if (gKeys.includes(selectedKey)) {
                        targetGroupName = gName;
                        break;
                    }
                }
            }

            for (const [groupName, groupItemKeys] of Object.entries(groupedKeys)) {
                const isOpen = targetGroupName ? (groupName === targetGroupName) : isFirstGroup;
                
                // ✨ 수정 포인트: 좁은 영역에서도 폴더명 텍스트가 줄바꿈되거나 잘리지 않도록 (shrink-0, whitespace-nowrap) 강력 적용
                htmlContent += `
                <li class="mb-2">
                    <button class="accordion-toggle w-full flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0">
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="font-bold text-[14px] text-gray-700 dark:text-gray-200 whitespace-nowrap tracking-tight shrink-0">${groupName}</span>
                        </div>
                        <svg class="w-4 h-4 text-gray-400 transform transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <ul class="accordion-content mt-1 space-y-0.5 overflow-hidden transition-all duration-300 ${isOpen ? 'block' : 'hidden'} border-l-2 border-gray-100 dark:border-gray-700 ml-2 pl-1.5">
                `;

                groupItemKeys.forEach(key => {
                    let hasWarning = false;
                    let hasQty = false;
                    let titleAttr = '';

                    if (mode === 'day') {
                        const dayData = filteredData.find(d => d.id === key);
                        if (dayData) {
                            const missingTasksList = checkMissingQuantities(dayData);
                            // 점 색은 그 날 이력(서버 데이터) 기준 — 누락(빨강)이 우선, 처리량 입력 완료는 파랑(lib/history-dot.js)
                            const dot = historyDotState(dayData, missingTasksList);
                            hasWarning = dot === 'missing';
                            hasQty = dot === 'done';
                            if (hasWarning) {
                                titleAttr = ` title="처리량 누락: ${missingTasksList.join(', ')}"`;
                            } else if (hasQty) {
                                titleAttr = ' title="처리량 입력됨"';
                            }
                        }
                    }
                    
                    // ✨ 요일 표시 로직 
                    let displayKey = key;
                    if (mode === 'day') {
                        const d = new Date(key);
                        const days = ['일', '월', '화', '수', '목', '금', '토'];
                        const dayStr = isNaN(d.getDay()) ? '' : ` (${days[d.getDay()]})`;
                        displayKey = `${key}${dayStr}`;
                    }

                    // 선택은 배경(is-on · bg-blue-100 — 날짜 클릭 처리 listeners-history.js 와 같은 이름)으로만 보인다. 점 색과 무관
                    const isSelected = key === selectedKey;
                    const baseClass = isSelected
                        ? 'is-on bg-blue-100 font-bold'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50';

                    // ✨ 수정 포인트: 좁은 영역에서도 날짜와 요일 텍스트가 줄바꿈되거나 잘리지 않도록 (shrink-0, whitespace-nowrap) 강력 적용
                    // '누락' 글자: 휴대폰은 title 을 볼 수 없어 빨간 점만으로는 이유를 모른다
                    htmlContent += `
                        <li>
                            <button data-key="${key}" class="history-date-btn w-full text-left py-2 px-2.5 text-[13px] rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-center gap-2 shrink-0 ${baseClass} ${hasWarning ? 'warning-no-quantity' : ''}"${titleAttr}${isSelected ? ' aria-current="date"' : ''}>
                                <span class="inline-block w-1.5 h-1.5 rounded-full ${hasWarning ? 'bg-red-500' : (hasQty ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600')} shrink-0"></span>
                                <span class="whitespace-nowrap tracking-tight shrink-0">${displayKey}</span>${hasWarning ? `
                                <span class="text-[10px] font-bold text-red-600 shrink-0">누락</span>` : ''}
                            </button>
                        </li>`;
                });

                htmlContent += `</ul></li>`;
                isFirstGroup = false;
            }

            DOM.historyDateList.innerHTML = htmlContent;

            // 아코디언 토글 이벤트 부착
            const toggleBtns = DOM.historyDateList.querySelectorAll('.accordion-toggle');
            toggleBtns.forEach(btn => {
                btn.addEventListener('click', onAccordionToggle);
            });

            // 📅 예정 물량 날짜 클릭 → 예정 입력 모달
            bindPlannedButtons(DOM.historyDateList);
        }

        let targetBtn = null;
        if (selectedKey) {
            targetBtn = DOM.historyDateList.querySelector(`button[data-key="${selectedKey}"]`);
        }
        if (!targetBtn) {
            targetBtn = DOM.historyDateList.querySelector('.history-date-btn');
        }

        if (targetBtn) {
            targetBtn.click();
            if (selectedKey) {
                targetBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }

    } finally {
        isRenderingList = false;
        if (renderListQueue) {
            const nextJob = renderListQueue;
            renderListQueue = null;
            renderHistoryDateListByMode(nextJob.mode, nextJob.selectedKey);
        }
    }
};

// 🗂 날짜 트리(좌측 기간 목록)와 본문 위 기간 바를 같이 보이거나 숨긴다 — 숨김 조건은 이 함수 한 곳으로 모은다(H1).
//    트리를 쓰지 않는 화면(업무 예상·물량 추세 예측·마일스톤·결산·검수·연차)은 js/history-sections.js isTreelessMain.
export const setTreeVisible = (visible) => {
    const sidebar = document.getElementById('history-global-sidebar');
    if (sidebar) {
        sidebar.style.display = visible ? '' : 'none';
        // 📱 모바일 규칙(components/modals-history.html)이 display:block !important 라 인라인 none 이 안 먹는다 — 클래스로도 숨긴다
        sidebar.classList.toggle('hp-tree-hidden', !visible);
    }
    const bar = document.getElementById('history-period-bar');
    if (bar) bar.style.display = visible ? '' : 'none';
};

// 좌측 사이드바의 일/주/월/년 단위 버튼 활성 상태를 갱신합니다.
export const updateGranularityButtons = (mode) => {
    const base = 'history-gran-btn flex-1 py-1.5 rounded-lg text-xs md:text-sm font-bold transition border';
    document.querySelectorAll('.history-gran-btn').forEach(btn => {
        const isActive = btn.dataset.granularity === mode;
        btn.className = isActive
            ? `${base} bg-blue-600 text-white border-blue-600 shadow-sm`
            : `${base} bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600`;
    });
};

// view: daily/weekly/monthly/yearly, attendance-*, report-*, personal-*, management-*
export const switchHistoryView = async (view, preserveKey = null) => {
    if (!view) return;

    const allViews = [
        'history-daily-view', 'history-weekly-view', 'history-monthly-view', 'history-yearly-view',
        'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view', 'history-attendance-yearly-view',
        'report-daily-view', 'report-weekly-view', 'report-monthly-view', 'report-yearly-view'
    ].map(id => document.getElementById(id));
    allViews.forEach(v => v && v.classList.add('hidden'));

    // 공용 사이드바 노출 (검수/연차 탭에서만 숨기며, 그 처리는 서브탭 핸들러가 담당)
    setTreeVisible(true);

    let viewToShow = null;
    let listMode = 'day';

    switch (view) {
        case 'daily': listMode = 'day'; viewToShow = document.getElementById('history-daily-view'); break;
        case 'weekly': listMode = 'week'; viewToShow = document.getElementById('history-weekly-view'); break;
        case 'monthly': listMode = 'month'; viewToShow = document.getElementById('history-monthly-view'); break;
        case 'yearly': listMode = 'year'; viewToShow = document.getElementById('history-yearly-view'); break;
        case 'attendance-daily': listMode = 'day'; viewToShow = document.getElementById('history-attendance-daily-view'); break;
        case 'attendance-weekly': listMode = 'week'; viewToShow = document.getElementById('history-attendance-weekly-view'); break;
        case 'attendance-monthly': listMode = 'month'; viewToShow = document.getElementById('history-attendance-monthly-view'); break;
        case 'attendance-yearly': listMode = 'year'; viewToShow = document.getElementById('history-attendance-yearly-view'); break;
        case 'report-daily': listMode = 'day'; viewToShow = document.getElementById('report-daily-view'); break;
        case 'report-weekly': listMode = 'week'; viewToShow = document.getElementById('report-weekly-view'); break;
        case 'report-monthly': listMode = 'month'; viewToShow = document.getElementById('report-monthly-view'); break;
        case 'report-yearly': listMode = 'year'; viewToShow = document.getElementById('report-yearly-view'); break;
        // 개인/경영 지표는 단일 컨테이너에 렌더링되므로 별도 뷰 토글이 없습니다.
        case 'personal-daily': case 'management-daily': listMode = 'day'; break;
        case 'personal-weekly': case 'management-weekly': listMode = 'week'; break;
        case 'personal-monthly': case 'management-monthly': listMode = 'month'; break;
        case 'personal-yearly': case 'management-yearly': listMode = 'year'; break;
    }

    State.context.globalGranularity = listMode;
    updateGranularityButtons(listMode);

    await renderHistoryDateListByMode(listMode, preserveKey);

    if (viewToShow) viewToShow.classList.remove('hidden');
};

export const openHistoryQuantityModal = (dateKey) => {
    const todayDateString = getTodayDateString();

    if (dateKey === todayDateString) {
        const todayData = {
            id: todayDateString,
            workRecords: State.appState.workRecords || [],
            taskQuantities: State.appState.taskQuantities || {},
            confirmedZeroTasks: State.appState.confirmedZeroTasks || []
        };
        const missingTasksList = checkMissingQuantities(todayData);
        renderQuantityModalInputs(State.appState.taskQuantities || {}, State.appConfig.quantityTaskTypes, missingTasksList, State.appState.confirmedZeroTasks || []);
        // 오늘 작업 기록이 있는데 처리량이 빈 업무는 미리 저장해 둔 오늘 예정 물량으로 채운다(2026-10-26)
        const canon = (n) => aliasTaskName(n, State.appConfig);
        applyPlannedPrefill(plannedPrefill(State.appState.taskQuantities, aliasNameMap(getPlannedQuantitiesForDate(todayDateString), State.appConfig),
            State.appState.confirmedZeroTasks, doneTasksOf(State.appState.workRecords, State.appConfig.quantityTaskTypes, canon), canon));
    } else {
        const dayData = State.allHistoryData.find(d => d.id === dateKey);
        if (!dayData) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        const missingTasksList = checkMissingQuantities(dayData);
        renderQuantityModalInputs(dayData.taskQuantities || {}, State.appConfig.quantityTaskTypes, missingTasksList, dayData.confirmedZeroTasks || []);
    }

    const title = document.getElementById('quantity-modal-title');
    if (title) title.textContent = `${dateKey} 처리량 수정`;

    State.context.quantityModalContext.mode = 'history';
    State.context.quantityModalContext.dateKey = dateKey;

    State.context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
        if (!dateKey) return;

        const idx = State.allHistoryData.findIndex(d => d.id === dateKey);
        if (idx > -1) {
            State.allHistoryData[idx] = {
                ...State.allHistoryData[idx],
                taskQuantities: newQuantities,
                confirmedZeroTasks: confirmedZeroTasks
            };
        }

        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        try {
            await setDoc(historyDocRef, {
                taskQuantities: newQuantities,
                confirmedZeroTasks: confirmedZeroTasks
            }, { merge: true });

            showToast(`${dateKey}의 처리량이 수정되었습니다.`);

            clearLocalCache();   // 전체·대시보드(100일) 캐시 키 모두

            if (dateKey === getTodayDateString()) {
                 const dailyDocRef = getDailyDocRef();
                 await setDoc(dailyDocRef, { taskQuantities: newQuantities, confirmedZeroTasks: confirmedZeroTasks }, { merge: true });
            }

            if (DOM.historyModal && !DOM.historyModal.classList.contains('hidden')) {
                const gran = State.context.globalGranularity || 'day';
                const sub = State.context.activeMainHistoryTab || 'work';
                const viewMap = {
                    work: { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' },
                    report: { day: 'report-daily', week: 'report-weekly', month: 'report-monthly', year: 'report-yearly' }
                };
                const currentView = (viewMap[sub] || viewMap.work)[gran] || 'daily';

                await switchHistoryView(currentView, dateKey);
            }

        } catch (e) {
            console.error('Error updating history quantities:', e);
            showToast('처리량 업데이트 중 오류가 발생했습니다.', true);
        }
    };

    const cBtn = document.getElementById('confirm-quantity-btn');
    const xBtn = document.getElementById('cancel-quantity-btn');
    if (cBtn) cBtn.textContent = '수정 저장';
    if (xBtn) xBtn.textContent = '취소';
    if (DOM.quantityModal) DOM.quantityModal.classList.remove('hidden');
};
