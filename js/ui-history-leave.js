// === js/ui-history-leave.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { 
    doc, getDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentYear = new Date().getFullYear();
let leaveSettings = {}; // { "홍길동": 15, "김철수": 12, ... } (화면 표시용 단순 객체)
let fullLeaveConfig = {}; // 관리자 설정 원본 데이터 (입사일 등 보존용)

// 초기화 및 렌더링 진입점
export async function initLeaveManagement() {
    const yearSelect = document.getElementById('leave-year-select');
    
    // 현재 연도로 초기화
    if (yearSelect) {
        if (!yearSelect.value) yearSelect.value = currentYear;
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

    tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-10 text-center"><div class="animate-spin inline-block w-6 h-6 border-2 border-blue-500 rounded-full border-t-transparent"></div> 데이터 집계 중...</td></tr>';

    try {
        // 1. 직원 목록 가져오기
        const members = await fetchAllMembers();
        
        // 2. 총 연차 설정 가져오기 (관리자 설정값 연동)
        await fetchLeaveSettings();

        // 3. 실제 사용 내역 계산하기 (DB의 leaveSchedule 분석)
        const usageData = await fetchLeaveUsage(currentYear);

        // 4. 테이블 그리기
        tbody.innerHTML = '';
        
        if (members.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">등록된 직원이 없습니다.</td></tr>';
            return;
        }

        members.forEach(member => {
            // 관리자 설정이 있으면 그 값을, 없으면 기본값 15
            const total = leaveSettings[member] !== undefined ? leaveSettings[member] : 15; 
            const used = usageData[member] ? usageData[member].count : 0;
            const remaining = total - used;
            const history = usageData[member] ? usageData[member].dates.join(', ') : '-';
            
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 transition-colors";
            
            // 잔여일수 색상 처리
            let remainColor = 'text-gray-700';
            if (remaining < 0) remainColor = 'text-red-600 font-bold';
            else if (remaining <= 3) remainColor = 'text-orange-500 font-bold';
            else remainColor = 'text-green-600 font-bold';

            tr.innerHTML = `
                <td class="px-6 py-3 font-medium text-gray-900 border-b border-gray-100">${member}</td>
                <td class="px-6 py-3 text-center border-b border-gray-100">
                    <input type="number" class="w-20 text-center border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 outline-none total-leave-input" 
                           data-member="${member}" value="${total}" min="0" step="0.5">
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
        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-red-500">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>';
    }
}

// 직원 목록 가져오기 (설정된 팀원 + 알바생)
async function fetchAllMembers() {
    // State.appConfig가 로드되어 있다고 가정
    const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
    const partTimers = (State.appState.partTimers || []).map(p => p.name);
    return [...new Set([...staff, ...partTimers])].sort();
}

// [핵심 변경] 총 연차 설정 로드 (DB: config/mainConfig)
// 관리자 페이지와 동일한 데이터 소스를 사용하도록 수정됨
async function fetchLeaveSettings() {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
        const snap = await getDoc(docRef);
        
        leaveSettings = {}; // 초기화
        fullLeaveConfig = {};

        if (snap.exists()) {
            const data = snap.data();
            // 관리자 페이지 데이터 구조: memberLeaveSettings: { "이름": { totalLeave: 15, joinDate: "..." } }
            fullLeaveConfig = data.memberLeaveSettings || {};
            
            // 화면 표시용 단순 객체로 변환
            Object.keys(fullLeaveConfig).forEach(name => {
                const setting = fullLeaveConfig[name];
                if (setting && typeof setting.totalLeave !== 'undefined') {
                    leaveSettings[name] = Number(setting.totalLeave);
                }
            });
        }
    } catch (e) {
        console.warn("Leave settings load failed:", e);
        leaveSettings = {};
    }
}

// 연차 사용 내역 집계 로직 (기존과 동일)
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
        if (record.type && (record.type.includes('연차') || record.type.includes('반차'))) {
            
            const startDateStr = record.startDate || "";
            if (!startDateStr.startsWith(String(year))) return;

            const name = record.member;
            if (!usage[name]) usage[name] = { count: 0, dates: [] };

            let days = 0;
            let label = "";

            if (record.type.includes('반차')) {
                days = 0.5;
                label = `${startDateStr.substring(5)} (${record.type})`;
            } else {
                if (record.endDate && record.endDate !== record.startDate) {
                    const start = new Date(record.startDate);
                    const end = new Date(record.endDate);
                    const diffTime = Math.abs(end - start);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                    
                    days = diffDays;
                    label = `${startDateStr.substring(5)}~${record.endDate.substring(5)}`;
                } else {
                    days = 1;
                    label = startDateStr.substring(5);
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

// [핵심 변경] 설정 저장 (config/mainConfig 업데이트)
// 여기서 값을 변경하면 관리자 페이지에도 반영됩니다.
async function saveLeaveSettings() {
    const inputs = document.querySelectorAll('.total-leave-input');
    let hasChange = false;
    
    // 기존 설정(fullLeaveConfig)을 기반으로 업데이트할 객체 준비
    // (입사일, 만료일 등 기존 데이터 유지)
    const updates = { ...fullLeaveConfig };

    inputs.forEach(input => {
        const member = input.dataset.member;
        const val = parseFloat(input.value);
        if (member && !isNaN(val)) {
            // 기존 데이터가 없으면 객체 생성
            if (!updates[member]) updates[member] = {};
            
            // 값이 다를 때만 업데이트 플래그 설정
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
        
        // mainConfig 문서의 memberLeaveSettings 필드만 부분 업데이트
        await updateDoc(docRef, {
            memberLeaveSettings: updates
        });
        
        // 로컬 데이터 갱신
        fullLeaveConfig = updates;
        Object.keys(updates).forEach(name => {
            if (updates[name] && typeof updates[name].totalLeave !== 'undefined') {
                leaveSettings[name] = updates[name].totalLeave;
            }
        });

        showToast("총 연차 설정이 저장되었습니다.");
        
        // 화면 재계산
        await renderLeaveSheet(); 
    } catch (e) {
        console.error("Save settings error:", e);
        showToast("설정 저장 실패: " + e.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}