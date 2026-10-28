// === js/listeners-form-attendance.js ===
// 설명: 근태 설정(연차/외출 등) 및 수정 모달의 폼 로직을 담당합니다.

import * as DOM from './dom-elements.js?v=202610281554';
import * as State from './state.js?v=202610281554';
import { isPersistentLeaveType, OTHER_LEAVE_TYPE, leaveTypeLabel } from './state.js?v=202610281554';
import { notifyLeaveScheduleChanged } from './leave-schedule-sync.js?v=202610281554';
import { showToast, getTodayDateString, toDateString, getCurrentTime, calculateWorkingDays, isWeekday } from './utils.js?v=202610281554';
import { saveStateToFirestore } from './app-data.js?v=202610281554';
import { updateLeaveSchedule } from './config.js?v=202610281554';
import { removeByIds, removeRecord } from './lib/leave-ops.js?v=202610281554';
import { renderLeaveTypeModalOptions } from './ui-modals.js?v=202610281554';
import { findDailyLeaveDup } from './lib/attendance-guard.js?v=202610281554';
import { doc, setDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 당일 근태 중복 안내 — 지각·조퇴는 하루 1건, 외출은 같은 시각만 중복
const dailyDupMessage = (type) => (type === '외출'
    ? '같은 시각에 이미 등록된 외출입니다.'
    : `이미 등록된 ${type}입니다. 하루 한 번만 등록할 수 있습니다.`);

// 헬퍼: 로컬 이력(allHistoryData)에서 특정 연차 ID 제거/업데이트
const updateLocalHistoryForLeave = (leaveEntry, action = 'add') => {
    const startDt = new Date(leaveEntry.startDate + 'T00:00:00');
    const endDt = new Date((leaveEntry.endDate || leaveEntry.startDate) + 'T00:00:00');

    for(let dt = new Date(startDt); dt <= endDt; dt.setDate(dt.getDate() + 1)) {
        const dateKey = toDateString(dt);
        if (!isWeekday(dateKey)) continue; 

        let dayData = State.allHistoryData.find(d => d.id === dateKey);
        
        if (action === 'add') {
            if (!dayData) {
                dayData = { id: dateKey, onLeaveMembers: [], workRecords: [], taskQuantities: {} };
                State.allHistoryData.push(dayData);
                State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
            }
            if (!dayData.onLeaveMembers) dayData.onLeaveMembers = [];
            const exists = dayData.onLeaveMembers.some(l => l.id === leaveEntry.id);
            if (!exists) {
                dayData.onLeaveMembers.push({ ...leaveEntry });
            }
        } else if (action === 'remove') {
            if (dayData && dayData.onLeaveMembers) {
                dayData.onLeaveMembers = dayData.onLeaveMembers.filter(l => l.id !== leaveEntry.id);
            }
        }
    }
};

export function setupFormAttendanceListeners() {

    if (DOM.leaveTypeModal) {
        DOM.leaveTypeModal.addEventListener('click', async (e) => {
            const delBtn = e.target.closest('.btn-delete-leave-history');
            if (delBtn) {
                if(!confirm('정말 이 내역을 삭제하시겠습니까? (병합된 내역은 모두 삭제됩니다)')) return;
                
                const idsString = delBtn.dataset.ids || '';
                const idsToDelete = idsString.split(',').filter(Boolean);
                
                try {
                    const r = await updateLeaveSchedule(State.db, list => removeByIds(list, idsToDelete));
                    if (r.changed) {
                        State.persistentLeaveSchedule.onLeaveMembers = r.list;
                        notifyLeaveScheduleChanged('leave-delete');
                    }

                    idsToDelete.forEach(id => {
                        State.allHistoryData.forEach(dayData => {
                            if (dayData.onLeaveMembers) {
                                dayData.onLeaveMembers = dayData.onLeaveMembers.filter(l => l.id !== id);
                            }
                        });
                    });

                    State.appState.dateBasedOnLeaveMembers = State.appState.dateBasedOnLeaveMembers.filter(l => !idsToDelete.includes(l.id));

                    renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');
                    if (typeof window.__refreshUpcomingLeave === 'function') window.__refreshUpcomingLeave();
                    showToast('삭제되었습니다.');
                } catch(err) {
                    console.error("삭제 실패:", err);
                    showToast('삭제 중 오류가 발생했습니다.', true);
                }
                return;
            }

            const editBtn = e.target.closest('.btn-edit-leave-history');
            if (editBtn) {
                const id = editBtn.dataset.id;
                const entry = State.persistentLeaveSchedule.onLeaveMembers.find(l => l.id === id);
                if (entry) {
                    document.getElementById('tab-leave-setting').click();
                    
                    const radio = document.querySelector(`input[name="leave-type"][value="${entry.type}"]`);
                    if(radio) radio.checked = true;
                    document.getElementById('leave-type-options').dispatchEvent(new Event('change'));
                    
                    document.getElementById('leave-start-date-input').value = entry.startDate;
                    document.getElementById('leave-end-date-input').value = entry.endDate || entry.startDate;
                    
                    DOM.confirmLeaveBtn.dataset.editingId = id;
                    DOM.confirmLeaveBtn.textContent = '수정 저장';
                }
            }
        });
    }

    if (DOM.confirmLeaveBtn) {
        DOM.confirmLeaveBtn.addEventListener('click', async () => {
            const memberName = State.context.memberToSetLeave;
            const selectedTypeRadio = document.querySelector('input[name="leave-type"]:checked');
            if (!memberName || !selectedTypeRadio) {
                showToast('선택이 필요합니다.', true);
                return;
            }

            const type = selectedTypeRadio.value;
            const today = getTodayDateString();

            // '기타'는 항목명을 반드시 직접 입력받는다. (type 은 '기타' 그대로, 이름은 customLabel 에)
            let customLabel = '';
            if (type === OTHER_LEAVE_TYPE) {
                customLabel = (document.getElementById('leave-other-label-input')?.value || '').trim();
                if (!customLabel) {
                    showToast('기타 항목명을 입력해주세요.', true);
                    document.getElementById('leave-other-label-input')?.focus();
                    return;
                }
            }
            const startDate = document.getElementById('leave-start-date-input').value || today;
            const endDate = document.getElementById('leave-end-date-input').value || startDate;

            // 중복 클릭 방지
            const originalBtnText = DOM.confirmLeaveBtn.textContent;
            DOM.confirmLeaveBtn.disabled = true;
            DOM.confirmLeaveBtn.textContent = '저장 중...';

            if (isPersistentLeaveType(type)) {
                if (startDate > endDate) {
                    showToast('종료 날짜는 시작 날짜보다 빠를 수 없습니다.', true);
                    DOM.confirmLeaveBtn.disabled = false;
                    DOM.confirmLeaveBtn.textContent = originalBtnText;
                    return;
                }

                const editingId = DOM.confirmLeaveBtn.dataset.editingId;
                let isDuplicate = false;
                const startDt = new Date(startDate + 'T00:00:00');
                const endDt = new Date(endDate + 'T00:00:00');
                
                for(let dt = new Date(startDt); dt <= endDt; dt.setDate(dt.getDate() + 1)) {
                    const checkDate = toDateString(dt);
                    if (!isWeekday(checkDate)) continue; 

                    const conflict = State.persistentLeaveSchedule.onLeaveMembers.some(l => {
                        const lStart = l.startDate;
                        const lEnd = l.endDate || l.startDate;
                        if (l.id === editingId) return false;
                        return l.member === memberName && l.type === type && (checkDate >= lStart && checkDate <= lEnd);
                    });

                    if (conflict) {
                        isDuplicate = true;
                        break;
                    }
                }

                if (isDuplicate) {
                    showToast('이미 해당 기간 평일에 동일한 기록이 존재합니다.', true);
                    DOM.confirmLeaveBtn.disabled = false;
                    DOM.confirmLeaveBtn.textContent = originalBtnText;
                    return;
                }

                try {
                    const isEdit = !!editingId;
                    // 새 기록은 id 를 트랜잭션 밖에서 정한다(재시도 때 같은 id).
                    const newEntry = isEdit ? null : {
                        id: `leave-${Date.now()}`,
                        member: memberName,
                        type,
                        startDate,
                        endDate,
                        ...(type === OTHER_LEAVE_TYPE ? { customLabel } : {})
                    };
                    // mutate 는 재시도 때 여러 번 불린다 — 마지막(성공한) 시도의 값만 남는다.
                    let beforeEdit = null;
                    let leaveEntry = newEntry;
                    const r = await updateLeaveSchedule(State.db, list => {
                        if (!isEdit) return [...list, newEntry];
                        const idx = list.findIndex(l => l.id === editingId);
                        if (idx < 0) return false;   // 다른 곳에서 지워진 기록 — 쓰지 않는다
                        beforeEdit = { ...list[idx] };
                        const edited = { ...list[idx], type, startDate, endDate };
                        if (type === OTHER_LEAVE_TYPE) edited.customLabel = customLabel;
                        else delete edited.customLabel;
                        leaveEntry = edited;
                        return list.map((l, i) => (i === idx ? edited : l));
                    });

                    if (!r.changed) {
                        // 원본 없음 — 서버 목록으로 화면만 맞추고 끝낸다.
                        delete DOM.confirmLeaveBtn.dataset.editingId;
                        DOM.confirmLeaveBtn.textContent = '설정 저장';
                        State.persistentLeaveSchedule.onLeaveMembers = r.list;
                        notifyLeaveScheduleChanged('leave-save');
                        showToast('수정할 원본 기록을 찾지 못했습니다(다른 곳에서 삭제됨).', true);
                        renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');
                        if (typeof window.__refreshUpcomingLeave === 'function') window.__refreshUpcomingLeave();
                        DOM.confirmLeaveBtn.disabled = false;
                        return;
                    }

                    if (isEdit) {
                        updateLocalHistoryForLeave(beforeEdit, 'remove');
                        delete DOM.confirmLeaveBtn.dataset.editingId;
                        DOM.confirmLeaveBtn.textContent = '설정 저장';
                    }
                    const currentLeaves = r.list;
                    State.persistentLeaveSchedule.onLeaveMembers = currentLeaves;
                    notifyLeaveScheduleChanged('leave-save');
                    updateLocalHistoryForLeave(leaveEntry, 'add');

                    const todayLeaves = currentLeaves.filter(entry => {
                        const ed = entry.endDate || entry.startDate;
                        return today >= entry.startDate && today <= ed;
                    });
                    State.appState.dateBasedOnLeaveMembers = todayLeaves;

                    const diffDays = calculateWorkingDays(startDate, endDate);
                    
                    if (isEdit) {
                        showToast('수정되었습니다.');
                        renderLeaveTypeModalOptions(State.LEAVE_TYPES, 'status');
                        if (typeof window.__refreshUpcomingLeave === 'function') window.__refreshUpcomingLeave();
                    } else {
                        if (type === '연차') showToast(`${memberName}님 ${diffDays}일(평일기준) 연차 처리 완료.`);
                        else showToast(`${memberName}님 ${leaveTypeLabel(leaveEntry)} 처리 완료.`);
                    }
                    document.getElementById('leave-start-date-input').value = '';
                    document.getElementById('leave-end-date-input').value = '';
                    // 예정 근태 목록 즉시 갱신(추가/수정 모두)
                    if (typeof window.__refreshUpcomingLeave === 'function') window.__refreshUpcomingLeave();

                } catch(err) {
                    console.error("연차 설정 저장 실패:", err);
                    showToast("저장 중 오류가 발생했습니다.", true);
                }

            } else {
                // 🔥 당일 근태(지각, 조퇴, 외출)도 즉각 전송 및 서버 병합
                try {
                    const todayDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);

                    // id·시각은 트랜잭션 밖에서 정한다 — 충돌로 다시 돌아도 같은 기록이다
                    const newDailyEntry = {
                        id: `daily-${Date.now()}`,
                        member: memberName,
                        type: type,
                        startTime: (type === '외출' || type === '조퇴' || type === '지각') ? getCurrentTime() : null,
                        endTime: null
                    };

                    // 0. 메모리로 먼저 확인(빠른 안내). 최종 판정은 아래 트랜잭션이 서버 값으로 한다.
                    if (findDailyLeaveDup(State.appState.dailyOnLeaveMembers, newDailyEntry)) {
                        showToast(dailyDupMessage(type), true);
                        DOM.confirmLeaveBtn.disabled = false;
                        DOM.confirmLeaveBtn.textContent = originalBtnText;
                        return;
                    }

                    // 1. 서버 목록을 읽고 중복이 아니면 더해 쓴다(두 PC 가 동시에 눌러도 한 건만)
                    const saved = await runTransaction(State.db, async (tx) => {
                        const snap = await tx.get(todayDocRef);
                        const list = snap.exists() && Array.isArray(snap.data().onLeaveMembers) ? snap.data().onLeaveMembers : [];
                        if (findDailyLeaveDup(list, newDailyEntry)) return { dup: true };
                        const next = [...list, newDailyEntry];
                        tx.set(todayDocRef, { onLeaveMembers: next }, { merge: true });
                        return { dup: false, next };
                    });
                    if (saved.dup) {
                        showToast(dailyDupMessage(type), true);
                        DOM.confirmLeaveBtn.disabled = false;
                        DOM.confirmLeaveBtn.textContent = originalBtnText;
                        return;
                    }
                    const currentDailyLeaves = saved.next;
                    State.appState.dailyOnLeaveMembers = currentDailyLeaves;

                    // 🛡️ 외출/조퇴 등록 시점에 진행 중 workRecord가 있으면 외출 시작 시각으로 강제 종료.
                    // 종료 누락된 record가 외출 시간까지 끌고 가는 사고 방지.
                    if (type === '외출' || type === '조퇴') {
                        try {
                            const { forceEndMemberWork } = await import('./app-sync.js?v=202610281554');
                            const r = await forceEndMemberWork(memberName, newDailyEntry.startTime);
                            if (r.ended > 0) {
                                console.warn(`[외출/조퇴 자동 종료] ${memberName}: ${r.ended}건`, r.summaries);
                                showToast(`진행 중이던 업무 ${r.ended}건이 ${newDailyEntry.startTime}로 자동 종료되었습니다.`);
                            }
                        } catch (e) {
                            console.error('forceEndMemberWork on leave register failed:', e);
                        }
                    }

                    // 2. 이력(데이터 관리) 화면에 새로고침 없이 즉각 표시되도록 메모리 반영
                    let dayData = State.allHistoryData.find(d => d.id === today);
                    if (dayData) {
                        if (!dayData.onLeaveMembers) dayData.onLeaveMembers = [];
                        dayData.onLeaveMembers.push(newDailyEntry);
                    }

                    showToast(`${memberName}님 ${type} 처리 완료.`);
                    if (DOM.leaveTypeModal) DOM.leaveTypeModal.classList.add('hidden');
                } catch(err) {
                    console.error("일일 근태 설정 저장 실패:", err);
                    showToast("저장 중 오류가 발생했습니다.", true);
                }
            }

            DOM.confirmLeaveBtn.disabled = false;
            if (DOM.confirmLeaveBtn.textContent === '저장 중...') DOM.confirmLeaveBtn.textContent = originalBtnText;
        });
    }

    const editLeaveModal = DOM.editLeaveModal || document.getElementById('edit-leave-record-modal');

    if (editLeaveModal) {
        const cancelEditLeaveBtn = document.getElementById('cancel-edit-leave-record-btn');
        if (cancelEditLeaveBtn) {
            cancelEditLeaveBtn.addEventListener('click', () => {
                editLeaveModal.classList.add('hidden');
            });
        }

        const deleteLeaveBtn = document.getElementById('delete-leave-record-btn');
        if (deleteLeaveBtn) {
            deleteLeaveBtn.addEventListener('click', () => {
                const memberName = document.getElementById('edit-leave-original-member-name').value;
                const type = document.getElementById('edit-leave-type').value; 
                
                State.context.deleteMode = 'leave-record';
                State.context.attendanceRecordToDelete = { 
                    memberName: memberName,
                    startIdentifier: document.getElementById('edit-leave-original-start-identifier').value,
                    type: document.getElementById('edit-leave-original-type').value,
                    displayType: type
                };

                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = `${memberName}님의 '${type}' 기록을 삭제하시겠습니까?`;
                
                editLeaveModal.classList.add('hidden');
                if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.remove('hidden');
            });
        }

        const confirmEditLeaveBtn = document.getElementById('confirm-edit-leave-record-btn');
        if (confirmEditLeaveBtn) {
            confirmEditLeaveBtn.addEventListener('click', async () => {
                const memberName = document.getElementById('edit-leave-original-member-name').value;
                const originalStart = document.getElementById('edit-leave-original-start-identifier').value;
                const originalType = document.getElementById('edit-leave-original-type').value;

                const newType = document.getElementById('edit-leave-type').value;
                const newStartTime = document.getElementById('edit-leave-start-time').value;
                const newEndTime = document.getElementById('edit-leave-end-time').value;
                const newStartDate = document.getElementById('edit-leave-start-date').value;
                const newEndDate = document.getElementById('edit-leave-end-date').value;

                const isNewTimeBased = (newType === '외출' || newType === '조퇴' || newType === '지각');

                let dailyChanged = false;
                let persistentChanged = false;
                let foundAndRemoved = false;
                let newPersistentEntry = null;   // 날짜 기반으로 새로 넣을 기록(서버 목록에 트랜잭션으로 적용)
                let originalPersistent = null;   // 화면 목록에서 찾은 원본 — 서버에서는 id(없으면 내용 첫 1건)로 지운다

                const today = getTodayDateString();
                let currentDailyLeaves = [...State.appState.dailyOnLeaveMembers];
                let currentLeaves = [...State.persistentLeaveSchedule.onLeaveMembers];

                if (originalType === 'daily') {
                    const index = currentDailyLeaves.findIndex(
                        r => r.member === memberName && (r.startTime || '') === originalStart
                    );
                    if (index > -1) {
                        currentDailyLeaves.splice(index, 1);
                        dailyChanged = true;
                        foundAndRemoved = true;
                    }
                } else { 
                    const index = currentLeaves.findIndex(
                        r => r.member === memberName && (r.startDate || '') === originalStart
                    );
                    if (index > -1) {
                        originalPersistent = currentLeaves[index];
                        currentLeaves.splice(index, 1);
                        persistentChanged = true;
                        foundAndRemoved = true;
                    }
                }

                if (!foundAndRemoved) {
                    showToast('수정할 원본 기록을 찾지 못했습니다.', true);
                    return;
                }

                if (isNewTimeBased) {
                    if (!newStartTime) {
                        showToast('시간 기반 근태는 시작 시간이 필수입니다.', true);
                        return;
                    }
                    const editedEntry = {
                        id: `daily-${Date.now()}`,
                        member: memberName,
                        type: newType,
                        startTime: newStartTime,
                        endTime: (newType === '외출') ? newEndTime : null 
                    };
                    // 원본을 뺀 목록에 같은 날 지각·조퇴(같은 시각 외출)가 이미 있으면 막는다
                    if (findDailyLeaveDup(currentDailyLeaves, editedEntry)) {
                        showToast(`${memberName} 님은 오늘 이미 ${newType} 기록이 있습니다.`, true);
                        return;
                    }
                    currentDailyLeaves.push(editedEntry);
                    dailyChanged = true;
                } else { 
                    if (!newStartDate) {
                        showToast('날짜 기반 근태는 시작일이 필수입니다.', true);
                        return;
                    }
                    newPersistentEntry = {
                        id: `leave-${Date.now()}`,
                        member: memberName,
                        type: newType,
                        startDate: newStartDate,
                        endDate: newEndDate || newStartDate
                    };
                    currentLeaves.push(newPersistentEntry);
                    persistentChanged = true;
                }

                try {
                    if (dailyChanged) {
                        const todayDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
                        await setDoc(todayDocRef, { onLeaveMembers: currentDailyLeaves }, { merge: true });
                        State.appState.dailyOnLeaveMembers = currentDailyLeaves;
                    }
                    if (persistentChanged) {
                        // 화면 사본(currentLeaves)을 통째로 쓰지 않고, 같은 변경(원본 제거 + 새 기록)을 서버 목록에 적용한다.
                        const r = await updateLeaveSchedule(State.db, list => {
                            let next = originalPersistent ? removeRecord(list, originalPersistent) : list;
                            if (newPersistentEntry) next = [...next, newPersistentEntry];
                            return next;
                        });
                        if (r.changed) {
                            State.persistentLeaveSchedule.onLeaveMembers = r.list;
                            notifyLeaveScheduleChanged('leave-edit');
                        }
                    }
                    showToast('근태 기록이 수정되었습니다.');
                    editLeaveModal.classList.add('hidden');
                } catch (e) {
                    console.error("Error saving updated leave record:", e);
                    showToast('기록 저장 중 오류가 발생했습니다.', true);
                }
            });
        }
        
        const editLeaveTypeSelect = document.getElementById('edit-leave-type');
        if (editLeaveTypeSelect) {
            editLeaveTypeSelect.addEventListener('change', (e) => {
                const newType = e.target.value;
                const isTimeBased = (newType === '외출' || newType === '조퇴' || newType === '지각');
                const isOuting = (newType === '외출');
                
                document.getElementById('edit-leave-time-fields').classList.toggle('hidden', !isTimeBased);
                document.getElementById('edit-leave-date-fields').classList.toggle('hidden', isTimeBased);
                
                const endTimeWrapper = document.getElementById('edit-leave-end-time-wrapper');
                if (endTimeWrapper) {
                    endTimeWrapper.classList.toggle('hidden', !isOuting);
                }
            });
        }
    }

    const manualAddHistoryBtn = document.getElementById('btn-manual-add-leave-history');
    if (manualAddHistoryBtn) {
        manualAddHistoryBtn.addEventListener('click', () => {
            const tabSetting = document.getElementById('tab-leave-setting');
            if (tabSetting) tabSetting.click();

            if (DOM.confirmLeaveBtn) {
                delete DOM.confirmLeaveBtn.dataset.editingId;
                DOM.confirmLeaveBtn.textContent = '설정 저장';
            }
            
            const sInput = document.getElementById('leave-start-date-input');
            const eInput = document.getElementById('leave-end-date-input');
            if (sInput) sInput.value = '';
            if (eInput) eInput.value = '';
            
            const radio = document.querySelector('input[name="leave-type"][value="연차"]');
            if (radio) radio.checked = true;
            
            const optionsContainer = document.getElementById('leave-type-options');
            if (optionsContainer) optionsContainer.dispatchEvent(new Event('change'));
        });
    }
}