// === js/weekend-calendar.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { 
    collection, query, where, doc, setDoc, deleteDoc, updateDoc, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-based index
let myRequestsMap = new Map();
let blockedDatesSet = new Set(); // 마감된 날짜 저장
let requestsByDate = {}; // 날짜별 신청자 목록
let unsubscribe = null; 

let currentManageDateStr = null; // 현재 관리 팝업이 열린 날짜

export async function initWeekendCalendar() {
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
    loadWeekendRequests(currentYear, currentMonth);
}

// 실시간 리스너 연결 및 데이터 분류
async function loadWeekendRequests(year, month) {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }

    try {
        const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
        const q = query(colRef, where("month", "==", monthStr));

        unsubscribe = onSnapshot(q, (snapshot) => {
            myRequestsMap.clear();
            blockedDatesSet.clear();
            requestsByDate = {};

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                
                if (data.type === 'blocked') {
                    // 마감(비활성화)된 날짜 처리
                    blockedDatesSet.add(data.date);
                } else {
                    // 일반 신청 데이터 처리
                    if (!requestsByDate[data.date]) requestsByDate[data.date] = [];
                    requestsByDate[data.date].push({ id: docSnap.id, ...data });

                    if (data.member === State.appState.currentUser) {
                        myRequestsMap.set(data.date, docSnap.id);
                    }
                }
            });

            // 데이터 수집 후 렌더링
            renderWeekendList(year, month);

        }, (error) => {
            console.error("Error in weekend listener:", error);
            showToast("실시간 데이터를 불러오지 못했습니다.", true);
        });

    } catch (e) {
        console.error("Error setting up listener:", e);
    }
}

// 주말 리스트 렌더링
function renderWeekendList(year, month) {
    const listView = document.getElementById('weekend-list-view');
    const label = document.getElementById('current-month-label');
    
    if (!listView || !label) return;

    label.textContent = `${year}년 ${month + 1}월`;
    listView.innerHTML = '';

    const lastDate = new Date(year, month + 1, 0).getDate();
    let hasWeekend = false;
    const isAdmin = (State.appState.currentUserRole === 'admin');

    for (let d = 1; d <= lastDate; d++) {
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay();

        if (dayOfWeek === 0 || dayOfWeek === 6) {
            hasWeekend = true;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayName = dayOfWeek === 0 ? '일' : '토';
            
            const isBlocked = blockedDatesSet.has(dateStr);
            const isAppliedByMe = myRequestsMap.has(dateStr);

            // 색상 및 스타일 정의
            let dayColor = dayOfWeek === 0 ? 'text-red-600' : 'text-blue-600';
            let bgColor = dayOfWeek === 0 ? 'bg-red-50' : 'bg-blue-50';
            let rowClass = 'bg-white border-gray-200 hover:shadow-md cursor-pointer group';
            let hintText = '터치하여 신청/취소';
            let hintClass = 'text-gray-400 group-hover:text-blue-500';

            if (isBlocked) {
                dayColor = 'text-gray-400';
                bgColor = 'bg-gray-100';
                rowClass = 'bg-gray-50 border-gray-200 opacity-80 cursor-not-allowed';
                hintText = '🚫 신청 마감됨';
                hintClass = 'text-red-500 font-bold';
            } else if (isAppliedByMe) {
                rowClass = 'bg-indigo-50 border-indigo-300 ring-1 ring-indigo-300 cursor-pointer group';
                hintText = '✅ 신청됨 (터치하여 취소)';
                hintClass = 'text-indigo-600 font-medium';
            }

            const rowItem = document.createElement('div');
            rowItem.className = `flex flex-col md:flex-row md:items-center justify-between p-3 rounded-lg border shadow-sm transition-all active:scale-[0.99] ${rowClass}`;
            rowItem.id = `row-${dateStr}`;
            
            // 행 클릭 이벤트 (일반 유저용 신청/취소)
            rowItem.onclick = (e) => {
                // 관리자 톱니바퀴를 눌렀을 때는 실행하지 않음
                if(e.target.closest('.admin-manage-btn')) return;
                handleDateClick(dateStr, isBlocked);
            };

            // 관리자 전용 관리 버튼
            const adminManageHtml = isAdmin 
                ? `<button class="admin-manage-btn ml-2 p-1.5 rounded-md hover:bg-gray-200 text-gray-500 transition tooltip" title="날짜 관리(인원추가/마감)" data-date="${dateStr}">
                    ⚙️
                   </button>` 
                : '';

            const dateInfo = document.createElement('div');
            dateInfo.className = "flex items-center gap-3 mb-2 md:mb-0";
            dateInfo.innerHTML = `
                <div class="w-12 h-12 flex flex-col items-center justify-center rounded-lg ${bgColor} ${dayColor} font-bold border border-gray-100">
                    <span class="text-xs opacity-70">${month + 1}월</span>
                    <span class="text-lg leading-none">${d}</span>
                </div>
                <div class="flex flex-col">
                    <div class="flex items-center">
                        <span class="font-bold text-gray-800 text-lg">${dayName}요일 근무</span>
                        ${adminManageHtml}
                    </div>
                    <span class="text-xs transition-colors ${hintClass}">${hintText}</span>
                </div>
            `;
            rowItem.appendChild(dateInfo);

            const badgesArea = document.createElement('div');
            badgesArea.className = "flex flex-wrap gap-2 justify-end items-center flex-grow pl-0 md:pl-4";
            badgesArea.id = `weekend-list-${dateStr}`; 
            badgesArea.style.minHeight = "28px"; 
            
            rowItem.appendChild(badgesArea);
            listView.appendChild(rowItem);

            // 이 날짜에 신청한 사람 배지 렌더링
            if (requestsByDate[dateStr]) {
                requestsByDate[dateStr].forEach(req => {
                    addBadgeToCalendar(dateStr, req, isAdmin);
                });
            }
        }
    }

    if (!hasWeekend) {
        listView.innerHTML = `<div class="text-center text-gray-400 py-10">이 달에는 주말이 없습니다.</div>`;
    }

    // 관리자 버튼에 이벤트 연결
    if (isAdmin) {
        document.querySelectorAll('.admin-manage-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                openAdminDatePopup(btn.dataset.date);
            };
        });
    }
}

