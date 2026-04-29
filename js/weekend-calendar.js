// === js/weekend-calendar.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { 
    collection, query, where, doc, setDoc, deleteDoc, updateDoc, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); 
let myRequestsMap = new Map();
let blockedDatesSet = new Set(); 
let capacityMap = new Map(); 
let requestsByDate = {}; 
let unsubscribe = null; 

let currentManageDateStr = null; 

let currentYearlyStats = new Map();
let currentMonthStats = new Map();
let smartCalcCache = null; 
let recommendOffset = 0; 

export async function initWeekendCalendar() {
    await loadWeekendRequests(currentYear, currentMonth);

    // 💡 선택 날짜 일괄 처리 이벤트 바인딩
    const selectAllCb = document.getElementById('select-all-dates-checkbox');
    if (selectAllCb) {
        selectAllCb.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.date-select-checkbox').forEach(cb => cb.checked = isChecked);
        });
    }

    const bulkConfirmBtn = document.getElementById('bulk-confirm-btn');
    if (bulkConfirmBtn) bulkConfirmBtn.onclick = () => processSelectedDatesBulkAction('confirmed');
    
    const bulkCancelBtn = document.getElementById('bulk-cancel-btn');
    if (bulkCancelBtn) bulkCancelBtn.onclick = () => processSelectedDatesBulkAction('canceled');
    
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    if (bulkDeleteBtn) bulkDeleteBtn.onclick = () => processSelectedDatesBulkAction('delete');
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

async function loadWeekendRequests(year, month) {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }

    try {
        const startOfYear = `${year}-01-01`;
        const endOfYear = `${year}-12-31`;
        
        const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
        const q = query(colRef, where("date", ">=", startOfYear), where("date", "<=", endOfYear));

        unsubscribe = onSnapshot(q, (snapshot) => {
            myRequestsMap.clear();
            blockedDatesSet.clear();
            capacityMap.clear(); 
            requestsByDate = {};
            
            const memberStats = new Map(); 
            const yearlyStatsMap = new Map(); 
            
            const excludedMembers = ['박영철', '박호진', '유아라', '이승운'];

            if (State.appConfig && State.appConfig.teamGroups) {
                State.appConfig.teamGroups.forEach(group => {
                    if (group.members && Array.isArray(group.members)) {
                        group.members.forEach(member => {
                            if (!excludedMembers.includes(member)) {
                                memberStats.set(member, { confirmed: 0, requested: 0 });
                                yearlyStatsMap.set(member, 0); 
                            }
                        });
                    }
                });
            }

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                
                if (data.type === 'blocked') {
                    if (data.month === monthStr) blockedDatesSet.add(data.date);
                } else if (data.type === 'capacity') {
                    if (data.month === monthStr) capacityMap.set(data.date, data.capacity);
                } else {
                    if (data.status === 'confirmed' && !excludedMembers.includes(data.member)) {
                        yearlyStatsMap.set(data.member, (yearlyStatsMap.get(data.member) || 0) + 1);
                    }

                    if (data.month === monthStr) {
                        if (!requestsByDate[data.date]) requestsByDate[data.date] = [];
                        requestsByDate[data.date].push({ id: docSnap.id, ...data });

                        if (data.member === State.appState.currentUser) {
                            myRequestsMap.set(data.date, docSnap.id);
                        }

                        if (!excludedMembers.includes(data.member)) {
                            const stat = memberStats.get(data.member) || { confirmed: 0, requested: 0 };
                            if (data.status === 'confirmed') {
                                stat.confirmed++;
                            } else if (data.status === 'requested') {
                                stat.requested++;
                            }
                            memberStats.set(data.member, stat);
                        }
                    }
                }
            });

            currentYearlyStats = new Map(yearlyStatsMap);
            currentMonthStats = new Map(memberStats);

            renderWeekendStats(memberStats, yearlyStatsMap);
            renderWeekendList(year, month);

        }, (error) => {
            console.error("Error in weekend listener:", error);
            showToast("실시간 데이터를 불러오지 못했습니다.", true);
        });

    } catch (e) {
        console.error("Error setting up listener:", e);
    }
}

