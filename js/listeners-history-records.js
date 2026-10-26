// === js/listeners-history-records.js ===
// 설명: 이력 보기의 '기록 관리'(상세 내역 수정/삭제/일괄적용) 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610261315';
import * as State from './state.js?v=202610261315';
import { showToast, showConfirm } from './utils.js?v=202610261315';
import {
    updateHistoryWorkRecord,
    deleteHistoryWorkRecord,
    addHistoryWorkRecord
} from './history-data-manager.js?v=202610261315';
import { renderHistoryDetail } from './app-history-logic.js?v=202610261315';
import { renderHistoryRecordsTable, openHistoryRecordManager, countDirtyRecordRows, isRecordRowDirty } from './history-record-table.js?v=202610261315';
import { generateId } from './app-data.js?v=202610261315';
import { checkStartAfterClockIn, clampStartToClockIn } from './lib/attendance-guard.js?v=202610261315';

const currentRecordsDateKey = () => document.getElementById('history-records-date').textContent;
// 기존 확인창 끝에 붙이는 문구 — 저장 안 한 수정이 없으면 빈 문자열
const dirtyNote = (n) => (n > 0 ? ` (저장하지 않은 수정 ${n}건도 사라집니다)` : '');
// 복제 저장 중 — 끝나기 전 다시 눌러도 한 번만 복제한다
let duplicating = false;
// 그날 그 사람의 출근시각(이력 메모리). 없으면 undefined → 검사 생략
const historyInTime = (dateKey, member) =>
    State.allHistoryData.find(d => d.id === dateKey)?.dailyAttendance?.[member]?.inTime;
// 저장 함수가 출근시각 검사로 막았으면 그 안내를, 아니면 기본 문구를
const errMsg = (e, fallback) => (e && e.code === 'START_BEFORE_CLOCKIN' ? e.message : fallback);

