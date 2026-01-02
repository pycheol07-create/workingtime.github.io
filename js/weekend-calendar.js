// === js/weekend-calendar.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { 
    collection, query, where, getDocs, doc, setDoc, deleteDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-based index
let myRequestsMap = new Map();

// 초기화 함수
export async function initWeekendCalendar() {
    renderWeekendList(currentYear, currentMonth);
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

// [핵심 변경] 주말 리스트 렌더링
function renderWeekendList(year, month) {
    const listView = document.getElementById('weekend-list-view');
    const label = document.getElementById('current-month-label');
    
    if (!listView || !label) return;

    // 월 표시
    label.textContent = `${year}년 ${month + 1}월`;
    listView.innerHTML = '';

    const lastDate = new Date(year, month + 1, 0).getDate();
    let hasWeekend = false;

    // 1일부터 말일까지 반복
    for (let d = 1; d <= lastDate; d++) {
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay();

        // 토(6) 또는 일(0)인 경우만 렌더링
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            hasWeekend = true;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayName = dayOfWeek === 0 ? '일' : '토';
            const dayColor = dayOfWeek === 0 ? 'text-red-600' : 'text-blue-600';
            const bgColor = dayOfWeek === 0 ? 'bg-red-50' : 'bg-blue-50';

            // 리스트 아이템 컨테이너
            const rowItem = document.createElement('div');
            // 기본 스타일: 회색 테두리, 흰 배경
            // hover 시 약간 진해짐, 클릭 커서
            rowItem.className = `flex flex-col md:flex-row md:items-center justify-between p-3 rounded-lg border border-gray-200 shadow-sm transition-all cursor-pointer hover:shadow-md active:scale-[0.99] bg-white group`;
            rowItem.id = `row-${dateStr}`;
            rowItem.onclick = () => handleDateClick(dateStr);

            // 1. 왼쪽: 날짜 정보
            const dateInfo = document.createElement('div');
            dateInfo.className = "flex items-center gap-3 mb-2 md:mb-0";
            dateInfo.innerHTML = `
                <div class="w-12 h-12 flex flex-col items-center justify-center rounded-lg ${bgColor} ${dayColor} font-bold border border-gray-100">
                    <span class="text-xs opacity-70">${month + 1}월</span>
                    <span class="text-lg leading-none">${d}</span>
                </div>
                <div class="flex flex-col">
                    <span class="font-bold text-gray-800 text-lg">${dayName}요일 근무</span>
                    <span class="text-xs text-gray-400 group-hover:text-blue-500 transition-colors">터치하여 신청/취소</span>
                </div>
            `;
            rowItem.appendChild(dateInfo);

            // 2. 오른쪽: 신청자 배지 목록 영역
            const badgesArea = document.createElement('div');
            badgesArea.className = "flex flex-wrap gap-2 justify-end items-center flex-grow pl-0 md:pl-4";
            badgesArea.id = `weekend-list-${dateStr}`; // 배지 추가 함수가 이 ID를 찾음
            
            // (빈 상태일 때 공간 확보용)
            badgesArea.style.minHeight = "28px"; 
            
            rowItem.appendChild(badgesArea);
            listView.appendChild(rowItem);
        }
    }

    if (!hasWeekend) {
        listView.innerHTML = `<div class="text-center text-gray-400 py-10">이 달에는 주말이 없습니다.</div>`;
    }
}

// Firestore에서 데이터 불러오기
async function loadWeekendRequests(year, month) {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    myRequestsMap.clear();

    try {
        const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
        const q = query(colRef, where("month", "==", monthStr));
        const snapshot = await getDocs(q);

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            addBadgeToCalendar(docSnap.id, data);
            
            // 내 신청 내역 기록
            if (data.member === State.appState.currentUser) {
                myRequestsMap.set(data.date, docSnap.id);
                
                // 내 신청이 있는 Row 강조 (파란 테두리 & 배경)
                const row = document.getElementById(`row-${data.date}`);
                if (row) {
                    row.classList.remove('bg-white', 'border-gray-200');
                    row.classList.add('bg-indigo-50', 'border-indigo-300', 'ring-1', 'ring-indigo-300');
                    
                    // "터치하여 신청/취소" 텍스트 변경
                    const hintText = row.querySelector('.text-xs.text-gray-400');
                    if(hintText) {
                        hintText.textContent = "✅ 신청됨 (터치하여 취소)";
                        hintText.classList.add('text-indigo-600', 'font-medium');
                        hintText.classList.remove('text-gray-400');
                    }
                }
            }
        });
    } catch (e) {
        console.error("Error loading weekend requests:", e);
        showToast("데이터 로딩 오류", true);
    }
}

