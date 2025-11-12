// === js/listeners-main.js ===
// 설명: 메인 화면의 리스너 (실시간 현황판 제외)

import * as DOM from './dom-elements.js';
import * as State from './state.js';

// ✅ [수정] app.js에서는 'render'만, app-data.js에서는 'updateDailyData'를 가져옵니다.
import { render } from './app.js';
import { updateDailyData } from './app-data.js';
// ⛔️ [삭제] debouncedSaveState는 이 파일에서 사용하지 않으므로 import 제거

import { calcElapsedMinutes, showToast, getTodayDateString, getCurrentTime, formatTimeTo24H } from './utils.js';
import {
    renderPersonalAnalysis,
    renderQuantityModalInputs,
    renderManualAddModalDatalists
} from './ui.js';
import {
    processClockIn, processClockOut, cancelClockOut
} from './app-logic.js';
import { saveProgress, saveDayDataToHistory } from './history-data-manager.js';
import { checkMissingQuantities } from './analysis-logic.js';

import { 
    doc, updateDoc, collection, query, where, getDocs, setDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ⛔️ [삭제] openLeaveModal 헬퍼 (board.js로 이동)
// ⛔️ [삭제] openAdminMemberActionModal 헬퍼 (board.js로 이동)

export function setupMainScreenListeners() {

    // ⛔️ [삭제] SELECTED_CLASSES, UNSELECTED_CLASSES 헬퍼 (listeners-modals-form.js에 이미 존재)

    // --- 개인 출퇴근 리스너 ---
    const pcAttendanceCheckbox = document.getElementById('pc-attendance-checkbox');
    if (pcAttendanceCheckbox) {
        pcAttendanceCheckbox.addEventListener('change', (e) => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) return;
            if (e.target.checked) {
                processClockIn(currentUser);
            } else {
                const success = processClockOut(currentUser);
                if (!success) e.target.checked = true;
            }
        });
    }

    const mobileAttendanceCheckbox = document.getElementById('mobile-attendance-checkbox');
    if (mobileAttendanceCheckbox) {
        mobileAttendanceCheckbox.addEventListener('change', (e) => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) return;
            if (e.target.checked) {
                processClockIn(currentUser);
            } else {
                 const success = processClockOut(currentUser);
                if (!success) e.target.checked = true;
            }
        });
    }

    if (DOM.pcClockOutCancelBtn) {
        DOM.pcClockOutCancelBtn.addEventListener('click', () => {
            const currentUser = State.appState.currentUser;
            if (currentUser) cancelClockOut(currentUser);
        });
    }

    if (DOM.mobileClockOutCancelBtn) {
        DOM.mobileClockOutCancelBtn.addEventListener('click', () => {
            const currentUser = State.appState.currentUser;
            if (currentUser) cancelClockOut(currentUser);
        });
    }

    // ⛔️ [삭제] teamStatusBoard 리스너 (board.js로 이동)

    // --- 하단 완료 로그 리스너 ---
    if (DOM.workLogBody) {
        DOM.workLogBody.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('button[data-action="delete"]');
            if (deleteBtn) {
                State.context.recordToDeleteId = deleteBtn.dataset.recordId;
                State.context.deleteMode = 'single';
                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = '이 업무 기록을 삭제하시겠습니까?';
                if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.remove('hidden');
                return;
            }
            const editBtn = e.target.closest('button[data-action="edit"]');
            if (editBtn) {
                State.context.recordToEditId = editBtn.dataset.recordId;
                const record = (State.appState.workRecords || []).find(r => String(r.id) === String(State.context.recordToEditId));
                if (record) {
                    document.getElementById('edit-member-name').value = record.member;
                    document.getElementById('edit-start-time').value = record.startTime || '';
                    document.getElementById('edit-end-time').value = record.endTime || '';

                    const taskSelect = document.getElementById('edit-task-type');
                    taskSelect.innerHTML = '';

                    const allTasks = (State.appConfig.taskGroups || []).flatMap(group => group.tasks);

                    allTasks.forEach(task => {
                        const option = document.createElement('option');
                        option.value = task;
                        option.textContent = task;
                        if (task === record.task) option.selected = true;
                        taskSelect.appendChild(option);
                    });

                    if (DOM.editRecordModal) DOM.editRecordModal.classList.remove('hidden');
                }
                return;
            }
        });
    }

    // --- 하단 버튼 (마감, 저장, 수동추가) 리스너 ---
    if (DOM.endShiftBtn) {
        DOM.endShiftBtn.addEventListener('click', () => {
            const ongoingRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');

            if (ongoingRecords.length > 0) {
                const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
                const ongoingTaskCount = ongoingTaskNames.size;
                if (DOM.endShiftConfirmTitle) DOM.endShiftConfirmTitle.textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
                if (DOM.endShiftConfirmMessage) DOM.endShiftConfirmMessage.textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
                if (DOM.endShiftConfirmModal) DOM.endShiftConfirmModal.classList.remove('hidden');
            } else {
                saveDayDataToHistory(true);
            }
        });
    }
    
    // ✅ [신규] 모바일 업무 마감 버튼 리스너
    if (DOM.endShiftBtnMobile) {
        DOM.endShiftBtnMobile.addEventListener('click', () => {
            // (데스크톱 버튼과 동일한 로직 수행)
            const ongoingRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');

            if (ongoingRecords.length > 0) {
                const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
                const ongoingTaskCount = ongoingTaskNames.size;
                if (DOM.endShiftConfirmTitle) DOM.endShiftConfirmTitle.textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
                if (DOM.endShiftConfirmMessage) DOM.endShiftConfirmMessage.textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
                if (DOM.endShiftConfirmModal) DOM.endShiftConfirmModal.classList.remove('hidden');
            } else {
                saveDayDataToHistory(true);
            }
            // 모바일 메뉴 닫기
            if (DOM.navContent) DOM.navContent.classList.add('hidden');
        });
    }


    if (DOM.saveProgressBtn) {
        DOM.saveProgressBtn.addEventListener('click', () => saveProgress(false));
    }

    if (DOM.openManualAddBtn) {
        DOM.openManualAddBtn.addEventListener('click', () => {
            document.getElementById('manual-add-start-time').value = getCurrentTime();
            document.getElementById('manual-add-end-time').value = '';
            renderManualAddModalDatalists(State.appState, State.appConfig);
            if (DOM.manualAddRecordModal) DOM.manualAddRecordModal.classList.remove('hidden');
        });
    }

    // --- 패널 접기/펴기 (모바일) 리스너 ---
    [DOM.toggleCompletedLog, DOM.toggleAnalysis, DOM.toggleSummary].forEach(toggle => {
        if (!toggle) return;
        toggle.addEventListener('click', () => {
            if (window.innerWidth >= 768) return;
            const content = toggle.nextElementSibling;
            const arrow = toggle.querySelector('svg');
            if (!content) return;
            content.classList.toggle('hidden');
            if (arrow) arrow.classList.toggle('rotate-180');
        });
    });

    // --- 헤더 메뉴 / 햄버거 메뉴 리스너 ---
    if (DOM.hamburgerBtn && DOM.navContent) {
        DOM.hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.navContent.classList.toggle('hidden');
        });
        DOM.navContent.addEventListener('click', (e) => {
            if (window.innerWidth < 768 && e.target.closest('a, button')) {
                DOM.navContent.classList.add('hidden');
            }
        });
    }

    if (DOM.menuToggleBtn) {
        DOM.menuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (DOM.menuDropdown) DOM.menuDropdown.classList.toggle('hidden');
        });
    }

    document.addEventListener('click', (e) => {
        if (DOM.navContent && DOM.hamburgerBtn) {
            const isClickInsideNav = DOM.navContent.contains(e.target);
            const isClickOnHamburger = DOM.hamburgerBtn.contains(e.target);
            if (!DOM.navContent.classList.contains('hidden') && !isClickInsideNav && !isClickOnHamburger) {
                DOM.navContent.classList.add('hidden');
            }
        }
        if (DOM.menuDropdown && DOM.menuToggleBtn) {
            const isClickInsideMenu = DOM.menuDropdown.contains(e.target);
            const isClickOnMenuBtn = DOM.menuToggleBtn.contains(e.target);
            if (!DOM.menuDropdown.classList.contains('hidden') && !isClickInsideMenu && !isClickOnMenuBtn) {
                DOM.menuDropdown.classList.add('hidden');
            }
        }
    });

    // --- 처리량 입력 (메뉴) 리스너 ---
    if (DOM.openQuantityModalTodayBtn) {
        DOM.openQuantityModalTodayBtn.addEventListener('click', () => {
            if (!State.auth || !State.auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
                return;
            }

            const quantityModal = document.getElementById('quantity-modal');

            const todayData = {
                workRecords: State.appState.workRecords || [],
                taskQuantities: State.appState.taskQuantities || {},
                confirmedZeroTasks: State.appState.confirmedZeroTasks || []
            };
            const missingTasksList = checkMissingQuantities(todayData);

            renderQuantityModalInputs(State.appState.taskQuantities || {}, State.appConfig.quantityTaskTypes || [], missingTasksList, State.appState.confirmedZeroTasks || []);

            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';

            State.context.quantityModalContext.mode = 'today';
            State.context.quantityModalContext.dateKey = null;

            State.context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
                // 로컬 상태 즉시 업데이트 (UX 반응성)
                State.appState.taskQuantities = newQuantities;
                State.appState.confirmedZeroTasks = confirmedZeroTasks;
                
                await updateDailyData({
                    taskQuantities: newQuantities,
                    confirmedZeroTasks: confirmedZeroTasks
                });

                showToast('오늘의 처리량이 저장되었습니다.');
            };

            State.context.quantityModalContext.onCancel = () => {};

            const quantityModalEl = document.getElementById('quantity-modal');
            if (quantityModalEl) quantityModalEl.classList.remove('hidden');
            if (DOM.menuDropdown) DOM.menuDropdown.classList.add('hidden');
        });
    }

    if (DOM.openQuantityModalTodayBtnMobile) {
        DOM.openQuantityModalTodayBtnMobile.addEventListener('click', () => {
            if (!State.auth || !State.auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
                return;
            }

            const quantityModal = document.getElementById('quantity-modal');

            const todayData = {
                workRecords: State.appState.workRecords || [],
                taskQuantities: State.appState.taskQuantities || {},
                confirmedZeroTasks: State.appState.confirmedZeroTasks || []
            };
            const missingTasksList = checkMissingQuantities(todayData);

            renderQuantityModalInputs(State.appState.taskQuantities || {}, State.appConfig.quantityTaskTypes || [], missingTasksList, State.appState.confirmedZeroTasks || []);

            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';

            State.context.quantityModalContext.mode = 'today';
            State.context.quantityModalContext.dateKey = null;

            State.context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
                State.appState.taskQuantities = newQuantities;
                State.appState.confirmedZeroTasks = confirmedZeroTasks;

                await updateDailyData({
                    taskQuantities: newQuantities,
                    confirmedZeroTasks: confirmedZeroTasks
                });
                
                showToast('오늘의 처리량이 저장되었습니다.');
            };

            State.context.quantityModalContext.onCancel = () => {};

            const quantityModalEl = document.getElementById('quantity-modal');
            if (quantityModalEl) quantityModalEl.classList.remove('hidden');
            if (DOM.navContent) DOM.navContent.classList.add('hidden');
        });
    }

    // --- 분석 패널 리스너 ---
    const analysisTabs = document.getElementById('analysis-tabs');
    if (analysisTabs) {
        analysisTabs.addEventListener('click', (e) => {
            const button = e.target.closest('.analysis-tab-btn');
            if (!button) return;
            const panelId = button.dataset.tabPanel;
            if (!panelId) return;

            analysisTabs.querySelectorAll('.analysis-tab-btn').forEach(btn => {
                btn.classList.remove('text-blue-600', 'border-blue-600');
                btn.classList.add('text-gray-500', 'border-transparent', 'hover:text-gray-700', 'hover:border-gray-300');
            });
            button.classList.add('text-blue-600', 'border-blue-600');
            button.classList.remove('text-gray-500', 'border-transparent', 'hover:text-gray-700', 'hover:border-gray-300');

            document.querySelectorAll('.analysis-tab-panel').forEach(panel => {
                panel.classList.add('hidden');
            });
            const panelToShow = document.getElementById(panelId);
            if (panelToShow) {
                panelToShow.classList.remove('hidden');
            }
        });
    }

    if (DOM.analysisMemberSelect) {
        DOM.analysisMemberSelect.addEventListener('change', (e) => {
            const selectedMember = e.target.value;
            renderPersonalAnalysis(selectedMember, State.appState);
        });
    }

    // ⛔️ [삭제] 관리자 모달 버튼 리스너 (board.js로 이동)
}