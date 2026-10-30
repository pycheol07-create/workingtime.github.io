// === js/listeners-main.js ===
// 설명: 메인 화면의 리스너 (실시간 현황판 제외)

import * as DOM from './dom-elements.js?v=202610301657';
import * as State from './state.js?v=202610301657';

// app.js에서는 'render'만, app-data.js에서는 'updateDailyData'를 가져옵니다.
import { render } from './app.js?v=202610301657';
import { updateDailyData } from './app-data.js?v=202610301657';

import { calcElapsedMinutes, showToast, showConfirm, getTodayDateString, getCurrentTime, formatTimeTo24H } from './utils.js?v=202610301657';
import { AUTO_END_TIME } from './lib/record-close.js?v=202610301657';
import {
    renderPersonalAnalysis,
    renderQuantityModalInputs,
    applyPlannedPrefill,
    renderManualAddModalDatalists,
    renderLeaveTypeModalOptions 
} from './ui.js?v=202610301657';
import {
    processClockIn, processClockOut, cancelClockOut
} from './app-logic.js?v=202610301657';
import { saveProgress, saveDayDataToHistory, previewDayClose, getPlannedQuantitiesForDate } from './history-data-manager.js?v=202610301657';
import { plannedPrefill, doneTasksOf } from './lib/planned-prefill.js?v=202610301657';
import { aliasNameMap, aliasTaskName } from './lib/task-alias-view.js?v=202610301657';
import { checkMissingQuantities } from './analysis-logic.js?v=202610301657';

