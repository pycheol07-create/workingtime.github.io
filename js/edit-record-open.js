// === js/edit-record-open.js — 대시보드 '업무 기록 수정' 창 열기(한 곳) ===
// 완료 업무 목록의 [수정](js/listeners-main.js)과 오래 켜진 업무 경고의 [끝난 시각 넣기](js/long-run-warn.js)가 같이 쓴다(2026-11-26).
// 휴식 목록은 js/listeners-form-record.js 가 문서 클릭(data-action="edit" + data-record-id)으로 채운다 — 부르는 단추에 그 두 속성을 둘 것.
import * as State from './state.js?v=c7f5fc984ef9-a2ce38c0';
import * as DOM from './dom-elements.js?v=2b9f19ecbde2-82fbef91';

/** @returns {boolean} 열었으면 true(기록을 못 찾으면 false) */
export function openEditRecordModal(recordId) {
    State.context.recordToEditId = recordId;
    const record = (State.appState.workRecords || []).find(r => String(r.id) === String(recordId));
    if (!record) return false;
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
    return true;
}
