// === js/listeners-form-team.js ===
// 설명: 팀원 선택 및 알바 관리(추가/수정/삭제) 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610301130';
import * as State from './state.js?v=202610301130';
import { showToast, getCurrentTime, getTodayDateString } from './utils.js?v=202610301130';
import { generateId, debouncedSaveState, updateDailyData } from './app-data.js?v=202610301130';
import { markDataAsDirty } from './app-lifecycle.js?v=202610301130';
import { renderTeamSelectionModalContent } from './ui-modals.js?v=202610301130';
import { startWorkGroup, addMembersToWorkGroup, processClockIn } from './app-logic.js?v=202610301130';
import { collection, query, where, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 헬퍼 변수 (ui-modals.js renderTeamSelectionModalContent 의 selectedClasses 와 같아야 한다)
const SELECTED_CLASSES = ['bg-blue-600', 'border-blue-600', 'text-white', 'hover:bg-blue-700'];

// 시작 창을 지금 선택 상태 그대로 다시 그리고, 실제로 선택된 칸(고를 수 있는 칸)만 선택 목록에 남긴다.
// (알바 추가·이름 변경·삭제, 출근하고 시작 뒤에 쓴다 — 예전엔 다시 그리면 화면 선택만 풀리고 목록엔 남았다)
const rerenderTeamSelect = () => {
    renderTeamSelectionModalContent(State.context.selectedTaskForStart, State.appState, State.appConfig.teamGroups,
        { selected: State.context.tempSelectedMembers || [] });
    const box = document.getElementById('team-select-modal-content');
    State.context.tempSelectedMembers = box
        ? Array.from(box.querySelectorAll('.member-select-btn.bg-blue-600')).map(b => b.dataset.memberName)
        : [];
};

/**
 * 업무 시작(또는 인원 추가) 창을 연다 — 업무 시작이면 본인을 미리 선택한다(관리자 포함, UX 개선 2번).
 * '인원 추가'(groupId 있음)는 미리 선택하지 않는다 — 관리자가 남을 넣는 경우가 많아 본인이 잘못 들어가기 쉽다.
 * 본인이 고를 수 없는 상태(업무 중·근태·출근 전)면 선택하지 않는다(출근 전이면 본인 칸에 [출근하고 시작]).
 * @param {string} task
 * @param {string|null} [groupId]  있으면 '인원 추가'
 */
export const openTeamSelectForTask = (task, groupId = null) => {
    State.context.selectedTaskForStart = task;
    State.context.selectedGroupForAdd = groupId || null;
    State.context.tempSelectedMembers = (!groupId && State.appState.currentUser) ? [State.appState.currentUser] : [];
    rerenderTeamSelect();
    const titleEl = document.getElementById('team-select-modal-title');
    if (titleEl) titleEl.textContent = groupId ? `'${task}' 인원 추가` : `'${task}' 업무 시작`;
    const confirmBtn = document.getElementById('confirm-team-select-btn');
    if (confirmBtn && !confirmBtn.disabled) confirmBtn.textContent = '선택 완료 및 업무 시작';
    if (DOM.teamSelectModal) DOM.teamSelectModal.classList.remove('hidden');
};

// processClockIn 이 쓴 출근이 이 탭의 상태(appState.dailyAttendance)에 들어올 때까지 기다린다(실시간 구독이 넣는다).
// startWorkGroup 이 appState 로 출근 여부를 보기 때문이다. 최대 limitMs.
const waitForClockedIn = async (member, limitMs = 5000) => {
    const until = Date.now() + limitMs;
    while (Date.now() < until) {
        if (State.appState.dailyAttendance?.[member]?.status === 'active') return true;
        await new Promise(r => setTimeout(r, 150));
    }
    return State.appState.dailyAttendance?.[member]?.status === 'active';
};
const UNSELECTED_CLASSES = ['bg-white', 'border-gray-300', 'text-gray-900', 'hover:bg-blue-50', 'hover:border-blue-300'];

// 헬퍼: 버튼을 선택 상태로 만듦
const selectMemberBtn = (btn) => {
    btn.classList.remove(...UNSELECTED_CLASSES);
    btn.classList.add(...SELECTED_CLASSES);
};
// 헬퍼: 버튼을 선택 해제 상태로 만듦
const deselectMemberBtn = (btn) => {
    btn.classList.remove(...SELECTED_CLASSES);
    btn.classList.add(...UNSELECTED_CLASSES);
};

export function setupFormTeamListeners() {

    // 1. 팀원 선택 모달 닫기 (취소)
    if (DOM.cancelTeamSelectBtn) {
        DOM.cancelTeamSelectBtn.addEventListener('click', () => {
            if (DOM.teamSelectModal) DOM.teamSelectModal.classList.add('hidden');
        });
    }

    // 2. 팀원 선택 모달 내부 클릭 이벤트 (위임)
    if (DOM.teamSelectModal) {
        DOM.teamSelectModal.addEventListener('click', async (e) => {
            const target = e.target;

            // 0. 본인 [출근하고 시작] — 기존 출근 처리(processClockIn, 출퇴근 토글과 같은 길)로 출근한 뒤
            //    본인을 선택 목록에 넣고 [선택 완료 및 업무 시작] 을 누른 것과 같이 진행한다. 자동 출근이 아니다.
            const clockInStartBtn = target.closest('.self-clockin-start-btn');
            if (clockInStartBtn) {
                const me = State.appState.currentUser;
                if (!me || clockInStartBtn.disabled) return;
                clockInStartBtn.disabled = true;
                clockInStartBtn.textContent = '출근 처리 중…';
                const ok = await processClockIn(me);
                if (!ok) {   // 실패 안내는 processClockIn 이 이미 띄웠다
                    clockInStartBtn.disabled = false;
                    clockInStartBtn.textContent = '출근하고 시작';
                    return;
                }
                if (!State.context.tempSelectedMembers.includes(me)) State.context.tempSelectedMembers.push(me);
                const ready = await waitForClockedIn(me);
                rerenderTeamSelect();
                if (!ready || !State.context.tempSelectedMembers.includes(me)) {
                    showToast('출근은 처리됐습니다. 화면이 갱신되면 [선택 완료 및 업무 시작] 을 눌러 주세요.', true);
                    return;
                }
                document.getElementById('confirm-team-select-btn')?.click();
                return;
            }

            // A. 개별 팀원 선택 버튼
            const memberButton = target.closest('.member-select-btn');
            if (memberButton && !memberButton.disabled) {
                const memberName = memberButton.dataset.memberName;
                const isCurrentlySelected = memberButton.classList.contains('bg-blue-600');

                if (!isCurrentlySelected) {
                    selectMemberBtn(memberButton);
                    if (!State.context.tempSelectedMembers.includes(memberName)) {
                        State.context.tempSelectedMembers.push(memberName);
                    }
                } else {
                    deselectMemberBtn(memberButton);
                    State.context.tempSelectedMembers = State.context.tempSelectedMembers.filter(m => m !== memberName);
                }
            }

            // B. 그룹 전체 선택 버튼
            const selectAllBtn = target.closest('.group-select-all-btn');
            if (selectAllBtn) {
                const groupName = selectAllBtn.dataset.groupName;
                const memberListDiv = DOM.teamSelectModal.querySelector(`.space-y-2[data-group-name="${groupName}"]`);
                if (memberListDiv) {
                    const availableButtons = Array.from(memberListDiv.querySelectorAll('.member-select-btn:not(:disabled)'));
                    const allSelected = availableButtons.length > 0 && availableButtons.every(btn => btn.classList.contains('bg-blue-600'));

                    availableButtons.forEach(btn => {
                        const memberName = btn.dataset.memberName;
                        if (allSelected) {
                            deselectMemberBtn(btn);
                            State.context.tempSelectedMembers = State.context.tempSelectedMembers.filter(m => m !== memberName);
                        } else {
                             if (!btn.classList.contains('bg-blue-600')) {
                                selectMemberBtn(btn);
                                if (!State.context.tempSelectedMembers.includes(memberName)) {
                                    State.context.tempSelectedMembers.push(memberName);
                                }
                            }
                        }
                    });
                }
            }

            // C. 알바 수정 버튼
            const editPartTimerBtn = target.closest('.edit-part-timer-btn');
            if (editPartTimerBtn) {
                const partTimerId = editPartTimerBtn.dataset.partTimerId;
                const partTimer = (State.appState.partTimers || []).find(p => p.id === partTimerId);
                if (partTimer) {
                    document.querySelector('#edit-part-timer-modal h2').textContent = '알바 이름 수정';
                    document.getElementById('part-timer-edit-id').value = partTimer.id;
                    document.getElementById('part-timer-new-name').value = partTimer.name;
                    document.getElementById('edit-part-timer-modal').classList.remove('hidden');
                    setTimeout(() => document.getElementById('part-timer-new-name').focus(), 50);
                }
                return; 
            }

            // D. 알바 삭제 버튼
            const deletePartTimerBtn = target.closest('.delete-part-timer-btn');
            if (deletePartTimerBtn) {
                const partTimerId = deletePartTimerBtn.dataset.partTimerId;
                const partTimer = (State.appState.partTimers || []).find(p => p.id === partTimerId);

                if (partTimer) {
                    if(!confirm(`'${partTimer.name}' 님을 삭제하시겠습니까?`)) return;

                    State.appState.partTimers = State.appState.partTimers.filter(p => p.id !== partTimerId);

                    if (State.appState.dailyAttendance && State.appState.dailyAttendance[partTimer.name]) {
                        delete State.appState.dailyAttendance[partTimer.name];
                    }

                    // 🛡️ 즉시 firestore에 영구 저장 (추가/수정 핸들러와 동일 패턴)
                    try {
                        await updateDailyData({
                            partTimers: State.appState.partTimers,
                            dailyAttendance: State.appState.dailyAttendance
                        });
                    } catch (e) {
                        console.error('알바 삭제 저장 실패:', e);
                        markDataAsDirty();
                    }

                    rerenderTeamSelect();
                    showToast(`${partTimer.name}님이 삭제되었습니다.`);
                }
                return;
            }

            // E. 알바 추가 버튼
             if (target.closest('#add-part-timer-modal-btn')) {
                if (!State.appState.partTimers) State.appState.partTimers = [];

                const existingNames = new Set(State.appState.partTimers.map(p => p.name));
                let nextNum = 1;
                while (existingNames.has(`알바${nextNum}`)) {
                    nextNum++;
                }
                const newName = `알바${nextNum}`;

                const newPartTimer = {
                    id: generateId(),
                    name: newName,
                    wage: State.appConfig.defaultPartTimerWage || 10000,
                    isPartTimer: true // 자동 지각 등 분기용 메타데이터
                };

                if (!State.appState.dailyAttendance) State.appState.dailyAttendance = {};
                State.appState.dailyAttendance[newName] = {
                    inTime: getCurrentTime(),
                    outTime: null,
                    status: 'active'
                };
                State.appState.partTimers.push(newPartTimer);

                // 🛡️ 즉시 firestore에 영구 저장 (debounce 우회).
                // 이전엔 debouncedSaveState만 호출했는데, isDataDirty 플래그가
                // 안 켜져 있어 saveStateToFirestore가 일찍 return → 다른 사람의
                // daily_data sync에 의해 알바가 메모리에서도 사라지는 문제 발생.
                try {
                    await updateDailyData({
                        partTimers: State.appState.partTimers,
                        dailyAttendance: State.appState.dailyAttendance
                    });
                } catch (e) {
                    console.error('알바 추가 저장 실패:', e);
                    // 실패 시 dirty 플래그라도 켜서 다음 디바운스 저장이 작동하도록
                    markDataAsDirty();
                }

                rerenderTeamSelect();
                showToast(`'${newName}'이(가) 추가되고 출근 처리되었습니다.`);
                return;
            }

            // F. 업무 시작 / 추가 확인 버튼
            const confirmTeamSelectBtn = target.closest('#confirm-team-select-btn');
            if (confirmTeamSelectBtn) {
                 if (State.context.tempSelectedMembers.length === 0) {
                    showToast('최소 1명 이상의 팀원을 선택해주세요.', true);
                    return;
                }

                const btn = confirmTeamSelectBtn;
                btn.disabled = true;
                btn.textContent = '처리 중...';

                try {
                    if (State.context.selectedGroupForAdd) {
                        await addMembersToWorkGroup(State.context.tempSelectedMembers, State.context.selectedTaskForStart, State.context.selectedGroupForAdd);
                    } else {
                        await startWorkGroup(State.context.tempSelectedMembers, State.context.selectedTaskForStart);
                    }
                    DOM.teamSelectModal.classList.add('hidden');
                } catch (error) {
                    console.error("업무 시작 중 오류:", error);
                    showToast("오류가 발생했습니다. 다시 시도해주세요.", true);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '선택 완료 및 업무 시작';
                }
             }
        });
    }

    // 3. 알바 이름 수정 확인
    if (DOM.confirmEditPartTimerBtn) {
        DOM.confirmEditPartTimerBtn.addEventListener('click', async () => {
            const partTimerId = document.getElementById('part-timer-edit-id').value;
            const newName = document.getElementById('part-timer-new-name').value.trim();

            if (!newName) {
                showToast('이름을 입력해주세요.', true); return;
            }

            const isNameTaken = (State.appConfig.teamGroups || []).flatMap(g => g.members).includes(newName) ||
                                (State.appState.partTimers || []).some(p => p.name === newName && p.id !== partTimerId);

            if (isNameTaken) {
                showToast(`'${newName}'(이)라는 이름은 이미 사용 중입니다.`, true); return;
            }

            if (!partTimerId) {
                // 신규 추가 로직은 위쪽 버튼 핸들러에서 처리
            } else {
                const partTimer = (State.appState.partTimers || []).find(p => p.id === partTimerId);
                if (!partTimer) {
                    showToast('수정할 알바 정보를 찾을 수 없습니다.', true); return;
                }
                const oldName = partTimer.name;
                if (oldName === newName) {
                     document.getElementById('edit-part-timer-modal').classList.add('hidden'); return;
                }

                partTimer.name = newName;

                // 로컬 상태 업데이트 (이름 변경)
                (State.appState.workRecords || []).forEach(record => {
                    if (record.member === oldName) record.member = newName;
                });
                
                if (State.appState.dailyAttendance && State.appState.dailyAttendance[oldName]) {
                    State.appState.dailyAttendance[newName] = State.appState.dailyAttendance[oldName];
                    delete State.appState.dailyAttendance[oldName];
                }

                // DB 업데이트 (workRecords 내의 member 이름 변경 + daily_data partTimers/dailyAttendance 즉시 저장)
                try {
                    const today = getTodayDateString();
                    const workRecordsColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
                    const q = query(workRecordsColRef, where("member", "==", oldName));
                    const querySnapshot = await getDocs(q);
                    if (!querySnapshot.empty) {
                        const batch = writeBatch(State.db);
                        querySnapshot.forEach(doc => batch.update(doc.ref, { member: newName }));
                        await batch.commit();
                    }

                    // 🛡️ 즉시 firestore에 영구 저장 (debounce 우회).
                    // 이전엔 debouncedSaveState만 호출했는데 isDataDirty 플래그가
                    // 안 켜져 있어 partTimers/dailyAttendance 저장이 누락됨 →
                    // 다른 사람의 daily_data sync로 옛 이름이 다시 메모리에 덮어쓰여
                    // "업무카드는 새 이름, 인원 현황은 옛 이름" 불일치 발생.
                    await updateDailyData({
                        partTimers: State.appState.partTimers,
                        dailyAttendance: State.appState.dailyAttendance
                    });

                    // 🛡️ activeLock(트랜잭션 락) doc id가 oldName이라면 그것도 갱신 필요.
                    try {
                        const { doc: fbDoc, deleteDoc, setDoc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
                        const lockColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'activeLocks');
                        const oldLockRef = fbDoc(lockColRef, oldName);
                        const oldLockSnap = await getDoc(oldLockRef);
                        if (oldLockSnap.exists()) {
                            const data = oldLockSnap.data();
                            await setDoc(fbDoc(lockColRef, newName), { ...data, member: newName });
                            await deleteDoc(oldLockRef);
                        }
                    } catch (e) {
                        console.warn('activeLock 이름 갱신 실패 (자동 복구로 처리):', e);
                    }

                    showToast(`'${oldName}'님을 '${newName}'(으)로 수정했습니다.`);
                } catch (e) {
                    console.error("알바 이름 변경 중 DB 오류: ", e);
                    showToast("이름 변경 중 DB 저장에 실패했습니다.", true);
                    partTimer.name = oldName; // 롤백
                    markDataAsDirty();
                }
            }
            document.getElementById('edit-part-timer-modal').classList.add('hidden');
            rerenderTeamSelect();
        });
    }

    // 4. 알바 이름 수정 취소
    if (DOM.cancelEditPartTimerBtn) {
        DOM.cancelEditPartTimerBtn.addEventListener('click', () => {
            document.getElementById('edit-part-timer-modal').classList.add('hidden');
        });
    }
}