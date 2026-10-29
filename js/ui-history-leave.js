// === js/ui-history-leave.js ===
import * as State from './state.js?v=202610291646';
import { showToast, isMemberActiveOn, friendlyFirebaseError } from './utils.js?v=202610291646';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ✅ 엑셀 변환 함수 불러오기
import { downloadLeaveLedgerExcel } from './history-excel.js?v=202610291646';
import { notifyLeaveScheduleChanged } from './leave-schedule-sync.js?v=202610291646';
import { updateLeaveSchedule } from './config.js?v=202610291646';

let currentYear = new Date().getFullYear();
let fullLeaveConfig = {}; 

// 정렬 상태 관리 (기본값을 입사일 'joinDate'로 설정)
let sortState = { key: 'joinDate', dir: 'asc' }; 

// 엑셀 다운로드를 위해 마지막에 렌더링된 연차 데이터 임시 저장용
let lastRenderedLeaveData = [];

// 연도·정렬 리스너를 붙였는지 — initLeaveManagement 는 탭에 들어올 때마다 불린다
let bound = false;

export async function initLeaveManagement() {
    const yearSelect = document.getElementById('leave-year-select');

    // 탭에 다시 들어왔는데 저장 안 한 총연차 수정이 있으면 그대로 둔다(다시 그리면 사라진다).
    if (bound && isLeaveDirty()) return;

    // 항상 현재 연도로 초기 세팅
    currentYear = new Date().getFullYear(); 
    
    if (yearSelect) {
        // 연도 목록: 2024 ~ 올해+1 (해가 바뀌어도 손으로 고칠 필요 없게)
        yearSelect.innerHTML = '';
        for (let y = 2024; y <= currentYear + 1; y++) {
            const o = document.createElement('option');
            o.value = String(y);
            o.textContent = `${y}년`;
            yearSelect.appendChild(o);
        }
        yearSelect.value = String(currentYear); // select box 현재 년도로 강제 고정
    }

    // 탭에 들어올 때마다 불리므로 리스너는 한 번만 붙인다(예전엔 쌓여서 한 번 바꿀 때 여러 번 그렸다).
    if (!bound) {
        bound = true;
        if (yearSelect) {
            yearSelect.addEventListener('change', (e) => {
                if (!confirmDiscardLeaveEdits()) {
                    e.target.value = String(currentYear);
                    return;
                }
                currentYear = parseInt(e.target.value);
                renderLeaveSheet();
            });
        }
        setupSortListeners();
    }
    
    const saveBtn = document.getElementById('save-leave-settings-btn');
    if (saveBtn) saveBtn.onclick = saveLeaveSettings;

    const refreshBtn = document.getElementById('refresh-leave-sheet-btn');
    if (refreshBtn) {
        refreshBtn.onclick = () => {
            if (!confirmDiscardLeaveEdits()) return;
            renderLeaveSheet();
        };
        
        // ✅ 엑셀 다운로드 버튼 동적 생성 및 추가 (기존에 없을 경우에만)
        if (!document.getElementById('download-leave-sheet-btn')) {
            const downloadBtn = document.createElement('button');
            downloadBtn.id = 'download-leave-sheet-btn';
            downloadBtn.className = 'px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded shadow-sm transition-colors flex items-center gap-2 ml-2';
            downloadBtn.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
                엑셀 받기
            `;
            
            // 새로고침 버튼 부모 요소에 나란히 추가
            refreshBtn.parentNode.appendChild(downloadBtn);

            // 다운로드 이벤트 연결
            downloadBtn.onclick = () => {
                if (lastRenderedLeaveData.length === 0) {
                    showToast("다운로드할 데이터가 없습니다.", true);
                    return;
                }
                downloadLeaveLedgerExcel(currentYear, lastRenderedLeaveData);
            };
        }
    }

    await renderLeaveSheet();
}

/** 저장된 총연차(saveLeaveSettings 와 같은 기준 — 설정 없으면 15). */
const savedTotalLeave = (member) => {
    const config = fullLeaveConfig[member] || {};
    return config.totalLeave !== undefined ? Number(config.totalLeave) : 15;
};

/** 총연차 칸에 저장하지 않은 수정이 있는지. 숫자로 읽을 수 없는 칸은 저장에서도 빠지므로 세지 않는다. */
export function isLeaveDirty() {
    const inputs = document.querySelectorAll('.total-leave-input');
    for (const input of inputs) {
        const member = input.dataset.member;
        const val = parseFloat(input.value);
        if (member && !isNaN(val) && val !== savedTotalLeave(member)) return true;
    }
    return false;
}

/** 표를 다시 그리기 전 확인 — 수정이 없으면 묻지 않고 true. */
const confirmDiscardLeaveEdits = () =>
    !isLeaveDirty() || confirm('저장하지 않은 총연차 수정이 사라집니다. 계속할까요?');

function setupSortListeners() {
    const headers = document.querySelectorAll('#history-leave-panel th[data-sort-key]');
    headers.forEach(th => {
        th.addEventListener('click', () => {
            if (!confirmDiscardLeaveEdits()) return;
            const key = th.dataset.sortKey;
            
            if (sortState.key === key) {
                sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
            } else {
                sortState.key = key;
                sortState.dir = 'asc';
            }
            
            updateSortIcons();
            renderLeaveSheet(); 
        });
    });
}

function updateSortIcons() {
    const headers = document.querySelectorAll('#history-leave-panel th[data-sort-key]');
    headers.forEach(th => {
        const icon = th.querySelector('.sort-icon');
        if (!icon) return;
        
        if (th.dataset.sortKey === sortState.key) {
            icon.textContent = sortState.dir === 'asc' ? '▲' : '▼';
            icon.classList.remove('text-gray-400');
            icon.classList.add('text-blue-600');
        } else {
            icon.textContent = '↕';
            icon.classList.add('text-gray-400');
            icon.classList.remove('text-blue-600');
        }
    });
}

export async function renderLeaveSheet() {
    const tbody = document.getElementById('leave-sheet-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-10 text-center"><div class="animate-spin inline-block w-6 h-6 border-2 border-blue-500 rounded-full border-t-transparent"></div> 데이터 복구 및 집계 중...</td></tr>';

    try {
        const members = await fetchAllMembers();
        await fetchLeaveSettings(); 
        const usageData = await fetchLeaveUsage(currentYear); 

        let rowData = members.map(member => {
            const config = fullLeaveConfig[member] || {};
            const total = config.totalLeave !== undefined ? Number(config.totalLeave) : 15;
            
            // 입사일 정보 추가 (없으면 맨 뒤로 밀리도록 처리)
            const joinDate = config.joinDate || '9999-12-31';

            const resetDate = config.leaveResetDate || '';
            const expireDate = config.expirationDate || '';
            let periodText = '-';
            let periodClass = 'text-gray-400';

            if (resetDate && expireDate) {
                periodText = `${resetDate} ~ ${expireDate}`;
                periodClass = 'text-gray-600 font-mono text-xs';
            }

            const used = usageData[member] ? usageData[member].count : 0;
            const remaining = total - used;
            const history = usageData[member] ? usageData[member].dates.join(', ') : '-';

            return { member, total, periodText, used, remaining, history, periodClass, config, joinDate };
        });

        // 정렬 적용 (입사일 등)
        if (sortState.key) {
            rowData.sort((a, b) => {
                let valA = a[sortState.key];
                let valB = b[sortState.key];

                if (sortState.key === 'joinDate') {
                    if (!valA) valA = '9999-12-31';
                    if (!valB) valB = '9999-12-31';
                }

                if (typeof valA === 'number' && typeof valB === 'number') {
                    return sortState.dir === 'asc' ? valA - valB : valB - valA;
                }
                
                valA = String(valA).toLowerCase();
                valB = String(valB).toLowerCase();
                if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
                if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
                return 0;
            });
        }

        // ✅ 엑셀 다운로드를 위해 정렬까지 완료된 최종 데이터 저장
        lastRenderedLeaveData = rowData;

        tbody.innerHTML = '';
        
        if (rowData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">등록된 직원이 없습니다.</td></tr>';
            return;
        }

        rowData.forEach(row => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 transition-colors";
            
            let remainColor = 'text-gray-700';
            if (row.remaining < 0) remainColor = 'text-red-600 font-bold';
            else if (row.remaining <= 3) remainColor = 'text-orange-500 font-bold';
            else remainColor = 'text-green-600 font-bold';

            tr.innerHTML = `
                <td class="px-6 py-3 font-medium text-gray-900 border-b border-gray-100">${row.member}</td>
                <td class="px-6 py-3 text-center border-b border-gray-100">
                    <input type="number" class="w-20 text-center border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 outline-none total-leave-input font-bold text-blue-600" 
                           data-member="${row.member}" value="${row.total}" min="0" step="0.5">
                </td>
                <td class="px-6 py-3 text-center border-b border-gray-100 ${row.periodClass}">
                    ${row.periodText}
                </td>
                <td class="px-6 py-3 text-center font-medium border-b border-gray-100">${row.used}</td>
                <td class="px-6 py-3 text-center ${remainColor} border-b border-gray-100">${row.remaining}</td>
                <td class="px-6 py-3 text-xs text-gray-500 border-b border-gray-100">
                    <div class="flex justify-between items-center w-full min-h-[2rem]">
                        <span class="break-words max-w-[85%] leading-relaxed">${row.history}</span>
                        <button class="px-2 py-1.5 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold rounded border border-gray-300 manage-leave-btn flex-shrink-0 shadow-sm transition-colors" data-member="${row.member}">관리</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // 관리 버튼 이벤트 바인딩
        tbody.querySelectorAll('.manage-leave-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const member = e.currentTarget.dataset.member;
                openLeaveManager(member);
            });
        });

    } catch (e) {
        console.error("Error rendering leave sheet:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-red-500">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>';
    }
}