// 배지 렌더링 함수
function addBadgeToCalendar(dateStr, data, isAdmin) {
    const container = document.getElementById(`weekend-list-${dateStr}`);
    if (!container) return;

    const badge = document.createElement('div');
    const colorClass = data.status === 'confirmed' 
        ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
        : 'bg-white text-orange-600 border-orange-300 border shadow-sm'; 
    
    badge.className = `px-3 py-1 rounded-full text-sm font-medium border flex items-center gap-1 transition-transform hover:scale-105 ${colorClass}`;
    
    const icon = data.status === 'confirmed' ? '👌' : '⏳';
    badge.innerHTML = `<span class="text-xs">${icon}</span> ${data.member}`;

    if (isAdmin) {
        badge.style.cursor = 'pointer';
        badge.onclick = (e) => {
            e.stopPropagation(); 
            handleAdminBadgeClick(data.id, data);
        };
    } else {
        badge.onclick = (e) => e.stopPropagation(); 
    }

    container.appendChild(badge);
}

// 일반 신청/취소 클릭 핸들러
async function handleDateClick(dateStr, isBlocked) {
    const member = State.appState.currentUser;
    if (!member) {
        showToast("로그인이 필요합니다.", true);
        return;
    }

    if (isBlocked) {
        showToast("이 날짜는 신청이 마감되었습니다.", true);
        return;
    }

    if (myRequestsMap.has(dateStr)) {
        if (confirm(`${dateStr} 근무 신청을 취소하시겠습니까?`)) {
            const docId = myRequestsMap.get(dateStr);
            await deleteRequest(docId);
        }
    } else {
        if (confirm(`${dateStr} 근무를 신청하시겠습니까?`)) {
            await createRequest(dateStr, member, 'requested');
        }
    }
}

// 단일 요청 생성 (상태 파라미터 추가)
async function createRequest(dateStr, member, status = 'requested') {
    const monthStr = dateStr.substring(0, 7);
    const docId = `${dateStr}_${member}`; 

    const requestData = {
        date: dateStr,
        month: monthStr,
        member: member,
        reason: "", 
        status: status,
        createdAt: new Date().toISOString()
    };

    if (status === 'confirmed') requestData.confirmedAt = new Date().toISOString();

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await setDoc(docRef, requestData);
        if(status === 'requested') showToast("신청되었습니다.");
    } catch (e) {
        console.error("Error creating request:", e);
        showToast("처리 실패", true);
    }
}

async function deleteRequest(docId) {
    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
        await deleteDoc(docRef);
        showToast("취소되었습니다.");
    } catch (e) {
        console.error("Error deleting request:", e);
        showToast("취소 실패", true);
    }
}

// 배지 클릭 (관리자 개인 승인/반려)
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
    } catch (e) {
        console.error("Error admin action:", e);
        showToast("처리 실패", true);
    }
}

// ==========================================
// [신규] 날짜 관리(추가/마감) 팝업 관련 로직
// ==========================================
function openAdminDatePopup(dateStr) {
    currentManageDateStr = dateStr;
    const popup = document.getElementById('weekend-admin-date-popup');
    document.getElementById('admin-date-popup-title').textContent = dateStr;
    document.getElementById('admin-date-add-member').value = '';

    // 토글 스위치 상태 설정
    const isBlocked = blockedDatesSet.has(dateStr);
    document.getElementById('admin-date-block-toggle').checked = isBlocked;

    popup.classList.remove('hidden');
}

export async function adminAddMemberToDate() {
    if (!currentManageDateStr) return;
    const input = document.getElementById('admin-date-add-member');
    const memberName = input.value.trim();

    if (!memberName) {
        showToast("추가할 이름을 입력하세요.", true);
        return;
    }

    // 관리자가 수동 추가하면 바로 '확정(confirmed)' 상태로 들어감
    await createRequest(currentManageDateStr, memberName, 'confirmed');
    showToast(`${memberName}님 추가 완료`);
    input.value = '';
}

export async function toggleBlockDate(isBlocked) {
    if (!currentManageDateStr) return;
    
    const docId = `BLOCKED_${currentManageDateStr}`;
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);

    try {
        if (isBlocked) {
            const monthStr = currentManageDateStr.substring(0, 7);
            await setDoc(docRef, {
                type: 'blocked',
                date: currentManageDateStr,
                month: monthStr,
                createdAt: new Date().toISOString()
            });
            showToast(`${currentManageDateStr} 신청이 마감되었습니다.`);
        } else {
            await deleteDoc(docRef);
            showToast(`${currentManageDateStr} 신청이 다시 활성화되었습니다.`);
        }
    } catch (e) {
        console.error("Error toggling block status:", e);
        showToast("상태 변경 실패", true);
        // 실패 시 토글 원복
        document.getElementById('admin-date-block-toggle').checked = !isBlocked;
    }
}

// 외부에서 팝업 열기/데이터 변수 접근용 (리스너 연동을 위해)
export { currentManageDateStr };