export function setupHistoryRecordListeners() {

    // 1. 메인 뷰에서 '기록 관리' 버튼 클릭 시 모달 열기
    if (DOM.historyViewContainer) {
        DOM.historyViewContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action="open-record-manager"]');
            if (btn) {
                openHistoryRecordManager(btn.dataset.dateKey);
            }
        });
    }

    // 2. 필터 UI 변경 (필터링)
    const memberFilterEl = document.getElementById('history-record-filter-member');
    const taskFilterEl = document.getElementById('history-record-filter-task');

    //    표를 다시 그리면 저장 안 한 입력이 사라진다 — 바꾸기 전 값을 기억해 두고, 확인창에서 취소하면 되돌린다.
    [memberFilterEl, taskFilterEl].forEach(selectEl => {
        if (!selectEl) return;
        const rememberPrev = () => { selectEl.dataset.prev = selectEl.value; };
        selectEl.addEventListener('focus', rememberPrev);
        selectEl.addEventListener('mousedown', rememberPrev);
        selectEl.addEventListener('change', () => {
            const dateKey = currentRecordsDateKey();
            const dirty = countDirtyRecordRows(dateKey);
            if (dirty > 0 && !confirm(`저장하지 않은 수정 ${dirty}건이 사라집니다. 필터를 바꿀까요?`)) {
                selectEl.value = selectEl.dataset.prev ?? '';
                return;
            }
            selectEl.dataset.prev = selectEl.value;
            renderHistoryRecordsTable(dateKey);
        });
    });

    // 3. (기존) 선택된 업무 일괄 시간 수정 적용
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

            if (!confirm(`선택된 업무(${taskFilterVal})의 모든 기록을 일괄 수정하시겠습니까?${dirtyNote(countDirtyRecordRows(dateKey))}`)) return;

            try {
                const data = State.allHistoryData.find(d => d.id === dateKey);
                const records = data ? data.workRecords : [];
                const targets = records.filter(r => r.task === taskFilterVal);
                
                if (targets.length === 0) { showToast('수정할 대상이 없습니다.', true); return; }

                // 일괄 수정은 막지 않고 각자 출근시각으로 맞춘다. 맞춘 시작이 종료 이후가 되는 기록이
                // 하나라도 있으면 아무것도 저장하지 않는다(일부만 바뀌면 되돌리기 어렵다).
                let adjustedCount = 0;
                const plans = [];
                for (const r of targets) {
                    const updateData = {};
                    if (newStart) {
                        const c = clampStartToClockIn(newStart, historyInTime(dateKey, r.member));
                        if (c.adjusted) adjustedCount++;
                        updateData.startTime = c.startTime;
                        const end = newEnd || r.endTime;
                        if (c.adjusted && end && c.startTime >= end) {
                            showToast(`${r.member} 님은 출근시각(${c.startTime})에 맞추면 시작이 종료(${end}) 이후가 됩니다. 일괄 수정을 멈췄습니다.`, true);
                            return;
                        }
                    }
                    if (newEnd) updateData.endTime = newEnd;
                    plans.push({ id: r.id, updateData });
                }

                // 같은 날 문서를 여러 번 고치므로 순서대로 보낸다
                let saved = 0;
                try {
                    for (const p of plans) {
                        await updateHistoryWorkRecord(dateKey, p.id, p.updateData);
                        saved++;
                    }
                } catch (e) {
                    // 다른 PC가 출근시각을 바꾼 경우 등 — 몇 건까지 저장됐는지 알려 준다
                    if (saved > 0) {
                        renderHistoryRecordsTable(dateKey);
                        renderHistoryDetail(dateKey);
                        e.message = `${errMsg(e, '저장 오류')} (${plans.length}건 중 ${saved}건은 이미 저장됨)`;
                        e.code = 'START_BEFORE_CLOCKIN';
                    }
                    throw e;
                }
                showToast(adjustedCount > 0
                    ? `${targets.length}건의 기록이 일괄 수정되었습니다. ${adjustedCount}건은 출근시각에 맞췄습니다.`
                    : `${targets.length}건의 기록이 일괄 수정되었습니다.`);
                renderHistoryRecordsTable(dateKey);
                renderHistoryDetail(dateKey); 
            } catch (e) {
                console.error(e);
                showToast(errMsg(e, '일괄 수정 중 오류가 발생했습니다.'), true);
            }
        });
    }

    // 4. 기록 추가 버튼 (수동 입력 모달 열기)
    if (DOM.historyRecordAddBtn) {
        DOM.historyRecordAddBtn.addEventListener('click', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            if (!dateKey) { showToast('날짜 정보를 찾을 수 없습니다.', true); return; }
            
            if (DOM.historyAddDateDisplay) DOM.historyAddDateDisplay.textContent = dateKey;
            if (DOM.historyAddRecordForm) DOM.historyAddRecordForm.reset();
            
            // Datalist 채우기
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
             // 추가하면 표를 다시 그린다 — 저장 안 한 수정이 사라진다
             const dirty = countDirtyRecordRows(dateKey);
             if (dirty > 0 && !confirm(`저장하지 않은 수정 ${dirty}건이 사라집니다. 기록을 추가할까요?`)) return;

             // 저장이 끝날 때까지 버튼을 잠근다 — 명단 확인창이 떠 있는 동안 다시 눌려도 두 번 저장되지 않게.
             const btn = DOM.confirmHistoryAddBtn;
             btn.disabled = true;
             try {
                 // 오타로 없는 사람 이름이 들어가는 것을 막는다(명단 = 추가 창을 열 때 채운 목록).
                 const roster = DOM.historyAddMemberDatalist
                     ? Array.from(DOM.historyAddMemberDatalist.options).map(o => o.value)
                     : [];
                 if (!roster.includes(member)) {
                     const ok = await showConfirm(`'${member}'은(는) 명단에 없는 이름입니다. 그래도 추가할까요?`,
                         { title: '명단에 없는 이름', okText: '추가' });
                     if (!ok) return;
                 }

                 const newRecord = {
                     id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                     member, task, startTime, endTime, 
                     status: 'completed', pauses: [],
                     groupId: `manual-grp-${Date.now()}` // 그룹 ID도 생성
                 };
                 await addHistoryWorkRecord(dateKey, newRecord);
                 showToast('기록이 추가되었습니다.');
                 if (DOM.historyAddRecordModal) DOM.historyAddRecordModal.classList.add('hidden');
                 
                 renderHistoryRecordsTable(dateKey);
                 // 상세 뷰 갱신
                 const selectedDateKey = document.querySelector('.history-date-btn.is-on')?.dataset.key;
                 if (dateKey === selectedDateKey) {
                     renderHistoryDetail(dateKey);
                 }
             } catch (e) {
                 console.error(e);
                 showToast(errMsg(e, '기록 추가 중 오류가 발생했습니다.'), true);
             } finally {
                 btn.disabled = false;
             }
        });
    }

    // 6. 테이블 내부 버튼 (삭제 및 복제)
    if (DOM.historyRecordsTableBody) {
        DOM.historyRecordsTableBody.addEventListener('click', async (e) => {
            const target = e.target;
            
            // 삭제
            const deleteBtn = target.closest('button[data-action="delete-history-record"]');
            if (deleteBtn) {
                const dateKey = deleteBtn.dataset.dateKey;
                const recordId = deleteBtn.dataset.recordId;
                if (confirm('정말로 이 기록을 삭제하시겠습니까?' + dirtyNote(countDirtyRecordRows(dateKey)))) {
                    try {
                        await deleteHistoryWorkRecord(dateKey, recordId);
                        showToast('기록이 삭제되었습니다.');
                        renderHistoryRecordsTable(dateKey);
                        const selectedDateKey = document.querySelector('.history-date-btn.is-on')?.dataset.key;
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

            // ✅ [신규] 복제 기능
            const duplicateBtn = target.closest('button[data-action="duplicate-history-record"]');
            if (duplicateBtn) {
                const dateKey = duplicateBtn.dataset.dateKey;
                const recordId = duplicateBtn.dataset.recordId;
                
                // 원본 데이터 찾기
                const dayData = State.allHistoryData.find(d => d.id === dateKey);
                const originalRecord = dayData?.workRecords?.find(r => r.id === recordId);

                if (originalRecord) {
                    if (duplicating) return;   // 앞 복제가 끝나기 전 연타 — 같은 기록이 여러 번 생기지 않게
                    const dirty = countDirtyRecordRows(dateKey);
                    if (dirty > 0 && !confirm(`저장하지 않은 수정 ${dirty}건이 사라집니다. 복제할까요?`)) return;
                    duplicating = true;
                    try {
                        const newRecord = {
                            ...originalRecord,
                            id: generateId(), // 새 ID 생성
                            groupId: generateId() // 새 그룹 ID
                        };
                        
                        await addHistoryWorkRecord(dateKey, newRecord);
                        
                        showToast(`${originalRecord.member}님의 기록이 복제되었습니다.`);
                        renderHistoryRecordsTable(dateKey); // 테이블 갱신
                        
                        // 백그라운드 뷰 갱신
                        const selectedDateKey = document.querySelector('.history-date-btn.is-on')?.dataset.key;
                        if (dateKey === selectedDateKey) renderHistoryDetail(dateKey);

                    } catch (err) {
                        console.error("복제 중 오류:", err);
                        showToast(errMsg(err, "기록 복제에 실패했습니다."), true);
                    } finally {
                        duplicating = false;
                    }
                }
            }
        });
    }

    // 닫기(× · 하단 [취소 / 닫기] · ESC — modal-esc.js 가 #history-records-close-btn 을 누른다) 전에 저장 안 한 수정 확인.
    //    캡처 단계에서 막아야 버튼의 인라인 onclick 과 listeners-modals.js 의 공통 닫기가 둘 다 멈춘다.
    if (DOM.historyRecordsModal) {
        DOM.historyRecordsModal.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn || btn.id === 'history-record-save-all-btn') return;
            const isClose = btn.classList.contains('modal-close-btn')
                || !!btn.closest('.border-t.flex.justify-end');
            if (!isClose) return;
            const dirty = countDirtyRecordRows(currentRecordsDateKey());
            if (dirty > 0 && !confirm(`저장하지 않은 수정 ${dirty}건이 사라집니다. 닫을까요?`)) {
                e.stopPropagation();
                e.preventDefault();
            }
        }, true);
    }

    // ✅ [신규] 일괄 저장 기능 (DOM 위임: 모달 컨텐츠 박스에 리스너 연결)
    if (DOM.historyRecordsModal) {
        DOM.historyRecordsModal.addEventListener('click', async (e) => {
            const saveAllBtn = e.target.closest('#history-record-save-all-btn');
            if (!saveAllBtn) return;
            const dateKey = document.getElementById('history-records-date').textContent;
            if (!dateKey) return;

            const rows = [...DOM.historyRecordsTableBody.querySelectorAll('tr.history-record-row')];
            const records = State.allHistoryData.find(d => d.id === dateKey)?.workRecords || [];
            // 빨간 표시: 행 배경 + 입력칸 테두리
            const markRow = (row, bad) => {
                row.classList.toggle('bg-red-50', bad);
                row.classList.toggle('bg-white', !bad);
                row.querySelectorAll('select, input').forEach(el => {
                    el.classList.toggle('ring-2', bad);
                    el.classList.toggle('ring-red-400', bad);
                });
            };

            // 1. 바뀐 행만 고르고, 잘못된 행이 하나라도 있으면 아무것도 저장하지 않는다
            //    (예전엔 잘못된 행을 조용히 빼고 'N건 저장'이라 했고, 안 바뀐 행까지 전부 다시 썼다)
            const targets = [];
            const invalid = [];
            const early = [];   // 출근시각보다 이른 시작
            rows.forEach(row => {
                markRow(row, false);
                if (!isRecordRowDirty(row)) return;
                const recordId = row.dataset.recordId;
                const task = row.querySelector('.history-record-task').value;
                const start = row.querySelector('.history-record-start').value;
                const end = row.querySelector('.history-record-end').value;
                // 진행 중 기록(ongoing·paused)은 종료칸을 건드리지 않았으면 endTime 을 보내지 않고 업무·시작만 검사한다.
                // 오늘 기록은 동기화(clampOpenRecords)로 종료칸이 현재 시각으로 채워져 그려지므로 빈칸 여부로는 못 가른다.
                // 종료칸을 일부러 바꿨으면 기존처럼 endTime 을 보낸다.
                const rec = records.find(r => r.id === recordId);
                const isOpen = !!rec && (rec.status === 'ongoing' || rec.status === 'paused');
                const keepOpen = isOpen && end === (row.dataset.origEnd ?? '');
                const bad = !recordId || !task || !start || (keepOpen ? false : (!end || start >= end));
                if (bad) { invalid.push(row); markRow(row, true); return; }
                // 시작을 바꾼 행만 출근시각과 비교한다(저장 함수와 같은 기준)
                if (rec && start !== rec.startTime
                    && !checkStartAfterClockIn(start, historyInTime(dateKey, rec.member)).ok) {
                    early.push(row); markRow(row, true); return;
                }
                const updateData = keepOpen ? { task, startTime: start } : { task, startTime: start, endTime: end };
                targets.push({ row, recordId, updateData, sent: { task, start, end } });
            });

            if (invalid.length > 0) {
                showToast(`잘못된 행 ${invalid.length}건(빈 칸 또는 시작≥종료) — 빨간 줄을 고친 뒤 다시 저장하세요.`, true);
                return;
            }
            if (early.length > 0) {
                showToast(`출근시각보다 이른 시작 ${early.length}건 — 빨간 줄을 고친 뒤 다시 저장하세요.`, true);
                return;
            }
            if (targets.length === 0) {
                showToast('바뀐 기록이 없습니다.');
                return;
            }

            saveAllBtn.disabled = true;
            saveAllBtn.textContent = '저장 중...';

            // 2. 순서대로 저장 — 같은 날 문서를 여러 번 고치므로 동시에 보내지 않는다
            let ok = 0;
            let fail = 0;
            try {
                for (const { row, recordId, updateData, sent } of targets) {
                    try {
                        await updateHistoryWorkRecord(dateKey, recordId, updateData);
                        ok++;
                        // 저장된 행은 기준값을 '실제로 보낸 값'으로(저장 중 사용자가 또 고친 값은 계속 '바뀐 행'으로 남게)
                        row.dataset.origTask = sent.task;
                        row.dataset.origStart = sent.start;
                        row.dataset.origEnd = sent.end;
                    } catch (err) {
                        console.error("일괄 저장 오류:", err);
                        fail++;
                        markRow(row, true);
                    }
                }

                if (fail === 0) {
                    showToast(`총 ${ok}건의 기록이 일괄 저장되었습니다.`);
                    renderHistoryRecordsTable(dateKey); // 재렌더링
                    const selectedDateKey = document.querySelector('.history-date-btn.is-on')?.dataset.key;
                    if (dateKey === selectedDateKey) renderHistoryDetail(dateKey);
                    // 저장 후 팝업은 닫지 않음
                } else {
                    // 실패한 행의 입력을 지우지 않도록 표를 다시 그리지 않는다
                    showToast(`${ok}건 저장, ${fail}건 실패`, true);
                }
            } finally {
                saveAllBtn.disabled = false;
                saveAllBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                    변경사항 일괄 저장
                `;
            }
        });
    }
}