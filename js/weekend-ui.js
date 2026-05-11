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

// 🌟 [수정 없음] 기존의 리스트 형태 렌더링 함수
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
    if (bulkBar && document.getElementById('weekend-list-view').classList.contains('hidden') === false) {
        if (isAdmin) {
            bulkBar.classList.remove('hidden');
            bulkBar.classList.add('flex');
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
                    rightArea.classList.add('bg-gray-100', 'border-gray-300', 'cursor-not-allowed');
                } else if (isAppliedByMe) {
                    rightArea.classList.add('bg-indigo-50', 'border-indigo-300', 'border-dashed', 'cursor-pointer');
                } else {
                    rightArea.classList.add('bg-white', 'border-gray-200', 'border-dashed', 'hover:bg-gray-50', 'cursor-pointer');
                }

                rightArea.onclick = () => handleDateClick(dateStr, isBlocked);
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
                    addBadgeToCalendar(dateStr, req, isAdmin && !isPast); 
                });
            }
        }
    }

    if (!hasWeekend) {
        listView.innerHTML = `<div class="text-center text-gray-400 py-10">이 달에는 주말이 없습니다.</div>`;
    }
}


// 🔥 [신규 추가] 달력 형태 렌더링 함수
export function renderWeekendGrid(year, month) {
    const gridView = document.getElementById('calendar-grid');
    const label = document.getElementById('current-month-label');
    
    if (!gridView || !label) return;

    label.textContent = `${year}년 ${month + 1}월`;
    gridView.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay(); // 해당 월 1일의 요일
    const lastDate = new Date(year, month + 1, 0).getDate(); // 해당 월 마지막 날짜
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isAdmin = (State.appState.currentUserRole === 'admin');

    // 1일 이전의 빈 칸 채우기
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = "bg-transparent p-1";
        gridView.appendChild(emptyCell);
    }

    // 날짜 칸 채우기
    for (let d = 1; d <= lastDate; d++) {
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay();
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        
        const cell = document.createElement('div');
        cell.className = "flex flex-col border rounded-md p-1 min-h-[80px] md:min-h-[100px] overflow-hidden transition-all bg-white relative";
        
        let headerColorClass = "text-gray-700";
        if (dayOfWeek === 0) headerColorClass = "text-red-600";
        if (dayOfWeek === 6) headerColorClass = "text-blue-600";

        // 주말(토,일)일 경우에만 상호작용 및 데이터 표시
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            const isBlocked = store.blockedDatesSet.has(dateStr);
            const isAppliedByMe = store.myRequestsMap.has(dateStr);
            const capacity = store.capacityMap.get(dateStr); 
            const isPast = dateObj < today;

            // 배경/투명도 처리
            if (isPast || isBlocked) {
                cell.classList.add('bg-gray-50', 'opacity-80', 'grayscale', 'border-gray-200');
            } else if (isAppliedByMe) {
                cell.classList.add('bg-indigo-50', 'border-indigo-300', 'border-dashed');
            } else {
                cell.classList.add('hover:bg-blue-50', 'cursor-pointer', 'border-blue-100');
            }

            // 클릭 이벤트 매핑
            if (!isPast) {
                cell.onclick = () => handleDateClick(dateStr, isBlocked);
            } else if (isAdmin) {
                cell.onclick = () => openPastDateEditPopup(dateStr);
                cell.classList.add('cursor-pointer', 'hover:bg-gray-200');
            } else {
                cell.onclick = () => showToast("지나간 주차는 관리자만 편집할 수 있습니다.", true);
            }

            // 헤더 조립 (날짜 숫자, 정원, 관리자설정 아이콘 등)
            let headerHtml = `<div class="flex justify-between items-start mb-1">
                                <span class="font-bold text-xs md:text-sm ${headerColorClass}">${d}</span>`;
            
            let badgesHtml = `<div class="flex flex-col gap-0.5" id="grid-list-${dateStr}">`;

            if (capacity) {
                headerHtml += `<span class="text-[9px] font-bold px-1 py-0.5 rounded border ${(isPast || isBlocked) ? 'bg-gray-200 text-gray-500 border-gray-300' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}">정원 ${capacity}</span>`;
            } else if (isAdmin && !isPast) {
                // 관리자용 설정 톱니바퀴 아이콘
                headerHtml += `<button title="날짜 설정" class="text-gray-400 hover:text-indigo-600 transition p-0.5" onclick="event.stopPropagation(); window.openAdminDatePopup('${dateStr}');">
                                 <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                               </button>`;
                window.openAdminDatePopup = openAdminDatePopup; // 글로벌 스코프 노출
            }

            headerHtml += `</div>`;
            cell.innerHTML = headerHtml + badgesHtml;

            // 데이터 채우기 로직은 setTimeout으로 DOM 부착 후 실행되도록 예약
            setTimeout(() => {
                if (store.requestsByDate[dateStr]) {
                    const adminMembers = ['박영철', '박호진', '유아라', '이승운'];
                    store.requestsByDate[dateStr].sort((a, b) => {
                        if (a.status === 'canceled' && b.status !== 'canceled') return 1;
                        if (a.status !== 'canceled' && b.status === 'canceled') return -1;
                        const aIsAdmin = adminMembers.includes(a.member);
                        const bIsAdmin = adminMembers.includes(b.member);
                        if (aIsAdmin && !bIsAdmin) return 1;  
                        if (!aIsAdmin && bIsAdmin) return -1; 
                        return (a.createdAt || "").localeCompare(b.createdAt || "");
                    });

                    store.requestsByDate[dateStr].forEach(req => {
                        addBadgeToGrid(dateStr, req, isAdmin && !isPast); 
                    });
                }
            }, 0);

        } else {
            // 평일 (회색으로 흐리게 처리)
            cell.classList.add('bg-gray-50', 'border-gray-100');
            cell.innerHTML = `<span class="font-medium text-xs md:text-sm text-gray-400 p-1">${d}</span>`;
        }

        gridView.appendChild(cell);
    }
}

// 캘린더용 초소형 뱃지 생성기
function addBadgeToGrid(dateStr, data, isClickableAdmin) {
    const container = document.getElementById(`grid-list-${dateStr}`);
    if (!container) return;

    const badge = document.createElement('div');
    
    let colorClass = '';

    if (data.status === 'confirmed') {
        colorClass = 'bg-blue-600 text-white';
    } else if (data.status === 'canceled') {
        colorClass = 'bg-yellow-100 text-yellow-700 opacity-70 line-through';
    } else {
        colorClass = 'bg-white text-orange-600 border border-orange-200';
    }
    
    badge.className = `px-1 py-0.5 rounded text-[10px] md:text-[11px] font-medium truncate w-full text-center shadow-sm ${colorClass}`;
    // 모바일 등 폭이 좁을 경우 이름 앞 2글자만 자르거나, 그대로 넣음
    badge.textContent = data.member;
    badge.title = data.status === 'confirmed' ? '확정' : (data.status === 'canceled' ? '취소' : '대기중');

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

// 기존 리스트 뷰용 뱃지 생성 함수 유지
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