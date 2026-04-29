// === js/ui-history-leave.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { 
    doc, getDoc, setDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { saveLeaveSchedule } from './config.js'; // 연차 저장 함수 임포트

let currentYear = new Date().getFullYear();
let fullLeaveConfig = {}; 

// 정렬 상태 관리 (key: 정렬할 필드명, dir: 'asc' | 'desc')
let sortState = { key: null, dir: 'asc' }; 

/**
 * 연차 관리 초기화
 */
export async function initLeaveManagement() {
    const yearSelect = document.getElementById('leave-year-select');
    
    if (yearSelect) {
        // [수정] 기준 연도가 25년으로 고정되는 현상 해결: 시스템의 현재 연도를 기본값으로 강제 설정
        const systemYear = new Date().getFullYear();
        if (!yearSelect.value || yearSelect.value == "2025") {
            yearSelect.value = systemYear;
        }
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
    setupTableActionListeners(); // [신규] 테이블 내 수정/삭제 액션 리스너 등록
    await renderLeaveSheet();
}

/**
 * [신규] 테이블 내 직접 관리(등록/삭제)를 위한 이벤트 위임
 */
function setupTableActionListeners() {
    const tbody = document.getElementById('leave-sheet-body');
    if (!tbody) return;

    tbody.addEventListener('click', async (e) => {
        // 1. 직접 등록 (추가 버튼 클릭)
        const addBtn = e.target.closest('.btn-row-add-leave');
        if (addBtn) {
            const memberName = addBtn.dataset.member;
            openDirectLeaveModal(memberName);
            return;
        }

        // 2. 직접 삭제 (날짜 배지 클릭)
        const deleteBadge = e.target.closest('.leave-history-badge');
        if (deleteBadge) {
            const leaveId = deleteBadge.dataset.id;
            const dateText = deleteBadge.textContent.trim();
            if (confirm(`[${dateText}] 연차 기록을 정말 삭제하시겠습니까?`)) {
                await deleteLeaveRecordDirectly(leaveId);
            }
        }
    });
}

/**
 * 연차 기록 직접 삭제 로직
 */
async function deleteLeaveRecordDirectly(id) {
    try {
        // 1. 상태 데이터에서 제거
        State.persistentLeaveSchedule.onLeaveMembers = State.persistentLeaveSchedule.onLeaveMembers.filter(l => l.id !== id);
        
        // 2. DB 저장
        await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
        
        // 3. 로컬 히스토리 캐시 동기화
        State.allHistoryData.forEach(day => {
            if (day.onLeaveMembers) {
                day.onLeaveMembers = day.onLeaveMembers.filter(l => l.id !== id);
            }
        });

        showToast('연차 기록이 삭제되었습니다.');
        renderLeaveSheet(); // 즉시 재렌더링
    } catch (err) {
        console.error("삭제 실패:", err);
        showToast('삭제 중 오류가 발생했습니다.', true);
    }
}

/**
 * 해당 직원의 연차 등록 모달 즉시 열기
 */
function openDirectLeaveModal(memberName) {
    State.context.memberToSetLeave = memberName;
    
    // 근태 설정 모달 열기
    const leaveModal = document.getElementById('leave-type-modal');
    if (leaveModal) {
        leaveModal.classList.remove('hidden');
        // '연차 설정' 탭 강제 클릭
        const tabBtn = document.getElementById('tab-leave-setting');
        if (tabBtn) tabBtn.click();
        
        // 연차 라디오 버튼 자동 선택
        const annualRadio = document.querySelector('input[name="leave-type"][value="연차"]');
        if (annualRadio) {
            annualRadio.checked = true;
            annualRadio.dispatchEvent(new Event('change'));
        }
        
        showToast(`${memberName}님의 연차 등록 모달을 열었습니다.`);
    }
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

    tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-10 text-center"><div class="animate-spin inline-block w-6 h-6 border-2 border-blue-500 rounded-full border-t-transparent"></div> 데이터 복구 및 집계 중...</td></tr>';

    try {
        const members = await fetchAllMembers();
        await fetchLeaveSettings(); 
        const usageData = await fetchLeaveUsage(currentYear); 

        let rowData = members.map(member => {
            const config = fullLeaveConfig[member] || {};
            const total = config.totalLeave !== undefined ? Number(config.totalLeave) : 15;
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
            const historyItems = usageData[member] ? usageData[member].items : [];

            return { member, total, periodText, used, remaining, historyItems, periodClass, config };
        });

        // 정렬 로직 (동일)
        if (sortState.key) {
            rowData.sort((a, b) => {
                let valA = a[sortState.key];
                let valB = b[sortState.key];
                if (typeof valA === 'number' && typeof valB === 'number') return sortState.dir === 'asc' ? valA - valB : valB - valA;
                valA = String(valA).toLowerCase();
                valB = String(valB).toLowerCase();
                return sortState.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            });
        }

        tbody.innerHTML = '';
        if (rowData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-gray-500">등록된 직원이 없습니다.</td></tr>';
            return;
        }

        rowData.forEach(row => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 transition-colors";
            
            let remainColor = row.remaining < 0 ? 'text-red-600 font-bold' : (row.remaining <= 3 ? 'text-orange-500 font-bold' : 'text-green-600 font-bold');

            // [수정] 사용 내역을 클릭 가능한 배지 형태로 생성
            const historyHtml = row.historyItems.length > 0 
                ? row.historyItems.map(item => `<span class="leave-history-badge inline-block bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100 mr-1 mb-1 cursor-pointer hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-all text-[11px]" title="클릭 시 삭제" data-id="${item.id}">${item.label}</span>`).join('')
                : '<span class="text-gray-300">-</span>';

            tr.innerHTML = `
                <td class="px-6 py-3 font-medium text-gray-900 border-b border-gray-100">${row.member}</td>
                <td class="px-6 py-3 text-center border-b border-gray-100">
                    <input type="number" class="w-16 text-center border border-gray-300 rounded px-1 py-1 focus:ring-2 focus:ring-blue-500 outline-none total-leave-input font-bold text-blue-600 text-sm" 
                           data-member="${row.member}" value="${row.total}" min="0" step="0.5">
                </td>
                <td class="px-6 py-3 text-center border-b border-gray-100 ${row.periodClass}">${row.periodText}</td>
                <td class="px-6 py-3 text-center font-medium border-b border-gray-100">${row.used}</td>
                <td class="px-6 py-3 text-center ${remainColor} border-b border-gray-100">${row.remaining}</td>
                <td class="px-6 py-3 border-b border-gray-100 max-w-xs">${historyHtml}</td>
                <td class="px-6 py-3 text-center border-b border-gray-100">
                    <button class="btn-row-add-leave bg-indigo-500 hover:bg-indigo-600 text-white px-2 py-1 rounded text-[11px] font-bold shadow-sm" data-member="${row.member}">추가</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("렌더링 오류:", e);
        tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-red-500">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>';
    }
}

async function fetchAllMembers() {
    const memberSet = new Set();
    if (State.appConfig.teamGroups) State.appConfig.teamGroups.forEach(group => group.members?.forEach(m => memberSet.add(m)));
    if (State.appState.partTimers) State.appState.partTimers.forEach(p => memberSet.add(p.name));
    return Array.from(memberSet); 
}

async function fetchLeaveSettings() {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
        const snap = await getDoc(docRef);
        fullLeaveConfig = snap.exists() ? (snap.data().memberLeaveSettings || {}) : {};
    } catch (e) { fullLeaveConfig = {}; }
}

/**
 * [수정] 사용 내역을 ID와 함께 가져와 클릭 삭제가 가능하도록 함
 */
async function fetchLeaveUsage(year) {
    let allLeavesMap = new Map();
    const generateKey = (l) => l.id || `${l.member}_${l.type}_${l.startDate}_${l.endDate||''}`;

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
        const snap = await getDoc(docRef);
        snap.exists() && snap.data().onLeaveMembers?.forEach(l => allLeavesMap.set(generateKey(l), l));
    } catch (e) {}

    if (State.allHistoryData) State.allHistoryData.forEach(day => day.onLeaveMembers?.forEach(l => allLeavesMap.set(generateKey(l), l)));
    if (State.persistentLeaveSchedule?.onLeaveMembers) State.persistentLeaveSchedule.onLeaveMembers.forEach(l => allLeavesMap.set(generateKey(l), l));

    const usage = {}; 
    allLeavesMap.forEach(record => {
        if (!record.type || (!record.type.includes('연차') && !record.type.includes('반차'))) return;
        
        const name = record.member;
        const config = fullLeaveConfig[name] || {};
        const resetDate = config.leaveResetDate || '';
        const expireDate = config.expirationDate || '';

        // 필터링: 연도 일치 또는 설정 기간 내 포함
        let isMatch = record.startDate?.startsWith(String(year)) || 
                     (resetDate && expireDate && record.startDate >= resetDate && record.startDate <= expireDate && (resetDate.startsWith(String(year)) || expireDate.startsWith(String(year))));

        if (!isMatch) return; 
        if (!usage[name]) usage[name] = { count: 0, items: [] };

        let days = 0, label = "";
        if (record.type.includes('반차')) {
            days = 0.5;
            label = `${record.startDate.substring(5)} (반)`;
        } else {
            const start = new Date(record.startDate), end = new Date(record.endDate || record.startDate);
            let diffDays = 0;
            for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
                if (dt.getDay() !== 0 && dt.getDay() !== 6) diffDays++;
            }
            days = diffDays || 1;
            label = record.endDate && record.endDate !== record.startDate ? `${record.startDate.substring(5)}~${record.endDate.substring(5)}` : record.startDate.substring(5);
        }
        usage[name].count += days;
        usage[name].items.push({ label, id: record.id });
    });

    Object.keys(usage).forEach(key => usage[key].items.sort((a,b) => a.label.localeCompare(b.label)));
    return usage;
}

async function saveLeaveSettings() {
    const inputs = document.querySelectorAll('.total-leave-input');
    const updates = JSON.parse(JSON.stringify(fullLeaveConfig));
    let hasChange = false;

    inputs.forEach(input => {
        const member = input.dataset.member, val = parseFloat(input.value);
        if (member && !isNaN(val) && (updates[member]?.totalLeave !== val)) {
            if (!updates[member]) updates[member] = {};
            updates[member].totalLeave = val;
            hasChange = true;
        }
    });

    if (!hasChange) return showToast("변경 사항이 없습니다.");

    const btn = document.getElementById('save-leave-settings-btn');
    btn.disabled = true;
    try {
        await setDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig'), { memberLeaveSettings: updates }, { merge: true });
        fullLeaveConfig = updates;
        showToast("총 연차 설정이 저장되었습니다.");
        renderLeaveSheet(); 
    } catch (e) { showToast("저장 실패", true); } finally { btn.disabled = false; }
}