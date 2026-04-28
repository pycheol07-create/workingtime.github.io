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

// [신규] 스마트 배분을 위한 전역 데이터 캐시
let currentYearlyStats = new Map();
let currentMonthStats = new Map();
let smartCalcCache = null; // 스마트 배분 결과 임시 저장

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
                            } else {
                                stat.requested++;
                            }
                            memberStats.set(data.member, stat);
                        }
                    }
                }
            });

            // 데이터를 캐시에 저장 (스마트 배분에서 활용)
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
            
            rowItem.onclick = (e) => {
                if(e.target.closest('.admin-manage-btn')) return;
                handleDateClick(dateStr, isBlocked);
            };

            const adminManageHtml = isAdmin 
                ? `<button class="admin-manage-btn ml-2 p-1.5 rounded-md hover:bg-gray-200 text-gray-500 transition tooltip" title="날짜 관리" data-date="${dateStr}">
                    ⚙️
                   </button>` 
                : '';

            const capacityHtml = capacity 
                ? `<span class="ml-2 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">정원: ${capacity}명</span>` 
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
                        <span class="font-bold text-gray-800 text-lg whitespace-nowrap">${dayName}요일 근무</span>
                        ${capacityHtml}
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

    if (isAdmin) {
        document.querySelectorAll('.admin-manage-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                openAdminDatePopup(btn.dataset.date);
            };
        });
    }
}

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

function handleAdminBadgeClick(docId, data) {
    const popup = document.getElementById('weekend-admin-popup');
    document.getElementById('admin-popup-member').textContent = data.member;
    
    const statusSpan = document.getElementById('admin-popup-status');
    statusSpan.textContent = data.status === 'confirmed' ? '승인됨' : '대기 중';
    statusSpan.className = data.status === 'confirmed' ? 'font-bold text-blue-600' : 'font-bold text-orange-500';

    document.getElementById('admin-confirm-btn').onclick = () => processAdminAction(docId, 'confirmed');
    // 승인 거절 시 삭제가 아니라 '대기' 상태로 전환하도록 수정
    document.getElementById('admin-reject-btn').onclick = () => processAdminAction(docId, 'demote');
    document.getElementById('admin-close-popup-btn').onclick = () => popup.classList.add('hidden');

    popup.classList.remove('hidden');
}

