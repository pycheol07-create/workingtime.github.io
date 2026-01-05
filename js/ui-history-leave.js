// === js/ui-history-leave.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { 
    doc, getDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentYear = new Date().getFullYear();
let leaveSettings = {}; // 화면 표시용 {이름: 총연차}
let fullLeaveConfig = {}; // 관리자 설정 원본 {이름: {totalLeave:..., leaveResetDate:..., expirationDate:...}}

// 초기화 및 렌더링 진입점
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

    await renderLeaveSheet();
}

// 메인 렌더링 함수
export async function renderLeaveSheet() {
    const tbody = document.getElementById('leave-sheet-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-10 text-center"><div class="animate-spin inline-block w-6 h-6 border-2 border-blue-500 rounded-full border-t-transparent"></div> 데이터 동기화 중...</td></tr>';

    try {
        // 1. 직원 목록 가져오기
        const members = await fetchAllMembers();
        
        // 2. 관리자 설정 로드 (총 연차 + 적용 기간)
        await fetchLeaveSettings();

        // 3. 사용 내역 집계 (설정된 기간 우선, 없으면 연도 기준)
        const usageData = await fetchLeaveUsage(currentYear);

        // 4. 테이블 그리기
        tbody.innerHTML = '';
        
        if (members.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">등록된 직원이 없습니다.</td></tr>';
            return;
        }

        members.forEach(member => {
            // 설정값 가져오기
            const config = fullLeaveConfig[member] || {};
            const total = config.totalLeave !== undefined ? Number(config.totalLeave) : 15;
            
            // 기간 텍스트 생성
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
            
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 transition-colors";
            
            let remainColor = 'text-gray-700';
            if (remaining < 0) remainColor = 'text-red-600 font-bold';
            else if (remaining <= 3) remainColor = 'text-orange-500 font-bold';
            else remainColor = 'text-green-600 font-bold';

            tr.innerHTML = `
                <td class="px-6 py-3 font-medium text-gray-900 border-b border-gray-100">${member}</td>
                <td class="px-6 py-3 text-center border-b border-gray-100">
                    <input type="number" class="w-20 text-center border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 outline-none total-leave-input font-bold text-blue-600" 
                           data-member="${member}" value="${total}" min="0" step="0.5">
                </td>
                <td class="px-6 py-3 text-center border-b border-gray-100 ${periodClass}">
                    ${periodText}
                </td>
                <td class="px-6 py-3 text-center font-medium border-b border-gray-100">${used}</td>
                <td class="px-6 py-3 text-center ${remainColor} border-b border-gray-100">${remaining}</td>
                <td class="px-6 py-3 text-xs text-gray-500 break-words max-w-md leading-relaxed border-b border-gray-100">
                    ${history}
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        console.error("Error rendering leave sheet:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-red-500">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>';
    }
}

// 직원 목록 가져오기
async function fetchAllMembers() {
    const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
    const partTimers = (State.appState.partTimers || []).map(p => p.name);
    return [...new Set([...staff, ...partTimers])].sort();
}

// [핵심] 관리자 설정 로드 (mainConfig > memberLeaveSettings)
async function fetchLeaveSettings() {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
        const snap = await getDoc(docRef);
        
        fullLeaveConfig = {}; 

        if (snap.exists()) {
            const data = snap.data();
            // 관리자 페이지가 저장하는 필드 구조
            fullLeaveConfig = data.memberLeaveSettings || {};
        }
    } catch (e) {
        console.warn("Leave settings load failed:", e);
        fullLeaveConfig = {};
    }
}

// [핵심] 사용 내역 집계 (기간 설정 우선 적용)
async function fetchLeaveUsage(year) {
    let allLeaves = [];
    
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            allLeaves = snap.data().onLeaveMembers || [];
        }
    } catch (e) {
        console.error("Leave schedule fetch error", e);
    }

    const usage = {}; 

    allLeaves.forEach(record => {
        // 연차 관련 타입만 집계
        if (record.type && (record.type.includes('연차') || record.type.includes('반차'))) {
            const name = record.member;
            
            // 1. 해당 멤버의 관리자 설정 확인 (기간 정보)
            const memberConfig = fullLeaveConfig[name] || {};
            const resetDate = memberConfig.leaveResetDate;
            const expireDate = memberConfig.expirationDate;

            let isMatch = false;

            // 2. 조건 확인: 설정된 기간이 있으면 그 기간 내 사용분만, 없으면 선택된 연도 기준
            if (resetDate && expireDate) {
                // 시작일이 설정된 기간 내에 포함되는지 확인 (단순 문자열 비교 가능 YYYY-MM-DD)
                if (record.startDate >= resetDate && record.startDate <= expireDate) {
                    isMatch = true;
                }
            } else {
                // 기간 설정 없으면 연도 기준 (fallback)
                if (record.startDate && record.startDate.startsWith(String(year))) {
                    isMatch = true;
                }
            }

            if (!isMatch) return; // 집계 대상 아님

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

// 설정 저장 (총 연차 수정 시 -> mainConfig 업데이트)
async function saveLeaveSettings() {
    const inputs = document.querySelectorAll('.total-leave-input');
    let hasChange = false;
    
    // 기존 설정을 복사하여 수정 (입사일, 기간 등 보존)
    const updates = { ...fullLeaveConfig };

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
        
        await updateDoc(docRef, {
            memberLeaveSettings: updates
        });
        
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