// 리스트에 배지(이름표) 추가
function addBadgeToCalendar(docId, data) {
    // 위에서 생성한 ID와 동일 (weekend-list-YYYY-MM-DD)
    const container = document.getElementById(`weekend-list-${data.date}`);
    if (!container) return;

    const isAdmin = (State.appState.currentUserRole === 'admin');
    
    const badge = document.createElement('div');
    const colorClass = data.status === 'confirmed' 
        ? 'bg-blue-600 text-white border-blue-600 shadow-sm' // 확정: 진한 파랑
        : 'bg-white text-orange-600 border-orange-300 border shadow-sm'; // 대기: 흰배경+주황글씨
    
    badge.className = `px-3 py-1 rounded-full text-sm font-medium border flex items-center gap-1 transition-transform hover:scale-105 ${colorClass}`;
    
    // 상태 아이콘
    const icon = data.status === 'confirmed' ? '👌' : '⏳';
    badge.innerHTML = `<span class="text-xs">${icon}</span> ${data.member}`;

    // 관리자 기능 (클릭 시 승인 팝업)
    // 일반 유저는 Row 클릭 이벤트(신청/취소)가 우선이므로 배지 클릭 막음(pointer-events-none 등 처리 필요없음, 상위 전파 중단)
    if (isAdmin) {
        badge.style.cursor = 'pointer';
        badge.onclick = (e) => {
            e.stopPropagation(); // Row 클릭(신청/취소) 방지
            handleAdminBadgeClick(docId, data);
        };
    } else {
        // 본인 배지인 경우 그냥 둠 (Row 클릭으로 취소됨)
        // 타인 배지인 경우 클릭해도 아무 일 없도록
        badge.onclick = (e) => {
            e.stopPropagation(); // Row 클릭 방지 (남의 이름 눌렀을 때 내 신청 토글되는 것 방지)
        };
    }

    container.appendChild(badge);
}

// 클릭 핸들러 (신청/취소 토글)
async function handleDateClick(dateStr) {
    const member = State.appState.currentUser;
    if (!member) {
        showToast("로그인이 필요합니다.", true);
        return;
    }

    if (myRequestsMap.has(dateStr)) {
        // 이미 신청함 -> 취소
        if (confirm(`${dateStr} 근무 신청을 취소하시겠습니까?`)) {
            const docId = myRequestsMap.get(dateStr);
            await deleteRequest(docId);
        }
    } else {
        // 미신청 -> 신청
        // (confirm 없이 바로 신청되게 하거나, 물어보거나 선택. 여기선 UX상 물어보는게 안전)
        if (confirm(`${dateStr} 근무를 신청하시겠습니까?`)) {
            await createRequest(dateStr, member);
        }
    }
}

// 신청 생성
async function createRequest(dateStr, member) {
    const monthStr = dateStr.substring(0, 7);
    const docId = `${dateStr}_${member}`; 

    const requestData = {
        date: dateStr,
        month: monthStr,
        member: member,
        reason: "", 
        status: 'requested',
        createdAt: new Date().toISOString()
    };

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await setDoc(docRef, requestData);
        showToast("신청되었습니다.");
        initWeekendCalendar(); 
    } catch (e) {
        console.error("Error creating request:", e);
        showToast("신청 실패", true);
    }
}

// 신청 삭제
async function deleteRequest(docId) {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await deleteDoc(docRef);
        showToast("취소되었습니다.");
        initWeekendCalendar(); 
    } catch (e) {
        console.error("Error deleting request:", e);
        showToast("취소 실패", true);
    }
}

// 관리자 팝업 핸들러
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
            showToast("반려(삭제) 완료");
        } else if (action === 'confirmed') {
            await updateDoc(docRef, { status: 'confirmed', confirmedAt: new Date().toISOString() });
            showToast("승인 완료");
        }
        document.getElementById('weekend-admin-popup').classList.add('hidden');
        initWeekendCalendar();
    } catch (e) {
        console.error("Error admin action:", e);
        showToast("처리 실패", true);
    }
}