import { 
    doc, updateDoc, collection, query, where, getDocs, setDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 출퇴근 스위치를 켤 때 — 이미 퇴근한 상태면 새 출근(출근 시각 덮어쓰기·지각 재등록) 대신 퇴근 취소로 돌린다
const clockInOrUndoClockOut = async (member) => {
    if (State.appState.dailyAttendance?.[member]?.status === 'returned') {
        const yes = await showConfirm('퇴근을 취소하고 다시 근무 상태로 돌릴까요? (출근 시각은 그대로)', { title: '퇴근 취소', okText: '다시 근무' });
        if (!yes) return false;
        return await cancelClockOut(member);
    }
    return await processClockIn(member);
};

export function setupMainScreenListeners() {

    // --- 개인 출퇴근 리스너 ---
    const pcAttendanceCheckbox = document.getElementById('pc-attendance-checkbox');
    if (pcAttendanceCheckbox) {
        pcAttendanceCheckbox.addEventListener('change', async (e) => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) return;
            if (e.target.checked) {
                const ok = await clockInOrUndoClockOut(currentUser);
                if (!ok) e.target.checked = false;
            } else {
                // await 필수 — 예전엔 Promise 를 받아 늘 참이라, 업무 중이라 퇴근이 막혀도 스위치가 '퇴근' 으로 남았다
                const success = await processClockOut(currentUser);
                if (!success) e.target.checked = true;
            }
        });
    }

    const mobileAttendanceCheckbox = document.getElementById('mobile-attendance-checkbox');
    if (mobileAttendanceCheckbox) {
        mobileAttendanceCheckbox.addEventListener('change', async (e) => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) return;
            if (e.target.checked) {
                const ok = await clockInOrUndoClockOut(currentUser);   // 위 PC 쪽과 같은 길
                if (!ok) e.target.checked = false;
            } else {
                const success = await processClockOut(currentUser);   // await 필수 — 위 PC 쪽 주석 참고
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
    
    // 내 연차관리 버튼 리스너 (PC)
    if (DOM.openMyLeaveBtn) {
        DOM.openMyLeaveBtn.addEventListener('click', () => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
                return;
            }
            
            // 컨텍스트 설정
            State.context.memberToSetLeave = currentUser;
            if (DOM.leaveMemberNameSpan) DOM.leaveMemberNameSpan.textContent = currentUser;

            // '연차 현황' 탭으로 모달 열기
            renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');
            
            if (DOM.leaveTypeModal) DOM.leaveTypeModal.classList.remove('hidden');
            if (DOM.menuDropdown) DOM.menuDropdown.classList.add('hidden');
        });
    }

    // 내 연차관리 버튼 리스너 (Mobile)
    if (DOM.openMyLeaveBtnMobile) {
        DOM.openMyLeaveBtnMobile.addEventListener('click', () => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
                return;
            }

            State.context.memberToSetLeave = currentUser;
            if (DOM.leaveMemberNameSpan) DOM.leaveMemberNameSpan.textContent = currentUser;

            renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');

            if (DOM.leaveTypeModal) DOM.leaveTypeModal.classList.remove('hidden');
            if (DOM.navContent) DOM.navContent.classList.add('hidden');
        });
    }


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
    // 🔥 [핵심 수정] 진행 중인 업무가 없어도 확인 창을 띄우도록 수정

    // 마감 미리보기를 확인창에 그린다. 마감은 되돌릴 수 없으므로
    // '무엇이 마감되고 무엇이 삭제되는지' 를 누르기 전에 보여 준다.
    const renderEndShiftPreview = () => {
        const box = DOM.endShiftPreview;
        if (!box) return;
        const t = DOM.endShiftTimeInput ? DOM.endShiftTimeInput.value : '';
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(t)) {
            box.innerHTML = '<span class="text-red-600">마감 시각을 17:30 형식으로 입력해 주세요.</span>';
            return;
        }
        const p = previewDayClose(State.appState.workRecords || [],
                                 State.appState.dailyAttendance || {}, t);
        const 시간 = (m) => {
            const v = Math.round(m || 0);
            if (v < 60) return `${v}분`;
            return v % 60 ? `${Math.floor(v / 60)}시간 ${v % 60}분` : `${Math.floor(v / 60)}시간`;
        };
        const 줄 = [
            `· 진행 중 기록 <b>${p.closed}건</b>이 마감됩니다 (합계 ${시간(p.closedMinutes)})`,
            `· 퇴근 미기록 <b>${p.outTimeFixed}명</b>의 퇴근시각이 <b>${t}</b>로 확정됩니다`,
        ];
        // 기본값이 17:30 이라 '늦게 눌렀을 때 부풀기' 는 막았지만, 반대로 **진짜 늦게까지
        // 일한 날** 이 조용히 깎인다. 부풀기는 27시간처럼 터무니없는 숫자로 드러나지만
        // 깎이는 쪽은 '조금 적은' 값이라 아무도 신고하지 않는다. 그래서 알려 준다.
        const 지금t = getCurrentTime();
        if (지금t > t) {
            줄.push(`· <span class="text-amber-700">지금 ${지금t} 인데 <b>${t}</b> 기준으로 마감합니다.`
                + ' 더 늦게까지 일한 날이면 위 시각을 고쳐 주세요.</span>');
        }
        if (p.deleted > 0) {
            const 사유 = [];
            if (p.deletedCompleted) 사유.push(`${p.deletedCompleted}건은 이미 종료된 0분 기록`);
            if (p.lateStart) 사유.push(`${p.lateStart}건은 ${t} 보다 늦게 시작`);
            줄.push(`· <span class="text-red-600 font-bold">${p.deleted}건은 0분이 되어 삭제됩니다`
                + (사유.length ? ` (그중 ${사유.join(', ')})` : '') + '</span>');
        }
        if (p.clamped > 0) 줄.push(`· ${p.clamped}건은 조퇴/퇴근 시각까지만 계산됩니다`);
        if (p.outTimeBeforeIn > 0) {
            줄.push(`· <span class="text-red-600 font-bold">${p.outTimeBeforeIn}명은 출근시각이 ${t} 보다 늦습니다`
                + ' — 이대로는 마감할 수 없습니다</span>');
        }
        if (p.invalid > 0) {
            줄.push('· <span class="text-red-600 font-bold">'
                + `${p.invalid}건은 시작시각이 HH:MM 형식이 아닙니다 — 이대로는 마감할 수 없습니다</span>`);
        }
        줄.push(`· 이미 종료된 기록 ${p.kept}건은 그대로 유지됩니다`);
        // 처리량 미입력 — 안내만 한다(마감은 막지 않는다, UX 개선 5번). 진행 중 기록은 마감되면 시간이 생기므로 '한 업무' 로 센다.
        // ⚠️ 업무마감봇이 이 상자의 innerText 를 로그로만 남긴다 — 버튼은 data-act 가 아닌 data-end-shift-qty 로 둔다.
        const 미입력 = checkMissingQuantities({
            workRecords: (State.appState.workRecords || []).map(r =>
                (r && (r.status === 'ongoing' || r.status === 'paused') && !(r.duration > 0)) ? { ...r, duration: 1 } : r),
            taskQuantities: State.appState.taskQuantities || {},
            confirmedZeroTasks: State.appState.confirmedZeroTasks || []
        });
        if (미입력.length > 0) {
            const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
            줄.push(`· <span class="text-amber-700">처리량 미입력 <b>${미입력.length}종</b> (${미입력.map(esc).join(', ')})</span>`
                + ' <button type="button" data-end-shift-qty class="ml-1 font-bold text-blue-700 underline hover:text-blue-900">지금 입력</button>');
        }
        box.innerHTML = 줄.map(x => `<div>${x}</div>`).join('');
    };

    // 마감 미리보기의 [지금 입력] → 오늘 처리량 입력 창(마감 확인창 위에 뜬다). 저장하면 미리보기를 다시 센다.
    if (DOM.endShiftPreview) {
        DOM.endShiftPreview.addEventListener('click', (e) => {
            if (e.target.closest('[data-end-shift-qty]')) openTodayQuantityModal();
        });
    }

    const openEndShiftModal = () => {
        const ongoingRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');

        if (ongoingRecords.length > 0) {
            const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
            const ongoingTaskCount = ongoingTaskNames.size;
            if (DOM.endShiftConfirmTitle) DOM.endShiftConfirmTitle.textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
            if (DOM.endShiftConfirmMessage) DOM.endShiftConfirmMessage.textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
        } else {
            if (DOM.endShiftConfirmTitle) DOM.endShiftConfirmTitle.textContent = `오늘 업무 마감`;
            if (DOM.endShiftConfirmMessage) DOM.endShiftConfirmMessage.textContent = `진행 중인 업무가 없습니다. 이대로 오늘 업무를 마감하시겠습니까?`;
        }
        // 기본값은 업무일 종료시각(17:30). **단 그보다 일찍 마감하면 현재시각.**
        //
        // 왜 현재시각이 아닌가 — 이 칸의 값이 그날 **전원의 퇴근시각**이 된다.
        // 깜빡하고 밤 10시에 마감을 누르면 그대로 10시 퇴근으로 확정됐다
        // (2026-10-01 에 같은 종류로 근무시간이 27시간 부풀었다).
        //
        // 왜 그냥 17:30 이 아닌가 — 오전에 일찍 마감하는 날 17:30 을 넣으면 이번엔
        // 반대로 아직 오지 않은 시각이 퇴근시각이 되어 부풀린다. 둘 중 **이른 쪽**을 쓴다.
        // (늦게까지 일한 날은 이 칸을 손으로 고치면 된다 — 미리보기가 결과를 보여 준다)
        const 지금 = getCurrentTime();
        if (DOM.endShiftTimeInput) {
            DOM.endShiftTimeInput.value = (지금 < AUTO_END_TIME) ? 지금 : AUTO_END_TIME;
        }
        renderEndShiftPreview();
        if (DOM.endShiftConfirmModal) DOM.endShiftConfirmModal.classList.remove('hidden');
    };

    if (DOM.endShiftTimeInput) {
        DOM.endShiftTimeInput.addEventListener('input', renderEndShiftPreview);
        DOM.endShiftTimeInput.addEventListener('change', renderEndShiftPreview);
    }

    if (DOM.endShiftBtn) {
        DOM.endShiftBtn.addEventListener('click', openEndShiftModal);
    }

    if (DOM.endShiftBtnMobile) {
        DOM.endShiftBtnMobile.addEventListener('click', () => {
            openEndShiftModal();
            if (DOM.navContent) DOM.navContent.classList.add('hidden');
        });
    }


    if (DOM.saveProgressBtn) {
        // 수동 저장은 검증 플래그 없이 저장한다 (isQuantityVerified = false)
        DOM.saveProgressBtn.addEventListener('click', () => saveProgress(false, false));
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
    // PC 사이드바·휴대폰 메뉴·마감 확인창의 [지금 입력] 이 같은 창을 연다(예전엔 PC/휴대폰 두 벌이 복사돼 있었다).
    const openTodayQuantityModal = () => {
        if (!State.auth || !State.auth.currentUser) {
            showToast('로그인이 필요합니다.', true);
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            return;
        }

        const todayData = {
            workRecords: State.appState.workRecords || [],
            taskQuantities: State.appState.taskQuantities || {},
            confirmedZeroTasks: State.appState.confirmedZeroTasks || []
        };
        const missingTasksList = checkMissingQuantities(todayData);
        // 정렬: 누락 → 오늘 한 업무(진행 중 포함) → 나머지 (ui-modals.js renderQuantityModalInputs)
        const doneTodayTasks = [...new Set((State.appState.workRecords || []).map(r => r && r.task).filter(Boolean))];

        renderQuantityModalInputs(State.appState.taskQuantities || {}, State.appConfig.quantityTaskTypes || [], missingTasksList, State.appState.confirmedZeroTasks || [], doneTodayTasks);
        // 오늘 작업 기록이 있는데 처리량이 빈 업무는 미리 저장해 둔 오늘 예정 물량으로 채운다(2026-10-26)
        const canon = (n) => aliasTaskName(n, State.appConfig);
        applyPlannedPrefill(plannedPrefill(State.appState.taskQuantities, aliasNameMap(getPlannedQuantitiesForDate(getTodayDateString()), State.appConfig),
            State.appState.confirmedZeroTasks, doneTasksOf(State.appState.workRecords, State.appConfig.quantityTaskTypes || [], canon), canon));

        const title = document.getElementById('quantity-modal-title');
        if (title) title.textContent = '오늘의 처리량 입력';

        State.context.quantityModalContext.mode = 'today';
        State.context.quantityModalContext.dateKey = null;

        // false 를 돌려주면 창을 닫지 않는다(listeners-form-quantity.js) — 저장이 안 됐는데 닫히면 입력이 사라진다.
        State.context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
            const saved = await updateDailyData({
                taskQuantities: newQuantities,
                confirmedZeroTasks: confirmedZeroTasks
            }, { requireOnline: true, timeoutMs: 10000 });
            if (!saved) return false;   // 오류 안내는 updateDailyData 가 한 번 띄웠다

            State.appState.taskQuantities = newQuantities;
            State.appState.confirmedZeroTasks = confirmedZeroTasks;

            // 오늘 입력은 검증 플래그 없이 저장한다
            // (isAutoSave=true 로 주어 saveProgress 자체 토스트를 끄고, 결과만 여기서 한 번 알린다)
            // 처리량 자체는 위 updateDailyData 로 이미 반영됐다 — 확인은 먼저 알린다.
            showToast('오늘의 처리량을 반영했습니다.');
            // 마감 확인창에서 [지금 입력] 으로 왔으면 미리보기의 '처리량 미입력' 줄을 새로 센다
            if (DOM.endShiftConfirmModal && !DOM.endShiftConfirmModal.classList.contains('hidden')) renderEndShiftPreview();

            // ⚠️ await 를 빼면 안 된다. 이 호출이 떠 있는 동안 사용자가 '업무 마감'을 누르면,
            //    뒤늦게 끝난 이쪽이 마감 전 상태(ongoing)로 이력을 통째 덮어쓴다.
            //    (workRecords 는 배열이라 merge 가 아니라 교체다)
            const resToday = await saveProgress(true, false);
            // 'nothing'(저장할 게 없음)은 정상, 'failed' 만 오류로 안내한다.
            if (resToday === 'failed') showToast('처리량은 반영됐지만 이력 저장에 실패했습니다. 연결을 확인해 주세요.', true);
            return true;
        };

        State.context.quantityModalContext.onCancel = () => {};

        // 다른 모드(데이터 관리의 '수정 저장')가 바꿔 둔 버튼 글자를 되돌린다
        if (DOM.confirmQuantityBtn && !DOM.confirmQuantityBtn.disabled) DOM.confirmQuantityBtn.textContent = '확인 및 저장';

        const quantityModalEl = document.getElementById('quantity-modal');
        if (quantityModalEl) quantityModalEl.classList.remove('hidden');
    };

    if (DOM.openQuantityModalTodayBtn) {
        DOM.openQuantityModalTodayBtn.addEventListener('click', () => {
            openTodayQuantityModal();
            if (DOM.menuDropdown) DOM.menuDropdown.classList.add('hidden');
        });
    }

    if (DOM.openQuantityModalTodayBtnMobile) {
        DOM.openQuantityModalTodayBtnMobile.addEventListener('click', () => {
            openTodayQuantityModal();
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

            // index.html 의 탭 버튼 클래스와 같은 목록(다크모드 포함)
            const TAB_ON = ['font-bold', 'text-blue-600', 'dark:text-blue-400', 'border-blue-600', 'dark:border-blue-400'];
            const TAB_OFF = ['font-medium', 'text-gray-400', 'dark:text-gray-500', 'border-transparent', 'hover:text-gray-700', 'dark:hover:text-gray-300', 'hover:border-gray-300', 'dark:hover:border-gray-600'];
            analysisTabs.querySelectorAll('.analysis-tab-btn').forEach(btn => {
                btn.classList.remove(...TAB_ON);
                btn.classList.add(...TAB_OFF);
            });
            button.classList.remove(...TAB_OFF);
            button.classList.add(...TAB_ON);

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
}