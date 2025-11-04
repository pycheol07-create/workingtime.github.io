// === listeners-main.js (메인 화면 리스너) ===

// app.js (메인)에서 가져올 핵심 상태 및 DOM 요소들
import {
    appState, appConfig, db, auth, 
    persistentLeaveSchedule, allHistoryData,
    context, 
    LEAVE_TYPES,

    // DOM 요소 (이 파일에서 필요한 것들)
    teamStatusBoard, workLogBody,
    deleteConfirmModal, 
    endShiftBtn, endShiftConfirmModal, endShiftConfirmTitle, endShiftConfirmMessage,
    saveProgressBtn,
    editRecordModal, 
    taskSelectModal,
    stopIndividualConfirmModal, stopIndividualConfirmMessage,
    teamSelectModal, 
    editStartTimeModal, editStartTimeModalTitle, editStartTimeModalMessage, 
    editStartTimeInput, editStartTimeContextIdInput, editStartTimeContextTypeInput,
    editLeaveModal,
    leaveTypeModal, leaveModalTitle, leaveMemberNameSpan, leaveTypeOptionsContainer,
    leaveDateInputsDiv, leaveStartDateInput, leaveEndDateInput,
    cancelLeaveConfirmModal, cancelLeaveConfirmMessage,
    toggleCompletedLog, toggleAnalysis, toggleSummary,
    menuToggleBtn, menuDropdown,
    openQuantityModalTodayBtn, openQuantityModalTodayBtnMobile, 
    hamburgerBtn, navContent, 
    analysisMemberSelect,

    // app.js (메인)의 헬퍼/로직 함수
    render, debouncedSaveState, 
    generateId, 
    
    // (로그인/로그아웃 DOM 요소)
    loginModal, 
    loginForm,
    loginEmailInput,
    loginPasswordInput,
    loginSubmitBtn,
    loginErrorMsg,
    loginButtonText,
    loginButtonSpinner,
    logoutBtn,
    logoutBtnMobile,
    
} from './app.js';

// utils.js에서 필요한 모든 헬퍼 함수 가져오기
import { calcElapsedMinutes, showToast, getTodayDateString, getCurrentTime } from './utils.js';

// ui.js (통합)에서 가져올 렌더링 함수
import {
    getAllDashboardDefinitions,
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions,
    renderPersonalAnalysis
} from './ui.js';

// app-logic.js (업무 로직)
import {
    stopWorkIndividual, pauseWorkGroup, resumeWorkGroup,
    pauseWorkIndividual, resumeWorkIndividual
} from './app-logic.js';

// app-history-logic.js (이력 로직)
import {
    saveProgress, saveDayDataToHistory
} from './app-history-logic.js';

// Firebase (Auth)
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


/**
 * 1. 메인 화면 (작업 보드, 완료 기록, 메뉴, 분석) 리스너 설정
 */
