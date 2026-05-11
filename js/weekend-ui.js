// === js/weekend-ui.js ===
import * as State from './state.js';
import { store } from './weekend-store.js';
import { handleDateClick } from './weekend-core.js';
import { openAdminDatePopup, openPastDateEditPopup, handleAdminBadgeClick } from './weekend-admin.js';

export function renderWeekendStats(memberStats, yearlyStatsMap) {
    const sidebar = document.getElementById('weekend-stats-sidebar');
    const list = document.getElementById('weekend-stats-list');
    
    if (!sidebar || !list) return;

    const excludedMembers = ['박영철', '박호진', '유아라', '이승운'];
    
    const filteredMembers = [...memberStats.entries()].filter(([name, counts]) => !excludedMembers.includes(name));

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

export function renderWeekendList(year, month) {
    const listView = document.getElementById('weekend-list-view');
    const label = document.getElementById('current-month-label');
    
    if (!listView || !label) return;

    label.textContent = `${year}년 ${month + 1}월`;
    listView.innerHTML = '';

    const lastDate = new Date(year, month + 1, 0).getDate();
    let hasWeekend = false;
    const isAdmin = (State.appState.currentUserRole === 'admin');

    const bulkBar = document.getElementById('admin-bulk-action-bar');
    if (bulkBar) {
        if (isAdmin) {
            bulkBar.classList.remove('hidden');
            bulkBar.classList.add('flex');
            const selAllCb = document.getElementById('select-all-dates-checkbox');
            if (selAllCb) selAllCb.checked = false;
        } else {
            bulkBar.classList.add('hidden');
            bulkBar.classList.remove('flex');
        }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let d = 1; d <= lastDate; d++) {
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay();

        if (dayOfWeek === 0 || dayOfWeek === 6) {
            hasWeekend = true;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayName = dayOfWeek === 0 ? '일' : '토';
            
            const isBlocked = store.blockedDatesSet.has(dateStr);
            const isAppliedByMe = store.myRequestsMap.has(dateStr);
            const capacity = store.capacityMap.get(dateStr); 
            const isPast = dateObj < today;

            let dayColor = dayOfWeek === 0 ? 'text-red-600' : 'text-blue-600';
            let bgColor = dayOfWeek === 0 ? 'bg-red-50' : 'bg-blue-50';

            const rowItem = document.createElement('div');
            rowItem.className = 'flex flex-row items-stretch gap-2 p-1.5 rounded-lg border shadow-sm hover:shadow-md transition-all mb-2';
            
            // 🔥 [핵심 수정] isBlocked 이거나 isPast 인 경우 어둡게(grayscale, opacity 등) 처리
            if (isPast || isBlocked) rowItem.classList.add('bg-gray-50', 'opacity-80', 'grayscale');
            else rowItem.classList.add('bg-white');

            rowItem.id = `row-${dateStr}`;

            if (isAdmin) {
                const chkWrapper = document.createElement('div');
                chkWrapper.className = 'flex items-center justify-center pl-2 pr-1';
                chkWrapper.onclick = (e) => e.stopPropagation();
                chkWrapper.innerHTML = `<input type="checkbox" class="date-select-checkbox w-4 h-4 cursor-pointer text-blue-600 border-gray-300 rounded" data-date="${dateStr}">`;
                rowItem.appendChild(chkWrapper);
            }

            const dateArea = document.createElement('div');
            dateArea.className = `w-[64px] md:w-[76px] flex-shrink-0 flex flex-col items-center justify-center rounded-md border overflow-hidden select-none`;
            
            // 🔥 [핵심 수정] isBlocked 도 isPast 와 동일하게 회색 배경 적용
            if (isPast || isBlocked) {
                dateArea.classList.add('bg-gray-200', 'text-gray-500', 'border-gray-300');
            } else {
                dateArea.classList.add(bgColor, dayColor);
            }

            if (isAdmin && !isPast) {
                dateArea.classList.add('cursor-pointer', 'hover:opacity-80', 'hover:ring-2', 'hover:ring-indigo-300', 'transition-all');
                dateArea.title = "설정 변경";
                dateArea.onclick = () => openAdminDatePopup(dateStr);
            }
            
            dateArea.innerHTML = `
                <span class="text-[17px] md:text-xl font-black tracking-tight mt-1 md:mt-2">${d}.${dayName}</span>
                ${capacity ? `<span class="mt-1 mb-1 md:mb-2 text-[9px] md:text-[10px] font-bold ${(isPast || isBlocked) ? 'bg-gray-300 text-gray-600 border-gray-400' : 'bg-emerald-100 text-emerald-700 border-emerald-200'} px-1.5 py-0.5 rounded border">정원 ${capacity}</span>` : '<span class="h-1 md:h-2"></span>'}
            `;

            const rightArea = document.createElement('div');
            rightArea.className = 'flex-1 flex flex-col justify-center rounded-md border p-2 transition-colors relative';
            const rightHeader = document.createElement('div');
            rightHeader.className = "flex justify-between items-center text-[10px] md:text-xs mb-1.5";

            if (isPast) {
                // 이미 위에서 전체 row에 grayscale/opacity를 적용했으므로, 여기서는 배경색/커서만 처리
                rightArea.classList.add('bg-gray-100', 'border-gray-300');
                if (isAdmin) {
                    rightArea.classList.add('cursor-pointer', 'hover:bg-gray-200');
                    rightArea.onclick = () => openPastDateEditPopup(dateStr);
                    rightHeader.innerHTML = `<span class="text-blue-600 font-bold">🛠️ 터치하여 인원 편집 (관리자)</span><span class="text-gray-600 font-bold bg-gray-200 px-1.5 rounded border border-gray-300">마감됨</span>`;
                } else {
                    rightArea.classList.add('cursor-not-allowed');
                    rightArea.onclick = () => showToast("지나간 주차는 관리자만 편집할 수 있습니다.", true);
                    rightHeader.innerHTML = `<span class="text-gray-500 font-bold">마감된 주차입니다.</span><span class="text-gray-500 font-bold bg-gray-200 px-1.5 rounded border border-gray-300">완료됨</span>`;
                }
            } else {
                if (isBlocked) {
                    // 🔥 [핵심 수정] isBlocked 상태의 내부 스타일 재정의
                    rightArea.classList.add('bg-gray-100', 'border-gray-300', 'cursor-not-allowed');
                } else if (isAppliedByMe) {
                    rightArea.classList.add('bg-indigo-50', 'border-indigo-300', 'border-dashed', 'cursor-pointer');
                } else {
                    rightArea.classList.add('bg-white', 'border-gray-200', 'border-dashed', 'hover:bg-gray-50', 'cursor-pointer');
                }

                rightArea.onclick = () => handleDateClick(dateStr, isBlocked);
                
                // 마감됨 텍스트도 회색조로 통일 (기존 빨간색 제거)
                rightHeader.innerHTML = `<span class="text-gray-500 font-medium">영역을 터치하여 신청/취소</span>${isBlocked ? '<span class="text-gray-600 font-bold bg-gray-200 border border-gray-300 px-1.5 rounded">마감됨</span>' : isAppliedByMe ? '<span class="text-indigo-600 font-bold bg-indigo-100 px-1.5 rounded">✅ 신청됨</span>' : ''}`;
            }

            const badgesArea = document.createElement('div');
            badgesArea.className = "flex flex-wrap gap-1.5 items-center justify-end";
            badgesArea.id = `weekend-list-${dateStr}`; 
            badgesArea.style.minHeight = "28px";

            rightArea.appendChild(rightHeader);
            rightArea.appendChild(badgesArea);

            rowItem.appendChild(dateArea);
            rowItem.appendChild(rightArea);
            listView.appendChild(rowItem);

            if (store.requestsByDate[dateStr]) {
                const adminMembers = ['박영철', '박호진', '유아라', '이승운'];
                
                store.requestsByDate[dateStr].sort((a, b) => {
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

                store.requestsByDate[dateStr].forEach(req => {
                    // 과거이거나 마감된 날짜면 뱃지의 상태/스타일도 그에 맞게 렌더링 됨
                    addBadgeToCalendar(dateStr, req, isAdmin && !isPast); 
                });
            }
        }
    }

    if (!hasWeekend) {
        listView.innerHTML = `<div class="text-center text-gray-400 py-10">이 달에는 주말이 없습니다.</div>`;
    }
}

export function addBadgeToCalendar(dateStr, data, isClickableAdmin) {
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

    if (isClickableAdmin) {
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