async function openLeaveManager(member) {
    let allLeaves = [];
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
    
    try {
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data().onLeaveMembers) {
            allLeaves = snap.data().onLeaveMembers;
        }
    } catch(e) {
        console.error("연차 데이터 로드 오류", e);
        showToast('데이터를 불러오지 못했습니다.', true);
        return;
    }

    // 대상자의 연차 내역만 필터링 및 고유 ID 부여
    let memberLeaves = allLeaves.filter(l => l.member === member && (l.type?.includes('연차') || l.type?.includes('반차')));
    memberLeaves.forEach(l => {
        if (!l.id) l.id = `leave-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    });
    
    // 최신순 정렬
    memberLeaves.sort((a,b) => {
        const dA = a.startDate || a.date || (a.startTime ? a.startTime.substring(0,10) : '');
        const dB = b.startDate || b.date || (b.startTime ? b.startTime.substring(0,10) : '');
        return dB.localeCompare(dA); 
    });

    const modalId = 'leave-manager-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    const modalHtml = `
    <div id="${modalId}" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
            <div class="px-5 py-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
                <h3 class="text-lg font-bold text-gray-900">${member} 님의 연차 관리</h3>
                <button id="lm-close-btn" class="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>
            
            <div class="p-5 overflow-y-auto flex-1 bg-white">
                <div class="bg-gray-50 p-4 rounded-lg mb-6 border border-gray-200">
                    <h4 class="font-bold mb-3 text-sm text-gray-800" id="lm-form-title">신규 등록</h4>
                    <input type="hidden" id="lm-edit-id" value="">
                    <div class="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <label class="block text-xs font-medium text-gray-600 mb-1">유형</label>
                            <select id="lm-type" class="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="연차">연차 (종일)</option>
                                <option value="오전반차">오전 반차</option>
                                <option value="오후반차">오후 반차</option>
                            </select>
                        </div>
                        <div id="lm-end-date-wrapper">
                            <label class="block text-xs font-medium text-gray-600 mb-1">종료일 (연속 시)</label>
                            <input type="date" id="lm-end-date" class="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    <div class="mb-4">
                        <label class="block text-xs font-medium text-gray-600 mb-1">시작일 (또는 해당일)</label>
                        <input type="date" id="lm-start-date" class="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div class="flex justify-end gap-2">
                        <button id="lm-cancel-edit-btn" class="hidden px-3 py-1.5 text-sm font-medium text-gray-700 bg-white rounded hover:bg-gray-100 border border-gray-300 shadow-sm">취소</button>
                        <button id="lm-save-btn" class="px-4 py-1.5 text-sm font-bold text-white bg-blue-600 rounded hover:bg-blue-700 shadow-sm">등록</button>
                    </div>
                </div>

                <h4 class="font-bold mb-2 text-sm text-gray-800 px-1">사용 내역</h4>
                <div id="lm-list-container" class="space-y-2"></div>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modalEl = document.getElementById(modalId);
    
    // 모달 닫기
    document.getElementById('lm-close-btn').onclick = () => modalEl.remove();

    // 유형 변경 시 반차면 종료일 숨김 처리
    document.getElementById('lm-type').onchange = (e) => {
        document.getElementById('lm-end-date-wrapper').style.display = e.target.value.includes('반차') ? 'none' : 'block';
    };

    // 목록·삭제 확인창에 쓰는 날짜 표기 ('시작 ~ 종료')
    const leaveDateLabel = (l) => {
        const targetDate = l.startDate || l.date || (l.startTime ? l.startTime.substring(0, 10) : '');
        let label = targetDate;
        if (l.type === '연차' && l.endDate && l.endDate !== targetDate) {
            label += ` ~ ${l.endDate}`;
        }
        return label;
    };

    // 저장 중에는 등록·수정·삭제 버튼을 잠근다(두 번 눌러 같은 연차가 두 줄 생기지 않게)
    let saving = false;
    const setSaving = (on) => {
        saving = on;
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.querySelectorAll('#lm-save-btn, #lm-cancel-edit-btn, #lm-list-container button').forEach(b => {
            b.disabled = on;
            b.classList.toggle('opacity-60', on);
        });
        const saveBtn = document.getElementById('lm-save-btn');
        if (saveBtn) {
            if (on) { saveBtn.dataset.label = saveBtn.textContent; saveBtn.textContent = '저장 중…'; }
            else if (saveBtn.dataset.label) { saveBtn.textContent = saveBtn.dataset.label; delete saveBtn.dataset.label; }
        }
    };

    // 내역 리스트 렌더링 함수
    const renderList = () => {
        const container = document.getElementById('lm-list-container');
        if (!container) return;   // 저장 중에 창을 닫은 경우
        container.innerHTML = '';
        if(memberLeaves.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500 text-center py-6 border border-gray-200 border-dashed rounded bg-gray-50">등록된 내역이 없습니다.</p>';
            return;
        }
        memberLeaves.forEach(l => {
            const label = leaveDateLabel(l);

            const div = document.createElement('div');
            div.className = "flex justify-between items-center p-3 bg-white border border-gray-200 rounded text-sm shadow-sm";
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <span class="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-bold">${l.type}</span>
                    <span class="text-gray-700 font-medium">${label}</span>
                </div>
                <div class="flex gap-2">
                    <button class="text-gray-500 hover:text-blue-600 font-medium px-2 py-1 bg-gray-50 rounded border border-gray-200" data-action="edit" data-id="${l.id}">수정</button>
                    <button class="text-red-500 hover:text-red-700 font-medium px-2 py-1 bg-red-50 rounded border border-red-100" data-action="delete" data-id="${l.id}">삭제</button>
                </div>
            `;
            container.appendChild(div);
        });
    };

    renderList();

    // 이벤트 위임으로 수정/삭제 처리
    document.getElementById('lm-list-container').addEventListener('click', (e) => {
        const btn = e.target;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if(!action || !id || saving) return;

        if(action === 'edit') {
            const l = memberLeaves.find(x => x.id === id);
            if(l) {
                document.getElementById('lm-edit-id').value = l.id;
                document.getElementById('lm-type').value = l.type || '연차';
                document.getElementById('lm-start-date').value = l.startDate || l.date || (l.startTime ? l.startTime.substring(0, 10) : '');
                document.getElementById('lm-end-date').value = l.endDate || '';
                
                document.getElementById('lm-form-title').textContent = '내역 수정';
                document.getElementById('lm-save-btn').textContent = '수정 완료';
                document.getElementById('lm-cancel-edit-btn').classList.remove('hidden');
                document.getElementById('lm-type').dispatchEvent(new Event('change'));
            }
        } else if(action === 'delete') {
            const l = memberLeaves.find(x => x.id === id);
            if(!l) return;
            if(confirm(`이 연차 내역을 삭제할까요?\n\n${member} · ${l.type} · ${leaveDateLabel(l)}`)) {
                // 화면 목록은 저장이 성공한 뒤에 바꾼다(실패하면 화면과 서버가 달라지지 않게)
                saveChanges(memberLeaves.filter(x => x.id !== id));
            }
        }
    });

    // 수정 폼 취소 버튼
    document.getElementById('lm-cancel-edit-btn').onclick = () => {
        document.getElementById('lm-edit-id').value = '';
        document.getElementById('lm-type').value = '연차';
        document.getElementById('lm-start-date').value = '';
        document.getElementById('lm-end-date').value = '';
        document.getElementById('lm-form-title').textContent = '신규 등록';
        document.getElementById('lm-save-btn').textContent = '등록';
        document.getElementById('lm-cancel-edit-btn').classList.add('hidden');
        document.getElementById('lm-type').dispatchEvent(new Event('change'));
    };

    // 저장(등록/수정) 로직
    document.getElementById('lm-save-btn').onclick = () => {
        if (saving) return;
        const id = document.getElementById('lm-edit-id').value;
        const type = document.getElementById('lm-type').value;
        const startDate = document.getElementById('lm-start-date').value;
        const endDate = document.getElementById('lm-end-date').value;

        if(!startDate) { alert('시작일을 선택하세요.'); return; }
        if(!type.includes('반차') && endDate && endDate < startDate) {
            alert('종료일이 시작일보다 앞입니다. 날짜를 확인하세요.');
            return;
        }

        const record = {
            id: id || `leave-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            member: member,
            type: type,
            startDate: startDate,
            date: startDate,
            endDate: type.includes('반차') ? startDate : (endDate || startDate)
        };

        // 사본에 반영해 저장하고, 성공한 뒤에만 화면 목록(memberLeaves)을 바꾼다
        let next;
        if(id) {
            next = memberLeaves.map(x => x.id === id ? record : x);
        } else {
            next = [record, ...memberLeaves]; // 새 등록은 리스트 맨 앞에 추가
        }

        saveChanges(next);
    };

    // Firestore에 최종 적용하는 함수 — nextLeaves: 저장할 이 사람의 연차/반차 목록(사본)
    const saveChanges = async (nextLeaves) => {
        if (saving) return;
        setSaving(true);
        try {
            // 서버 목록(트랜잭션)에서 이 사람의 연차/반차 내역을 모두 지운 뒤 수정된 리스트를 다시 밀어넣는다.
            //   다른 사람·다른 종류 근태는 서버에 있는 그대로 남는다(동시 저장에도 사라지지 않게).
            const r = await updateLeaveSchedule(State.db, list => [
                ...list.filter(l => !(l.member === member && (l.type?.includes('연차') || l.type?.includes('반차')))),
                ...nextLeaves
            ]);
            const currentAll = r.list;
            memberLeaves = nextLeaves;   // 저장 성공 — 이제 화면에 반영한다

            if(State.persistentLeaveSchedule) {
                State.persistentLeaveSchedule.onLeaveMembers = currentAll;
            }
            notifyLeaveScheduleChanged('leave-history-edit');

            showToast('연차 정보가 저장되었습니다.');
            
            // 데이터 재정렬 후 렌더링
            memberLeaves.sort((a,b) => {
                const dA = a.startDate || a.date || (a.startTime ? a.startTime.substring(0,10) : '');
                const dB = b.startDate || b.date || (b.startTime ? b.startTime.substring(0,10) : '');
                return dB.localeCompare(dA); 
            });
            renderList();
            setSaving(false);   // 잠금을 먼저 푼다 — 잠긴 [취소] 버튼은 click() 이 먹지 않는다

            document.getElementById('lm-cancel-edit-btn')?.click(); // 폼 초기화
            renderLeaveSheetKeepingEdits(); // 대장화면 새로고침(저장 안 한 총연차 입력은 살린다)
        } catch(e) {
            console.error(e);
            setSaving(false);   // 입력칸은 그대로 둔다 — 고쳐서 다시 누르면 된다
            alert('저장하지 못했습니다 — ' + friendlyFirebaseError(e) + '.');
        }
    };
}

async function fetchAllMembers() {
    const memberSet = new Set();
    
    if (State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(group => {
            if (group.members && Array.isArray(group.members)) {
                // 🚪 퇴사자(오늘 기준 비활성)는 연차 배정 명단에서 제외 (과거 연차 이력은 별도 보존)
                group.members.forEach(m => { if (isMemberActiveOn(m, null, State.appConfig)) memberSet.add(m); });
            }
        });
    }

    if (State.appState.partTimers) {
        State.appState.partTimers.forEach(p => memberSet.add(p.name));
    }

    return Array.from(memberSet); 
}

async function fetchLeaveSettings() {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
        const snap = await getDoc(docRef);
        
        fullLeaveConfig = {}; 

        if (snap.exists()) {
            const data = snap.data();
            if (data.memberLeaveSettings) {
                 fullLeaveConfig = data.memberLeaveSettings;
            }
        }
    } catch (e) {
        console.error("Leave settings fetch error:", e);
        fullLeaveConfig = {};
    }
}

/**
 * 연차 사용 내역 집계 로직
 */
async function fetchLeaveUsage(year) {
    let allLeavesMap = new Map();
    
    const generateKey = (l) => {
        const targetDate = l.startDate || l.date || (l.startTime ? l.startTime.substring(0, 10) : 'nodate');
        return l.id ? l.id : `${l.member}_${l.type}_${targetDate}_${l.endDate||''}`;
    };

    // 1. 중앙 DB에서 불러오기
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data().onLeaveMembers) {
            snap.data().onLeaveMembers.forEach(l => {
                allLeavesMap.set(generateKey(l), l); 
            });
        }
    } catch (e) {
        console.error("Leave schedule fetch error", e);
    }

    // 2. 과거 일일 업무 기록에서 긁어오기
    if (State.allHistoryData && Array.isArray(State.allHistoryData)) {
        State.allHistoryData.forEach(day => {
            if (day.onLeaveMembers && Array.isArray(day.onLeaveMembers)) {
                day.onLeaveMembers.forEach(l => {
                    allLeavesMap.set(generateKey(l), l);
                });
            }
        });
    }

    // 3. 현재 메모리 반영
    if (State.persistentLeaveSchedule && Array.isArray(State.persistentLeaveSchedule.onLeaveMembers)) {
        State.persistentLeaveSchedule.onLeaveMembers.forEach(l => {
            allLeavesMap.set(generateKey(l), l);
        });
    }

    const allLeaves = Array.from(allLeavesMap.values());
    const usage = {}; 

    allLeaves.forEach(record => {
        if (record.type && (record.type.includes('연차') || record.type.includes('반차'))) {
            const name = record.member;
            
            const memberConfig = fullLeaveConfig[name] || {};
            const resetDate = memberConfig.leaveResetDate || '';
            const expireDate = memberConfig.expirationDate || '';

            let isMatch = false;

            const recordDate = record.startDate || record.date || (record.startTime ? record.startTime.substring(0, 10) : '');

            if (recordDate && recordDate.startsWith(String(year))) {
                isMatch = true;
            }
            
            if (!isMatch && resetDate && expireDate) {
                if (recordDate >= resetDate && recordDate <= expireDate) {
                    if (resetDate.startsWith(String(year)) || expireDate.startsWith(String(year))) {
                        isMatch = true;
                    }
                }
            }

            // ★ 연차 사용기한(적용 시작일) 이전 내역은 정리 대상 — 같은 연도라도 집계에서 제외
            if (isMatch && resetDate && recordDate && recordDate < resetDate) {
                isMatch = false;
            }

            if (!isMatch) return;

            if (!usage[name]) usage[name] = { count: 0, dates: [] };

            let days = 0;
            let label = "";

            const displayDate = recordDate.substring(2).replace(/-/g, '.');
            const displayEndDate = record.endDate ? record.endDate.substring(2).replace(/-/g, '.') : '';

            if (record.type.includes('반차')) {
                days = 0.5;
                label = `${displayDate}(반)`;
            } else {
                if (record.endDate && record.endDate !== recordDate) {
                    const start = new Date(recordDate); 
                    const end = new Date(record.endDate);
                    
                    let diffDays = 0;
                    for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
                        const dayOfWeek = dt.getDay();
                        if (dayOfWeek !== 0 && dayOfWeek !== 6) { 
                            diffDays++; 
                        }
                    }
                    if (diffDays === 0) diffDays = 1; 
                    
                    days = diffDays;
                    label = `${displayDate}~${displayEndDate}`; 
                } else {
                    days = 1; 
                    label = displayDate; 
                }
            }

            usage[name].count += days;
            usage[name].dates.push({ fullDate: recordDate, label: label });
        }
    });

    Object.keys(usage).forEach(key => {
        usage[key].dates.sort((a, b) => a.fullDate.localeCompare(b.fullDate));
        usage[key].dates = usage[key].dates.map(item => item.label);
    });

    return usage;
}