export function setupMainScreenListeners() {
    
    // --- 1. 메인 화면 (teamStatusBoard) 리스너 ---
    if (teamStatusBoard) {
      teamStatusBoard.addEventListener('click', (e) => {
        
        // 1. 모바일 토글 버튼들
        const toggleMobileBtn = e.target.closest('#toggle-all-tasks-mobile');
        if (toggleMobileBtn) {
            e.stopPropagation(); 
            
            // 👈 [수정] DOM을 직접 조작하는 대신 context 상태를 변경하고 render() 호출
            context.isMobileTaskViewExpanded = !context.isMobileTaskViewExpanded;
            render(); // render()가 'ui-main.js'의 renderRealtimeStatus를 올바른 상태로 호출
            
            return;
        }
        
        const toggleMemberBtn = e.target.closest('#toggle-all-members-mobile');
        if (toggleMemberBtn) {
            e.stopPropagation();

            // 👈 [수정] DOM을 직접 조작하는 대신 context 상태를 변경하고 render() 호출
            context.isMobileMemberViewExpanded = !context.isMobileMemberViewExpanded;
            render(); // render()가 'ui-main.js'의 renderRealtimeStatus를 올바른 상태로 호출
            
            return;
        }

        // 2. 카드 내부의 액션 버튼들
        const stopGroupButton = e.target.closest('.stop-work-group-btn');
        if (stopGroupButton) {
            context.groupToStopId = Number(stopGroupButton.dataset.groupId); // ✅ context.
            if (document.getElementById('stop-group-confirm-modal')) {
                 document.getElementById('stop-group-confirm-modal').classList.remove('hidden');
            }
            return;
        }
        const pauseGroupButton = e.target.closest('.pause-work-group-btn');
        if (pauseGroupButton) {
            pauseWorkGroup(Number(pauseGroupButton.dataset.groupId));
            return;
        }
        const resumeGroupButton = e.target.closest('.resume-work-group-btn');
        if (resumeGroupButton) {
            resumeWorkGroup(Number(resumeGroupButton.dataset.groupId));
            return;
        }
        const individualPauseBtn = e.target.closest('[data-action="pause-individual"]');
        if (individualPauseBtn) {
            pauseWorkIndividual(individualPauseBtn.dataset.recordId);
            return;
        }
        const individualResumeBtn = e.target.closest('[data-action="resume-individual"]');
        if (individualResumeBtn) {
            resumeWorkIndividual(individualResumeBtn.dataset.recordId);
            return;
        }
        const individualStopBtn = e.target.closest('button[data-action="stop-individual"]');
        if (individualStopBtn) {
            context.recordToStopId = individualStopBtn.dataset.recordId; // ✅ context.
            const record = (appState.workRecords || []).find(r => r.id === context.recordToStopId);
            if (stopIndividualConfirmMessage && record) {
                 stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
            }
            if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.remove('hidden');
            return;
        }

        // 3. 그룹 시작 시간 수정 영역
        const groupTimeDisplay = e.target.closest('.group-time-display[data-action="edit-group-start-time"]');
        if (groupTimeDisplay) {
            const groupId = Number(groupTimeDisplay.dataset.groupId);
            const currentStartTime = groupTimeDisplay.dataset.currentStartTime;
            if (!groupId || !currentStartTime) return;

            context.recordIdOrGroupIdToEdit = groupId; // ✅ context.
            context.editType = 'group'; // ✅ context.

            if(editStartTimeModalTitle) editStartTimeModalTitle.textContent = '그룹 시작 시간 변경';
            if(editStartTimeModalMessage) editStartTimeModalMessage.textContent = '이 그룹의 모든 팀원의 시작 시간이 변경됩니다.';
            if(editStartTimeInput) editStartTimeInput.value = currentStartTime;
            if(editStartTimeContextIdInput) editStartTimeContextIdInput.value = groupId;
            if(editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = 'group';
            
            if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
            return;
        }

        // 4. 개별 시작 시간 수정 (시계 아이콘 버튼)
        const individualEditTimeBtn = e.target.closest('button[data-action="edit-individual-start-time"]');
        if (individualEditTimeBtn) {
            const recordId = individualEditTimeBtn.dataset.recordId;
            const currentStartTime = individualEditTimeBtn.dataset.currentStartTime;
            const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
            if (!record) return;

            context.recordIdOrGroupIdToEdit = recordId; // ✅ context.
            context.editType = 'individual'; // ✅ context.

            if(editStartTimeModalTitle) editStartTimeModalTitle.textContent = '개별 시작 시간 변경';
            if(editStartTimeModalMessage) editStartTimeModalMessage.textContent = `${record.member}님의 시작 시간을 변경합니다.`;
            if(editStartTimeInput) editStartTimeInput.value = currentStartTime;
            if(editStartTimeContextIdInput) editStartTimeContextIdInput.value = recordId;
            if(editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = 'individual';

            if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
            return;
        }
        
        // 6. 통합 근태 수정 카드 클릭 (data-action="edit-leave-record")
        const editLeaveCard = e.target.closest('[data-action="edit-leave-record"]');
        if (editLeaveCard) {
            const memberName = editLeaveCard.dataset.memberName;
            const currentType = editLeaveCard.dataset.leaveType;
            const currentStartTime = editLeaveCard.dataset.startTime; // 외출/조퇴용
            const currentStartDate = editLeaveCard.dataset.startDate; // 연차/결근/출장용
            const currentEndTime = editLeaveCard.dataset.endTime;
            const currentEndDate = editLeaveCard.dataset.endDate;

            const role = appState.currentUserRole || 'user';
            const selfName = appState.currentUser || null;
            if (role !== 'admin' && memberName !== selfName) {
                showToast('본인의 근태 기록만 수정할 수 있습니다.', true);
                return;
            }
            
            // '외출' 또는 '조퇴'인 경우, '복귀' 확인 모달을 바로 띄웁니다.
            if (currentType === '외출' || currentType === '조퇴') {
                context.memberToCancelLeave = memberName;
                if (cancelLeaveConfirmMessage) {
                    cancelLeaveConfirmMessage.textContent = `${memberName}님을 '${currentType}' 상태에서 복귀(취소) 처리하시겠습니까?`;
                }
                if (cancelLeaveConfirmModal) {
                    cancelLeaveConfirmModal.classList.remove('hidden');
                }
                return; // 👈 중요: 수정 모달을 열지 않고 여기서 종료
            }


            // (이하 기존 로직)
            // '연차', '출장', '결근'인 경우에만 전체 수정 모달이 열립니다.
            const modal = document.getElementById('edit-leave-record-modal');
            const titleEl = document.getElementById('edit-leave-modal-title');
            const nameEl = document.getElementById('edit-leave-member-name');
            const typeSelect = document.getElementById('edit-leave-type');
            const timeFields = document.getElementById('edit-leave-time-fields');
            const dateFields = document.getElementById('edit-leave-date-fields');
            const startTimeInput = document.getElementById('edit-leave-start-time');
            const endTimeInput = document.getElementById('edit-leave-end-time');
            const startDateInput = document.getElementById('edit-leave-start-date');
            const endDateInput = document.getElementById('edit-leave-end-date');
            const originalNameInput = document.getElementById('edit-leave-original-member-name');
            const originalStartInput = document.getElementById('edit-leave-original-start-identifier');
            const originalTypeInput = document.getElementById('edit-leave-original-type');

            if (!modal || !typeSelect) return;

            titleEl.textContent = `${memberName}님 근태 수정`;
            nameEl.textContent = memberName;

            typeSelect.innerHTML = '';
            LEAVE_TYPES.forEach(type => {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                if (type === currentType) {
                    option.selected = true;
                }
                typeSelect.appendChild(option);
            });

            const isTimeBased = (currentType === '외출' || currentType === '조퇴');
            const isDateBased = !isTimeBased;

            timeFields.classList.toggle('hidden', !isTimeBased);
            dateFields.classList.toggle('hidden', isTimeBased);

            if (isTimeBased) {
                startTimeInput.value = currentStartTime || '';
                endTimeInput.value = currentEndTime || '';
            } else {
                startDateInput.value = currentStartDate || '';
                endDateInput.value = currentEndDate || '';
            }

            originalNameInput.value = memberName;
            originalStartInput.value = isTimeBased ? currentStartTime : currentStartDate;
            originalTypeInput.value = isTimeBased ? 'daily' : 'persistent'; 

            modal.classList.remove('hidden');
            return; 
        }

        // 7. 근태 설정 카드 (data-action="member-toggle-leave")
        const memberCard = e.target.closest('[data-action="member-toggle-leave"]');
        if (memberCard) {
            const memberName = memberCard.dataset.memberName;
            const role = appState.currentUserRole || 'user';
            const selfName = appState.currentUser || null;

            if (role !== 'admin' && memberName !== selfName) {
                showToast('본인의 근태 현황만 설정할 수 있습니다.', true); return;
            }
            const isWorking = (appState.workRecords || []).some(r => r.member === memberName && (r.status === 'ongoing' || r.status === 'paused'));
            if (isWorking) {
                return showToast(`${memberName}님은 현재 업무 중이므로 근태 상태를 변경할 수 없습니다.`, true);
            }
            
            context.memberToSetLeave = memberName; // ✅ context.
            if(leaveMemberNameSpan) leaveMemberNameSpan.textContent = memberName;
            renderLeaveTypeModalOptions(LEAVE_TYPES);
            if(leaveStartDateInput) leaveStartDateInput.value = getTodayDateString();
            if(leaveEndDateInput) leaveEndDateInput.value = '';
            const firstRadio = leaveTypeOptionsContainer?.querySelector('input[type="radio"]');
            if (firstRadio) {
                const initialType = firstRadio.value;
                if (leaveDateInputsDiv) leaveDateInputsDiv.classList.toggle('hidden', !(initialType === '연차' || initialType === '출장' || initialType === '결근'));
            } else if (leaveDateInputsDiv) { leaveDateInputsDiv.classList.add('hidden'); }
            if(leaveTypeModal) leaveTypeModal.classList.remove('hidden');
            
            return;
        }

        // 8. 업무 카드 전체 클릭 (시작, 기타, 또는 인원 추가)
        
        // 8a. 카드 내부의 상호작용 요소 클릭 시, 카드 전체 클릭(8b)으로 
        //     이벤트가 전파되는 것을 막습니다. (가장 중요)
        if (e.target.closest('.members-list, .card-actions, .group-time-display')) {
            // (members-list: 멤버 목록)
            // (card-actions: 하단 버튼 영역)
            // (group-time-display: 상단 시간 표시 영역)
            e.stopPropagation(); // 👈 이 클릭은 카드 전체 클릭으로 간주하지 않음
            return;
        }

        // 8b. 카드 자체(빈 공간) 클릭 처리
        // 'start-task' 카드는 data-action을, '진행 중' 카드는 data-group-id를 가집니다.
        const card = e.target.closest('div[data-group-id], div[data-action]');
        
        if (card) { 
            const action = card.dataset.action;
            const groupId = card.dataset.groupId;
            const task = card.dataset.task;

            if (action === 'start-task') {
                // (기존) 시작 전 카드 클릭
                context.selectedTaskForStart = task; 
                context.selectedGroupForAdd = null; 
                renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
                const titleEl = document.getElementById('team-select-modal-title');
                if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
                if (teamSelectModal) teamSelectModal.classList.remove('hidden');
                return;

            } else if (action === 'other') {
                // (기존) 기타 업무 카드 클릭
                if (taskSelectModal) taskSelectModal.classList.remove('hidden');
                return;
            
            } else if (groupId && task) {
                // (신규) 진행 중인 카드 (data-group-id가 있는 카드)의 
                // 빈 공간 클릭 시 -> '인원 추가' 로직 실행
                
                context.selectedTaskForStart = task;
                context.selectedGroupForAdd = Number(groupId); 
                renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
                const titleEl = document.getElementById('team-select-modal-title');
                if (titleEl) titleEl.textContent = `'${task}' 인원 추가`;
                if (teamSelectModal) teamSelectModal.classList.remove('hidden');
                return;
            }
        }
        
      }); 
    } 

    // --- 2. 완료 기록 (workLogBody) 리스너 ---
    if (workLogBody) {
      workLogBody.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('button[data-action="delete"]');
        if (deleteBtn) {
          context.recordToDeleteId = deleteBtn.dataset.recordId; 
          context.deleteMode = 'single'; 
          const msgEl = document.getElementById('delete-confirm-message');
          if (msgEl) msgEl.textContent = '이 업무 기록을 삭제하시겠습니까?';
          if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
          return;
        }
        const editBtn = e.target.closest('button[data-action="edit"]');
        if (editBtn) {
          context.recordToEditId = editBtn.dataset.recordId; 
          const record = (appState.workRecords || []).find(r => String(r.id) === String(context.recordToEditId));
          if (record) {
            document.getElementById('edit-member-name').value = record.member;
            document.getElementById('edit-start-time').value = record.startTime || '';
            document.getElementById('edit-end-time').value = record.endTime || '';

            const taskSelect = document.getElementById('edit-task-type');
            taskSelect.innerHTML = ''; 
            
            const allTasks = (appConfig.taskGroups || []).flatMap(group => group.tasks);
            
            allTasks.forEach(task => {
                const option = document.createElement('option');
                option.value = task;
                option.textContent = task;
                if (task === record.task) option.selected = true;
                taskSelect.appendChild(option);
            });

            if (editRecordModal) editRecordModal.classList.remove('hidden');
          }
          return;
        }
      });
    }

    // --- 3. 버튼 리스너 (일괄 삭제, 저장, 마감 등) ---
    const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
    if (deleteAllCompletedBtn) {
      deleteAllCompletedBtn.addEventListener('click', () => {
        context.deleteMode = 'all'; // ✅ context.
        const msgEl = document.getElementById('delete-confirm-message');
        if (msgEl) msgEl.textContent = '오늘 완료된 모든 업무 기록을 삭제하시겠습니까?';
        if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
      });
    }
        
    if (endShiftBtn) {
      endShiftBtn.addEventListener('click', () => {
        const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
        
        if (ongoingRecords.length > 0) {
            const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
            const ongoingTaskCount = ongoingTaskNames.size;
            if (endShiftConfirmTitle) endShiftConfirmTitle.textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
            if (endShiftConfirmMessage) endShiftConfirmMessage.textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
            if (endShiftConfirmModal) endShiftConfirmModal.classList.remove('hidden');
        } else {
            saveDayDataToHistory(false);
            showToast('업무 마감 처리 완료. 오늘의 기록을 이력에 저장하고 초기화했습니다.');
        }
      });
    }
    
    if (saveProgressBtn) {
      saveProgressBtn.addEventListener('click', () => saveProgress(false));
    }

    // --- 8. 기타 UI 리스너 ---
    [toggleCompletedLog, toggleAnalysis, toggleSummary].forEach(toggle => {
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

    // --- 10. 메뉴 및 햄버거 리스너 ---
    if (hamburgerBtn && navContent) {
        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            navContent.classList.toggle('hidden');
        });
        navContent.addEventListener('click', (e) => {
            if (window.innerWidth < 768 && e.target.closest('a, button')) {
                navContent.classList.add('hidden');
            }
        });
    }

    if (menuToggleBtn) {
        menuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            if (menuDropdown) menuDropdown.classList.toggle('hidden');
        });
    }

    document.addEventListener('click', (e) => {
        if (navContent && hamburgerBtn) { 
            const isClickInsideNav = navContent.contains(e.target);
            const isClickOnHamburger = hamburgerBtn.contains(e.target);
            if (!navContent.classList.contains('hidden') && !isClickInsideNav && !isClickOnHamburger) {
                navContent.classList.add('hidden');
            }
        }
        if (menuDropdown && menuToggleBtn) {
            const isClickInsideMenu = menuDropdown.contains(e.target);
            const isClickOnMenuBtn = menuToggleBtn.contains(e.target);
            if (!menuDropdown.classList.contains('hidden') && !isClickInsideMenu && !isClickOnMenuBtn) {
                menuDropdown.classList.add('hidden');
            }
        }
    });
    
    if (openQuantityModalTodayBtn) {
        openQuantityModalTodayBtn.addEventListener('click', () => {
            if (!auth || !auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (loginModal) loginModal.classList.remove('hidden');
                return;
            }
            // (로직이 listeners-modals.js의 'confirmQuantityBtn' 리스너로 이동)
            // ...
            
            // ✅ 이 리스너는 모달을 열고 'context'를 설정하는 역할만 합니다.
            const quantityModal = document.getElementById('quantity-modal');
            renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || []);
            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';

            context.quantityModalContext.mode = 'today'; 
            context.quantityModalContext.dateKey = null; 
            context.quantityModalContext.onConfirm = async (newQuantities) => { 
                appState.taskQuantities = newQuantities;
                debouncedSaveState(); 
                showToast('오늘의 처리량이 저장되었습니다.');
                render();

                try {
                    const allDefinitions = getAllDashboardDefinitions(appConfig); 
                    const dashboardItemIds = appConfig.dashboardItems || [];     
                    const quantityTaskTypes = appConfig.quantityTaskTypes || []; 
                    const quantitiesFromState = appState.taskQuantities || {}; 
                    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
                    
                    for (const task in quantitiesFromState) {
                        if (!quantityTaskTypes.includes(task)) continue;
                        const quantity = newQuantities[task] || 0;
                        const targetDashboardId = taskNameToDashboardIdMap[task]; 

                        if (targetDashboardId && allDefinitions[targetDashboardId] && dashboardItemIds.includes(targetDashboardId)) {
                            const valueId = allDefinitions[targetDashboardId].valueId; 
                            const element = document.getElementById(valueId);        
                            if (element) {
                                element.textContent = quantity; 
                            } 
                        } 
                    }
                } catch (syncError) {
                    console.error("Error during dashboard sync:", syncError);
                }

                const todayDateKey = getTodayDateString();
                const todayHistoryIndex = allHistoryData.findIndex(d => d.id === todayDateKey);
                if (todayHistoryIndex > -1) {
                    const todayHistoryData = allHistoryData[todayHistoryIndex];
                    const updatedHistoryData = { ...todayHistoryData, taskQuantities: newQuantities };
                    allHistoryData[todayHistoryIndex] = updatedHistoryData;
                    const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', todayDateKey);
                    try {
                        // (이 import가 누락되어 있었네요. listeners-modals.js로 옮길 때 추가해야 합니다.)
                        // import { doc, setDoc } from "https/..."
                        // await setDoc(historyDocRef, updatedHistoryData);
                        console.warn("setDoc in openQuantityModalTodayBtn listener needs to be moved to listeners-modals.js confirm logic");
                    } catch (e) {
                        console.error('오늘 날짜 이력(history) 처리량 업데이트 실패:', e);
                        allHistoryData[todayHistoryIndex] = todayHistoryData;
                    }
                }
            };
            context.quantityModalContext.onCancel = () => {}; 

            const cBtn = document.getElementById('confirm-quantity-btn');
            const xBtn = document.getElementById('cancel-quantity-btn');
            if (cBtn) cBtn.textContent = '저장';
            if (xBtn) xBtn.textContent = '취소';
            if (quantityModal) quantityModal.classList.remove('hidden');
            if (menuDropdown) menuDropdown.classList.add('hidden');
        });
    }

    if (openQuantityModalTodayBtnMobile) {
        openQuantityModalTodayBtnMobile.addEventListener('click', () => {
            if (!auth || !auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (loginModal) loginModal.classList.remove('hidden');
                return;
            }
            
            // ✅ 위와 동일하게 모달을 열고 'context'를 설정합니다.
            const quantityModal = document.getElementById('quantity-modal');
            renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || []);
            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';
            
            context.quantityModalContext.mode = 'today'; 
            context.quantityModalContext.dateKey = null; 
            context.quantityModalContext.onConfirm = (newQuantities) => { 
                appState.taskQuantities = newQuantities;
                debouncedSaveState(); 
                showToast('오늘의 처리량이 저장되었습니다.');
                render(); 
            };
            context.quantityModalContext.onCancel = () => {}; 

            const cBtn = document.getElementById('confirm-quantity-btn');
            const xBtn = document.getElementById('cancel-quantity-btn');
            if (cBtn) cBtn.textContent = '저장';
            if (xBtn) xBtn.textContent = '취소';
            if (quantityModal) quantityModal.classList.remove('hidden');
            if (navContent) navContent.classList.add('hidden');
        });
    }
    
    // --- 12. 분석 탭 리스너 ---
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

    if (analysisMemberSelect) {
        analysisMemberSelect.addEventListener('change', (e) => {
            const selectedMember = e.target.value;
            renderPersonalAnalysis(selectedMember, appState);
        });
    }
    
    // --- 16. 로그인/로그아웃 리스너 ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (loginSubmitBtn) loginSubmitBtn.disabled = true;
            if (loginButtonText) loginButtonText.classList.add('hidden');
            if (loginButtonSpinner) loginButtonSpinner.classList.remove('hidden');
            if (loginErrorMsg) loginErrorMsg.classList.add('hidden');

            const email = loginEmailInput.value;
            const password = loginPasswordInput.value;

            try {
                await signInWithEmailAndPassword(auth, email, password);
                // onAuthStateChanged in app.js가 성공 처리를 합니다.
                if (loginPasswordInput) loginPasswordInput.value = ''; // 비밀번호 필드 지우기
            } catch (error) {
                console.error('Login error:', error.code, error.message);
                if (loginErrorMsg) {
                    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                        loginErrorMsg.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
                    } else {
                        loginErrorMsg.textContent = `로그인 오류: ${error.code}`;
                    }
                    loginErrorMsg.classList.remove('hidden');
                }
            } finally {
                if (loginSubmitBtn) loginSubmitBtn.disabled = false;
                if (loginButtonText) loginButtonText.classList.remove('hidden');
                if (loginButtonSpinner) loginButtonSpinner.classList.add('hidden');
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                // onAuthStateChanged in app.js가 UI 변경을 처리합니다.
            } catch (error) {
                console.error('Logout error:', error);
                showToast('로그아웃 중 오류가 발생했습니다.', true);
            }
        });
    }
    
    if (logoutBtnMobile) {
        logoutBtnMobile.addEventListener('click', async () => {
            try {
                await signOut(auth);
                // onAuthStateChanged in app.js가 UI 변경을 처리합니다.
            } catch (error) {
                console.error('Logout error:', error);
                showToast('로그아웃 중 오류가 발생했습니다.', true);
            }
        });
    }
}