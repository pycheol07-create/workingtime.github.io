// === js/ui-history-leave.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { 
    doc, getDoc, updateDoc, setDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentYear = new Date().getFullYear();
let fullLeaveConfig = {}; 

// 정렬 상태 관리 (key: 정렬할 필드명, dir: 'asc' | 'desc')
let sortState = { key: null, dir: 'asc' }; 

export async function initLeaveManagement() {
    const yearSelect = document.getElementById('leave-year-select');
    
    if (yearSelect) {
        if (!yearSelect.value) yearSelect.value = currentYear;
        currentYear = parseInt(yearSelect.value);
        
        yearSelect.addEventListener('change', (e) => {
            currentYear = parseInt(e.target.value);
            renderLeaveSheet();
        });
    }
    
    const saveBtn = document.getElementById('save-leave-settings-btn');
    if (saveBtn) saveBtn.onclick = saveLeaveSettings;

    const refreshBtn = document.getElementById('refresh-leave-sheet-btn');
    if (refreshBtn) refreshBtn.onclick = renderLeaveSheet;

    setupSortListeners();
    await renderLeaveSheet();
}

function setupSortListeners() {
    const headers = document.querySelectorAll('#history-leave-panel th[data-sort-key]');
    headers.forEach(th => {
        th.addEventListener('click', () => {
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

    tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-10 text-center"><div class="animate-spin inline-block w-6 h-6 border-2 border-blue-500 rounded-full border-t-transparent"></div> 데이터 로딩 중...</td></tr>';

    try {
        const members = await fetchAllMembers();
        await fetchLeaveSettings(); // 설정 데이터 불러오기 (복구)
        const usageData = await fetchLeaveUsage(currentYear); // 사용 내역 불러오기

        let rowData = members.map(member => {
            const config = fullLeaveConfig[member] || {};
            // 기존에 설정된 totalLeave가 있으면 가져오고 없으면 기본 15
            const total = config.totalLeave !== undefined ? Number(config.totalLeave) : 15;
            
            const resetDate = config.leaveResetDate || '';
            const expireDate = config.expirationDate || '';
            let periodText = '-';
            let periodClass = 'text-gray-400';

            // DB에 명시된 기간이 있다면 그대로 표시
            if (resetDate && expireDate) {
                periodText = `${resetDate} ~ ${expireDate}`;
                periodClass = 'text-gray-600 font-mono text-xs';
            }

            const used = usageData[member] ? usageData[member].count : 0;
            const remaining = total - used;
            const history = usageData[member] ? usageData[member].dates.join(', ') : '-';

            return { member, total, periodText, used, remaining, history, periodClass, config };
        });

        // 정렬 적용
        if (sortState.key) {
            rowData.sort((a, b) => {
                let valA = a[sortState.key];
                let valB = b[sortState.key];

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
                <td class="px-6 py-3 text-xs text-gray-500 break-words max-w-md leading-relaxed border-b border-gray-100">
                    ${row.history}
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        console.error("Error rendering leave sheet:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-red-500">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>';
    }
}

async function fetchAllMembers() {
    const memberSet = new Set();
    
    if (State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(group => {
            if (group.members && Array.isArray(group.members)) {
                group.members.forEach(m => memberSet.add(m));
            }
        });
    }

    if (State.appState.partTimers) {
        State.appState.partTimers.forEach(p => memberSet.add(p.name));
    }

    return Array.from(memberSet); 
}

// 🌟 [핵심 복구 포인트] DB에서 연차 설정(memberLeaveSettings)을 확실하게 불러오도록 수정
async function fetchLeaveSettings() {
    try {
        // 기존 시스템에서 관리자 설정이 저장되던 정확한 경로
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
        const snap = await getDoc(docRef);
        
        fullLeaveConfig = {}; 

        if (snap.exists()) {
            const data = snap.data();
            if (data.memberLeaveSettings) {
                 fullLeaveConfig = data.memberLeaveSettings;
            } else {
                 console.warn("mainConfig 문서 내에 memberLeaveSettings 필드가 없습니다.");
            }
        } else {
             console.warn("mainConfig 문서가 DB에 존재하지 않습니다.");
        }
    } catch (e) {
        console.error("Leave settings fetch error:", e);
        fullLeaveConfig = {};
    }
}

async function fetchLeaveUsage(year) {
    let allLeaves = [];
    
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data().onLeaveMembers) {
            allLeaves = snap.data().onLeaveMembers;
        }
    } catch (e) {
        console.error("Leave schedule fetch error", e);
    }

    const usage = {}; 

    allLeaves.forEach(record => {
        if (record.type && (record.type.includes('연차') || record.type.includes('반차'))) {
            const name = record.member;
            
            const memberConfig = fullLeaveConfig[name] || {};
            const resetDate = memberConfig.leaveResetDate;
            const expireDate = memberConfig.expirationDate;

            let isMatch = false;

            // 명시적 기간이 있다면 해당 기간 내의 데이터만 집계
            if (resetDate && expireDate) {
                if (record.startDate >= resetDate && record.startDate <= expireDate) {
                    isMatch = true;
                }
            } else {
                // 명시적 기간이 없으면 현재 선택된 탭(year)에 해당하는 데이터 집계
                if (record.startDate && record.startDate.startsWith(String(year))) {
                    isMatch = true;
                }
            }

            if (!isMatch) return; 

            if (!usage[name]) usage[name] = { count: 0, dates: [] };

            let days = 0;
            let label = "";

            if (record.type.includes('반차')) {
                days = 0.5;
                label = `${record.startDate.substring(5)} (반)`;
            } else {
                if (record.endDate && record.endDate !== record.startDate) {
                    const start = new Date(record.startDate);
                    const end = new Date(record.endDate);
                    const diffTime = Math.abs(end - start);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                    
                    days = diffDays;
                    label = `${record.startDate.substring(5)}~${record.endDate.substring(5)}`;
                } else {
                    days = 1;
                    label = record.startDate.substring(5);
                }
            }

            usage[name].count += days;
            usage[name].dates.push(label);
        }
    });

    Object.keys(usage).forEach(key => {
        usage[key].dates.sort();
    });

    return usage;
}

// 🌟 수정한 설정이 날아가지 않도록 안전한 저장 로직 강화
async function saveLeaveSettings() {
    const inputs = document.querySelectorAll('.total-leave-input');
    let hasChange = false;
    
    // 깊은 복사로 기존 설정 보호
    const updates = JSON.parse(JSON.stringify(fullLeaveConfig));

    inputs.forEach(input => {
        const member = input.dataset.member;
        const val = parseFloat(input.value);
        if (member && !isNaN(val)) {
            if (!updates[member]) updates[member] = {};
            
            if (updates[member].totalLeave !== val) {
                updates[member].totalLeave = val;
                hasChange = true;
            }
        }
    });

    if (!hasChange) {
        showToast("변경 사항이 없습니다.");
        return;
    }

    const btn = document.getElementById('save-leave-settings-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '저장 중...';

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
        
        // setDoc({merge:true})를 사용하여 문서가 없으면 생성하고, 있으면 특정 필드만 병합
        await setDoc(docRef, {
            memberLeaveSettings: updates
        }, { merge: true });
        
        fullLeaveConfig = updates;
        showToast("총 연차 설정이 저장되었습니다.");
        
        await renderLeaveSheet(); 
    } catch (e) {
        console.error("Save settings error:", e);
        showToast("설정 저장 실패: " + e.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}