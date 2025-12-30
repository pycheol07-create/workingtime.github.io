// === js/weekend-calendar.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { 
    collection, query, where, getDocs, doc, setDoc, deleteDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-based index
let myRequestsMap = new Map(); // 내가 신청한 날짜를 빠르게 확인하기 위함

// 캘린더 초기화 및 렌더링 함수
export async function initWeekendCalendar() {
    renderCalendarGrid(currentYear, currentMonth);
    await loadWeekendRequests(currentYear, currentMonth);
}

export function changeMonth(offset) {
    currentMonth += offset;
    if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    } else if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    }
    initWeekendCalendar();
}

// 달력 그리드 그리기
function renderCalendarGrid(year, month) {
    const grid = document.getElementById('weekend-calendar-grid');
    const label = document.getElementById('current-month-label');
    
    if (!grid || !label) return;

    // 월 표시
    label.textContent = `${year}년 ${month + 1}월`;
    grid.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay(); // 0: 일요일
    const lastDate = new Date(year, month + 1, 0).getDate();

    // 빈 칸 채우기 (지난달)
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = "bg-gray-100 border-b border-r border-gray-200 min-h-[100px]";
        grid.appendChild(emptyCell);
    }

    // 날짜 칸 생성
    for (let d = 1; d <= lastDate; d++) {
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6); // 0:일, 6:토
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        
        // 주말이면 클릭 가능하게 스타일링
        let cellClass = `relative border-b border-r border-gray-200 p-2 flex flex-col min-h-[120px] transition-colors `;
        if (isWeekend) {
            cellClass += "bg-white hover:bg-blue-50 cursor-pointer";
        } else {
            cellClass += "bg-gray-50 opacity-60";
        }

        const cell = document.createElement('div');
        cell.className = cellClass;
        cell.dataset.date = dateStr;
        cell.id = `cell-${dateStr}`;

        // 날짜 숫자
        const dateNum = document.createElement('span');
        dateNum.className = `text-sm font-bold mb-1 pointer-events-none ${dayOfWeek === 0 ? 'text-red-500' : (dayOfWeek === 6 ? 'text-blue-600' : 'text-gray-500')}`;
        dateNum.textContent = d;
        cell.appendChild(dateNum);

        // 신청자 목록 컨테이너
        const listContainer = document.createElement('div');
        listContainer.className = "flex flex-col gap-1 mt-1 w-full pointer-events-none"; // 클릭 이벤트가 부모(Cell)로 전달되도록
        listContainer.id = `weekend-list-${dateStr}`;
        cell.appendChild(listContainer);

        // 이벤트: 주말인 경우 날짜 클릭 시 바로 토글(신청/취소)
        if (isWeekend) {
            cell.onclick = () => handleDateClick(dateStr);
        }

        grid.appendChild(cell);
    }
}

