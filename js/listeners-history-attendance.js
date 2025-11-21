// === js/listeners-history-attendance.js ===
// 설명: 이력 보기의 '근태 이력' 관리(추가/수정/삭제 요청) 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString, getCurrentTime } from './utils.js';
import { renderAttendanceDailyHistory } from './ui-history.js';
import { doc, updateDoc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function setupHistoryAttendanceListeners() {
    // 1. 리스트 뷰 내 버튼 클릭 이벤트 (수정/삭제/추가 팝업 열기)
    if (DOM.attendanceHistoryViewContainer) {
        DOM.attendanceHistoryViewContainer.addEventListener('click', handleAttendanceListClicks);
    }

    // 2. 모달 내부 버튼 및 입력 제어 이벤트
    setupAttendanceModalButtons();
}

// 리스트 내 클릭 핸들러 (위임)
function handleAttendanceListClicks(e) {
    // 1. 수정 버튼
    const editBtn = e.target.closest('button[data-action="edit-attendance"]');
    if (editBtn) {
        const dateKey = editBtn.dataset.dateKey;
        const index = parseInt(editBtn.dataset.index, 10);
        if (!dateKey || isNaN(index)) return;
        
        const dayData = State.allHistoryData.find(d => d.id === dateKey);
        if (!dayData || !dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) {
            showToast('데이터를 찾을 수 없습니다.', true); return;
        }
        const record = dayData.onLeaveMembers[index];

        // 모달 폼 채우기
        if (DOM.editAttendanceMemberName) DOM.editAttendanceMemberName.value = record.member;
        if (DOM.editAttendanceTypeSelect) {
            DOM.editAttendanceTypeSelect.innerHTML = '';
            State.LEAVE_TYPES.forEach(type => {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                if (type === record.type) option.selected = true;
                DOM.editAttendanceTypeSelect.appendChild(option);
            });
        }

        const isTimeBased = ['외출', '조퇴', '지각'].includes(record.type);
        const isDateBased = ['연차', '출장', '결근'].includes(record.type);
        const isOuting = (record.type === '외출');
        
        if (DOM.editAttendanceTimeFields) {
             DOM.editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
             const endTimeWrapper = document.getElementById('edit-attendance-end-time-wrapper');
             if(endTimeWrapper) endTimeWrapper.classList.toggle('hidden', !isOuting);
             if(DOM.editAttendanceStartTimeInput) DOM.editAttendanceStartTimeInput.value = record.startTime || '';
             if(DOM.editAttendanceEndTimeInput) DOM.editAttendanceEndTimeInput.value = record.endTime || '';
        }
        if (DOM.editAttendanceDateFields) {
            DOM.editAttendanceDateFields.classList.toggle('hidden', !isDateBased);
            if(DOM.editAttendanceStartDateInput) DOM.editAttendanceStartDateInput.value = record.startDate || '';
            if(DOM.editAttendanceEndDateInput) DOM.editAttendanceEndDateInput.value = record.endDate || '';
        }
        
        // 메타 데이터 저장
        if (DOM.editAttendanceDateKeyInput) DOM.editAttendanceDateKeyInput.value = dateKey;
        if (DOM.editAttendanceRecordIndexInput) DOM.editAttendanceRecordIndexInput.value = index;
        
        if (DOM.editAttendanceRecordModal) DOM.editAttendanceRecordModal.classList.remove('hidden');
        return;
    }

    // 2. 삭제 버튼
    const deleteBtn = e.target.closest('button[data-action="delete-attendance"]');
    if (deleteBtn) {
        const dateKey = deleteBtn.dataset.dateKey;
        const index = parseInt(deleteBtn.dataset.index, 10);
        
        // 실제 삭제 로직은 listeners-modals-confirm.js에서 처리
        State.context.deleteMode = 'attendance';
        State.context.attendanceRecordToDelete = { dateKey, index };
        
        if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.remove('hidden');
        return;
    }

    // 3. 추가 버튼 (헤더 영역 등)
    const addBtn = e.target.closest('button[data-action="open-add-attendance-modal"]');
    if (addBtn) {
        const dateKey = addBtn.dataset.dateKey;
        if (DOM.addAttendanceForm) DOM.addAttendanceForm.reset();
        if (DOM.addAttendanceDateKeyInput) DOM.addAttendanceDateKeyInput.value = dateKey;
        if (DOM.addAttendanceStartDateInput) DOM.addAttendanceStartDateInput.value = dateKey;
        
        // 멤버 리스트 갱신 (직원 + 알바)
        if (DOM.addAttendanceMemberDatalist) {
            DOM.addAttendanceMemberDatalist.innerHTML = '';
            const all = [...new Set([...(State.appConfig.teamGroups||[]).flatMap(g=>g.members), ...(State.appState.partTimers||[]).map(p=>p.name)])].sort();
            all.forEach(m=>{const o=document.createElement('option');o.value=m;DOM.addAttendanceMemberDatalist.appendChild(o);});
        }
        
        // 유형 리스트 갱신
        if (DOM.addAttendanceTypeSelect) {
            DOM.addAttendanceTypeSelect.innerHTML = '';
            State.LEAVE_TYPES.forEach((t,i)=>{
                const o=document.createElement('option');o.value=t;o.textContent=t;
                if(i===0)o.selected=true;
                DOM.addAttendanceTypeSelect.appendChild(o);
            });
        }

        // 초기 UI 상태 설정
        const first = State.LEAVE_TYPES[0];
        const isTime = ['외출','조퇴','지각'].includes(first);
        const isDate = !isTime;
        if(DOM.addAttendanceTimeFields) DOM.addAttendanceTimeFields.classList.toggle('hidden', !isTime);
        if(DOM.addAttendanceDateFields) DOM.addAttendanceDateFields.classList.toggle('hidden', !isDate);
        const endWrap = document.getElementById('add-attendance-end-time-wrapper');
        if(endWrap) endWrap.classList.toggle('hidden', first!=='외출');

        if (DOM.addAttendanceRecordModal) DOM.addAttendanceRecordModal.classList.remove('hidden');
    }
}

function setupAttendanceModalButtons() {
    // --- 수정 모달 확인 버튼 ---
    if (DOM.confirmEditAttendanceBtn) {
        DOM.confirmEditAttendanceBtn.addEventListener('click', async () => {
            const dateKey = DOM.editAttendanceDateKeyInput.value;
            const index = parseInt(DOM.editAttendanceRecordIndexInput.value, 10);
            const member = DOM.editAttendanceMemberName.value;
            const type = DOM.editAttendanceTypeSelect.value;

            if (!dateKey || isNaN(index) || !member || !type) {
                showToast('필수 정보가 누락되었습니다.', true); return;
            }

            const isTimeBased = ['외출', '조퇴', '지각'].includes(type);
            const newEntry = { member, type };

            if (isTimeBased) {
                newEntry.startTime = DOM.editAttendanceStartTimeInput.value;
                newEntry.endTime = DOM.editAttendanceEndTimeInput.value;
                if (!newEntry.startTime) { showToast('시작 시간을 입력해주세요.', true); return; }
            } else {
                newEntry.startDate = DOM.editAttendanceStartDateInput.value;
                newEntry.endDate = DOM.editAttendanceEndDateInput.value || newEntry.startDate;
                if (!newEntry.startDate) { showToast('시작일을 입력해주세요.', true); return; }
            }

            try {
                const todayKey = getTodayDateString();
                
                // 1. 로컬 데이터 업데이트
                const dayDataIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
                if (dayDataIndex > -1) {
                     State.allHistoryData[dayDataIndex].onLeaveMembers[index] = newEntry;
                }

                // 2. Firestore 업데이트 (오늘 or 과거 이력)
                if (dateKey === todayKey) {
                     const dailyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey);
                     // 배열의 특정 인덱스 업데이트 시도 (실패 시 전체 배열 갱신)
                     await updateDoc(dailyDocRef, { [`onLeaveMembers.${index}`]: newEntry }).catch(async () => {
                         const docSnap = await getDoc(dailyDocRef).catch(() => null);
                         if (docSnap && docSnap.exists()) {
                             const currentLeaves = docSnap.data().onLeaveMembers || [];
                             if(currentLeaves.length > index) {
                                 currentLeaves[index] = newEntry;
                                 await updateDoc(dailyDocRef, { onLeaveMembers: currentLeaves });
                             }
                         }
                     });
                } else {
                     const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                     await updateDoc(historyDocRef, { [`onLeaveMembers.${index}`]: newEntry }).catch(async () => {
                         const docSnap = await getDoc(historyDocRef).catch(() => null);
                         if (docSnap && docSnap.exists()) {
                             const currentLeaves = docSnap.data().onLeaveMembers || [];
                             if(currentLeaves.length > index) {
                                 currentLeaves[index] = newEntry;
                                 await updateDoc(historyDocRef, { onLeaveMembers: currentLeaves });
                             }
                         }
                     });
                }

                showToast('근태 기록이 수정되었습니다.');
                DOM.editAttendanceRecordModal.classList.add('hidden');
                
                // 3. 화면 갱신 (현재 필터 상태 유지)
                const filteredData = (State.context.historyStartDate || State.context.historyEndDate)
                    ? State.allHistoryData.filter(d => {
                        const date = d.id;
                        const start = State.context.historyStartDate;
                        const end = State.context.historyEndDate;
                        if (start && end) return date >= start && date <= end;
                        if (start) return date >= start;
                        if (end) return date <= end;
                        return true;
                    })
                    : State.allHistoryData;
                renderAttendanceDailyHistory(dateKey, filteredData);

            } catch (e) {
                console.error("Error updating attendance:", e);
                showToast('수정 중 오류가 발생했습니다.', true);
            }
        });
    }

    if (DOM.cancelEditAttendanceBtn) {
        DOM.cancelEditAttendanceBtn.addEventListener('click', () => { 
            if(DOM.editAttendanceRecordModal) DOM.editAttendanceRecordModal.classList.add('hidden'); 
        });
    }
    
    // --- 추가 모달 확인 버튼 ---
    if (DOM.confirmAddAttendanceBtn) {
        DOM.confirmAddAttendanceBtn.addEventListener('click', async () => {
            const dateKey = DOM.addAttendanceDateKeyInput.value;
            const member = DOM.addAttendanceMemberNameInput.value.trim();
            const type = DOM.addAttendanceTypeSelect.value;

            if (!member || !type) { showToast('이름과 유형을 입력해주세요.', true); return; }

            const isTimeBased = ['외출', '조퇴', '지각'].includes(type);
            const newEntry = {
                member,
                type,
                id: `manual-leave-${Date.now()}` 
            };

            if (isTimeBased) {
                newEntry.startTime = DOM.addAttendanceStartTimeInput.value;
                newEntry.endTime = DOM.addAttendanceEndTimeInput.value;
                if (!newEntry.startTime) { showToast('시작 시간을 입력해주세요.', true); return; }
            } else {
                newEntry.startDate = DOM.addAttendanceStartDateInput.value;
                newEntry.endDate = DOM.addAttendanceEndDateInput.value || newEntry.startDate;
                if (!newEntry.startDate) { showToast('시작일을 입력해주세요.', true); return; }
            }

            try {
                const todayKey = getTodayDateString();
                
                // 1. 로컬 데이터 업데이트
                const dayDataIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
                if (dayDataIndex > -1) {
                    if (!State.allHistoryData[dayDataIndex].onLeaveMembers) {
                        State.allHistoryData[dayDataIndex].onLeaveMembers = [];
                    }
                    State.allHistoryData[dayDataIndex].onLeaveMembers.push(newEntry);
                } else if (dateKey !== todayKey) {
                    // 데이터가 아예 없는 날짜에 추가하는 경우 생성
                    State.allHistoryData.push({
                        id: dateKey,
                        onLeaveMembers: [newEntry],
                        workRecords: [],
                        taskQuantities: {},
                        management: {}
                    });
                    State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
                }

                // 2. Firestore 업데이트
                if (dateKey === todayKey) {
                    const dailyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey);
                    const docSnap = await getDoc(dailyDocRef).catch(() => null);
                    if (docSnap && docSnap.exists()) {
                        const currentLeaves = docSnap.data().onLeaveMembers || [];
                        currentLeaves.push(newEntry);
                        await updateDoc(dailyDocRef, { onLeaveMembers: currentLeaves });
                    } else {
                        await setDoc(dailyDocRef, { onLeaveMembers: [newEntry] }, { merge: true });
                    }
                } else {
                    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                    const docSnap = await getDoc(historyDocRef).catch(() => null);
                     if (docSnap && docSnap.exists()) {
                        const currentLeaves = docSnap.data().onLeaveMembers || [];
                        currentLeaves.push(newEntry);
                        await updateDoc(historyDocRef, { onLeaveMembers: currentLeaves });
                    } else {
                        await setDoc(historyDocRef, { id: dateKey, onLeaveMembers: [newEntry] });
                    }
                }

                showToast('근태 기록이 추가되었습니다.');
                DOM.addAttendanceRecordModal.classList.add('hidden');

                // 3. 화면 갱신
                 const filteredData = (State.context.historyStartDate || State.context.historyEndDate)
                    ? State.allHistoryData.filter(d => {
                        const date = d.id;
                        const start = State.context.historyStartDate;
                        const end = State.context.historyEndDate;
                        if (start && end) return date >= start && date <= end;
                        if (start) return date >= start;
                        if (end) return date <= end;
                        return true;
                    })
                    : State.allHistoryData;
                renderAttendanceDailyHistory(dateKey, filteredData);

            } catch (e) {
                console.error("Error adding attendance:", e);
                showToast('추가 중 오류가 발생했습니다.', true);
            }
        });
    }

    if (DOM.cancelAddAttendanceBtn) {
        DOM.cancelAddAttendanceBtn.addEventListener('click', () => { 
            if(DOM.addAttendanceRecordModal) DOM.addAttendanceRecordModal.classList.add('hidden'); 
        });
    }
    
    // --- 유형 선택에 따른 UI 토글 (시간/날짜 입력창) ---
    const toggleUI = (select, timeFields, dateFields, endWrapperId) => {
        select.addEventListener('change', e => {
            const t = e.target.value;
            const isTime = ['외출','조퇴','지각'].includes(t);
            timeFields.classList.toggle('hidden', !isTime);
            dateFields.classList.toggle('hidden', isTime);
            const w = document.getElementById(endWrapperId);
            if(w) w.classList.toggle('hidden', t!=='외출');
        });
    };
    
    if(DOM.addAttendanceTypeSelect) toggleUI(DOM.addAttendanceTypeSelect, DOM.addAttendanceTimeFields, DOM.addAttendanceDateFields, 'add-attendance-end-time-wrapper');
    if(DOM.editAttendanceTypeSelect) toggleUI(DOM.editAttendanceTypeSelect, DOM.editAttendanceTimeFields, DOM.editAttendanceDateFields, 'edit-attendance-end-time-wrapper');
}