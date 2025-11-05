// === listeners-main.js (메인 화면 리스너) ===

import {
    appState, appConfig, db, auth, 
    persistentLeaveSchedule, allHistoryData,
    context, 
    LEAVE_TYPES,

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
    leaveTypeModal, leaveMemberNameSpan, leaveTypeOptionsContainer,
    leaveDateInputsDiv, leaveStartDateInput, leaveEndDateInput,
    cancelLeaveConfirmModal, cancelLeaveConfirmMessage,
    toggleCompletedLog, toggleAnalysis, toggleSummary,
    menuToggleBtn, menuDropdown,
    openQuantityModalTodayBtn, openQuantityModalTodayBtnMobile, 
    hamburgerBtn, navContent, 
    analysisMemberSelect,

    render, debouncedSaveState, 
    generateId, 
    markDataAsDirty,
    
    loginModal, loginForm, loginEmailInput, loginPasswordInput, loginSubmitBtn,
    loginErrorMsg, loginButtonText, loginButtonSpinner, logoutBtn, logoutBtnMobile,
    
} from './app.js';

import { calcElapsedMinutes, showToast, getTodayDateString, getCurrentTime } from './utils.js';

import {
    getAllDashboardDefinitions,
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions,
    renderPersonalAnalysis,
    renderQuantityModalInputs 
} from './ui.js';

import {
    stopWorkIndividual, pauseWorkGroup, resumeWorkGroup,
    pauseWorkIndividual, resumeWorkIndividual
} from './app-logic.js';

import {
    saveProgress, saveDayDataToHistory,
    checkMissingQuantities 
} from './app-history-logic.js';

import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


/**
 * 1. 메인 화면 (작업 보드, 완료 기록, 메뉴, 분석) 리스너 설정
 */