function renderWeekendStats(memberStats, yearlyStatsMap) {
    const sidebar = document.getElementById('weekend-stats-sidebar');
    const list = document.getElementById('weekend-stats-list');
    
    if (!sidebar || !list) return;

    const excludedMembers = ['박영철', '박호진', '유아라', '이승운'];
    
    const filteredMembers = [...memberStats.entries()].filter(([name, counts]) => {
        return !excludedMembers.includes(name);
    });

    if (filteredMembers.length === 0) {
        sidebar.classList.add('!hidden');
        const toggleBtn = document.getElementById('toggle-weekend-stats-btn');
        if(toggleBtn) toggleBtn.classList.add('!hidden');
        return;
    } else {
        sidebar.classList.remove('!hidden');
        const toggleBtn = document.getElementById('toggle-weekend-stats-btn');
        if(toggleBtn) toggleBtn.classList.remove('!hidden');
    }

    list.innerHTML = '';

    filteredMembers.sort((a, b) => {
        const totalA = a[1].confirmed + a[1].requested;
        const totalB = b[1].confirmed + b[1].requested;
        if (totalB !== totalA) return totalB - totalA; 
        
        const yearlyA = yearlyStatsMap.get(a[0]) || 0;
        const yearlyB = yearlyStatsMap.get(b[0]) || 0;
        if (yearlyA !== yearlyB) return yearlyA - yearlyB;
        
        return a[0].localeCompare(b[0]);
    });

    filteredMembers.forEach(([name, counts]) => {
        const item = document.createElement('div');
        const opacityClass = (counts.confirmed === 0 && counts.requested === 0) ? "opacity-60 hover:opacity-100" : "";
        const yearlyCount = yearlyStatsMap.get(name) || 0;

        item.className = `bg-white border border-indigo-100 p-2 rounded-md shadow-sm flex justify-between items-center transition-all hover:-translate-y-0.5 ${opacityClass}`;
        
        item.innerHTML = `
            <div class="flex items-center">
                <span class="font-bold text-gray-700 text-sm whitespace-nowrap">${name}</span>
                <span class="text-[10px] text-gray-400 font-medium ml-1.5 whitespace-nowrap">(연누적 ${yearlyCount}회)</span>
            </div>
            <div class="text-xs bg-gray-50 px-2 py-1 rounded border border-gray-200 font-mono tracking-wider ml-2 flex-shrink-0">
                <span class="text-blue-600 font-bold w-4 inline-block text-center" title="확정됨">${counts.confirmed}</span><span class="text-gray-300">|</span><span class="text-orange-500 font-medium w-4 inline-block text-center" title="승인 대기">${counts.requested}</span>
            </div>
        `;
        list.appendChild(item);
    });
}

