// === js/listeners-modals.js ===
import {
    appState, appConfig, db, auth,
    context,
    teamSelectModal,
    deleteConfirmModal,
    confirmDeleteBtn,
    deleteHistoryModal,
    quantityModal,
    confirmQuantityBtn,
    cancelQuantityBtn,
    editRecordModal,
    confirmEditBtn,
    cancelEditBtn,
    quantityOnStopModal,
    confirmQuantityOnStopBtn,
    cancelQuantityOnStopBtn,
    resetAppModal,
    confirmResetAppBtn,
    taskSelectModal,
    stopIndividualConfirmModal,
    confirmStopIndividualBtn,
    cancelStopIndividualBtn,
    stopIndividualConfirmMessage,
    editPartTimerModal,
    confirmEditPartTimerBtn,
    cancelEditPartTimerBtn,
    leaveTypeModal,
    confirmLeaveBtn,
    cancelLeaveBtn,
    cancelLeaveConfirmModal,
    confirmCancelLeaveBtn,
    cancelCancelLeaveBtn,
    cancelLeaveConfirmMessage,
    manualAddRecordModal,
    confirmManualAddBtn,
    manualAddForm,
    endShiftConfirmModal,
    confirmEndShiftBtn,
    editStartTimeModal,
    confirmEditStartTimeBtn,
    stopGroupConfirmModal, confirmStopGroupBtn, cancelStopGroupBtn,

    // ✅ [누락 복구] cancelTeamSelectBtn 추가
    cancelTeamSelectBtn,
    partTimerNewNameInput, partTimerEditIdInput,

    generateId,
    render,
    persistentLeaveSchedule,
    allHistoryData,

    // 시뮬레이션 관련 DOM 요소
    costSimulationModal, openCostSimulationBtn, simCalculateBtn,
    simResultContainer,
    simModeRadios, simInputArea,
    simBottleneckContainer, simBottleneckTbody,
    // ✨ 드래그를 위한 요소
    simModalHeader, simModalContent,

    updateDailyData

} from './app.js';

import { getTodayDateString, getCurrentTime, formatDuration, showToast, calcElapsedMinutes } from './utils.js';

import {
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions,
    renderManualAddModalDatalists
} from './ui-modals.js';

import {
    finalizeStopGroup,
    stopWorkIndividual,
} from './app-logic.js';

import { saveDayDataToHistory, switchHistoryView, calculateSimulation, analyzeBottlenecks } from './app-history-logic.js';
import { saveLeaveSchedule } from './config.js';

