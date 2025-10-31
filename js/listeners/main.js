// === js/listeners/main.js ===

import { appState, appConfig, persistentLeaveSchedule } from '../store.js';
import { debouncedSaveState, saveLeaveSchedule } from '../api.js';
import { showToast, getTodayDateString, generateId, calcElapsedMinutes } from '../utils.js';
import * as actions from '../actions.js'; // 모든 actions 함수 가져오기
import * as uiModals from '../ui/modals.js'; // 모든 modal UI 함수 가져오기
import * as ui from '../ui/index.js'; // render 등

// --- 1. 컨텍스트 변수 (리스너 내부에서 사용) ---
// 이 변수들은 이 파일 내의 리스너들만 참조합니다.
let selectedTaskForStart = null;
let selectedGroupForAdd = null;
let recordToStopId = null;
let groupToStopId = null;
let recordIdOrGroupIdToEdit = null;
let editType = null;
let memberToSetLeave = null;

// (app.js에서 LEAVE_TYPES를 가져와야 함)
const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장'];

/**
 * 메인 화면 (대시보드, 완료 로그, 분석 탭)의 리스너를 부착합니다.
 */
export function attachMainListeners() {

    // === 1. teamStatusBoard (메인 업무 현황판) ===
    const teamStatusBoard = document.getElementById('team-status-board');
    if (teamStatusBoard) {
      teamStatusBoard.addEventListener('click', (e) => {
        
        // 1. 모바일 토글 버튼
        const toggleMobileBtn = e.target.closest('#toggle-all-tasks-mobile');
        if (toggleMobileBtn) {
            e.stopPropagation(); 
            const grid = document.getElementById('preset-task-grid');
            if (!grid) return;
            const isExpanded = grid.classList.contains('mobile-expanded');
            if (isExpanded) {
                grid.classList.remove('mobile-expanded');
                grid.querySelectorAll('.mobile-task-hidden').forEach(el => el.classList.add('hidden'));
                toggleMobileBtn.textContent = '전체보기';
            } else {
                grid.classList.add('mobile-expanded');
                grid.querySelectorAll('.mobile-task-hidden').forEach(el => el.classList.remove('hidden'));
                toggleMobileBtn.textContent = '간략히';
            }
            return;
        }
        const toggleMemberBtn = e.target.closest('#toggle-all-members-mobile');
        if (toggleMemberBtn) {
            e.stopPropagation();
            const container = document.getElementById('all-members-container');
            if (!container) return;
            const isExpanded = container.classList.contains('mobile-expanded');
            if (isExpanded) {
                container.classList.remove('mobile-expanded');
                container.querySelectorAll('.mobile-member-hidden').forEach(el => el.classList.add('hidden'));
                toggleMemberBtn.textContent = '전체보기';
            } else {
                container.classList.add('mobile-expanded');
                container.querySelectorAll('.mobile-member-hidden').forEach(el => el.classList.remove('hidden'));
                toggleMemberBtn.textContent = '간략히';
            }
            return;
        }

        // 2. 카드 내부 액션 버튼 (그룹)
        const stopGroupButton = e.target.closest('.stop-work-group-btn');
        if (stopGroupButton) {
            // ✅ [수정] groupToStopId를 window 전역이 아닌, 이 파일의 로컬 변수로 설정
            groupToStopId = Number(stopGroupButton.dataset.groupId);
            document.getElementById('stop-group-confirm-modal')?.classList.remove('hidden');
            return;
        }
        const pauseGroupButton = e.target.closest('.pause-work-group-btn');
        if (pauseGroupButton) {
            actions.pauseWorkGroup(Number(pauseGroupButton.dataset.groupId));
            return;
        }
        const resumeGroupButton = e.target.closest('.resume-work-group-btn');
        if (resumeGroupButton) {
            actions.resumeWorkGroup(Number(resumeGroupButton.dataset.groupId));
            return;
        }
        
        // 3. 카드 내부 액션 버튼 (개인)
        const individualPauseBtn = e.target.closest('[data-action="pause-individual"]');
        if (individualPauseBtn) {
            actions.pauseWorkIndividual(individualPauseBtn.dataset.recordId);
            return;
        }
        const individualResumeBtn = e.target.closest('[data-action="resume-individual"]');
        if (individualResumeBtn) {
            actions.resumeWorkIndividual(individualResumeBtn.dataset.recordId);
            return;
        }
        const individualStopBtn = e.target.closest('button[data-action="stop-individual"]');
        if (individualStopBtn) {
            // ✅ [수정] recordToStopId를 window 전역이 아닌, 이 파일의 로컬 변수로 설정
            recordToStopId = individualStopBtn.dataset.recordId;
            const record = (appState.workRecords || []).find(r => r.id === recordToStopId);
            const msgEl = document.getElementById('stop-individual-confirm-message');
            if (msgEl && record) {
                 msgEl.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
            }
            document.getElementById('stop-individual-confirm-modal')?.classList.remove('hidden');
            return;
        }
        const addMemberButton = e.target.closest('.add-member-btn[data-action="add-member"]');
        if (addMemberButton) {
            selectedTaskForStart = addMemberButton.dataset.task;
            selectedGroupForAdd = Number(addMemberButton.dataset.groupId);
            uiModals.renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups);
            document.getElementById('team-select-modal-title').textContent = `'${selectedTaskForStart}' 인원 추가`;
            document.getElementById('team-select-modal').classList.remove('hidden');
            return;
        }

        // 4. 시간 수정 버튼/영역
        const groupTimeDisplay = e.target.closest('.group-time-display[data-action="edit-group-start-time"]');
        if (groupTimeDisplay) {
            const groupId = Number(groupTimeDisplay.dataset.groupId);
            const currentStartTime = groupTimeDisplay.dataset.currentStartTime;
            if (!groupId || !currentStartTime) return;
            
            // ✅ [수정] 컨텍스트 변수 설정 (modals.js 리스너에서 사용)
            recordIdOrGroupIdToEdit = groupId;
            editType = 'group';

            document.getElementById('edit-start-time-modal-title').textContent = '그룹 시작 시간 변경';
            document.getElementById('edit-start-time-modal-message').textContent = '이 그룹의 모든 팀원의 시작 시간이 변경됩니다.';
            document.getElementById('edit-start-time-input').value = currentStartTime;
            document.getElementById('edit-start-time-context-id').value = groupId;
            document.getElementById('edit-start-time-context-type').value = 'group';
            document.getElementById('edit-start-time-modal').classList.remove('hidden');
            return;
        }
        const individualEditTimeBtn = e.target.closest('button[data-action="edit-individual-start-time"]');
        if (individualEditTimeBtn) {
            const recordId = individualEditTimeBtn.dataset.recordId;
            const currentStartTime = individualEditTimeBtn.dataset.currentStartTime;
            const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
            if (!record) return;

            recordIdOrGroupIdToEdit = recordId;
            editType = 'individual';

            document.getElementById('edit-start-time-modal-title').textContent = '개별 시작 시간 변경';
            document.getElementById('edit-start-time-modal-message').textContent = `${record.member}님의 시작 시간을 변경합니다.`;
            document.getElementById('edit-start-time-input').value = currentStartTime;
            document.getElementById('edit-start-time-context-id').value = recordId;
            document.getElementById('edit-start-time-context-type').value = 'individual';
            document.getElementById('edit-start-time-modal').classList.remove('hidden');
            return;
        }

        // 5. 근태 수정 카드 (data-action="edit-leave-record")
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
                if (type === currentType) option.selected = true;
                typeSelect.appendChild(option);
            });

            const isTimeBased = (currentType === '외출' || currentType === '조퇴');
            const isDateBased = !isTimeBased;
            timeFields.classList.toggle('hidden', !isTimeBased);
            dateFields.classList.toggle('hidden', isDateBased);
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

        // 6. 근태 설정 카드 (data-action="member-toggle-leave")
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
            
            // ✅ [수정] memberToSetLeave 로컬 변수
            memberToSetLeave = memberName;
            document.getElementById('leave-member-name').textContent = memberName;
            uiModals.renderLeaveTypeModalOptions(LEAVE_TYPES);
            document.getElementById('leave-start-date-input').value = getTodayDateString();
            document.getElementById('leave-end-date-input').value = '';
            
            const leaveDateInputsDiv = document.getElementById('leave-date-inputs');
            const firstRadio = document.getElementById('leave-type-options')?.querySelector('input[type="radio"]');
            if (firstRadio) {
                const initialType = firstRadio.value;
                leaveDateInputsDiv.classList.toggle('hidden', !(initialType === '연차' || initialType === '출장' || initialType === '결근'));
            } else if (leaveDateInputsDiv) { leaveDateInputsDiv.classList.add('hidden'); }
            
            document.getElementById('leave-type-modal').classList.remove('hidden');
            return;
        }

        // 7. 업무 시작 카드 (start-task, other)
        const card = e.target.closest('div[data-action]');
        if (card) { 
            const action = card.dataset.action;
            if (action === 'start-task' || action === 'other') {
                if (e.target.closest('a, input, select, .members-list')) {
                    return; 
                }
                const task = card.dataset.task;
                if (action === 'start-task') {
                    selectedTaskForStart = task;
                    selectedGroupForAdd = null; 
                    uiModals.renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
                    document.getElementById('team-select-modal-title').textContent = `'${task}' 업무 시작`;
                    document.getElementById('team-select-modal').classList.remove('hidden');
                    return;
                } else if (action === 'other') {
                    document.getElementById('task-select-modal').classList.remove('hidden');
                    return;
                }
            }
        }
      });
    } // if (teamStatusBoard)

    // === 2. workLogBody (완료된 업무 로그) ===
    const workLogBody = document.getElementById('work-log-body');
    if (workLogBody) {
      workLogBody.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('button[data-action="delete"]');
        if (deleteBtn) {
          // ✅ [수정] window 전역이 아닌, modals.js가 import할 전역 변수 모음(context.js)이 필요
          //    임시로 window 전역 사용
          window.recordToDeleteId = deleteBtn.dataset.recordId;
          window.deleteMode = 'single';
          
          document.getElementById('delete-confirm-message').textContent = '이 업무 기록을 삭제하시겠습니까?';
          document.getElementById('delete-confirm-modal').classList.remove('hidden');
          return;
        }
        
        const editBtn = e.target.closest('button[data-action="edit"]');
        if (editBtn) {
          window.recordToEditId = editBtn.dataset.recordId;
          
          const record = (appState.workRecords || []).find(r => String(r.id) === String(window.recordToEditId));
          if (record) {
            document.getElementById('edit-member-name').value = record.member;
            document.getElementById('edit-start-time').value = record.startTime || '';
            document.getElementById('edit-end-time').value = record.endTime || '';

            const taskSelect = document.getElementById('edit-task-type');
            taskSelect.innerHTML = ''; // Clear options
            const allTasks = [].concat(...Object.values(appConfig.taskGroups || {}));
            allTasks.forEach(task => {
                const option = document.createElement('option');
                option.value = task;
                option.textContent = task;
                if (task === record.task) option.selected = true;
                taskSelect.appendChild(option);
            });

            document.getElementById('edit-record-modal').classList.remove('hidden');
          }
          return;
        }
      });
    }
    
    // === 3. 분석 탭 리스너 ===
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

    // === 4. 개인별 통계 드롭다운 ===
    const analysisMemberSelect = document.getElementById('analysis-member-select');
    if (analysisMemberSelect) {
        analysisMemberSelect.addEventListener('change', (e) => {
            const selectedMember = e.target.value;
            // ✅ [수정] ui/index.js (analysis.js)의 함수 호출
            ui.renderPersonalAnalysis(selectedMember, appState);
        });
    }
}