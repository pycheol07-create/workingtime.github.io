// === js/ui-history-leave.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { 
    collection, doc, getDoc, setDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentYear = new Date().getFullYear();
let leaveSettings = {}; // { "홍길동": 15, "김철수": 12, ... }

// 초기화 및 렌더링 진입점
export async function initLeaveManagement() {
    const yearSelect = document.getElementById('leave-year-select');
    if (yearSelect) {
        currentYear = parseInt(yearSelect.value);
        yearSelect.addEventListener('change', (e) => {
            currentYear = parseInt(e.target.value);
            renderLeaveSheet();
        });
    }
    
    // 버튼 리스너 연결
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

    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center"><div class="animate-spin inline-block w-6 h-6 border-2 border-blue-500 rounded-full border-t-transparent"></div> 로딩 중...</td></tr>';

    try {
        // 1. 직원 목록 가져오기
        const members = await fetchAllMembers();
        
        // 2. 총 연차 설정 가져오기 (DB: config/leaveSettings)
        await fetchLeaveSettings();

        // 3. 연차 사용 내역 가져오기 (DB: persistent_data/leaveSchedule)
        const usageData = await fetchLeaveUsage(currentYear);

        // 4. 테이블 그리기
        tbody.innerHTML = '';
        
        members.forEach(member => {
            const total = leaveSettings[member] || 15; // 기본값 15일
            const used = usageData[member] ? usageData[member].count : 0;
            const remaining = total - used;
            const history = usageData[member] ? usageData[member].dates.join(', ') : '-';
            
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 transition-colors";
            
            // 잔여일수 색상 처리
            const remainColor = remaining < 0 ? 'text-red-600 font-bold' : (remaining <= 3 ? 'text-orange-500 font-bold' : 'text-green-600 font-bold');

            tr.innerHTML = `
                <td class="px-4 py-3 font-medium text-gray-900">${member}</td>
                <td class="px-4 py-3 text-center">
                    <input type="number" class="w-16 text-center border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none total-leave-input" 
                           data-member="${member}" value="${total}" min="0" step="0.5">
                </td>
                <td class="px-4 py-3 text-center font-medium">${used}</td>
                <td class="px-4 py-3 text-center ${remainColor}">${remaining}</td>
                <td class="px-4 py-3 text-xs text-gray-500 break-words max-w-md leading-relaxed">${history}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        console.error("Error rendering leave sheet:", e);
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-4 text-center text-red-500">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>';
    }
}

// 직원 목록 가져오기
async function fetchAllMembers() {
    // 1. 설정된 팀 그룹에서 정직원 가져오기
    const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
    // 2. 알바생 가져오기
    const partTimers = (State.appState.partTimers || []).map(p => p.name);
    // 병합 및 정렬
    return [...new Set([...staff, ...partTimers])].sort();
}

// 총 연차 설정 로드
async function fetchLeaveSettings() {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'leaveSettings');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            leaveSettings = snap.data();
        } else {
            leaveSettings = {};
        }
    } catch (e) {
        console.warn("Leave settings load failed, using defaults.", e);
        leaveSettings = {};
    }
}

// 연차 사용 내역 집계 (leaveSchedule 기반)
async function fetchLeaveUsage(year) {
    // persistent_data/leaveSchedule 에서 데이터를 가져와서 계산
    // 구조: { onLeaveMembers: [ { member: "이름", type: "연차", startDate: "YYYY-MM-DD", ... }, ... ] }
    
    // *주의: 여기서는 단순화를 위해 로컬 State 또는 DB에서 가져옴
    // 만약 데이터 양이 많다면 별도 컬렉션 관리가 필요하지만, 현재 구조상 leaveSchedule 전체를 로드해서 필터링함.
    
    let allLeaves = [];
    
    // 1. DB에서 최신 스케줄 가져오기
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            allLeaves = snap.data().onLeaveMembers || [];
        }
    } catch (e) {
        console.error("Leave schedule fetch error", e);
    }

    const usage = {}; // { "홍길동": { count: 3, dates: ["2025-01-01", ...] } }

    allLeaves.forEach(record => {
        // 조건: "연차" 타입이고, 선택된 연도(year)에 해당하는 경우
        if (record.type === '연차' && record.startDate) {
            const recordYear = parseInt(record.startDate.substring(0, 4));
            
            if (recordYear === year) {
                const name = record.member;
                if (!usage[name]) usage[name] = { count: 0, dates: [] };

                // 기간 계산 (startDate ~ endDate)
                // 현재 시스템은 주로 1일 단위 연차를 사용한다고 가정 (또는 endDate가 startDate와 같음)
                // 만약 기간 연차라면 날짜 차이를 계산해야 함. 여기서는 단순하게 1건 = 1일로 보거나, 날짜 차이를 계산.
                
                let days = 1;
                if (record.endDate && record.endDate !== record.startDate) {
                    const start = new Date(record.startDate);
                    const end = new Date(record.endDate);
                    const diffTime = Math.abs(end - start);
                    days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                }
                
                // 반차 처리 (필요 시 type에 '반차'가 있다면 0.5로 계산 가능)
                // 현재는 '연차'만 1일로 계산
                
                usage[name].count += days;
                
                let dateStr = record.startDate;
                if (days > 1) dateStr += `~${record.endDate.substring(5)}`; // 01-05 형태로 뒤는 축약
                usage[name].dates.push(dateStr);
            }
        }
    });

    // 날짜순 정렬
    Object.keys(usage).forEach(key => {
        usage[key].dates.sort();
    });

    return usage;
}

// 설정 저장 (총 연차)
async function saveLeaveSettings() {
    const inputs = document.querySelectorAll('.total-leave-input');
    const newSettings = {};
    
    inputs.forEach(input => {
        const member = input.dataset.member;
        const val = parseFloat(input.value);
        if (member && !isNaN(val)) {
            newSettings[member] = val;
        }
    });

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'leaveSettings');
        await setDoc(docRef, newSettings, { merge: true });
        
        leaveSettings = newSettings; // 메모리 갱신
        showToast("총 연차 설정이 저장되었습니다.");
        renderLeaveSheet(); // 재계산 (잔여일수 갱신 등)
    } catch (e) {
        console.error("Save settings error:", e);
        showToast("설정 저장 실패", true);
    }
}