function renderWeekendList(year, month) {
    const listView = document.getElementById('weekend-list-view');
    const label = document.getElementById('current-month-label');
    
    if (!listView || !label) return;

    label.textContent = `${year}년 ${month + 1}월`;
    listView.innerHTML = '';

    const lastDate = new Date(year, month + 1, 0).getDate();
    let hasWeekend = false;
    const isAdmin = (State.appState.currentUserRole === 'admin');

    // 💡 관리자용 일괄 처리 바 노출 여부
    const bulkBar = document.getElementById('admin-bulk-action-bar');
    if (bulkBar) {
        if (isAdmin) {
            bulkBar.classList.remove('hidden');
            bulkBar.classList.add('flex');
            // 전체 선택 초기화
            const selAllCb = document.getElementById('select-all-dates-checkbox');
            if (selAllCb) selAllCb.checked = false;
        } else {
            bulkBar.classList.add('hidden');
            bulkBar.classList.remove('flex');
        }
    }

    for (let d = 1; d <= lastDate; d++) {
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay();

        if (dayOfWeek === 0 || dayOfWeek === 6) {
            hasWeekend = true;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayName = dayOfWeek === 0 ? '일' : '토';
            
            const isBlocked = blockedDatesSet.has(dateStr);
            const isAppliedByMe = myRequestsMap.has(dateStr);
            const capacity = capacityMap.get(dateStr); 

            let dayColor = dayOfWeek === 0 ? 'text-red-600' : 'text-blue-600';
            let bgColor = dayOfWeek === 0 ? 'bg-red-50' : 'bg-blue-50';

            // 💡 신규 레이아웃: Row 컨테이너
            const rowItem = document.createElement('div');
            rowItem.className = 'flex flex-row items-stretch gap-2 p-1.5 rounded-lg border shadow-sm bg-white hover:shadow-md transition-all mb-2';
            rowItem.id = `row-${dateStr}`;

            // 💡 1. 좌측 영역 (날짜 및 관리자 설정/체크박스)
            const leftArea = document.createElement('div');
            leftArea.className = `relative w-[72px] md:w-24 flex-shrink-0 flex flex-col items-center justify-center rounded-md border ${bgColor} ${dayColor} overflow-hidden select-none`;
            
            let adminHtml = '';
            if (isAdmin) {
                leftArea.classList.add('cursor-pointer', 'hover:opacity-80', 'hover:ring-2', 'hover:ring-indigo-300', 'transition-all');
                adminHtml = `
                    <div class="absolute top-[5px] left-[5px] z-10" onclick="event.stopPropagation()">
                        <input type="checkbox" class="date-select-checkbox w-3.5 h-3.5 md:w-4 md:h-4 cursor-pointer text-blue-600 border-gray-300 rounded" data-date="${dateStr}">
                    </div>
                `;
                leftArea.onclick = () => openAdminDatePopup(dateStr);
            }
            
            leftArea.innerHTML = `
                ${adminHtml}
                <span class="text-xl md:text-2xl font-black tracking-tight mt-1 md:mt-2">${d}.${dayName}</span>
                ${capacity ? `<span class="mt-1 mb-1 md:mb-2 text-[9px] md:text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200">정원 ${capacity}</span>` : '<span class="h-1 md:h-2"></span>'}
            `;

            // 💡 2. 우측 영역 (배지 및 신청 버튼)
            const rightArea = document.createElement('div');
            rightArea.className = 'flex-1 flex flex-col justify-center rounded-md border p-2 cursor-pointer transition-colors';
            
            if (isBlocked) {
                rightArea.classList.add('bg-gray-50', 'border-gray-300', 'opacity-70', 'cursor-not-allowed');
            } else if (isAppliedByMe) {
                rightArea.classList.add('bg-indigo-50', 'border-indigo-300', 'border-dashed');
            } else {
                rightArea.classList.add('bg-white', 'border-gray-200', 'border-dashed', 'hover:bg-gray-50');
            }

            rightArea.onclick = () => handleDateClick(dateStr, isBlocked);

            const rightHeader = document.createElement('div');
            rightHeader.className = "flex justify-between items-center text-[10px] md:text-xs mb-1.5";
            rightHeader.innerHTML = `
                <span class="text-gray-400 font-medium">영역을 터치하여 신청/취소</span>
                ${isBlocked ? '<span class="text-red-500 font-bold bg-red-50 px-1.5 rounded">🚫 마감됨</span>' : isAppliedByMe ? '<span class="text-indigo-600 font-bold bg-indigo-100 px-1.5 rounded">✅ 신청됨</span>' : ''}
            `;

            const badgesArea = document.createElement('div');
            badgesArea.className = "flex flex-wrap gap-1.5 items-center";
            badgesArea.id = `weekend-list-${dateStr}`; 
            badgesArea.style.minHeight = "28px";

            rightArea.appendChild(rightHeader);
            rightArea.appendChild(badgesArea);

            rowItem.appendChild(leftArea);
            rowItem.appendChild(rightArea);
            listView.appendChild(rowItem);

            // 배지 추가
            if (requestsByDate[dateStr]) {
                const adminMembers = ['박영철', '박호진', '유아라', '이승운'];
                
                requestsByDate[dateStr].sort((a, b) => {
                    if (a.status === 'canceled' && b.status !== 'canceled') return 1;
                    if (a.status !== 'canceled' && b.status === 'canceled') return -1;
                    
                    const aIsAdmin = adminMembers.includes(a.member);
                    const bIsAdmin = adminMembers.includes(b.member);
                    
                    if (aIsAdmin && !bIsAdmin) return 1;  
                    if (!aIsAdmin && bIsAdmin) return -1; 
                    
                    const timeA = a.createdAt || "";
                    const timeB = b.createdAt || "";
                    return timeA.localeCompare(timeB);
                });

                requestsByDate[dateStr].forEach(req => {
                    addBadgeToCalendar(dateStr, req, isAdmin);
                });
            }
        }
    }

    if (!hasWeekend) {
        listView.innerHTML = `<div class="text-center text-gray-400 py-10">이 달에는 주말이 없습니다.</div>`;
    }
}

