// === js/listeners/modals.js ===

import { appState, appConfig, persistentLeaveSchedule, setAppState } from '../store.js';
import { debouncedSaveState, saveProgress, saveLeaveSchedule, updateHistoryDoc, deleteHistoryDoc } from '../api.js';
import { showToast, getTodayDateString, generateId, calcElapsedMinutes, normalizeName } from '../utils.js';
import * as actions from '../actions.js';
// ✅ [수정] ui/index.js에서 필요한 모든 ui 함수를 가져옵니다.
import * as ui from '../ui/index.js';

const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장']; // (임시)

/**
 * 모든 모달(팝업)의 확인/취소/닫기 리스너를 부착합니다.
 */
export function attachModalListeners() {

    // === 1. 상단 메뉴 및 버튼 (모달 열기) ===
    
    // '처리량 입력' (데스크탑)
    const openQuantityModalTodayBtn = document.getElementById('open-quantity-modal-today');
    if (openQuantityModalTodayBtn) {
        openQuantityModalTodayBtn.addEventListener('click', () => {
            ui.renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || []);
            document.getElementById('quantity-modal-title').textContent = '오늘의 처리량 입력';
            
            window.quantityModalContext = {
                mode: 'today',
                dateKey: null,
                onConfirm: handleQuantityUpdate,
                onCancel: () => {}
            };
            
            document.getElementById('confirm-quantity-btn').textContent = '저장';
            document.getElementById('cancel-quantity-btn').textContent = '취소';
            document.getElementById('quantity-modal').classList.remove('hidden');
            document.getElementById('menu-dropdown')?.classList.add('hidden');
        });
    }

    // '처리량 입력' (모바일)
    const openQuantityModalTodayBtnMobile = document.getElementById('open-quantity-modal-today-mobile');
    if (openQuantityModalTodayBtnMobile) {
        openQuantityModalTodayBtnMobile.addEventListener('click', () => {
            ui.renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || []);
            document.getElementById('quantity-modal-title').textContent = '오늘의 처리량 입력';
            
            window.quantityModalContext = {
                mode: 'today',
                dateKey: null,
                onConfirm: handleQuantityUpdate,
                onCancel: () => {}
            };
            
            document.getElementById('confirm-quantity-btn').textContent = '저장';
            document.getElementById('cancel-quantity-btn').textContent = '취소';
            document.getElementById('quantity-modal').classList.remove('hidden');
            document.getElementById('nav-content')?.classList.add('hidden');
        });
    }

    // '수동 추가' (완료 로그)
    const openManualAddBtn = document.getElementById('open-manual-add-btn');
    if (openManualAddBtn) {
        openManualAddBtn.addEventListener('click', () => {
            ui.renderManualAddModalDatalists(appState, appConfig);
            document.getElementById('manual-add-form')?.reset();
            document.getElementById('manual-add-record-modal')?.classList.remove('hidden');
        });
    }
    
    // '일괄 삭제' (완료 로그)
    const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
    if (deleteAllCompletedBtn) {
      deleteAllCompletedBtn.addEventListener('click', () => {
        window.deleteMode = 'all';
        document.getElementById('delete-confirm-message').textContent = '오늘 완료된 모든 업무 기록을 삭제하시겠습니까?';
        document.getElementById('delete-confirm-modal').classList.remove('hidden');
      });
    }
    
    // '중간 저장'
    const saveProgressBtn = document.getElementById('save-progress-btn');
    if (saveProgressBtn) {
      saveProgressBtn.addEventListener('click', () => saveProgress(false));
    }

    // '업무 마감'
    const endShiftBtn = document.getElementById('end-shift-btn');
    if (endShiftBtn) {
      endShiftBtn.addEventListener('click', () => {
        const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
        
        if (ongoingRecords.length > 0) {
            const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
            const ongoingTaskCount = ongoingTaskNames.size;
            document.getElementById('end-shift-confirm-title').textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
            document.getElementById('end-shift-confirm-message').textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
            document.getElementById('end-shift-confirm-modal').classList.remove('hidden');
        } else {
            actions.saveDayDataToHistory(false);
            showToast('업무 마감 처리 완료. 오늘의 기록을 이력에 저장하고 초기화했습니다.');
        }
      });
    }
    
    // '초기화' (데스크탑)
    const resetAppBtn = document.getElementById('reset-app-btn');
    if (resetAppBtn) {
      resetAppBtn.addEventListener('click', () => {
        document.getElementById('reset-app-modal').classList.remove('hidden');
      });
    }
    // '초기화' (모바일)
    const resetAppBtnMobile = document.getElementById('reset-app-btn-mobile');
    if (resetAppBtnMobile) {
      resetAppBtnMobile.addEventListener('click', () => {
        document.getElementById('reset-app-modal').classList.remove('hidden');
        document.getElementById('nav-content')?.classList.add('hidden');
      });
    }

    // === 2. 모달 확인/저장 버튼 ===
    
    // '수량 입력' (공통) - 확인
    const confirmQuantityBtn = document.getElementById('confirm-quantity-btn');
    if (confirmQuantityBtn) {
      confirmQuantityBtn.addEventListener('click', () => {
        const inputs = document.getElementById('quantity-modal').querySelectorAll('input[data-task]');
        const newQuantities = {};
        inputs.forEach(input => {
          const task = input.dataset.task;
          const quantity = Number(input.value) || 0;
          if (quantity > 0) newQuantities[task] = quantity;
        });
        
        const context = window.quantityModalContext || {};
        if (context.onConfirm) {
          context.onConfirm(newQuantities);
        }
        
        document.getElementById('quantity-modal').classList.add('hidden');
      });
    }
    
    // '수동 기록 추가' - 저장
    const confirmManualAddBtn = document.getElementById('confirm-manual-add-btn');
    if (confirmManualAddBtn) {
        confirmManualAddBtn.addEventListener('click', () => {
            const member = document.getElementById('manual-add-member')?.value.trim();
            const task = document.getElementById('manual-add-task')?.value.trim();
            const startTime = document.getElementById('manual-add-start-time')?.value;
            const endTime = document.getElementById('manual-add-end-time')?.value;

            if (!member || !task || !startTime || !endTime) {
                return showToast('모든 필드를 올바르게 입력해주세요.', true);
            }
            if (endTime < startTime) {
                return showToast('종료 시간은 시작 시간보다 이후여야 합니다.', true);
            }

            const newId = generateId();
            const duration = calcElapsedMinutes(startTime, endTime, []);
            const newRecord = {
                id: newId, member, task, startTime, endTime, duration,
                status: 'completed', groupId: null, pauses: []
            };
            appState.workRecords.push(newRecord);
            debouncedSaveState(); 
            showToast('수동 기록이 추가되었습니다.');
            document.getElementById('manual-add-record-modal').classList.add('hidden');
        });
    }

    // '업무 기록 수정' (완료 로그) - 저장
    const confirmEditBtn = document.getElementById('confirm-edit-btn');
    if (confirmEditBtn) {
      confirmEditBtn.addEventListener('click', () => {
        const recordId = window.recordToEditId;
        if (!recordId) return;
        
        const idx = appState.workRecords.findIndex(r => String(r.id) === String(recordId));
        if (idx === -1) {
          showToast('수정할 기록을 찾을 수 없습니다.', true);
          document.getElementById('edit-record-modal').classList.add('hidden');
          window.recordToEditId = null;
          return;
        }

        const record = appState.workRecords[idx];
        const newTask = document.getElementById('edit-task-type').value;
        const newStart = document.getElementById('edit-start-time').value;
        const newEnd = document.getElementById('edit-end-time').value;

        if (!newStart || !newEnd || !newTask) {
            return showToast('모든 필드를 올바르게 입력해주세요.', true);
        }
        if (newEnd < newStart) {
            return showToast('종료 시간은 시작 시간보다 이후여야 합니다.', true);
        }

        record.task = newTask;
        record.startTime = newStart;
        record.endTime = newEnd;
        record.duration = calcElapsedMinutes(newStart, newEnd, record.pauses);

        debouncedSaveState();
        showToast('기록이 수정되었습니다.');
        document.getElementById('edit-record-modal').classList.add('hidden');
        window.recordToEditId = null;
      });
    }

    // '공통 삭제 확인' - 확인
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', async () => {
        let stateChanged = false;
        const deleteMode = window.deleteMode || 'single';
        
        if (deleteMode === 'all') {
          const originalLength = appState.workRecords.length;
          appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
          if (appState.workRecords.length < originalLength) {
              stateChanged = true;
              showToast('완료된 모든 기록이 삭제되었습니다.');
          } else {
              showToast('삭제할 완료 기록이 없습니다.');
          }
          
        } else if (deleteMode === 'single' && window.recordToDeleteId) {
          const originalLength = appState.workRecords.length;
          appState.workRecords = (appState.workRecords || []).filter(r => String(r.id) !== String(window.recordToDeleteId));
          if (appState.workRecords.length < originalLength) {
              stateChanged = true;
              showToast('선택한 기록이 삭제되었습니다.');
          }
          
        } else if (deleteMode === 'leave' && window.attendanceRecordToDelete) {
            const { memberName, startIdentifier, recordType } = window.attendanceRecordToDelete;
            let recordDeleted = false;
            let deletedRecordInfo = '';

            if (recordType === 'daily') {
                const index = appState.dailyOnLeaveMembers.findIndex(r => r.member === memberName && r.startTime === startIdentifier);
                if (index > -1) {
                    deletedRecordInfo = `${appState.dailyOnLeaveMembers[index].type}`;
                    appState.dailyOnLeaveMembers.splice(index, 1);
                    stateChanged = true; // daily가 변경됨
                    recordDeleted = true;
                }
            } else { // recordType === 'persistent'
                const index = persistentLeaveSchedule.onLeaveMembers.findIndex(r => r.member === memberName && r.startDate === startIdentifier);
                if (index > -1) {
                    deletedRecordInfo = `${persistentLeaveSchedule.onLeaveMembers[index].type}`;
                    persistentLeaveSchedule.onLeaveMembers.splice(index, 1);
                    try {
                        await saveLeaveSchedule(persistentLeaveSchedule); // api.js 호출
                        recordDeleted = true;
                    } catch (e) {
                         console.error('Error deleting persistent leave record:', e);
                         showToast('근태 기록 삭제 중 Firestore 저장 오류 발생.', true);
                    }
                }
            }
            if (recordDeleted) showToast(`${memberName}님의 '${deletedRecordInfo}' 기록이 삭제되었습니다.`);
            else showToast('삭제할 근태 기록을 찾지 못했습니다.', true);
            
        } else if (deleteMode === 'attendance-history' && window.attendanceRecordToDelete) {
            const { dateKey, index } = window.attendanceRecordToDelete;
            const dayDataIndex = window.allHistoryData.findIndex(d => d.id === dateKey);
            if (dayDataIndex > -1) {
                const dayData = window.allHistoryData[dayDataIndex];
                const record = dayData.onLeaveMembers[index];
                dayData.onLeaveMembers.splice(index, 1);
                try {
                    await updateHistoryDoc(dateKey, dayData); // api.js
                    showToast(`${record.member}님의 '${record.type}' 기록이 삭제되었습니다.`);
                    ui.renderAttendanceDailyHistory(dateKey, window.allHistoryData);
                } catch (e) {
                    showToast('이력 근태 기록 삭제 중 오류 발생.', true);
                    dayData.onLeaveMembers.splice(index, 0, record); // 원복
                }
            } else {
                showToast('이력 데이터를 찾을 수 없습니다.', true);
            }
        }
        
        if (stateChanged) { // daily 데이터가 변경된 경우
             debouncedSaveState();
        }

        document.getElementById('delete-confirm-modal').classList.add('hidden');
        window.recordToDeleteId = null;
        window.deleteMode = 'single';
        window.attendanceRecordToDelete = null;
      });
    }

    // '업무 마감 확인' - 종료 후 마감
    const confirmEndShiftBtn = document.getElementById('confirm-end-shift-btn');
    if (confirmEndShiftBtn) {
        confirmEndShiftBtn.addEventListener('click', () => {
            actions.saveDayDataToHistory(false);
            showToast('업무 마감 처리 완료. 오늘의 기록을 이력에 저장하고 초기화했습니다.');
            document.getElementById('end-shift-confirm-modal').classList.add('hidden');
        });
    }

    // '초기화 확인' - 예
    const confirmResetAppBtn = document.getElementById('confirm-reset-app-btn');
    if (confirmResetAppBtn) {
      confirmResetAppBtn.addEventListener('click', async () => {
        await actions.saveDayDataToHistory(true);
        document.getElementById('reset-app-modal').classList.add('hidden');
      });
    }
    
    // '처리량 입력' (업무 종료 시) - 확인
    const confirmQuantityOnStopBtn = document.getElementById('confirm-quantity-on-stop');
    if (confirmQuantityOnStopBtn) {
      confirmQuantityOnStopBtn.addEventListener('click', () => {
        if (window.groupToStopId) {
          const input = document.getElementById('quantity-on-stop-input');
          const quantity = input ? (Number(input.value) || 0) : null;
          actions.finalizeStopGroup(window.groupToStopId, quantity);
          if(input) input.value = '';
          window.groupToStopId = null;
          document.getElementById('quantity-on-stop-modal').classList.add('hidden');
        }
      });
    }

    // '개별 업무 종료 확인' - 예
    const confirmStopIndividualBtn = document.getElementById('confirm-stop-individual-btn');
    if (confirmStopIndividualBtn) {
      confirmStopIndividualBtn.addEventListener('click', () => {
        if (window.recordToStopId) {
          actions.stopWorkIndividual(window.recordToStopId);
        }
        document.getElementById('stop-individual-confirm-modal').classList.add('hidden');
        window.recordToStopId = null;
      });
    }

    // '그룹 업무 종료 확인' - 예
    const confirmStopGroupBtn = document.getElementById('confirm-stop-group-btn');
    if (confirmStopGroupBtn) {
      confirmStopGroupBtn.addEventListener('click', () => {
        if (window.groupToStopId) {
          actions.stopWorkGroup(window.groupToStopId);
        }
        document.getElementById('stop-group-confirm-modal').classList.add('hidden');
        window.groupToStopId = null;
      });
    }
    
    // '근태 설정' - 설정 완료
    const confirmLeaveBtn = document.getElementById('confirm-leave-btn');
    if (confirmLeaveBtn) confirmLeaveBtn.addEventListener('click', async () => {
        const memberName = window.memberToSetLeave;
        if (!memberName) return;

        const selectedTypeInput = document.querySelector('input[name="leave-type"]:checked');
        if (!selectedTypeInput) {
            return showToast('근태 유형을 선택해주세요.', true);
        }
        
        const leaveType = selectedTypeInput.value;
        const startDate = document.getElementById('leave-start-date-input')?.value;
        const endDate = document.getElementById('leave-end-date-input')?.value;

        if ((leaveType === '연차' || leaveType === '출장' || leaveType === '결근') && !startDate) {
            return showToast('시작일을 입력해주세요.', true);
        }
        if (endDate && endDate < startDate) {
            return showToast('종료일은 시작일보다 이후여야 합니다.', true);
        }

        await actions.handleLeaveRequest(memberName, leaveType, startDate, endDate);

        document.getElementById('leave-type-modal').classList.add('hidden');
        window.memberToSetLeave = null;
    });
    
    // '근태 복귀 확인' - 예
    const confirmCancelLeaveBtn = document.getElementById('confirm-cancel-leave-btn');
    if (confirmCancelLeaveBtn) {
        confirmCancelLeaveBtn.addEventListener('click', async () => {
            const memberName = window.memberToCancelLeave; 
            if (!memberName) return;
            
            await actions.handleCancelLeave(memberName);

            document.getElementById('cancel-leave-confirm-modal').classList.add('hidden');
            window.memberToCancelLeave = null;
        });
    }

    // '알바 이름 수정' - 저장
    const confirmEditPartTimerBtn = document.getElementById('confirm-edit-part-timer-btn');
    if (confirmEditPartTimerBtn) confirmEditPartTimerBtn.addEventListener('click', () => {
        const id = Number(document.getElementById('part-timer-edit-id')?.value);
        const idx = (appState.partTimers || []).findIndex(p => p.id === id);
        if (idx === -1) { 
            document.getElementById('edit-part-timer-modal').classList.add('hidden'); 
            return; 
        }
        
        const partTimer = appState.partTimers[idx];
        const newNameRaw = document.getElementById('part-timer-new-name')?.value || '';
        const newName = newNameRaw.trim();
        if (!newName) { return showToast('알바 이름은 비워둘 수 없습니다.', true); }

        const nOld = normalizeName(partTimer.name);
        const nNew = normalizeName(newName);
        if (nOld === nNew) { 
            document.getElementById('edit-part-timer-modal').classList.add('hidden'); 
            return; 
        }

        const allNamesNorm = (appConfig.teamGroups || []).flatMap(g => g.members).map(normalizeName)
            .concat((appState.partTimers || []).filter((p, i) => i !== idx).map(p => normalizeName(p.name)));
        if (allNamesNorm.includes(nNew)) { return showToast('해당 이름은 이미 사용 중입니다.', true); }

        const oldName = partTimer.name;
        appState.partTimers[idx] = { ...partTimer, name: newName };
        appState.workRecords = (appState.workRecords || []).map(r => (r.member === oldName ? { ...r, member: newName } : r));
        
        debouncedSaveState();
        
        ui.renderTeamSelectionModalContent(window.selectedTaskForStart, appState, appConfig.teamGroups);
        document.getElementById('edit-part-timer-modal').classList.add('hidden');
        showToast('알바 이름이 수정되었습니다.');
    });

    // '팀원 선택' (업무 시작) - 선택 완료
    const confirmTeamSelectBtn = document.getElementById('confirm-team-select-btn');
    if (confirmTeamSelectBtn) confirmTeamSelectBtn.addEventListener('click', () => {
      if (window.tempSelectedMembers.length === 0) { return showToast('추가할 팀원을 선택해주세요.', true); }
      
      const { selectedTaskForStart, selectedGroupForAdd, tempSelectedMembers } = window;
      
      if (selectedGroupForAdd !== null) {
        actions.addMembersToWorkGroup(tempSelectedMembers, selectedTaskForStart, selectedGroupForAdd);
        showToast(`${selectedTaskForStart} 업무에 인원이 추가되었습니다.`);
      } else if (selectedTaskForStart) {
        actions.startWorkGroup(tempSelectedMembers, selectedTaskForStart);
        showToast(`${selectedTaskForStart} 업무를 시작합니다.`);
      }
      
      document.getElementById('team-select-modal').classList.add('hidden');
      window.tempSelectedMembers = []; 
      window.selectedTaskForStart = null; 
      window.selectedGroupForAdd = null;
    });

    // '시작 시간 변경' - 저장
    const confirmEditStartTimeBtn = document.getElementById('confirm-edit-start-time-btn');
    if (confirmEditStartTimeBtn) {
        confirmEditStartTimeBtn.addEventListener('click', () => {
            const newStartTime = document.getElementById('edit-start-time-input')?.value;
            const contextId = window.recordIdOrGroupIdToEdit;
            const contextType = window.editType;

            if (!newStartTime || !contextId || !contextType) {
                return showToast('시간 변경 정보를 가져올 수 없습니다.', true);
            }

            let updated = false;
            if (contextType === 'group') {
                const groupId = Number(contextId);
                appState.workRecords.forEach(record => {
                    if (record.groupId === groupId && (record.status === 'ongoing' || record.status === 'paused')) {
                        record.startTime = newStartTime;
                        updated = true;
                    }
                });
                if (updated) showToast('그룹 시작 시간이 변경되었습니다.');

            } else if (contextType === 'individual') {
                const recordId = contextId;
                const recordIndex = appState.workRecords.findIndex(r => String(r.id) === String(recordId));
                if (recordIndex !== -1) {
                    appState.workRecords[recordIndex].startTime = newStartTime;
                    updated = true;
                    showToast('개별 시작 시간이 변경되었습니다.');
                } else {
                    showToast('해당 기록을 찾을 수 없습니다.', true);
                }
            }

            if (updated) {
                debouncedSaveState();
                ui.render(); 
            }

            document.getElementById('edit-start-time-modal').classList.add('hidden');
            window.recordIdOrGroupIdToEdit = null;
            window.editType = null;
        });
    }

    // '이력 - 근태 수정' - 저장
    const confirmEditAttendanceBtn = document.getElementById('confirm-edit-attendance-btn');
    if (confirmEditAttendanceBtn) {
        confirmEditAttendanceBtn.addEventListener('click', async () => {
            const dateKey = document.getElementById('edit-attendance-date-key').value;
            const index = parseInt(document.getElementById('edit-attendance-record-index').value, 10);
            const newType = document.getElementById('edit-attendance-type').value;

            confirmEditAttendanceBtn.disabled = true; 

            if (!dateKey || isNaN(index)) {
                showToast('저장할 기록 정보를 찾는 데 실패했습니다.', true);
                confirmEditAttendanceBtn.disabled = false;
                return;
            }

            const dayDataIndex = window.allHistoryData.findIndex(d => d.id === dateKey);
            if (!window.allHistoryData || dayDataIndex === -1) {
                 showToast('원본 이력 데이터를 찾을 수 없습니다.', true);
                 confirmEditAttendanceBtn.disabled = false;
                 return;
            }
            
            const dayData = { ...window.allHistoryData[dayDataIndex] }; 
            dayData.onLeaveMembers = dayData.onLeaveMembers ? [...dayData.onLeaveMembers] : []; 
            
            const recordToUpdate = dayData.onLeaveMembers[index];
            if (!recordToUpdate) {
                 showToast('원본 근태 기록을 찾을 수 없습니다.', true);
                 confirmEditAttendanceBtn.disabled = false;
                 return;
            }

            const updatedRecord = { member: recordToUpdate.member, type: newType };
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const isDateBased = (newType === '연차' || newType === '출장' || newType === '결근');

            try {
                if (isTimeBased) {
                    const startTime = document.getElementById('edit-attendance-start-time').value;
                    const endTime = document.getElementById('edit-attendance-end-time').value;
                    if (!startTime) throw new Error('시간 기반 근태는 시작 시간이 필수입니다.');
                    if (endTime && endTime < startTime) throw new Error('종료 시간은 시작 시간보다 이후여야 합니다.');
                    updatedRecord.startTime = startTime;
                    updatedRecord.endTime = endTime || null;
                } else if (isDateBased) {
                    const startDate = document.getElementById('edit-attendance-start-date').value;
                    const endDate = document.getElementById('edit-attendance-end-date').value;
                     if (!startDate) throw new Error('날짜 기반 근태는 시작일이 필수입니다.');
                    if (endDate && endDate < startDate) throw new Error('종료일은 시작일보다 이후여야 합니다.');
                    updatedRecord.startDate = startDate;
                    updatedRecord.endDate = endDate || null;
                }
            } catch (validationError) {
                showToast(validationError.message, true);
                confirmEditAttendanceBtn.disabled = false;
                return;
            }

            const originalRecord = window.allHistoryData[dayDataIndex].onLeaveMembers[index]; 
            window.allHistoryData[dayDataIndex].onLeaveMembers[index] = updatedRecord;

            try {
                await updateHistoryDoc(dateKey, window.allHistoryData[dayDataIndex]); // api.js
                showToast('근태 기록이 성공적으로 수정되었습니다.'); 
                ui.renderAttendanceDailyHistory(dateKey, window.allHistoryData);
                document.getElementById('edit-attendance-record-modal').classList.add('hidden');
            } catch (e) {
                showToast('근태 기록 저장 중 오류가 발생했습니다.', true);
                window.allHistoryData[dayDataIndex].onLeaveMembers[index] = originalRecord; // 원복
            } finally {
                confirmEditAttendanceBtn.disabled = false;
            }
        });
    }

    // '이력 - 근태 추가' - 저장
    const confirmAddAttendanceBtn = document.getElementById('confirm-add-attendance-btn');
    if (confirmAddAttendanceBtn) {
        confirmAddAttendanceBtn.addEventListener('click', async () => {
            const dateKey = document.getElementById('add-attendance-date-key').value;
            const member = document.getElementById('add-attendance-member-name').value.trim();
            const newType = document.getElementById('add-attendance-type').value;

            if (!dateKey) return showToast('저장할 날짜 정보를 찾지 못했습니다.', true);
            if (!member) return showToast('이름을 입력하거나 선택해주세요.', true);

            const dayDataIndex = window.allHistoryData.findIndex(d => d.id === dateKey);
            if (dayDataIndex === -1) return showToast('원본 이력 데이터를 찾을 수 없습니다.', true);
            
            const dayData = window.allHistoryData[dayDataIndex]; // 원본 참조
            const newRecord = { member: member, type: newType };
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const isDateBased = (newType === '연차' || newType === '출장' || newType === '결근');

            try {
                if (isTimeBased) {
                    const startTime = document.getElementById('add-attendance-start-time').value;
                    const endTime = document.getElementById('add-attendance-end-time').value;
                    if (!startTime) throw new Error('시간 기반 근태는 시작 시간이 필수입니다.');
                    if (endTime && endTime < startTime) throw new Error('종료 시간은 시작 시간보다 이후여야 합니다.');
                    newRecord.startTime = startTime;
                    newRecord.endTime = endTime || null;
                } else if (isDateBased) {
                    const startDate = document.getElementById('add-attendance-start-date').value;
                    const endDate = document.getElementById('add-attendance-end-date').value;
                     if (!startDate) throw new Error('날짜 기반 근태는 시작일이 필수입니다.');
                    if (endDate && endDate < startDate) throw new Error('종료일은 시작일보다 이후여야 합니다.');
                    newRecord.startDate = startDate;
                    newRecord.endDate = endDate || null;
                }
            } catch (validationError) {
                return showToast(validationError.message, true);
            }

            if (!dayData.onLeaveMembers) dayData.onLeaveMembers = [];
            dayData.onLeaveMembers.push(newRecord); // 로컬 캐시 수정

            try {
                await updateHistoryDoc(dateKey, dayData); // api.js
                showToast('근태 기록이 성공적으로 추가되었습니다.');
                ui.renderAttendanceDailyHistory(dateKey, window.allHistoryData);
                document.getElementById('add-attendance-record-modal').classList.add('hidden');
            } catch (e) {
                showToast('근태 기록 저장 중 오류가 발생했습니다.', true);
                dayData.onLeaveMembers.pop(); // 원복
            }
        });
    }
    
    // '이력 - 근태 이력 수정' (메인 화면) - 저장
    const confirmEditLeaveRecordBtn = document.getElementById('confirm-edit-leave-record-btn');
    if (confirmEditLeaveRecordBtn) {
        confirmEditLeaveRecordBtn.addEventListener('click', async () => {
            const memberName = document.getElementById('edit-leave-original-member-name').value;
            const originalStart = document.getElementById('edit-leave-original-start-identifier').value;
            const originalRecordType = document.getElementById('edit-leave-original-type').value;
            const newType = document.getElementById('edit-leave-type').value;

            if (!memberName || !originalStart || !originalRecordType) return showToast('원본 기록 정보를 찾을 수 없습니다.', true);

            const isNewTimeBased = (newType === '외출' || newType === '조퇴');
            const isOriginalTimeBased = (originalRecordType === 'daily');
            
            let updatedRecord = { member: memberName, type: newType };
            
            try {
                if (isNewTimeBased) {
                    const startTime = document.getElementById('edit-leave-start-time').value;
                    const endTime = document.getElementById('edit-leave-end-time').value;
                    if (!startTime) throw new Error('시작 시간은 필수입니다.');
                    if (endTime && endTime < startTime) throw new Error('종료 시간은 시작 시간보다 이후여야 합니다.');
                    updatedRecord.startTime = startTime;
                    updatedRecord.endTime = endTime || null;
                } else {
                    const startDate = document.getElementById('edit-leave-start-date').value;
                    const endDate = document.getElementById('edit-leave-end-date').value;
                    if (!startDate) throw new Error('시작일은 필수입니다.');
                    if (endDate && endDate < startDate) throw new Error('종료일은 시작일보다 이후여야 합니다.');
                    updatedRecord.startDate = startDate;
                    updatedRecord.endDate = endDate || null;
                }
            } catch (e) {
                return showToast(e.message, true);
            }

            let foundAndUpdated = false;
            let recordRemoved = null; 

            if (isOriginalTimeBased) {
                const index = appState.dailyOnLeaveMembers.findIndex(r => r.member === memberName && r.startTime === originalStart);
                if (index > -1) {
                    if (isNewTimeBased) { appState.dailyOnLeaveMembers[index] = updatedRecord; } 
                    else { 
                        recordRemoved = appState.dailyOnLeaveMembers.splice(index, 1)[0];
                        persistentLeaveSchedule.onLeaveMembers.push(updatedRecord);
                    }
                    foundAndUpdated = true;
                }
            } else { 
                const index = persistentLeaveSchedule.onLeaveMembers.findIndex(r => r.member === memberName && r.startDate === originalStart);
                if (index > -1) {
                     if (isNewTimeBased) { 
                         recordRemoved = persistentLeaveSchedule.onLeaveMembers.splice(index, 1)[0];
                         appState.dailyOnLeaveMembers.push(updatedRecord);
                     } else { 
                         persistentLeaveSchedule.onLeaveMembers[index] = updatedRecord;
                     }
                    foundAndUpdated = true;
                }
            }

            if (foundAndUpdated) {
                try {
                    let saveDaily = (isNewTimeBased || isOriginalTimeBased);
                    let savePersistent = (!isNewTimeBased || !isOriginalTimeBased);
                    
                    if (savePersistent) await saveLeaveSchedule(persistentLeaveSchedule);
                    if (saveDaily) debouncedSaveState();
                    
                    showToast('근태 기록이 성공적으로 수정되었습니다.');
                    document.getElementById('edit-leave-record-modal').classList.add('hidden');
                    ui.render(); 
                } catch (e) {
                    console.error('Error saving updated leave record:', e);
                    showToast('근태 기록 저장 중 오류 발생.', true);
                    if (recordRemoved) { // 원복
                        if (isOriginalTimeBased) appState.dailyOnLeaveMembers.push(recordRemoved);
                        else persistentLeaveSchedule.onLeaveMembers.push(recordRemoved);
                    }
                }
            } else {
                showToast('원본 근태 기록을 찾지 못해 수정할 수 없습니다.', true);
            }
        });
    }

    // '이력 - 근태 이력 수정' (메인 화면) - 삭제
    const deleteLeaveRecordBtn = document.getElementById('delete-leave-record-btn');
    if (deleteLeaveRecordBtn) {
        deleteLeaveRecordBtn.addEventListener('click', () => {
            const memberName = document.getElementById('edit-leave-original-member-name').value;
            const originalStart = document.getElementById('edit-leave-original-start-identifier').value;
            const originalRecordType = document.getElementById('edit-leave-original-type').value;

            if (!memberName || !originalStart || !originalRecordType) return showToast('삭제할 기록 정보를 찾을 수 없습니다.', true);

            window.deleteMode = 'leave';
            window.attendanceRecordToDelete = { 
                memberName: memberName, 
                startIdentifier: originalStart, 
                recordType: originalRecordType 
            }; 
            
            document.getElementById('delete-confirm-message').textContent = `${memberName}님의 근태 기록을 삭제하시겠습니까?`;
            document.getElementById('edit-leave-record-modal').classList.add('hidden');
            document.getElementById('delete-confirm-modal').classList.remove('hidden');
        });
    }

    // === 3. 모달 닫기/취소 버튼 ===
    
    // (모든 .modal-close-btn)
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
          const modal = e.target.closest('.fixed.inset-0');
          if (!modal || modal.id === 'history-modal') return;
          modal.classList.add('hidden');
          
          const modalId = modal.id;
          if (modalId === 'leave-type-modal') window.memberToSetLeave = null;
          else if (modalId === 'cancel-leave-confirm-modal') window.memberToCancelLeave = null;
          else if (modalId === 'team-select-modal') {
              window.tempSelectedMembers = []; window.selectedTaskForStart = null; window.selectedGroupForAdd = null;
          }
          else if (modalId === 'delete-confirm-modal') {
              window.recordToDeleteId = null; window.deleteMode = 'single'; window.attendanceRecordToDelete = null;
          }
          else if (modalId === 'delete-history-modal') window.historyKeyToDelete = null;
          else if (modalId === 'edit-record-modal') window.recordToEditId = null;
          else if (modalId === 'quantity-on-stop-modal') window.groupToStopId = null;
          else if (modalId === 'stop-group-confirm-modal') window.groupToStopId = null;
          else if (modalId === 'stop-individual-confirm-modal') window.recordToStopId = null;
          else if (modalId === 'manual-add-record-modal') document.getElementById('manual-add-form')?.reset();
          else if (modalId === 'edit-start-time-modal') {
              window.recordIdOrGroupIdToEdit = null; window.editType = null;
          }
      });
    });

    // (기타 모든 '취소' 버튼)
    document.getElementById('cancel-team-select-btn')?.addEventListener('click', () => {
        document.getElementById('team-select-modal')?.classList.add('hidden');
        window.tempSelectedMembers = []; window.selectedTaskForStart = null; window.selectedGroupForAdd = null;
    });
    document.getElementById('cancel-stop-individual-btn')?.addEventListener('click', () => {
        document.getElementById('stop-individual-confirm-modal')?.classList.add('hidden');
        window.recordToStopId = null;
    });
    document.getElementById('cancel-stop-group-btn')?.addEventListener('click', () => {
        document.getElementById('stop-group-confirm-modal')?.classList.add('hidden');
        window.groupToStopId = null;
    });
    document.getElementById('cancel-reset-app-btn')?.addEventListener('click', () => {
        document.getElementById('reset-app-modal')?.classList.add('hidden');
    });
    document.getElementById('cancel-end-shift-btn')?.addEventListener('click', () => {
        document.getElementById('end-shift-confirm-modal')?.classList.add('hidden');
    });
    document.getElementById('cancel-quantity-on-stop')?.addEventListener('click', () => {
        document.getElementById('quantity-on-stop-modal')?.classList.add('hidden');
        window.groupToStopId = null;
    });
    document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
        document.getElementById('edit-record-modal')?.classList.add('hidden');
        window.recordToEditId = null;
    });
    document.getElementById('cancel-quantity-btn')?.addEventListener('click', () => {
        document.getElementById('quantity-modal')?.classList.add('hidden');
        if (window.quantityModalContext.onCancel) window.quantityModalContext.onCancel();
        window.quantityModalContext = {};
    });
    document.getElementById('cancel-delete-btn')?.addEventListener('click', () => {
        document.getElementById('delete-confirm-modal')?.classList.add('hidden');
        window.recordToDeleteId = null; window.deleteMode = 'single'; window.attendanceRecordToDelete = null;
    });
    document.getElementById('cancel-history-delete-btn')?.addEventListener('click', () => {
        document.getElementById('delete-history-modal')?.classList.add('hidden');
        window.historyKeyToDelete = null;
    });
    document.getElementById('cancel-manual-add-btn')?.addEventListener('click', () => {
        document.getElementById('manual-add-record-modal')?.classList.add('hidden');
    });
    document.getElementById('cancel-edit-start-time-btn')?.addEventListener('click', () => {
        document.getElementById('edit-start-time-modal')?.classList.add('hidden');
        window.recordIdOrGroupIdToEdit = null; window.editType = null;
    });
    document.getElementById('cancel-edit-attendance-btn')?.addEventListener('click', () => {
        document.getElementById('edit-attendance-record-modal')?.classList.add('hidden');
    });
    document.getElementById('cancel-add-attendance-btn')?.addEventListener('click', () => {
        document.getElementById('add-attendance-record-modal')?.classList.add('hidden');
    });
    document.getElementById('cancel-edit-leave-record-btn')?.addEventListener('click', () => {
        document.getElementById('edit-leave-record-modal')?.classList.add('hidden');
    });
    document.getElementById('cancel-leave-btn')?.addEventListener('click', () => {
        document.getElementById('leave-type-modal')?.classList.add('hidden');
        window.memberToSetLeave = null;
    });
    document.getElementById('cancel-cancel-leave-btn')?.addEventListener('click', () => {
        document.getElementById('cancel-leave-confirm-modal')?.classList.add('hidden');
        window.memberToCancelLeave = null;
    });
    document.getElementById('cancel-edit-part-timer-btn')?.addEventListener('click', () => {
        document.getElementById('edit-part-timer-modal')?.classList.add('hidden');
    });
    
} // attachModalListeners 끝

/**
 * '수량 입력' (오늘/이력) 모달의 확인 버튼 공통 로직
 */
async function handleQuantityUpdate(newQuantities) {
    const context = window.quantityModalContext || {};
    
    // 1. 오늘 날짜 수량 업데이트
    if (context.mode === 'today') {
        setAppState({ taskQuantities: newQuantities });
        debouncedSaveState();
        showToast('오늘의 처리량이 저장되었습니다.');
        ui.render(); // 메인 UI 갱신

        // 2. 이력 문서(오늘 날짜)도 업데이트
        const todayDateKey = getTodayDateString();
        const todayHistoryIndex = window.allHistoryData.findIndex(d => d.id === todayDateKey);
        if (todayHistoryIndex > -1) {
            const todayHistoryData = window.allHistoryData[todayHistoryIndex];
            const updatedHistoryData = { ...todayHistoryData, taskQuantities: newQuantities };
            window.allHistoryData[todayHistoryIndex] = updatedHistoryData;
            try {
                await updateHistoryDoc(todayDateKey, updatedHistoryData);
            } catch (e) {
                window.allHistoryData[todayHistoryIndex] = todayHistoryData; // 원복
            }
        }
    }
}