/** 표를 다시 그리되, 저장하지 않은 총연차 입력은 다시 그린 칸에 되살린다(연차 '관리' 창 저장 뒤 등). */
async function renderLeaveSheetKeepingEdits() {
    const pending = {};
    document.querySelectorAll('.total-leave-input').forEach(input => {
        const member = input.dataset.member;
        const val = parseFloat(input.value);
        if (member && !isNaN(val) && val !== savedTotalLeave(member)) pending[member] = input.value;
    });
    await renderLeaveSheet();
    document.querySelectorAll('.total-leave-input').forEach(input => {
        const member = input.dataset.member;
        if (member && Object.prototype.hasOwnProperty.call(pending, member)) input.value = pending[member];
    });
}

async function saveLeaveSettings() {
    const inputs = document.querySelectorAll('.total-leave-input');

    // 바뀐 사람 — 화면을 열 때 읽은 값과 다른 칸만(isLeaveDirty 와 같은 기준: 설정 없으면 15).
    // 설정이 없는 사람(화면 15)을 저장할 때마다 15 로 써 넣지 않게 한다.
    const desired = {};
    inputs.forEach(input => {
        const member = input.dataset.member;
        const val = parseFloat(input.value);
        if (member && !isNaN(val) && val !== savedTotalLeave(member)) desired[member] = val;
    });

    const btn = document.getElementById('save-leave-settings-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '저장 중...';

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');

        // 저장 직전 서버 설정을 다시 읽어, 바뀐 사람의 totalLeave 만 보낸다(서버가 이미 같은 값이면 뺀다).
        // 예전엔 화면을 열 때 받은 설정 전체를 다시 써서, 그 사이 다른 곳에서 바꾼 입사일·기간 등이 옛 값으로 돌아갔다.
        // (merge 쓰기는 중첩 필드도 합치므로 { 사람: { totalLeave } } 만 보내면 나머지 필드는 그대로다)
        const snap = await getDoc(docRef);
        const server = (snap.exists() && snap.data().memberLeaveSettings) || {};
        const changed = {};
        Object.entries(desired).forEach(([member, val]) => {
            if ((server[member] || {}).totalLeave !== val) changed[member] = { totalLeave: val };
        });

        if (Object.keys(changed).length === 0) {
            fullLeaveConfig = server;
            showToast("변경 사항이 없습니다.");
            await renderLeaveSheet();   // 서버 값으로 다시 그려 미저장 표시(isLeaveDirty)를 푼다
            return;
        }

        await setDoc(docRef, {
            memberLeaveSettings: changed
        }, { merge: true });

        const merged = { ...server };
        Object.entries(changed).forEach(([member, v]) => { merged[member] = { ...(server[member] || {}), ...v }; });
        fullLeaveConfig = merged;
        showToast("총 연차 설정이 저장되었습니다.");
        
        await renderLeaveSheet(); 
    } catch (e) {
        console.error("Save settings error:", e);
        showToast("설정 저장 실패 — " + friendlyFirebaseError(e), true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}