function addBadgeToCalendar(dateStr, data, isAdmin) {
    const container = document.getElementById(`weekend-list-${dateStr}`);
    if (!container) return;

    const badge = document.createElement('div');
    
    let colorClass = '';
    let icon = '';

    if (data.status === 'confirmed') {
        colorClass = 'bg-blue-600 text-white border-blue-600 shadow-sm';
        icon = '👌';
    } else if (data.status === 'canceled') {
        colorClass = 'bg-yellow-100 text-yellow-700 border-yellow-400 shadow-sm opacity-80 line-through';
        icon = '❌';
    } else {
        colorClass = 'bg-white text-orange-600 border-orange-300 border shadow-sm';
        icon = '⏳';
    }
    
    badge.className = `px-2.5 md:px-3 py-0.5 md:py-1 rounded-full text-[11px] md:text-sm font-medium border flex items-center gap-1 transition-transform hover:scale-105 ${colorClass}`;
    badge.innerHTML = `<span class="text-[10px] md:text-xs">${icon}</span> ${data.member}`;

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
        if (confirm(`${dateStr} 근무 신청 내역을 완전히 삭제하시겠습니까?`)) {
            const docId = myRequestsMap.get(dateStr);
            await deleteRequest(docId);
        }
    } else {
        if (confirm(`${dateStr} 근무를 신청하시겠습니까?`)) {
            await createRequest(dateStr, member, 'requested');
        }
    }
}

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
        showToast("신청 기록이 완전히 삭제되었습니다.");
    } catch (e) {
        console.error("Error deleting request:", e);
        showToast("삭제 실패", true);
    }
}

