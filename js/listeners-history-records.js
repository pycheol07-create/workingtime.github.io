// === js/listeners-history-records.js ===
// 설명: 이력 보기의 '기록 관리'(상세 내역 수정/삭제/일괄적용) 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, formatDuration, calcTotalPauseMinutes } from './utils.js';
import {
    updateHistoryWorkRecord,
    deleteHistoryWorkRecord,
    addHistoryWorkRecord
} from './history-data-manager.js';
import { renderHistoryDetail } from './app-history-logic.js';

// ✅ [이동] 기록 관리 테이블 렌더링 (필터링 및 일괄수정 포함)
const renderHistoryRecordsTable = (dateKey) => {
    if (!DOM.historyRecordsTableBody) return;
    
    const data = State.allHistoryData.find(d => d.id === dateKey);
    const records = data ? (data.workRecords || []) : [];

    const memberFilterVal = document.getElementById('history-record-filter-member')?.value;
    const taskFilterVal = document.getElementById('history-record-filter-task')?.value;

    // 일괄 수정 패널 표시 여부 제어
    const batchArea = document.getElementById('history-record-batch-edit-area');
    if (batchArea) {
        if (taskFilterVal) {
            batchArea.classList.remove('hidden');
            batchArea.classList.add('flex');
        } else {
            batchArea.classList.add('hidden');
            batchArea.classList.remove('flex');
        }
    }
    
    DOM.historyRecordsTableBody.innerHTML = '';
    
    // 필터링
    const filtered = records.filter(r => {
        if (memberFilterVal && r.member !== memberFilterVal) return false;
        if (taskFilterVal && r.task !== taskFilterVal) return false;
        return true;
    });

    // 정렬: 시작 시간 순
    const sorted = filtered.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    const allTasks = (State.appConfig.taskGroups || []).flatMap(g => g.tasks).sort();
    
    sorted.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = 'bg-white border-b hover:bg-gray-50 transition';
        
        let taskOptions = '';
        const uniqueTasks = new Set([...allTasks, r.task]); 
        Array.from(uniqueTasks).sort().forEach(t => {
            taskOptions += `<option value="${t}" ${t === r.task ? 'selected' : ''}>${t}</option>`;
        });

        const pauseMinutes = calcTotalPauseMinutes(r.pauses);
        const pauseText = pauseMinutes > 0 ? ` <span class="text-xs text-gray-400 block">(휴: ${formatDuration(pauseMinutes)})</span>` : '';

        tr.innerHTML = `
            <td class="px-6 py-4 font-medium text-gray-900 w-[15%]">${r.member}</td>
            <td class="px-6 py-4 w-[20%]">
                <select class="history-record-task w-full p-1 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500">
                    ${taskOptions}
                </select>
            </td>
            <td class="px-6 py-4 w-[15%]">
                <input type="time" class="history-record-start w-full p-1 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500" value="${r.startTime || ''}">
            </td>
            <td class="px-6 py-4 w-[15%]">
                <input type="time" class="history-record-end w-full p-1 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500" value="${r.endTime || ''}">
            </td>
            <td class="px-6 py-4 text-gray-500 text-xs w-[15%]">
                ${formatDuration(r.duration)}${pauseText}
            </td>
            <td class="px-6 py-4 text-right space-x-2 w-[20%]">
                <button class="text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-xs px-3 py-1.5 focus:outline-none transition shadow-sm" 
                    data-action="save-history-record" 
                    data-date-key="${dateKey}" 
                    data-record-id="${r.id}">저장</button>
                <button class="text-white bg-red-500 hover:bg-red-600 font-medium rounded-lg text-xs px-3 py-1.5 focus:outline-none transition shadow-sm" 
                    data-action="delete-history-record" 
                    data-date-key="${dateKey}" 
                    data-record-id="${r.id}">삭제</button>
            </td>
        `;
        DOM.historyRecordsTableBody.appendChild(tr);
    });
    
    if (sorted.length === 0) {
        DOM.historyRecordsTableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">조건에 맞는 기록이 없습니다.</td></tr>';
    }
};