import { doc, updateDoc, deleteDoc, writeBatch, collection, query, where, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


const deleteWorkRecordDocument = async (recordId) => {
    if (!recordId) return;
    try {
        const today = getTodayDateString();
        const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords', recordId);
        await deleteDoc(docRef);
    } catch (e) {
        console.error("Error deleting work record document: ", e);
        showToast("문서 삭제 중 오류 발생.", true);
    }
};

const deleteWorkRecordDocuments = async (recordIds) => {
    if (!recordIds || recordIds.length === 0) return;
    try {
        const today = getTodayDateString();
        const colRef = collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
        const batch = writeBatch(db);

        recordIds.forEach(recordId => {
            const docRef = doc(colRef, recordId);
            batch.delete(docRef);
        });

        await batch.commit();
    } catch (e) {
        console.error("Error batch deleting work record documents: ", e);
        showToast("여러 문서 삭제 중 오류 발생.", true);
    }
};

// 시뮬레이션 테이블 행 추가 헬퍼 함수
const renderSimulationTaskRow = (tbody) => {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-gray-50 transition sim-task-row';
    
    let taskOptions = '<option value="">업무 선택</option>';
    (appConfig.quantityTaskTypes || []).sort().forEach(task => {
        taskOptions += `<option value="${task}">${task}</option>`;
    });

    row.innerHTML = `
        <td class="px-4 py-2">
            <select class="sim-row-task w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                ${taskOptions}
            </select>
        </td>
        <td class="px-4 py-2">
            <input type="number" class="sim-row-qty w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right" placeholder="1000" min="1">
        </td>
        <td class="px-4 py-2">
            <input type="number" class="sim-row-worker-or-time w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right" placeholder="5" min="1">
        </td>
        <td class="px-4 py-2 text-center">
            <button class="sim-row-delete-btn text-gray-400 hover:text-red-500 transition">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
            </button>
        </td>
    `;
    tbody.appendChild(row);
};

export function setupGeneralModalListeners() {

    document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay, .fixed.inset-0');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    });

    // 인건비 시뮬레이션 모달 관련 리스너
    const simAddTaskRowBtn = document.getElementById('sim-add-task-row-btn');
    const simTaskTableBody = document.getElementById('sim-task-table-body');
    const simTableHeaderWorker = document.getElementById('sim-table-header-worker');
    const simStartTimeInput = document.getElementById('sim-start-time-input');

    // 시뮬레이션 모달 드래그 적용
    if (costSimulationModal && simModalHeader && simModalContent) {
        makeDraggable(costSimulationModal, simModalHeader, simModalContent);
    }

    if (openCostSimulationBtn) {
        openCostSimulationBtn.addEventListener('click', () => {
            // 초기화
            if (simResultContainer) simResultContainer.classList.add('hidden');
            if (simBottleneckContainer) simBottleneckContainer.classList.add('hidden');
            if (simInputArea) simInputArea.classList.remove('hidden');
            
            // 모달 위치 초기화
            if (simModalContent) {
                simModalContent.removeAttribute('style');
                simModalContent.dataset.hasBeenUncentered = 'false';
            }
             if (costSimulationModal) {
                costSimulationModal.classList.add('flex', 'items-center', 'justify-center');
            }

            if (simTaskTableBody) {
                simTaskTableBody.innerHTML = '';
                renderSimulationTaskRow(simTaskTableBody); // 기본 1줄 추가
            }
            if (simStartTimeInput) simStartTimeInput.value = "08:30"; // 기본 시작 시간

            // 모드 초기화 (기본: 소요 시간 예측)
            if (simModeRadios && simModeRadios.length > 0) {
                simModeRadios[0].checked = true;
                simModeRadios[0].dispatchEvent(new Event('change'));
            }

            if (costSimulationModal) costSimulationModal.classList.remove('hidden');
            document.getElementById('menu-dropdown')?.classList.add('hidden');
        });
    }

    if (simModeRadios) {
        Array.from(simModeRadios).forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    const mode = e.target.value;
                    if (mode === 'bottleneck') {
                        simInputArea.classList.add('hidden');
                        simResultContainer.classList.add('hidden');
                        simCalculateBtn.textContent = '병목 구간 분석하기';
                    } else {
                        simInputArea.classList.remove('hidden');
                        simBottleneckContainer.classList.add('hidden');
                        simCalculateBtn.textContent = '시뮬레이션 실행 🚀';
                        
                        if (simTableHeaderWorker) {
                            simTableHeaderWorker.textContent = (mode === 'fixed-workers') ? '투입 인원 (명)' : '목표 시간 (분)';
                        }
                        // 테이블 내 placeholder 업데이트
                        document.querySelectorAll('.sim-row-worker-or-time').forEach(input => {
                            input.placeholder = (mode === 'fixed-workers') ? '5' : '60';
                        });
                    }
                }
            });
        });
    }

    if (simAddTaskRowBtn && simTaskTableBody) {
        simAddTaskRowBtn.addEventListener('click', () => {
            renderSimulationTaskRow(simTaskTableBody);
        });
    }

    if (simTaskTableBody) {
        simTaskTableBody.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.sim-row-delete-btn');
            if (deleteBtn) {
                deleteBtn.closest('tr').remove();
            }
        });
    }

    if (simCalculateBtn) {
        simCalculateBtn.addEventListener('click', () => {
            const mode = document.querySelector('input[name="sim-mode"]:checked').value;

            // --- 모드 3: 병목 분석 ---
            if (mode === 'bottleneck') {
                const bottlenecks = analyzeBottlenecks(allHistoryData);
                if (!bottlenecks || bottlenecks.length === 0) {
                    showToast('분석할 데이터가 충분하지 않습니다.', true);
                    return;
                }
                if (simBottleneckTbody) {
                    simBottleneckTbody.innerHTML = bottlenecks.map((item, index) => `
                        <tr class="bg-white">
                            <td class="px-4 py-3 font-medium text-gray-900">${index + 1}위</td>
                            <td class="px-4 py-3 font-bold ${index === 0 ? 'text-red-600' : 'text-gray-800'}">${item.task}</td>
                            <td class="px-4 py-3 text-right font-mono ${index === 0 ? 'text-red-600 font-bold' : ''}">${formatDuration(item.timeFor1000)}</td>
                            <td class="px-4 py-3 text-right text-gray-500">${item.speed.toFixed(2)}</td>
                        </tr>
                    `).join('');
                }
                simBottleneckContainer.classList.remove('hidden');
                return;
            }

            // --- 모드 1 & 2: 다중 업무 시뮬레이션 (순차적 계산) ---
            let currentStartTimeStr = simStartTimeInput ? simStartTimeInput.value : "09:00";
            const rows = document.querySelectorAll('.sim-task-row');
            const results = [];
            let totalDuration = 0;
            let totalCost = 0;
            let finalEndTimeStr = currentStartTimeStr;

            rows.forEach(row => {
                const task = row.querySelector('.sim-row-task').value;
                const qty = Number(row.querySelector('.sim-row-qty').value);
                const inputVal = Number(row.querySelector('.sim-row-worker-or-time').value);

                if (task && qty > 0 && inputVal > 0) {
                    // 순차적 계산: 현재 업무의 예상 종료 시간을 다음 업무의 시작 시간으로 전달
                    const res = calculateSimulation(mode, task, qty, inputVal, appConfig, allHistoryData, currentStartTimeStr);
                    
                    if (!res.error) {
                        res.startTime = currentStartTimeStr; // 결과 표시용 시작 시간 저장
                        results.push({ task, ...res });
                        
                        // 다음 업무를 위해 시작 시간 및 누적 값 업데이트
                        currentStartTimeStr = res.expectedEndTime;
                        finalEndTimeStr = res.expectedEndTime;
                        totalDuration += res.durationMinutes;
                        totalCost += res.totalCost;
                    }
                }
            });

            if (results.length === 0) {
                showToast('최소 1개 이상의 업무 정보를 올바르게 입력해주세요.', true);
                return;
            }

            // 결과 렌더링
            const simTotalDurationEl = document.getElementById('sim-total-duration');
            const simExpectedEndTimeEl = document.getElementById('sim-expected-end-time');
            const simTotalCostEl = document.getElementById('sim-total-cost');
            const simResultTbody = document.getElementById('sim-result-tbody');

            if (simTotalDurationEl) simTotalDurationEl.textContent = formatDuration(totalDuration);
            if (simExpectedEndTimeEl) simExpectedEndTimeEl.textContent = finalEndTimeStr;
            if (simTotalCostEl) simTotalCostEl.textContent = `${Math.round(totalCost).toLocaleString()}원`;

            if (simResultTbody) {
                simResultTbody.innerHTML = results.map(res => `
                    <tr class="bg-white">
                        <td class="px-4 py-3 font-medium text-gray-900">
                            ${res.task}
                            <div class="text-xs text-gray-400 font-normal">${res.startTime} 시작</div>
                        </td>
                        <td class="px-4 py-3 text-right">
                            ${formatDuration(res.durationMinutes)}
                            ${res.includesLunch ? '<span class="text-xs text-orange-500 block">(점심포함)</span>' : ''}
                        </td>
                        <td class="px-4 py-3 text-right">${Math.round(res.totalCost).toLocaleString()}원</td>
                        <td class="px-4 py-3 text-right font-bold text-indigo-600">${res.expectedEndTime}</td>
                    </tr>
                `).join('');
            }

            if (simResultContainer) simResultContainer.classList.remove('hidden');
        });
    }

    if (confirmQuantityBtn) {
        confirmQuantityBtn.addEventListener('click', async () => {
            const newQuantities = {};
            const confirmedZeroTasks = [];

            document.querySelectorAll('#modal-task-quantity-inputs input[type="number"]').forEach(input => {
                const taskName = input.dataset.task;
                if (taskName) {
                    newQuantities[taskName] = Number(input.value) || 0;
                }
            });

            document.querySelectorAll('#modal-task-quantity-inputs .confirm-zero-checkbox').forEach(checkbox => {
                if (checkbox.checked) {
                    confirmedZeroTasks.push(checkbox.dataset.task);
                }
            });

            if (context.quantityModalContext && typeof context.quantityModalContext.onConfirm === 'function') {
                await context.quantityModalContext.onConfirm(newQuantities, confirmedZeroTasks);
            }

            if (quantityModal) quantityModal.classList.add('hidden');
        });
    }

    if (cancelQuantityBtn) {
        cancelQuantityBtn.addEventListener('click', () => {
            if (context.quantityModalContext && typeof context.quantityModalContext.onCancel === 'function') {
                context.quantityModalContext.onCancel();
            }
            if (quantityModal) quantityModal.classList.add('hidden');
        });
    }

    if (cancelTeamSelectBtn) {
        cancelTeamSelectBtn.addEventListener('click', () => {
            if (teamSelectModal) teamSelectModal.classList.add('hidden');
        });
    }

    if (taskSelectModal) {
        taskSelectModal.addEventListener('click', (e) => {
            const taskButton = e.target.closest('.task-select-btn');
            if (taskButton) {
                const taskName = taskButton.dataset.task;
                context.selectedTaskForStart = taskName;
                context.selectedGroupForAdd = null;
                context.tempSelectedMembers = [];
                taskSelectModal.classList.add('hidden');

                renderTeamSelectionModalContent(taskName, appState, appConfig.teamGroups);

                const titleEl = document.getElementById('team-select-modal-title');
                const confirmBtn = document.getElementById('confirm-team-select-btn');
                if (titleEl) titleEl.textContent = `'${taskName}' 업무 시작`;
                if (confirmBtn) confirmBtn.textContent = '선택 완료 및 업무 시작';

                if (teamSelectModal) teamSelectModal.classList.remove('hidden');
            }
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {

            if (context.deleteMode === 'group') {
                const groupMembers = (appState.workRecords || [])
                    .filter(r => String(r.groupId) === String(context.recordToDeleteId) && (r.status === 'ongoing' || r.status === 'paused'))
                    .map(r => r.id);

                if (groupMembers.length > 0) {
                    await deleteWorkRecordDocuments(groupMembers);
                    showToast('그룹 업무가 삭제되었습니다.');
                }
            } else if (context.deleteMode === 'single') {
                await deleteWorkRecordDocument(context.recordToDeleteId);
                showToast('업무 기록이 삭제되었습니다.');
            } else if (context.deleteMode === 'all-completed') {
                 const completedIds = (appState.workRecords || [])
                    .filter(r => r.status === 'completed')
                    .map(r => r.id);

                if (completedIds.length > 0) {
                    await deleteWorkRecordDocuments(completedIds);
                    showToast(`완료된 업무 ${completedIds.length}건이 삭제되었습니다.`);
                } else {
                    showToast('삭제할 완료된 업무가 없습니다.');
                }
            }
            else if (context.deleteMode === 'attendance') {
                const { dateKey, index } = context.attendanceRecordToDelete;
                const dayData = allHistoryData.find(d => d.id === dateKey);

                if (dayData && dayData.onLeaveMembers && dayData.onLeaveMembers[index]) {
                    const deletedRecord = dayData.onLeaveMembers.splice(index, 1)[0];
                    try {
                        const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                        await setDoc(historyDocRef, { onLeaveMembers: dayData.onLeaveMembers }, { merge: true });

                        showToast(`${deletedRecord.member}님의 '${deletedRecord.type}' 기록이 삭제되었습니다.`);

                        const activeAttendanceTab = document.querySelector('#attendance-history-tabs button.font-semibold');
                        const view = activeAttendanceTab ? activeAttendanceTab.dataset.view : 'attendance-daily';

                        await switchHistoryView(view);
                    } catch (e) {
                         console.error('Error deleting attendance record:', e);
                         showToast('근태 기록 삭제 중 오류 발생', true);
                         dayData.onLeaveMembers.splice(index, 0, deletedRecord);
                    }
                }
                context.attendanceRecordToDelete = null;
            }

            deleteConfirmModal.classList.add('hidden');
            context.recordToDeleteId = null;
            context.deleteMode = 'single';
        });
    }

    if (confirmEditBtn) {
        confirmEditBtn.addEventListener('click', async () => {
            const recordId = context.recordToEditId;
            const task = document.getElementById('edit-task-type').value;
            const member = document.getElementById('edit-member-name').value;
            const startTime = document.getElementById('edit-start-time').value;
            const endTime = document.getElementById('edit-end-time').value;

            const record = (appState.workRecords || []).find(r => r.id === recordId);
            if (!record) {
                showToast('수정할 기록을 찾을 수 없습니다.', true);
                return;
            }

            if (startTime && endTime && startTime >= endTime) {
                showToast('시작 시간이 종료 시간보다 늦거나 같을 수 없습니다.', true);
                return;
            }

            try {
                const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords', recordId);

                const updates = {
                    task,
                    member,
                    startTime
                };

                if (endTime) {
                    updates.endTime = endTime;
                    updates.status = 'completed';
                    updates.duration = calcElapsedMinutes(startTime, endTime, record.pauses || []);
                } else {
                    updates.endTime = null;
                    updates.status = record.status === 'completed' ? 'ongoing' : record.status;
                    updates.duration = null;
                }

                await updateDoc(docRef, updates);

                showToast('업무 기록이 수정되었습니다.');
                editRecordModal.classList.add('hidden');
            } catch (e) {
                console.error("Error updating work record: ", e);
                showToast("기록 수정 중 오류 발생", true);
            }
        });
    }

    if (confirmQuantityOnStopBtn) {
        confirmQuantityOnStopBtn.addEventListener('click', async () => {
            const quantity = document.getElementById('quantity-on-stop-input').value;
            await finalizeStopGroup(context.groupToStopId, quantity);
            quantityOnStopModal.classList.add('hidden');
            context.groupToStopId = null;
        });
    }
    if (cancelQuantityOnStopBtn) {
        cancelQuantityOnStopBtn.addEventListener('click', async () => {
            await finalizeStopGroup(context.groupToStopId, null);
            quantityOnStopModal.classList.add('hidden');
            context.groupToStopId = null;
        });
    }

    if (confirmStopIndividualBtn) {
        confirmStopIndividualBtn.addEventListener('click', async () => {
            await stopWorkIndividual(context.recordToStopId);
            stopIndividualConfirmModal.classList.add('hidden');
            context.recordToStopId = null;
        });
    }

    if (confirmStopGroupBtn) {
        confirmStopGroupBtn.addEventListener('click', async () => {
            if (context.groupToStopId) {
                await finalizeStopGroup(context.groupToStopId, null);
                if (stopGroupConfirmModal) stopGroupConfirmModal.classList.add('hidden');
                context.groupToStopId = null;
            }
        });
    }

    if (cancelStopGroupBtn) {
        cancelStopGroupBtn.addEventListener('click', () => {
            if (stopGroupConfirmModal) stopGroupConfirmModal.classList.add('hidden');
            context.groupToStopId = null;
        });
    }

    if (confirmEditPartTimerBtn) {
        confirmEditPartTimerBtn.addEventListener('click', async () => {
            const partTimerId = document.getElementById('part-timer-edit-id').value;
            const newName = document.getElementById('part-timer-new-name').value.trim();

            if (!newName) {
                showToast('이름을 입력해주세요.', true); return;
            }

            const isNameTaken = (appConfig.teamGroups || []).flatMap(g => g.members).includes(newName) ||
                                (appState.partTimers || []).some(p => p.name === newName && p.id !== partTimerId);

            if (isNameTaken) {
                showToast(`'${newName}'(이)라는 이름은 이미 사용 중입니다.`, true); return;
            }

            if (!partTimerId) {
                const newPartTimer = {
                    id: generateId(),
                    name: newName,
                    wage: appConfig.defaultPartTimerWage || 10000
                };
                if (!appState.partTimers) appState.partTimers = [];
                appState.partTimers.push(newPartTimer);
                
                // 🔥 [핵심] 전체 저장 대신 partTimers 필드만 원자적 업데이트
                await updateDailyData({ partTimers: appState.partTimers });
                
                renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups);
                showToast(`알바 '${newName}'님이 추가되었습니다.`);
            } else {
                const partTimer = (appState.partTimers || []).find(p => p.id === partTimerId);
                if (!partTimer) {
                    showToast('수정할 알바 정보를 찾을 수 없습니다.', true); return;
                }
                const oldName = partTimer.name;
                if (oldName === newName) {
                     document.getElementById('edit-part-timer-modal').classList.add('hidden'); return;
                }

                partTimer.name = newName;

                (appState.workRecords || []).forEach(record => {
                    if (record.member === oldName) record.member = newName;
                });

                try {
                    const today = getTodayDateString();
                    const workRecordsColRef = collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
                    const q = query(workRecordsColRef, where("member", "==", oldName));
                    const querySnapshot = await getDocs(q);
                    if (!querySnapshot.empty) {
                        const batch = writeBatch(db);
                        querySnapshot.forEach(doc => batch.update(doc.ref, { member: newName }));
                        await batch.commit();
                    }
                    // 🔥 [핵심] 전체 저장 대신 partTimers 필드만 원자적 업데이트
                    await updateDailyData({ partTimers: appState.partTimers });

                    showToast(`'${oldName}'님을 '${newName}'(으)로 수정했습니다.`);
                } catch (e) {
                    console.error("알바 이름 변경 중 DB 오류: ", e);
                    showToast("이름 변경 중 DB 저장에 실패했습니다.", true);
                    partTimer.name = oldName;
                }
            }
            document.getElementById('edit-part-timer-modal').classList.add('hidden');
            renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups);
        });
    }

    if (confirmLeaveBtn) {
        confirmLeaveBtn.addEventListener('click', async () => {
            const memberName = context.memberToSetLeave;
            const selectedTypeRadio = document.querySelector('input[name="leave-type"]:checked');
            if (!memberName || !selectedTypeRadio) {
                showToast('선택이 필요합니다.', true);
                return;
            }

            const type = selectedTypeRadio.value;
            const today = getTodayDateString();
            const startDate = document.getElementById('leave-start-date-input').value || today;
            const endDate = document.getElementById('leave-end-date-input').value || startDate;

            if (type === '연차' || type === '출장' || type === '결근') {
                if (startDate > endDate) {
                    showToast('종료 날짜는 시작 날짜보다 빠를 수 없습니다.', true);
                    return;
                }
                const newEntry = {
                    id: `leave-${Date.now()}`,
                    member: memberName,
                    type,
                    startDate,
                    endDate
                };
                persistentLeaveSchedule.onLeaveMembers.push(newEntry);
                await saveLeaveSchedule(db, persistentLeaveSchedule);
            } else {
                const newDailyEntry = {
                    member: memberName,
                    type: type,
                    startTime: (type === '외출' || type === '조퇴') ? getCurrentTime() : null,
                    endTime: null
                };
                appState.dailyOnLeaveMembers.push(newDailyEntry);
                // 🔥 [핵심] 전체 저장 대신 onLeaveMembers 필드만 원자적 업데이트
                await updateDailyData({ onLeaveMembers: appState.dailyOnLeaveMembers });
            }

            showToast(`${memberName}님 ${type} 처리 완료.`);
            leaveTypeModal.classList.add('hidden');
        });
    }

    if (confirmCancelLeaveBtn) {
        confirmCancelLeaveBtn.addEventListener('click', async () => {
            const memberName = context.memberToCancelLeave;
            if (!memberName) return;

            let dailyChanged = false;
            let persistentChanged = false;

            const originalLength = appState.dailyOnLeaveMembers.length;
            appState.dailyOnLeaveMembers = appState.dailyOnLeaveMembers.filter(entry => entry.member !== memberName);
            if (appState.dailyOnLeaveMembers.length !== originalLength) {
                dailyChanged = true;
            }

            const today = getTodayDateString();
            persistentLeaveSchedule.onLeaveMembers = (persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
                if (entry.member === memberName) {
                    const endDate = entry.endDate || entry.startDate;
                    if (today >= entry.startDate && today <= (endDate || entry.startDate)) {
                        persistentChanged = true;
                        return false;
                    }
                }
                return true;
            });

            if (dailyChanged) {
                // 🔥 [핵심] 전체 저장 대신 onLeaveMembers 필드만 원자적 업데이트
                await updateDailyData({ onLeaveMembers: appState.dailyOnLeaveMembers });
            }
            if (persistentChanged) {
                await saveLeaveSchedule(db, persistentLeaveSchedule);
            }

            if (dailyChanged || persistentChanged) {
                showToast(`${memberName}님 근태 기록(오늘)이 취소되었습니다.`);
            } else {
                showToast('취소할 근태 기록이 없습니다.');
            }

            cancelLeaveConfirmModal.classList.add('hidden');
            context.memberToCancelLeave = null;
        });
    }

    if (confirmManualAddBtn) {
        confirmManualAddBtn.addEventListener('click', async () => {
            const member = document.getElementById('manual-add-member').value;
            const task = document.getElementById('manual-add-task').value;
            const startTime = document.getElementById('manual-add-start-time').value;
            const endTime = document.getElementById('manual-add-end-time').value;
            const pauses = [];

            if (!member || !task || !startTime || !endTime) {
                showToast('모든 필드를 입력해야 합니다.', true);
                return;
            }
            if (startTime >= endTime) {
                showToast('시작 시간이 종료 시간보다 늦거나 같을 수 없습니다.', true);
                return;
            }

            try {
                const recordId = generateId();
                const duration = calcElapsedMinutes(startTime, endTime, pauses);

                const newRecordData = {
                    id: recordId,
                    member,
                    task,
                    startTime,
                    endTime,
                    duration,
                    status: 'completed',
                    groupId: `manual-${generateId()}`,
                    pauses: []
                };

                const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords', recordId);
                await setDoc(docRef, newRecordData);

                showToast('수동 기록이 추가되었습니다.');
                manualAddRecordModal.classList.add('hidden');
                manualAddForm.reset();

            } catch (e) {
                console.error("Error adding manual work record: ", e);
                showToast("수동 기록 추가 중 오류 발생", true);
            }
        });
    }

    if (confirmEndShiftBtn) {
        confirmEndShiftBtn.addEventListener('click', async () => {
            await saveDayDataToHistory(false);
            endShiftConfirmModal.classList.add('hidden');
        });
    }

    if (confirmResetAppBtn) {
        confirmResetAppBtn.addEventListener('click', async () => {
            const today = getTodayDateString();

            try {
                const workRecordsColRef = collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
                const q = query(workRecordsColRef);
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const batch = writeBatch(db);
                    querySnapshot.forEach(doc => {
                        batch.delete(doc.ref);
                    });
                    await batch.commit();
                }

                const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
                // 초기화는 전체 상태를 비우는 것이므로 setDoc({}) 사용
                await setDoc(docRef, {});

                appState.workRecords = [];
                appState.taskQuantities = {};
                appState.partTimers = [];
                appState.dailyOnLeaveMembers = [];
                appState.dailyAttendance = {};

                render();

                showToast('오늘 데이터가 모두 초기화되었습니다.');
                resetAppModal.classList.add('hidden');

            } catch (e) {
                console.error("오늘 데이터 초기화 실패: ", e);
                showToast("데이터 초기화 중 오류가 발생했습니다.", true);
            }
        });
    }

    if (confirmEditStartTimeBtn) {
        confirmEditStartTimeBtn.addEventListener('click', async () => {
            const contextId = document.getElementById('edit-start-time-context-id').value;
            const contextType = document.getElementById('edit-start-time-context-type').value;
            const newStartTime = document.getElementById('edit-start-time-input').value;

            if (!contextId || !contextType || !newStartTime) {
                showToast('정보가 누락되었습니다.', true);
                return;
            }

            try {
                const today = getTodayDateString();
                const workRecordsColRef = collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');

                if (contextType === 'individual') {
                    const docRef = doc(workRecordsColRef, contextId);
                    await updateDoc(docRef, { startTime: newStartTime });

                } else if (contextType === 'group') {
                    const q = query(workRecordsColRef, where("groupId", "==", contextId), where("status", "in", ["ongoing", "paused"]));
                    const querySnapshot = await getDocs(q);

                    if (!querySnapshot.empty) {
                        const batch = writeBatch(db);
                        querySnapshot.forEach(doc => {
                            batch.update(doc.ref, { startTime: newStartTime });
                        });
                        await batch.commit();
                    }
                }

                showToast('시작 시간이 수정되었습니다.');
                editStartTimeModal.classList.add('hidden');

            } catch (e) {
                 console.error("Error updating start time: ", e);
                 showToast("시작 시간 수정 중 오류 발생", true);
            }
        });
    }
}

function makeDraggable(modalOverlay, header, contentBox) {
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        
        isDragging = true;

        if (contentBox.dataset.hasBeenUncentered !== 'true') {
            const rect = contentBox.getBoundingClientRect();
            modalOverlay.classList.remove('flex', 'items-center', 'justify-center');
            contentBox.style.position = 'absolute';
            contentBox.style.top = `${rect.top + window.scrollY}px`;
            contentBox.style.left = `${rect.left + window.scrollX}px`;
            contentBox.style.margin = '0';
            contentBox.style.transform = 'none';
            contentBox.dataset.hasBeenUncentered = 'true';
        }

        const rect = contentBox.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        const newLeft = e.clientX - offsetX + window.scrollX;
        const newTop = e.clientY - offsetY + window.scrollY;

        contentBox.style.left = `${newLeft}px`;
        contentBox.style.top = `${newTop}px`;
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}