function handleAdminBadgeClick(docId, data) {
    const popup = document.getElementById('weekend-admin-popup');
    document.getElementById('admin-popup-member').textContent = data.member;
    
    const statusSpan = document.getElementById('admin-popup-status');
    
    if (data.status === 'confirmed') {
        statusSpan.textContent = '승인됨';
        statusSpan.className = 'font-bold text-blue-600';
    } else if (data.status === 'canceled') {
        statusSpan.textContent = '취소됨';
        statusSpan.className = 'font-bold text-yellow-600';
    } else {
        statusSpan.textContent = '대기 중';
        statusSpan.className = 'font-bold text-orange-500';
    }

    document.getElementById('admin-confirm-btn').onclick = () => processAdminAction(docId, 'confirmed', data);
    document.getElementById('admin-reject-btn').onclick = () => processAdminAction(docId, 'demote', data);
    
    const cancelBtn = document.getElementById('admin-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = () => processAdminAction(docId, 'canceled', data);
    
    document.getElementById('admin-close-popup-btn').onclick = () => popup.classList.add('hidden');

    popup.classList.remove('hidden');
}

async function processAdminAction(docId, action, data) {
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
    try {
        if (action === 'demote') {
            await updateDoc(docRef, { status: 'requested', confirmedAt: null });
            showToast("대기 상태로 변경되었습니다.");
        } 
        else if (action === 'confirmed') {
            await updateDoc(docRef, { status: 'confirmed', confirmedAt: new Date().toISOString() });
            showToast("승인 완료");
            
            const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
            await setDoc(notiRef, {
                targetMember: data.member,
                type: 'weekend_confirmed',
                message: `${data.date} 주말 근무 신청이 확정(승인)되었습니다.`,
                createdAt: new Date().toISOString(),
                isRead: false
            });
        } 
        else if (action === 'canceled') {
            await updateDoc(docRef, { status: 'canceled', confirmedAt: null });
            showToast("취소 처리되었습니다.");
            
            const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
            await setDoc(notiRef, {
                targetMember: data.member,
                type: 'weekend_canceled',
                message: `${data.date} 주말 근무 신청이 관리자에 의해 취소(반려)되었습니다.`,
                createdAt: new Date().toISOString(),
                isRead: false
            });
        }
        document.getElementById('weekend-admin-popup').classList.add('hidden');
    } catch (e) {
        console.error("Error admin action:", e);
        showToast("처리 실패", true);
    }
}

// 💡 신규: 체크박스로 선택된 날짜들에 대한 일괄 처리
export async function processSelectedDatesBulkAction(action) {
    const checkboxes = document.querySelectorAll('.date-select-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast("선택된 날짜가 없습니다.", true);
        return;
    }

    const actionText = action === 'confirmed' ? '승인' : action === 'canceled' ? '취소' : '삭제';
    if (!confirm(`선택한 ${checkboxes.length}개 날짜의 모든 신청 건을 일괄 ${actionText} 하시겠습니까?`)) return;

    let count = 0;
    try {
        for (const cb of checkboxes) {
            const dateStr = cb.dataset.date;
            const reqs = requestsByDate[dateStr] || [];
            
            for (const req of reqs) {
                const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', req.id);
                if (action === 'delete') {
                    await deleteDoc(docRef);
                } else {
                    if (req.status !== action) {
                        await updateDoc(docRef, { status: action, confirmedAt: action === 'confirmed' ? new Date().toISOString() : null });
                        
                        const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
                        const msg = action === 'confirmed' 
                            ? `${dateStr} 주말 근무 배정이 확정(승인)되었습니다.` 
                            : `${dateStr} 주말 근무 신청이 관리자에 의해 일괄 취소(반려)되었습니다.`;
                        await setDoc(notiRef, {
                            targetMember: req.member,
                            type: action === 'confirmed' ? 'weekend_confirmed' : 'weekend_canceled',
                            message: msg,
                            createdAt: new Date().toISOString(),
                            isRead: false
                        });
                    }
                }
                count++;
            }
        }
        showToast(`선택 날짜의 총 ${count}건 일괄 ${actionText} 완료 및 알림 전송됨.`);
        
        // 처리 완료 후 체크 해제
        document.getElementById('select-all-dates-checkbox').checked = false;
        checkboxes.forEach(cb => cb.checked = false);

    } catch (e) {
        console.error("Bulk action error:", e);
        showToast("일괄 처리 중 오류 발생", true);
    }
}

function populateAdminAddMemberSelect(dateStr) {
    const select = document.getElementById('admin-date-add-member');
    if (!select) return;

    select.innerHTML = '<option value="">팀원 선택...</option>';

    let allMembers = [];
    if (State.appConfig && State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(g => {
            if (g.members) allMembers = allMembers.concat(g.members);
        });
    }
    if (State.appState && State.appState.partTimers) {
        State.appState.partTimers.forEach(p => {
            if (p.name) allMembers.push(p.name);
        });
    }
    allMembers = [...new Set(allMembers)];

    const reqs = requestsByDate[dateStr] || [];
    const alreadyApplied = reqs.map(r => r.member);

    allMembers.forEach(member => {
        const option = document.createElement('option');
        option.value = member;
        option.textContent = member;
        if (alreadyApplied.includes(member)) {
            option.disabled = true;
            option.textContent += ' (이미 신청/확정됨)';
        }
        select.appendChild(option);
    });
}

function openAdminDatePopup(dateStr) {
    currentManageDateStr = dateStr;
    recommendOffset = 0; 
    
    const popup = document.getElementById('weekend-admin-date-popup');
    document.getElementById('admin-date-popup-title').textContent = dateStr;
    
    populateAdminAddMemberSelect(dateStr);
    
    const capacityInput = document.getElementById('admin-date-capacity');
    if (capacityInput) {
        capacityInput.value = capacityMap.has(dateStr) ? capacityMap.get(dateStr) : '';
    }

    const randomCountInput = document.getElementById('admin-date-random-count');
    if (randomCountInput) randomCountInput.value = '1';

    const isBlocked = blockedDatesSet.has(dateStr);
    document.getElementById('admin-date-block-toggle').checked = isBlocked;

    const smartArea = document.getElementById('smart-calc-result-area');
    if (smartArea) {
        smartArea.innerHTML = '';
        smartArea.classList.add('hidden');
    }
    smartCalcCache = null;

    popup.classList.remove('hidden');
}

export function calculateSmartAllocation() {
    if (!currentManageDateStr) return;
    const capacityStr = capacityMap.get(currentManageDateStr);
    const capacity = parseInt(capacityStr, 10);
    
    if (isNaN(capacity) || capacity <= 0) {
        showToast("먼저 정원(명)을 설정하고 '설정' 버튼을 눌러주세요.", true);
        return;
    }

    const reqs = requestsByDate[currentManageDateStr] || [];
    
    const activeReqs = reqs.filter(r => r.status !== 'canceled');
    const applicants = activeReqs.map(r => r.member);
    
    let allMembers = [];
    if (State.appConfig && State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(g => {
            if (g.members) allMembers = allMembers.concat(g.members);
        });
    }
    allMembers = [...new Set(allMembers)];
    
    const adminMembers = ['박영철', '박호진', '유아라', '이승운'];
    const eligibleMembers = allMembers.filter(m => !adminMembers.includes(m));

    const adminApplicants = applicants.filter(m => adminMembers.includes(m));
    const generalApplicants = applicants.filter(m => !adminMembers.includes(m));

    const availableCapacity = Math.max(0, capacity - adminApplicants.length);

    const getScore = (m) => {
        const y = currentYearlyStats.get(m) || 0;
        const ms = currentMonthStats.get(m) || {confirmed: 0, requested: 0};
        const monthTotal = ms.confirmed + ms.requested;
        return (monthTotal * 1000) + (y * 10); 
    };

    const sortedGeneralApplicants = [...generalApplicants].sort((a, b) => {
        const diff = getScore(a) - getScore(b);
        return diff !== 0 ? diff : a.localeCompare(b);
    });

    const nonApplicants = eligibleMembers.filter(m => !applicants.includes(m));
    const sortedNonApplicants = [...nonApplicants].sort((a, b) => {
        const diff = getScore(a) - getScore(b);
        return diff !== 0 ? diff : a.localeCompare(b);
    });

    let toConfirm = [...adminApplicants]; 
    let toDecline = []; 
    let toAdd = [];     

    if (generalApplicants.length > availableCapacity) {
        toConfirm = toConfirm.concat(sortedGeneralApplicants.slice(0, availableCapacity));
        toDecline = sortedGeneralApplicants.slice(availableCapacity);
        recommendOffset = 0; 
    } else if (generalApplicants.length < availableCapacity) {
        toConfirm = toConfirm.concat(sortedGeneralApplicants);
        const needed = availableCapacity - generalApplicants.length;
        
        if (sortedNonApplicants.length > 0) {
            if (recommendOffset >= sortedNonApplicants.length) {
                recommendOffset = 0; 
                showToast("모든 후보를 순회하여 다시 1순위부터 추천합니다.");
            }
            
            for (let i = 0; i < needed; i++) {
                const index = (recommendOffset + i) % sortedNonApplicants.length;
                if (!toAdd.includes(sortedNonApplicants[index])) {
                    toAdd.push(sortedNonApplicants[index]);
                }
            }
            recommendOffset += needed;
        }
    } else {
        toConfirm = toConfirm.concat(sortedGeneralApplicants);
        recommendOffset = 0;
    }

    let totalMonthlyCapacity = 0;
    capacityMap.forEach(v => totalMonthlyCapacity += parseInt(v, 10) || 0);
    const avgPossibleShifts = (totalMonthlyCapacity / eligibleMembers.length).toFixed(1);

    renderSmartCalcResult(toConfirm, toDecline, toAdd, capacity, applicants.length, adminApplicants.length, avgPossibleShifts);
}

function renderSmartCalcResult(toConfirm, toDecline, toAdd, capacity, appCount, adminCount, avgPossible) {
    const area = document.getElementById('smart-calc-result-area');
    area.classList.remove('hidden');

    let html = `<div class="text-xs text-gray-700 font-medium space-y-3 mb-4">`;
    html += `<div class="flex flex-col gap-1 border-b border-indigo-100 pb-2">
                <div class="flex justify-between">
                    <span>설정 정원: <b class="text-emerald-600">${capacity}명</b> (관리자 ${adminCount}명 포함)</span> 
                    <span>신청: <b>${appCount}명</b></span>
                </div>
                <div class="text-[10px] text-indigo-500 font-normal">* 이 달의 팀원당 권장 근무: 약 ${avgPossible}회</div>
             </div>`;
    
    const finalConfirmed = [...toConfirm, ...toAdd];
    html += `<div><span class="text-emerald-700 font-bold">✅ 최종 확정 추천 (${finalConfirmed.length}명)</span><div class="mt-2 flex flex-wrap gap-1.5">`;
    
    finalConfirmed.forEach(m => {
        const yCount = currentYearlyStats.get(m) || 0;
        const ms = currentMonthStats.get(m) || {confirmed: 0, requested: 0};
        const mTotal = ms.confirmed + ms.requested;
        
        const isNew = toAdd.includes(m);
        const isAdmin = ['박영철', '박호진', '유아라', '이승운'].includes(m);
        
        let badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm';
        let icon = '✔️';
        let subText = `(당월 ${mTotal}회/누적 ${yCount}회)`;
        
        if (isAdmin) {
            badgeClass = 'bg-gray-100 text-gray-800 border-gray-300 shadow-sm';
            icon = '👑';
            subText = '(관리자)';
        } else if (isNew) {
            badgeClass = 'bg-blue-50 text-blue-800 border-blue-200 shadow-sm';
            icon = '➕';
        }

        html += `<span class="border px-1.5 py-1 rounded-md text-[11px] ${badgeClass}">${icon} ${m} <span class="text-[10px] opacity-70">${subText}</span></span>`;
    });
    html += `</div></div>`;

    if (toDecline.length > 0) {
        html += `<div class="pt-1"><span class="text-red-600 font-bold">➖ 정원 초과로 자동 취소 (${toDecline.length}명)</span><br><span class="text-gray-400 text-[10px]">당월 신청 횟수가 많아 배정에서 제외되며, 취소(노란색) 상태로 변경됩니다.</span><div class="mt-2 flex flex-wrap gap-1.5">`;
        toDecline.forEach(m => {
            const ms = currentMonthStats.get(m) || {confirmed: 0, requested: 0};
            html += `<span class="bg-yellow-100 text-yellow-700 border border-yellow-400 px-1.5 py-1 rounded-md text-[11px] line-through shadow-sm">❌ ${m} <span class="text-[10px] opacity-70">(당월 ${ms.confirmed+ms.requested}회)</span></span>`;
        });
        html += `</div></div>`;
    }

    if(toAdd.length === 0 && toDecline.length === 0) {
         html += `<div class="text-blue-600 font-bold py-1 bg-blue-50 px-2 rounded mt-2">인원이 정원과 일치하여 전원 확정 추천합니다.</div>`;
    }
    
    html += `</div>`;
    html += `<button id="apply-smart-calc-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-lg shadow-md transition text-sm flex justify-center items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                추천안 일괄 적용하기
             </button>`;

    area.innerHTML = html;
    smartCalcCache = { toConfirm, toDecline, toAdd };
}

export async function applySmartAllocation() {
    if (!smartCalcCache || !currentManageDateStr) return;
    const { toConfirm, toDecline, toAdd } = smartCalcCache;
    const reqs = requestsByDate[currentManageDateStr] || [];
    
    const applyBtn = document.getElementById('apply-smart-calc-btn');
    if(applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = '적용 중...';
    }

    try {
        for (const m of toDecline) {
            const req = reqs.find(r => r.member === m);
            if (req && req.status !== 'canceled') { 
                await updateDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', req.id), { 
                    status: 'canceled', 
                    confirmedAt: null 
                });
                
                const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
                await setDoc(notiRef, {
                    targetMember: m,
                    type: 'weekend_canceled',
                    message: `${currentManageDateStr} 주말 근무 신청이 정원 초과로 인해 취소(반려)되었습니다.`,
                    createdAt: new Date().toISOString(),
                    isRead: false
                });
            }
        }
        
        for (const m of toConfirm) {
            const req = reqs.find(r => r.member === m);
            if (req && req.status !== 'confirmed') {
                await updateDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', req.id), { status: 'confirmed', confirmedAt: new Date().toISOString() });
                
                const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
                await setDoc(notiRef, {
                    targetMember: m,
                    type: 'weekend_confirmed',
                    message: `${currentManageDateStr} 주말 근무 배정이 확정되었습니다.`,
                    createdAt: new Date().toISOString(),
                    isRead: false
                });
            }
        }
        
        for (const m of toAdd) {
            await createRequest(currentManageDateStr, m, 'confirmed');
            
            const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
            await setDoc(notiRef, {
                targetMember: m,
                type: 'weekend_confirmed',
                message: `${currentManageDateStr} 주말 근무가 배정(확정)되었습니다.`,
                createdAt: new Date().toISOString(),
                isRead: false
            });
        }

        showToast("스마트 배분이 성공적으로 적용되었으며, 알림이 발송되었습니다.");
        document.getElementById('smart-calc-result-area').classList.add('hidden');
        smartCalcCache = null;
        
        recommendOffset = 0; 
    } catch (e) {
        console.error("Smart Allocation Error:", e);
        showToast("적용 중 오류가 발생했습니다.", true);
    } finally {
         if(applyBtn) {
            applyBtn.disabled = false;
            applyBtn.textContent = '추천안 일괄 적용하기';
        }
    }
}