// ✅ [이동] 기록 관리 모달 열기
export const openHistoryRecordManager = (dateKey) => {
    const data = State.allHistoryData.find(d => d.id === dateKey);
    if (!data) {
        showToast('데이터를 찾을 수 없습니다.', true);
        return;
    }

    if (DOM.historyRecordsDateSpan) DOM.historyRecordsDateSpan.textContent = dateKey;

    // 필터 초기화 및 옵션 채우기
    const records = data.workRecords || [];
    const members = new Set(records.map(r => r.member).filter(Boolean));
    const tasks = new Set(records.map(r => r.task).filter(Boolean));
    
    const memberSelect = document.getElementById('history-record-filter-member');
    const taskSelect = document.getElementById('history-record-filter-task');

    if (memberSelect) {
        memberSelect.innerHTML = '<option value="">전체</option>';
        [...members].sort().forEach(m => {
            memberSelect.innerHTML += `<option value="${m}">${m}</option>`;
        });
        memberSelect.value = '';
    }
    if (taskSelect) {
        taskSelect.innerHTML = '<option value="">전체</option>';
        [...tasks].sort().forEach(t => {
            taskSelect.innerHTML += `<option value="${t}">${t}</option>`;
        });
        taskSelect.value = '';
    }

    const batchArea = document.getElementById('history-record-batch-edit-area');
    if (batchArea) batchArea.classList.add('hidden');

    renderHistoryRecordsTable(dateKey);

    if (DOM.historyRecordsModal) DOM.historyRecordsModal.classList.remove('hidden');
}

