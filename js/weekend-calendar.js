// === js/weekend-calendar.js ===
import * as State from './state.js';
import * as DOM from './dom-elements.js';
import { showToast, getTodayDateString } from './utils.js';
import { 
    collection, query, where, getDocs, doc, setDoc, deleteDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-based index

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

// 달력 그리드 그리기 (HTML 생성)
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
        
        const cell = document.createElement('div');
        cell.className = `relative border-b border-r border-gray-200 p-2 flex flex-col min-h-[120px] transition-colors ${isWeekend ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 opacity-60'}`;
        cell.dataset.date = dateStr;
        cell.dataset.isWeekend = isWeekend;

        // 날짜 숫자
        const dateNum = document.createElement('span');
        dateNum.className = `text-sm font-bold mb-1 ${dayOfWeek === 0 ? 'text-red-500' : (dayOfWeek === 6 ? 'text-blue-600' : 'text-gray-500')}`;
        dateNum.textContent = d;
        cell.appendChild(dateNum);

        // 주말인 경우 '신청' 버튼 영역 (hover 시 표시 or 항상 표시)
        if (isWeekend) {
            const addBtn = document.createElement('button');
            addBtn.innerHTML = '+';
            addBtn.className = "absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 text-xs opacity-0 group-hover:opacity-100 transition-opacity request-work-btn";
            addBtn.onclick = (e) => {
                e.stopPropagation();
                openRequestPopup(dateStr);
            };
            // 셀 전체에 hover 효과를 주기 위해 group 클래스 추가가 필요하지만, 간단히 JS로 처리
            cell.addEventListener('mouseenter', () => addBtn.classList.remove('opacity-0'));
            cell.addEventListener('mouseleave', () => addBtn.classList.add('opacity-0'));
            cell.appendChild(addBtn);
        }

        // 신청자 목록 컨테이너
        const listContainer = document.createElement('div');
        listContainer.className = "flex flex-col gap-1 mt-1 w-full";
        listContainer.id = `weekend-list-${dateStr}`;
        cell.appendChild(listContainer);

        grid.appendChild(cell);
    }
}

// Firestore에서 데이터 불러와서 배치하기
async function loadWeekendRequests(year, month) {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`; // "2024-05" 형식
    
    try {
        const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
        const q = query(colRef, where("month", "==", monthStr));
        const snapshot = await getDocs(q);

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            addBadgeToCalendar(docSnap.id, data);
        });
    } catch (e) {
        console.error("Error loading weekend requests:", e);
        showToast("데이터를 불러오는 중 오류가 발생했습니다.", true);
    }
}

// 캘린더 셀에 배지(Badge) 추가
function addBadgeToCalendar(docId, data) {
    const container = document.getElementById(`weekend-list-${data.date}`);
    if (!container) return;

    const isMe = (data.member === State.appState.currentUser);
    const isAdmin = (State.appState.currentUserRole === 'admin');
    
    const badge = document.createElement('div');
    // 스타일: 확정됨(파랑), 대기중(주황)
    const colorClass = data.status === 'confirmed' 
        ? 'bg-blue-100 text-blue-800 border-blue-200' 
        : 'bg-orange-100 text-orange-800 border-orange-200';
    
    badge.className = `px-2 py-1 rounded text-xs border cursor-pointer truncate font-medium flex justify-between items-center ${colorClass}`;
    badge.innerHTML = `<span>${data.member}</span>`;
    badge.title = `사유: ${data.reason}`;

    // 클릭 이벤트 (상세/관리)
    badge.onclick = (e) => {
        e.stopPropagation();
        handleBadgeClick(docId, data, isMe, isAdmin);
    };

    container.appendChild(badge);
}

// 배지 클릭 핸들러
function handleBadgeClick(docId, data, isMe, isAdmin) {
    if (isAdmin) {
        // 관리자용 팝업 열기
        const popup = document.getElementById('weekend-admin-popup');
        document.getElementById('admin-popup-member').textContent = data.member;
        document.getElementById('admin-popup-reason').textContent = data.reason;
        
        const statusSpan = document.getElementById('admin-popup-status');
        statusSpan.textContent = data.status === 'confirmed' ? '승인됨' : '대기 중';
        statusSpan.className = data.status === 'confirmed' ? 'font-bold text-blue-600' : 'font-bold text-orange-500';

        // 버튼 이벤트 바인딩
        document.getElementById('admin-confirm-btn').onclick = () => processRequest(docId, 'confirmed');
        document.getElementById('admin-reject-btn').onclick = () => processRequest(docId, 'rejected'); // 실제로는 삭제
        document.getElementById('admin-close-popup-btn').onclick = () => popup.classList.add('hidden');

        popup.classList.remove('hidden');
    } else if (isMe) {
        // 본인: 취소(삭제) 확인
        if (confirm(`'${data.date}' 주말 근무 신청을 취소하시겠습니까?`)) {
            processRequest(docId, 'delete');
        }
    } else {
        // 타인: 그냥 정보 보기 (Toast)
        showToast(`${data.member}님의 예정 업무: ${data.reason}`);
    }
}

// 신청 팝업 열기
let selectedDateForRequest = null;
function openRequestPopup(dateStr) {
    selectedDateForRequest = dateStr;
    const popup = document.getElementById('weekend-request-popup');
    document.getElementById('popup-date-display').textContent = dateStr;
    document.getElementById('weekend-reason-input').value = '';
    document.getElementById('weekend-reason-input').focus();
    popup.classList.remove('hidden');
}

// 신청 데이터 저장 (Firestore)
export async function submitRequest() {
    const reason = document.getElementById('weekend-reason-input').value.trim();
    if (!reason) {
        showToast("근무 사유를 입력해주세요.", true);
        return;
    }
    if (!selectedDateForRequest) return;

    const member = State.appState.currentUser;
    const monthStr = selectedDateForRequest.substring(0, 7); // "YYYY-MM"
    const docId = `${selectedDateForRequest}_${member}`; // 중복 방지 ID

    const requestData = {
        date: selectedDateForRequest,
        month: monthStr,
        member: member,
        reason: reason,
        status: 'requested', // 기본값 대기
        createdAt: new Date().toISOString()
    };

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await setDoc(docRef, requestData);
        
        showToast("주말 근무 신청이 완료되었습니다.");
        document.getElementById('weekend-request-popup').classList.add('hidden');
        
        // 화면 갱신 (전체 다시 로드 없이 해당 셀에만 추가해도 되지만, 편의상 리로드)
        initWeekendCalendar(); 
    } catch (e) {
        console.error("Error submitting weekend request:", e);
        showToast("신청 저장 중 오류가 발생했습니다.", true);
    }
}

// 승인/반려/삭제 처리
async function processRequest(docId, action) {
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
    
    try {
        if (action === 'delete' || action === 'rejected') {
            await deleteDoc(docRef);
            showToast(action === 'delete' ? "신청이 취소되었습니다." : "신청이 반려(삭제)되었습니다.");
        } else if (action === 'confirmed') {
            await updateDoc(docRef, { status: 'confirmed', confirmedAt: new Date().toISOString() });
            showToast("승인 처리되었습니다.");
        }
        
        document.getElementById('weekend-admin-popup').classList.add('hidden');
        initWeekendCalendar(); // 화면 갱신
    } catch (e) {
        console.error("Error processing request:", e);
        showToast("처리 중 오류가 발생했습니다.", true);
    }
}