export async function setDateCapacity(capacityStr) {
    if (!currentManageDateStr) return;
    const capacity = parseInt(capacityStr, 10);
    const docId = `CAPACITY_${currentManageDateStr}`;
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);

    try {
        if (isNaN(capacity) || capacity <= 0) {
            await deleteDoc(docRef);
            showToast(`${currentManageDateStr} 정원 설정이 해제되었습니다.`);
        } else {
            await setDoc(docRef, {
                type: 'capacity',
                date: currentManageDateStr,
                month: currentManageDateStr.substring(0, 7),
                capacity: capacity,
                updatedAt: new Date().toISOString()
            });
            showToast(`${currentManageDateStr} 정원이 ${capacity}명으로 설정되었습니다.`);
        }
    } catch (e) {
        console.error("Error setting capacity:", e);
        showToast("정원 설정 실패", true);
    }
}

export async function adminAddMemberToDate() {
    if (!currentManageDateStr) return;
    const select = document.getElementById('admin-date-add-member');
    const memberName = select.value.trim();

    if (!memberName) {
        showToast("추가할 팀원을 선택하세요.", true);
        return;
    }

    await createRequest(currentManageDateStr, memberName, 'confirmed');
    
    const notiRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications'));
    await setDoc(notiRef, {
        targetMember: memberName,
        type: 'weekend_confirmed',
        message: `${currentManageDateStr} 주말 근무가 배정(확정)되었습니다.`,
        createdAt: new Date().toISOString(),
        isRead: false
    });

    showToast(`${memberName}님 확정 및 알림 발송 완료`);
    
    populateAdminAddMemberSelect(currentManageDateStr);
}