export function setupHistoryRecordListeners() {

    // 1. 메인 뷰에서 '기록 관리' 버튼 클릭 시 모달 열기
    if (DOM.historyViewContainer) {
        DOM.historyViewContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action="open-record-manager"]');
            if (btn) {
                // 전체화면 해제 등의 로직은 메인 리스너에서 처리하거나, 여기서 처리해도 됨.
                // 일단 모달 열기만 수행
                openHistoryRecordManager(btn.dataset.dateKey);
            }
        });
    }

    // 2. 필터 UI 변경
    const memberFilterEl = document.getElementById('history-record-filter-member');
    const taskFilterEl = document.getElementById('history-record-filter-task');

    if (memberFilterEl) {
        memberFilterEl.addEventListener('change', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            renderHistoryRecordsTable(dateKey);
        });
    }
    if (taskFilterEl) {
        taskFilterEl.addEventListener('change', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            renderHistoryRecordsTable(dateKey);
        });
    }

    // 3. 일괄 적용 버튼
    const batchApplyBtn = document.getElementById('history-batch-apply-btn');
    if (batchApplyBtn) {
        batchApplyBtn.addEventListener('click', async () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            const taskFilterVal = taskFilterEl ? taskFilterEl.value : '';
            const newStart = document.getElementById('history-batch-start-time').value;
            const newEnd = document.getElementById('history-batch-end-time').value;

            if (!taskFilterVal) { showToast('업무를 선택한 상태에서만 일괄 수정이 가능합니다.', true); return; }
            if (!newStart && !newEnd) { showToast('수정할 시작 또는 종료 시간을 입력해주세요.', true); return; }
            if (newStart && newEnd && newStart >= newEnd) { showToast('시작 시간이 종료 시간보다 빨라야 합니다.', true); return; }

            if (!confirm(`선택된 업무(${taskFilterVal})의 모든 기록을 일괄 수정하시겠습니까?`)) return;

            try {
                const data = State.allHistoryData.find(d => d.id === dateKey);
                const records = data ? data.workRecords : [];
                const targets = records.filter(r => r.task === taskFilterVal);
                
                if (targets.length === 0) { showToast('수정할 대상이 없습니다.', true); return; }

                const updatePromises = targets.map(r => {
                    const updateData = {};
                    if (newStart) updateData.startTime = newStart;
                    if (newEnd) updateData.endTime = newEnd;
                    return updateHistoryWorkRecord(dateKey, r.id, updateData);
                });

                await Promise.all(updatePromises);
                showToast(`${targets.length}건의 기록이 일괄 수정되었습니다.`);
                renderHistoryRecordsTable(dateKey);
                renderHistoryDetail(dateKey); 
            } catch (e) {
                console.error(e);
                showToast('일괄 수정 중 오류가 발생했습니다.', true);
            }
        });
    }

    // 4. 기록 추가 버튼 (모달 열기)
    if (DOM.historyRecordAddBtn) {
        DOM.historyRecordAddBtn.addEventListener('click', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            if (!dateKey) { showToast('날짜 정보를 찾을 수 없습니다.', true); return; }
            
            if (DOM.historyAddDateDisplay) DOM.historyAddDateDisplay.textContent = dateKey;
            if (DOM.historyAddRecordForm) DOM.historyAddRecordForm.reset();
            
            if (DOM.historyAddMemberDatalist) {
                DOM.historyAddMemberDatalist.innerHTML = '';
                const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                const partTimers = (State.appState.partTimers || []).map(p => p.name);
                const allMembers = [...new Set([...staff, ...partTimers])].sort();
                allMembers.forEach(m => {
                    const op = document.createElement('option');
                    op.value = m;
                    DOM.historyAddMemberDatalist.appendChild(op);
                });
            }
            
            if (DOM.historyAddTaskDatalist) {
                DOM.historyAddTaskDatalist.innerHTML = '';
                const allTasks = (State.appConfig.taskGroups || []).flatMap(g => g.tasks).sort();
                const uniqueTasks = [...new Set(allTasks)];
                uniqueTasks.forEach(t => {
                    const op = document.createElement('option');
                    op.value = t;
                    DOM.historyAddTaskDatalist.appendChild(op);
                });
            }

            if (DOM.historyAddRecordModal) DOM.historyAddRecordModal.classList.remove('hidden');
        });
    }

    // 5. 기록 추가 확인
    if (DOM.confirmHistoryAddBtn) {
        DOM.confirmHistoryAddBtn.addEventListener('click', async () => {
             const dateKey = document.getElementById('history-records-date').textContent;
             const member = DOM.historyAddMemberInput.value.trim();
             const task = DOM.historyAddTaskInput.value.trim();
             const startTime = DOM.historyAddStartTimeInput.value;
             const endTime = DOM.historyAddEndTimeInput.value;

             if (!member || !task || !startTime || !endTime) { showToast('모든 필드를 입력해주세요.', true); return; }
             if (startTime >= endTime) { showToast('종료 시간은 시작 시간보다 늦어야 합니다.', true); return; }

             try {
                 const newRecord = {
                     id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                     member, task, startTime, endTime, status: 'completed', pauses: []
                 };
                 await addHistoryWorkRecord(dateKey, newRecord);
                 showToast('기록이 추가되었습니다.');
                 if (DOM.historyAddRecordModal) DOM.historyAddRecordModal.classList.add('hidden');
                 
                 renderHistoryRecordsTable(dateKey);
                 // 상세 뷰 갱신
                 const selectedDateKey = document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key;
                 if (dateKey === selectedDateKey) {
                     renderHistoryDetail(dateKey);
                 }
             } catch (e) {
                 console.error(e);
                 showToast('기록 추가 중 오류가 발생했습니다.', true);
             }
        });
    }

    // 6. 테이블 내부 버튼 (개별 저장/삭제)
    if (DOM.historyRecordsTableBody) {
        DOM.historyRecordsTableBody.addEventListener('click', async (e) => {
            const target = e.target;
            
            // 삭제
            const deleteBtn = target.closest('button[data-action="delete-history-record"]');
            if (deleteBtn) {
                const dateKey = deleteBtn.dataset.dateKey;
                const recordId = deleteBtn.dataset.recordId;
                if (confirm('정말로 이 기록을 삭제하시겠습니까?')) {
                    try {
                        await deleteHistoryWorkRecord(dateKey, recordId);
                        showToast('기록이 삭제되었습니다.');
                        renderHistoryRecordsTable(dateKey);
                        const selectedDateKey = document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key;
                        if (dateKey === selectedDateKey) {
                             renderHistoryDetail(dateKey);
                        }
                    } catch (err) {
                        console.error(err);
                        showToast('삭제 중 오류가 발생했습니다.', true);
                    }
                }
                return;
            }

            // 저장
            const saveBtn = target.closest('button[data-action="save-history-record"]');
            if (saveBtn) {
                const row = saveBtn.closest('tr');
                const dateKey = saveBtn.dataset.dateKey;
                const recordId = saveBtn.dataset.recordId;

                const newTask = row.querySelector('.history-record-task').value;
                const newStart = row.querySelector('.history-record-start').value;
                const newEnd = row.querySelector('.history-record-end').value;

                if (!newTask || !newStart || !newEnd) { showToast('모든 필드를 입력해주세요.', true); return; }
                if (newStart >= newEnd) { showToast('시작 시간이 종료 시간보다 빨라야 합니다.', true); return; }

                try {
                    await updateHistoryWorkRecord(dateKey, recordId, { task: newTask, startTime: newStart, endTime: newEnd });
                    showToast('기록이 수정되었습니다.');
                    renderHistoryRecordsTable(dateKey);
                    const selectedDateKey = document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key;
                    if (dateKey === selectedDateKey) {
                         renderHistoryDetail(dateKey);
                    }
                } catch (err) {
                    console.error(err);
                    showToast('수정 중 오류가 발생했습니다.', true);
                }
            }
        });
    }
}