async function processAdminAction(docId, action) {
    const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', docId);
    try {
        if (action === 'demote') {
            await updateDoc(docRef, { status: 'requested', confirmedAt: null });
            showToast("대기 상태로 변경되었습니다.");
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

function openAdminDatePopup(dateStr) {
    currentManageDateStr = dateStr;
    const popup = document.getElementById('weekend-admin-date-popup');
    document.getElementById('admin-date-popup-title').textContent = dateStr;
    document.getElementById('admin-date-add-member').value = '';
    
    const capacityInput = document.getElementById('admin-date-capacity');
    if (capacityInput) {
        capacityInput.value = capacityMap.has(dateStr) ? capacityMap.get(dateStr) : '';
    }

    const randomCountInput = document.getElementById('admin-date-random-count');
    if (randomCountInput) randomCountInput.value = '1';

    const isBlocked = blockedDatesSet.has(dateStr);
    document.getElementById('admin-date-block-toggle').checked = isBlocked;

    // 스마트 배분 영역 초기화
    const smartArea = document.getElementById('smart-calc-result-area');
    if (smartArea) {
        smartArea.innerHTML = '';
        smartArea.classList.add('hidden');
    }
    smartCalcCache = null;

    popup.classList.remove('hidden');
}

// ===============================================
// [신규] 스마트 형평성 배분 (자동 추천 및 일괄 적용)
// ===============================================

export function calculateSmartAllocation() {
    if (!currentManageDateStr) return;
    const capacity = capacityMap.get(currentManageDateStr);
    
    if (!capacity || capacity <= 0) {
        showToast("먼저 정원(명)을 설정하고 '설정' 버튼을 눌러주세요.", true);
        return;
    }

    const reqs = requestsByDate[currentManageDateStr] || [];
    // 대기/확정 상관없이 이 날짜에 신청한 모든 사람
    const applicants = reqs.map(r => r.member);
    
    // 1. 제외자를 뺀 전체 팀원 목록 만들기
    let allMembers = [];
    if (State.appConfig && State.appConfig.teamGroups) {
        State.appConfig.teamGroups.forEach(g => {
            if (g.members) allMembers = allMembers.concat(g.members);
        });
    }
    allMembers = [...new Set(allMembers)];
    const excludedMembers = ['박영철', '박호진', '유아라', '이승운'];
    const eligibleMembers = allMembers.filter(m => !excludedMembers.includes(m));

    const nonApplicants = eligibleMembers.filter(m => !applicants.includes(m));

    // 점수 계산 (점수가 낮을수록 근무가 필요하므로 우선순위가 높음)
    const getScore = (m) => {
        const y = currentYearlyStats.get(m) || 0;
        const ms = currentMonthStats.get(m) || {confirmed: 0, requested: 0};
        // 가중치: 연 누적횟수(x100) > 당월 확정(x10) > 당월 대기(x1)
        return (y * 100) + (ms.confirmed * 10) + ms.requested;
    };

    // 정렬 (오름차순 = 점수가 낮을수록 앞쪽으로 옴)
    const sortedApplicants = [...applicants].sort((a, b) => {
        const diff = getScore(a) - getScore(b);
        return diff !== 0 ? diff : a.localeCompare(b);
    });

    const sortedNonApplicants = [...nonApplicants].sort((a, b) => {
        const diff = getScore(a) - getScore(b);
        return diff !== 0 ? diff : a.localeCompare(b);
    });

    let toConfirm = []; // 확정 유지/전환 대상
    let toDecline = []; // 대기로 전환 대상 (정원 초과 시)
    let toAdd = [];     // 새로 추가되어 확정될 대상 (정원 미달 시)

    if (applicants.length > capacity) {
        // 신청자가 넘침: 우선순위 높은 사람만 정원만큼 컷
        toConfirm = sortedApplicants.slice(0, capacity);
        toDecline = sortedApplicants.slice(capacity);
    } else if (applicants.length < capacity) {
        // 신청자가 모자람: 신청자 전원 확정 + 안 한 사람 중 우선순위 높은 사람 픽
        toConfirm = sortedApplicants;
        const needed = capacity - applicants.length;
        toAdd = sortedNonApplicants.slice(0, needed);
    } else {
        // 딱 맞음
        toConfirm = sortedApplicants;
    }

    renderSmartCalcResult(toConfirm, toDecline, toAdd, capacity, applicants.length);
}

function renderSmartCalcResult(toConfirm, toDecline, toAdd, capacity, appCount) {
    const area = document.getElementById('smart-calc-result-area');
    area.classList.remove('hidden');

    let html = `<div class="text-xs text-gray-700 font-medium space-y-3 mb-4">`;
    html += `<div class="flex justify-between border-b border-indigo-100 pb-2"><span>설정 정원: <b class="text-emerald-600">${capacity}명</b></span> <span>현재 신청자: <b>${appCount}명</b></span></div>`;
    
    const finalConfirmed = [...toConfirm, ...toAdd];
    html += `<div><span class="text-emerald-700 font-bold">✅ 최종 확정 추천 (${finalConfirmed.length}명)</span><div class="mt-1.5 flex flex-wrap gap-1.5">`;
    finalConfirmed.forEach(m => {
        const yCount = currentYearlyStats.get(m) || 0;
        const isNew = toAdd.includes(m);
        const badgeClass = isNew ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
        const icon = isNew ? '➕' : '✔️';
        html += `<span class="border px-1.5 py-0.5 rounded text-[11px] ${badgeClass}">${icon} ${m} (누적 ${yCount}회)</span>`;
    });
    html += `</div></div>`;

    if (toDecline.length > 0) {
        html += `<div class="pt-1"><span class="text-red-600 font-bold">➖ 정원 초과로 대기 전환 (${toDecline.length}명)</span><br><span class="text-gray-400 text-[10px]">누적 횟수가 상대적으로 많아 대기 상태가 됩니다.</span><div class="mt-1 flex flex-wrap gap-1.5">`;
        toDecline.forEach(m => html += `<span class="bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded text-[11px] line-through">${m} (누적 ${currentYearlyStats.get(m)||0}회)</span>`);
        html += `</div></div>`;
    }

    if(toAdd.length === 0 && toDecline.length === 0) {
         html += `<div class="text-blue-600 font-bold py-1">인원이 정원과 일치하여 전원 확정 추천합니다.</div>`;
    }
    
    html += `</div>`;
    html += `<button id="apply-smart-calc-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-lg shadow-md transition text-sm flex justify-center items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                추천안 일괄 적용하기
             </button>`;

    area.innerHTML = html;
    
    // 일괄 적용을 위해 데이터 캐싱
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
        // 1. 제외자 처리 (대기로 강등)
        for (const m of toDecline) {
            const req = reqs.find(r => r.member === m);
            if (req && req.status === 'confirmed') {
                await updateDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', req.id), { status: 'requested', confirmedAt: null });
            }
        }
        // 2. 확정자 유지/승격
        for (const m of toConfirm) {
            const req = reqs.find(r => r.member === m);
            if (req && req.status !== 'confirmed') {
                await updateDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests', req.id), { status: 'confirmed', confirmedAt: new Date().toISOString() });
            }
        }
        // 3. 신규 인원 강제 차출 (확정 등록)
        for (const m of toAdd) {
            await createRequest(currentManageDateStr, m, 'confirmed');
        }

        showToast("스마트 배분이 성공적으로 적용되었습니다.");
        document.getElementById('smart-calc-result-area').classList.add('hidden');
        smartCalcCache = null;
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

// ===============================================

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
    const input = document.getElementById('admin-date-add-member');
    const memberName = input.value.trim();

    if (!memberName) {
        showToast("추가할 이름을 입력하세요.", true);
        return;
    }

    await createRequest(currentManageDateStr, memberName, 'confirmed');
    showToast(`${memberName}님 추가 완료`);
    input.value = '';
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