export async function adminRandomSelectMembers(count) {
    if (!currentManageDateStr) return;
    
    let allMembers = [];
    if (State.appConfig && State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(group => {
            if (group.members && Array.isArray(group.members)) {
                allMembers = allMembers.concat(group.members);
            }
        });
    }

    allMembers = [...new Set(allMembers)];

    const excludedMembers = ['박영철', '박호진', '유아라', '이승운']; 
    const alreadyApplied = (requestsByDate[currentManageDateStr] || []).map(req => req.member);
    
    const availableMembers = allMembers.filter(member => 
        !excludedMembers.includes(member) && !alreadyApplied.includes(member)
    );

    if (availableMembers.length === 0) {
        showToast("추첨 가능한 인원이 없습니다.", true);
        return;
    }

    if (count > availableMembers.length) {
        showToast(`현재 추첨 가능한 최대 인원은 ${availableMembers.length}명입니다.`, true);
        count = availableMembers.length;
    }

    const shuffled = [...availableMembers];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selectedMembers = shuffled.slice(0, count);

    let successCount = 0;
    for (const member of selectedMembers) {
        try {
            await createRequest(currentManageDateStr, member, 'requested');
            successCount++;
        } catch(e) {
            console.error(`Error adding random member ${member}:`, e);
        }
    }

    showToast(`랜덤 추첨으로 ${successCount}명 승인 대기 등록 완료`);
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
        document.getElementById('admin-date-block-toggle').checked = !isBlocked;
    }
}

export { currentManageDateStr };