// Firestore에서 데이터 불러오기
async function loadWeekendRequests(year, month) {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`; // "2024-05"
    myRequestsMap.clear();

    try {
        const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
        const q = query(colRef, where("month", "==", monthStr));
        const snapshot = await getDocs(q);

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            addBadgeToCalendar(docSnap.id, data);
            
            // 내 신청 내역 기록 (토글 판별용)
            if (data.member === State.appState.currentUser) {
                myRequestsMap.set(data.date, docSnap.id);
                // 내 신청이 있는 칸은 스타일 강조
                const cell = document.getElementById(`cell-${data.date}`);
                if (cell) cell.classList.add('bg-blue-50', 'ring-2', 'ring-inset', 'ring-blue-200');
            }
        });
    } catch (e) {
        console.error("Error loading weekend requests:", e);
        showToast("데이터 로딩 오류", true);
    }
}

// 캘린더 셀에 배지 추가
function addBadgeToCalendar(docId, data) {
    const container = document.getElementById(`weekend-list-${data.date}`);
    if (!container) return;

    const isAdmin = (State.appState.currentUserRole === 'admin');
    
    const badge = document.createElement('div');
    const colorClass = data.status === 'confirmed' 
        ? 'bg-blue-100 text-blue-800 border-blue-200' 
        : 'bg-orange-100 text-orange-800 border-orange-200';
    
    badge.className = `px-2 py-1 rounded text-xs border truncate font-medium flex justify-between items-center ${colorClass} pointer-events-auto`; // 배지는 별도 클릭 가능하게
    badge.textContent = data.member;

    // 관리자는 타인 배지를 클릭해서 승인 관리
    if (isAdmin) {
        badge.style.cursor = 'pointer';
        badge.onclick = (e) => {
            e.stopPropagation(); // 셀 클릭(본인신청) 방지
            handleAdminBadgeClick(docId, data);
        };
    }

    container.appendChild(badge);
}

// [핵심] 날짜 칸 클릭 핸들러 (신청/취소 토글)
async function handleDateClick(dateStr) {
    const member = State.appState.currentUser;
    if (!member) {
        showToast("로그인이 필요합니다.", true);
        return;
    }

    // 이미 신청한 날짜인지 확인
    if (myRequestsMap.has(dateStr)) {
        // 이미 신청함 -> 취소(삭제) 프로세스
        if (confirm(`${dateStr} 근무 신청을 취소하시겠습니까?`)) {
            const docId = myRequestsMap.get(dateStr);
            await deleteRequest(docId);
        }
    } else {
        // 신청 안 함 -> 신규 신청 프로세스 (사유 입력 없음)
        if (confirm(`${dateStr} 근무를 신청하시겠습니까?`)) {
            await createRequest(dateStr, member);
        }
    }
}

// 신규 신청 생성
async function createRequest(dateStr, member) {
    const monthStr = dateStr.substring(0, 7); // "YYYY-MM"
    const docId = `${dateStr}_${member}`; // ID 조합

    const requestData = {
        date: dateStr,
        month: monthStr,
        member: member,
        reason: "", // 사유 없음
        status: 'requested',
        createdAt: new Date().toISOString()
    };

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await setDoc(docRef, requestData);
        showToast(`${dateStr} 근무 신청 완료`);
        initWeekendCalendar(); // 화면 갱신
    } catch (e) {
        console.error("Error creating request:", e);
        showToast("신청 중 오류가 발생했습니다.", true);
    }
}

// 신청 삭제
async function deleteRequest(docId) {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await deleteDoc(docRef);
        showToast("신청이 취소되었습니다.");
        initWeekendCalendar(); // 화면 갱신
    } catch (e) {
        console.error("Error deleting request:", e);
        showToast("취소 중 오류가 발생했습니다.", true);
    }
}

// 관리자용 배지 클릭 핸들러
function handleAdminBadgeClick(docId, data) {
    const popup = document.getElementById('weekend-admin-popup');
    document.getElementById('admin-popup-member').textContent = data.member;
    
    const statusSpan = document.getElementById('admin-popup-status');
    statusSpan.textContent = data.status === 'confirmed' ? '승인됨' : '대기 중';
    statusSpan.className = data.status === 'confirmed' ? 'font-bold text-blue-600' : 'font-bold text-orange-500';

    document.getElementById('admin-confirm-btn').onclick = () => processAdminAction(docId, 'confirmed');
    document.getElementById('admin-reject-btn').onclick = () => processAdminAction(docId, 'delete');
    document.getElementById('admin-close-popup-btn').onclick = () => popup.classList.add('hidden');

    popup.classList.remove('hidden');
}

async function processAdminAction(docId, action) {
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
    try {
        if (action === 'delete') {
            await deleteDoc(docRef);
            showToast("반려(삭제) 처리되었습니다.");
        } else if (action === 'confirmed') {
            await updateDoc(docRef, { status: 'confirmed', confirmedAt: new Date().toISOString() });
            showToast("승인 처리되었습니다.");
        }
        document.getElementById('weekend-admin-popup').classList.add('hidden');
        initWeekendCalendar();
    } catch (e) {
        console.error("Error admin action:", e);
        showToast("처리 중 오류 발생", true);
    }
}