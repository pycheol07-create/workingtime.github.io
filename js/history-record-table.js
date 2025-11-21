// === js/history-record-table.js ===
// 설명: '기록 관리' 모달 내의 테이블 렌더링 및 필터링 로직을 담당합니다.
// (기존 app-history-logic.js에서 분리됨)

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, formatDuration, calcTotalPauseMinutes } from './utils.js';

/**
 * 기록 관리 모달을 엽니다.
 */
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
        memberSelect.value = ''; // Reset
    }
    if (taskSelect) {
        taskSelect.innerHTML = '<option value="">전체</option>';
        [...tasks].sort().forEach(t => {
            taskSelect.innerHTML += `<option value="${t}">${t}</option>`;
        });
        taskSelect.value = ''; // Reset
    }

    // 일괄 수정 패널 숨김 (초기 상태)
    const batchArea = document.getElementById('history-record-batch-edit-area');
    if (batchArea) batchArea.classList.add('hidden');

    renderHistoryRecordsTable(dateKey); // 초기 렌더링 (전체)

    if (DOM.historyRecordsModal) DOM.historyRecordsModal.classList.remove('hidden');
}

/**
 * 기록 관리 테이블을 렌더링합니다. (필터링 및 일괄수정 UI 연동 포함)
 */
export const renderHistoryRecordsTable = (dateKey) => {
    if (!DOM.historyRecordsTableBody) return;
    
    const data = State.allHistoryData.find(d => d.id === dateKey);
    const records = data ? (data.workRecords || []) : [];

    // 필터 값 읽기
    const memberFilter = document.getElementById('history-record-filter-member')?.value;
    const taskFilter = document.getElementById('history-record-filter-task')?.value;

    // 일괄 수정 패널 표시 여부 제어 (특정 업무가 선택되었을 때만 노출)
    const batchArea = document.getElementById('history-record-batch-edit-area');
    if (batchArea) {
        if (taskFilter) {
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
        if (memberFilter && r.member !== memberFilter) return false;
        if (taskFilter && r.task !== taskFilter) return false;
        return true;
    });

    // 정렬: 시작 시간 순
    const sorted = filtered.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    const allTasks = (State.appConfig.taskGroups || []).flatMap(g => g.tasks).sort();
    
    sorted.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = 'bg-white border-b hover:bg-gray-50 transition';
        
        // 업무 선택 옵션 생성
        let taskOptions = '';
        const uniqueTasks = new Set([...allTasks, r.task]); 
        Array.from(uniqueTasks).sort().forEach(t => {
            taskOptions += `<option value="${t}" ${t === r.task ? 'selected' : ''}>${t}</option>`;
        });

        // 휴식 시간 계산 및 표시
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