export function setupMainScreenListeners() {
    
    if (teamStatusBoard) {
      teamStatusBoard.addEventListener('click', (e) => {
        
        const toggleMobileBtn = e.target.closest('#toggle-all-tasks-mobile');
        if (toggleMobileBtn) {
            e.stopPropagation(); 
            context.isMobileTaskViewExpanded = !context.isMobileTaskViewExpanded;
            render(); 
            return;
        }
        
        const toggleMemberBtn = e.target.closest('#toggle-all-members-mobile');
        if (toggleMemberBtn) {
            e.stopPropagation();
            context.isMobileMemberViewExpanded = !context.isMobileMemberViewExpanded;
            render(); 
            return;
        }

        const stopGroupButton = e.target.closest('.stop-work-group-btn');
        if (stopGroupButton) {
            context.groupToStopId = Number(stopGroupButton.dataset.groupId); 
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
            context.recordToStopId = individualStopBtn.dataset.recordId; 
            const record = (appState.workRecords || []).find(r => r.id === context.recordToStopId);
            if (stopIndividualConfirmMessage && record) {
                 stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
            }
            if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.remove('hidden');
            return;
        }

        const groupTimeDisplay = e.target.closest('.group-time-display[data-action="edit-group-start-time"]');
        if (groupTimeDisplay) {
            const groupId = Number(groupTimeDisplay.dataset.groupId);
            const currentStartTime = groupTimeDisplay.dataset.currentStartTime;
            if (!groupId || !currentStartTime) return;

            context.recordIdOrGroupIdToEdit = groupId; 
            context.editType = 'group'; 

            if(editStartTimeModalTitle) editStartTimeModalTitle.textContent = '그룹 시작 시간 변경';
            if(editStartTimeModalMessage) editStartTimeModalMessage.textContent = '이 그룹의 모든 팀원의 시작 시간이 변경됩니다.';
            if(editStartTimeInput) editStartTimeInput.value = currentStartTime;
            if(editStartTimeContextIdInput) editStartTimeContextIdInput.value = groupId;
            if(editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = 'group';
            
            if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
            return;
        }

        const individualEditTimeBtn = e.target.closest('button[data-action="edit-individual-start-time"]');
        if (individualEditTimeBtn) {
            const recordId = individualEditTimeBtn.dataset.recordId;
            const currentStartTime = individualEditTimeBtn.dataset.currentStartTime;
            const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
            if (!record) return;

            context.recordIdOrGroupIdToEdit = recordId; 
            context.editType = 'individual'; 

            if(editStartTimeModalTitle) editStartTimeModalTitle.textContent = '개별 시작 시간 변경';
            if(editStartTimeModalMessage) editStartTimeModalMessage.textContent = `${record.member}님의 시작 시간을 변경합니다.`;
            if(editStartTimeInput) editStartTimeInput.value = currentStartTime;
            if(editStartTimeContextIdInput) editStartTimeContextIdInput.value = recordId;
            if(editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = 'individual';

            if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
            return;
        }
        
        const editLeaveCard = e.target.closest('[data-action="edit-leave-record"]');
        if (editLeaveCard) {
            const memberName = editLeaveCard.dataset.memberName;
            const currentType = editLeaveCard.dataset.leaveType;
            const currentStartTime = editLeaveCard.dataset.startTime; 
            const currentStartDate = editLeaveCard.dataset.startDate; 
            const currentEndTime = editLeaveCard.dataset.endTime;
            const currentEndDate = editLeaveCard.dataset.endDate;

            const role = appState.currentUserRole || 'user';
            const selfName = appState.currentUser || null;
            if (role !== 'admin' && memberName !== selfName) {
                showToast('본인의 근태 기록만 수정할 수 있습니다.', true);
                return;
            }
            
            // ✅ [수정] '외출'인 경우에만 '복귀' 모달 띄움. ('조퇴'는 수정 모달로)
            if (currentType === '외출') {
                context.memberToCancelLeave = memberName;
                if (cancelLeaveConfirmMessage) {
                    cancelLeaveConfirmMessage.textContent = `${memberName}님을 '${currentType}' 상태에서 복귀(취소) 처리하시겠습니까?`;
                }
                if (cancelLeaveConfirmModal) {
                    cancelLeaveConfirmModal.classList.remove('hidden');
                }
                return; 
            }

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
            
            context.memberToSetLeave = memberName; 
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

        if (e.target.closest('.members-list, .card-actions, .group-time-display')) {
            e.stopPropagation(); 
            return;
        }

        const card = e.target.closest('div[data-group-id], div[data-action]');
        
        if (card) { 
            const action = card.dataset.action;
            const groupId = card.dataset.groupId;
            const task = card.dataset.task;

            if (action === 'start-task') {
                context.selectedTaskForStart = task; 
                context.selectedGroupForAdd = null; 
                renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
                const titleEl = document.getElementById('team-select-modal-title');
                if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
                if (teamSelectModal) teamSelectModal.classList.remove('hidden');
                return;

            } else if (action === 'other') {
                if (taskSelectModal) taskSelectModal.classList.remove('hidden');
                return;
            
            } else if (groupId && task) {
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

    const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
    if (deleteAllCompletedBtn) {
      deleteAllCompletedBtn.addEventListener('click', () => {
        context.deleteMode = 'all'; 
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
            
            const quantityModal = document.getElementById('quantity-modal');

            const todayData = {
                workRecords: appState.workRecords || [],
                taskQuantities: appState.taskQuantities || {},
            };
            const missingTasksList = checkMissingQuantities(todayData);

            renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || [], missingTasksList);

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
                    
                    saveProgress(true); 
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
            
            const quantityModal = document.getElementById('quantity-modal');

            const todayData = {
                workRecords: appState.workRecords || [],
                taskQuantities: appState.taskQuantities || {},
            };
            const missingTasksList = checkMissingQuantities(todayData);

            renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || [], missingTasksList);

            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';
            
            context.quantityModalContext.mode = 'today'; 
            context.quantityModalContext.dateKey = null; 
            context.quantityModalContext.onConfirm = (newQuantities) => { 
                appState.taskQuantities = newQuantities;
                debouncedSaveState(); 
                
                saveProgress(true); 

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
                if (loginPasswordInput) loginPasswordInput.value = ''; 
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
            } catch (error) {
                console.error('Logout error:', error);
                showToast('로그아웃 중 오류가 발생했습니다.', true);
            }
        });
    }
}