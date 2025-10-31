// === js/ui/main.js ===

import { formatTimeTo24H, formatDuration } from '../utils.js';

const taskCardStyles = {
    'default': {
        card: ['bg-blue-50', 'border-gray-300', 'text-gray-700', 'shadow-sm'],
        hover: 'hover:border-blue-500 hover:shadow-md',
        subtitle: 'text-gray-500',
        buttonBgOff: 'bg-gray-200',
        buttonTextOff: 'text-gray-500'
    },
    'ongoing': {
        card: ['bg-blue-100', 'border-blue-500', 'text-gray-900', 'shadow-xl', 'shadow-blue-200/50'], // 진행 중 강조
        hover: 'hover:border-blue-600',
        subtitle: 'text-gray-600',
        buttonBgOn: 'bg-blue-600',
        buttonTextOn: 'text-white',
        buttonHoverOn: 'hover:bg-blue-700'
    },
    'paused': {
        card: ['bg-yellow-50', 'border-yellow-300', 'text-yellow-800', 'shadow-md', 'shadow-yellow-100/50'],
        hover: 'hover:border-yellow-400 hover:shadow-lg',
        title: 'text-yellow-800',
        subtitle: 'text-yellow-700',
        buttonBgOn: 'bg-yellow-600',
        buttonTextOn: 'text-white',
        buttonHoverOn: 'hover:bg-yellow-700'
    }
};
const taskTitleColors = {
    '국내배송': 'text-green-700',
    '중국제작': 'text-purple-700',
    '직진배송': 'text-emerald-700',
    '채우기': 'text-sky-700',
    '개인담당업무': 'text-indigo-700',
    '티니': 'text-red-700',
    '택배포장': 'text-orange-700',
    '해외배송': 'text-cyan-700',
    '재고조사': 'text-fuchsia-700',
    '앵글정리': 'text-amber-700',
    '상품재작업': 'text-yellow-800',
    '상.하차': 'text-stone-700',
    '검수': 'text-teal-700',
    '아이롱': 'text-violet-700',
    '오류': 'text-rose-700',
    '강성': 'text-pink-700',
    '2층업무': 'text-neutral-700',
    '재고찾는시간': 'text-lime-700',
    '매장근무': 'text-blue-700',
    '출장': 'text-gray-700',
    'default': 'text-blue-700'
};


// ✅ [수정] renderRealtimeStatus (모든 근태 카드에 data-action="edit-leave-record" 추가)
export const renderRealtimeStatus = (appState, teamGroups = [], keyTasks = []) => {
    // === ✅ [수정] 현재 사용자 정보 가져오기 (함수 상단으로 이동) ===
    const currentUserRole = appState.currentUserRole || 'user';
    const currentUserName = appState.currentUser || null;
    // ----------------------------------------------------

    const teamStatusBoard = document.getElementById('team-status-board');
    if (!teamStatusBoard) {
        console.error("Element #team-status-board not found!");
        return;
    }
    teamStatusBoard.innerHTML = '';

    const memberGroupMap = new Map();
    teamGroups.forEach(group => group.members.forEach(member => {
        if (!memberGroupMap.has(member)) memberGroupMap.set(member, group.name);
    }));

    // --- Section 1: Preset Task Quick Actions ---
    const presetTaskContainer = document.createElement('div');
    presetTaskContainer.className = 'mb-6';
    
    // ✅ [수정] "주요 업무" 헤더 텍스트(h3) 삭제, 버튼만 남김
    presetTaskContainer.innerHTML = `
        <div class="flex justify-end items-center border-b pb-2 mb-4 md:hidden">
            <button id="toggle-all-tasks-mobile" 
                    class="md:hidden bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-xs py-1 px-2 rounded-md transition active:scale-[0.98]">
                전체보기
            </button>
        </div>`;

    const presetGrid = document.createElement('div');
    // ✅ [수정] 그리드 컬럼 설정 변경 및 ID 추가
    presetGrid.className = 'grid grid-cols-1 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4';
    presetGrid.id = 'preset-task-grid'; // 👈 [추가] ID 추가

    const baseTasks = keyTasks.length > 0 ? keyTasks : ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];
    
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const activeTaskNames = new Set(ongoingRecords.map(r => r.task));
    
    const tasksToRender = [...new Set([...baseTasks, ...activeTaskNames])];

    tasksToRender.forEach(task => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task);
        // ✅ [수정] 현재 유저가 이 업무를 하는지 확인
        const isCurrentUserWorkingOnThisTask = groupRecords.some(r => r.member === currentUserName);

        const isPaused = groupRecords.length > 0 && groupRecords.every(r => r.status === 'paused');
        const isOngoing = groupRecords.some(r => r.status === 'ongoing');

        let currentStyle;
        if (isPaused) {
            currentStyle = taskCardStyles['paused'];
        } else if (isOngoing || groupRecords.length > 0) {
            currentStyle = taskCardStyles['ongoing'];
        } else {
            currentStyle = taskCardStyles['default'];
        }

        const titleClass = isPaused ? currentStyle.title : (taskTitleColors[task] || taskTitleColors['default']);

        // ✅ [수정] 모바일 반응형 클래스 (토글을 위한 'mobile-task-hidden' 클래스 추가)
        const mobileVisibilityClass = isCurrentUserWorkingOnThisTask ? 'flex' : 'hidden md:flex mobile-task-hidden';
        
        // 🚨 [수정] 카드 자체의 cursor-pointer 제거 (하위 요소에서 클릭 처리)
        card.className = `p-3 rounded-lg border ${mobileVisibilityClass} flex-col justify-between min-h-[300px] transition-all duration-200 ${currentStyle.card.join(' ')} ${currentStyle.hover}`;


        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0]; // 대표 레코드 (그룹 ID, 태스크 이름 등)

            let membersHtml = '<div class="space-y-1 overflow-y-auto max-h-48 members-list">';
            groupRecords.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(rec => {

                const isRecPaused = rec.status === 'paused';

                const memberTextColor = isRecPaused ? 'text-yellow-800' : 'text-gray-800';
                const timeTextColor = isRecPaused ? 'text-yellow-600' : 'text-gray-500';
                const stopButtonBg = isRecPaused ? 'bg-yellow-200 hover:bg-yellow-300' : 'bg-red-100 hover:bg-red-200';
                const stopButtonText = isRecPaused ? 'text-yellow-700' : 'text-red-700';
                const memberRowBg = isRecPaused ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50';

                const pauseIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>`;
                const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.25l14.25 6.75-14.25 6.75V5.25z" /></svg>`;
                
                let pauseResumeButtonHtml = '';
                if (rec.status === 'ongoing') {
                    // 정지 버튼 (Pause 아이콘)
                    pauseResumeButtonHtml = `<button data-action="pause-individual" title="정지" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-yellow-100 hover:bg-yellow-200 text-yellow-700 transition">${pauseIcon}</button>`;
                } else if (rec.status === 'paused') {
                    // 재개 버튼 (Play 아이콘)
                    pauseResumeButtonHtml = `<button data-action="resume-individual" title="재개" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-green-100 hover:bg-green-200 text-green-700 transition">${playIcon}</button>`;
                }
                
                membersHtml += `
                <div class="text-sm ${memberRowBg} rounded p-1 group flex justify-between items-center member-row"
                    data-record-id="${rec.id}"
                    data-group-id="${rec.groupId || ''}">

                    <span class="font-semibold ${memberTextColor} break-keep mr-1 inline-block text-left" title="${rec.member}">${rec.member}</span>
                    <span class="text-xs ${timeTextColor} flex-grow text-center">(${formatTimeTo24H(rec.startTime)}) ${isRecPaused ? '(휴식중)' : ''}</span>
                    
                    <div class="flex-shrink-0 flex items-center space-x-1 member-actions">
                        ${pauseResumeButtonHtml}

                        <button data-action="stop-individual" title="종료" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-200 text-red-700 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        
                        <button data-action="edit-individual-start-time" title="시작 시간 변경" data-record-id="${rec.id}" data-current-start-time="${rec.startTime || ''}" class="w-7 h-7 flex items-center justify-center rounded-full bg-blue-100 hover:bg-blue-200 text-blue-700 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </button>
                        
                    </div>
                </div>`;
            });
            membersHtml += '</div>';

            const earliestStartTime = groupRecords.reduce((earliest, current) => ((current.startTime && (!earliest || current.startTime < earliest)) ? current.startTime : earliest), null);
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime) || groupRecords[0];
            const recordIdForDuration = representativeRecord ? representativeRecord.id : groupRecords[0].id;
            const pauses = representativeRecord ? representativeRecord.pauses : [];
            const pausesJson = JSON.stringify(pauses || []);
            const durationStatus = isOngoing ? 'ongoing' : 'paused';
            const stopBtnClass = `bg-red-600 hover:bg-red-700 text-white`;

            // ✅ [수정] 그룹 시간 표시 부분을 div로 감싸고 data-* 속성 추가
            const groupTimeDisplayHtml = `
                <div class="text-xs ${currentStyle.subtitle} my-2 cursor-pointer group-time-display" 
                     data-action="edit-group-start-time" 
                     data-group-id="${firstRecord.groupId}" 
                     data-current-start-time="${earliestStartTime || ''}">
                    시작: ${formatTimeTo24H(earliestStartTime)} 
                    <span class="ongoing-duration" 
                          data-start-time="${earliestStartTime || ''}" 
                          data-status="${durationStatus}" 
                          data-record-id="${recordIdForDuration || ''}"
                          data-pauses-json='${pausesJson}'></span>
                </div>`;

            card.innerHTML = `<div class="flex flex-col h-full">
                                <div class="font-bold text-lg ${titleClass} break-keep">${firstRecord.task} ${isPaused ? ' (일시정지)' : ''}</div>
                                ${groupTimeDisplayHtml} 
                                <div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">${groupRecords.length}명 참여중:</div>
                                <div class="flex-grow">${membersHtml}</div>
                                <div class="mt-auto flex gap-2 pt-2 card-actions"
                                     data-group-id="${firstRecord.groupId}"
                                     data-task="${firstRecord.task}">

                                    <button class="add-member-btn flex-1 aspect-square flex flex-col items-center justify-center bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition text-xs font-semibold p-1 shadow-sm"
                                            data-action="add-member"
                                            data-group-id="${firstRecord.groupId}"
                                            data-task="${firstRecord.task}">
                                        <span class="text-center leading-tight">인원<br>추가</span>
                                    </button>

                                    <button data-group-id="${firstRecord.groupId}" class="${isPaused ? 'resume-work-group-btn bg-green-500 hover:bg-green-600' : 'pause-work-group-btn bg-yellow-500 hover:bg-yellow-600'} flex-1 aspect-square flex flex-col items-center justify-center text-white rounded-lg transition text-xs font-semibold p-1 shadow-sm">
                                        ${isPaused
                                            ? `<span class="text-center leading-tight">전체<br>재개</span>`
                                            : `<span class="text-center leading-tight">전체<br>정지</span>`
                                        }
                                    </button>

                                    <button data-group-id="${firstRecord.groupId}" class="stop-work-group-btn ${stopBtnClass} flex-1 aspect-square flex flex-col items-center justify-center text-white rounded-lg transition text-xs font-semibold p-1 shadow-sm">
                                        <span class="text-center leading-tight">전체<br>종료</span>
                                    </button>
                                </div>
                            </div>`;
        } else {
             // 🚨 [수정] 시작 전 카드는 클릭 가능하도록 cursor-pointer 유지, data-* 속성 추가
            card.className = `p-3 rounded-lg border ${mobileVisibilityClass} flex-col justify-between min-h-[300px] transition-all duration-200 cursor-pointer ${currentStyle.card.join(' ')} ${currentStyle.hover}`;
            card.dataset.action = 'start-task';
            card.dataset.task = task;

            card.innerHTML = `
                <div class="flex-grow">
                    <div class="font-bold text-lg ${titleClass} break-keep">${task}</div>
                    <div class="text-xs ${currentStyle.subtitle} my-2">시작: 시작 전</div>
                    <div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">참여 인원 (0명):</div>
                    <div class="text-xs ${currentStyle.subtitle} italic flex-grow flex items-center justify-center text-center">카드를 클릭하여 팀원 선택</div>
                </div>
                <div class="mt-auto flex gap-2 pt-2">
                    <div class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-semibold p-1 opacity-50 cursor-not-allowed">
                        <span class="text-center leading-tight">인원<br>추가</span>
                    </div>
                    <div class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-semibold p-1 opacity-50 cursor-not-allowed">
                        <span class="text-center leading-tight">전체<br>정지</span>
                    </div>
                    <div class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-semibold p-1 opacity-50 cursor-not-allowed">
                        <span class="text-center leading-tight">전체<br>종료</span>
                    </div>
                </div>
            `;
        }
        presetGrid.appendChild(card);
    });

    const otherTaskCard = document.createElement('div');
    const otherStyle = taskCardStyles['default'];
    // ✅ [수정] '기타 업무' 카드는 모바일에서도 항상 보이도록 'flex' 유지
    otherTaskCard.className = `p-3 rounded-lg border flex flex-col justify-center items-center min-h-[300px] transition-all duration-200 cursor-pointer ${otherStyle.card.join(' ')} ${otherStyle.hover}`;
    otherTaskCard.dataset.action = 'other';
    otherTaskCard.innerHTML = `
        <div class="font-bold text-lg text-gray-700">기타 업무</div>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400 mt-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div class="text-xs text-gray-500 mt-3">새로운 업무 시작</div>
    `;
    presetGrid.appendChild(otherTaskCard);
    presetTaskContainer.appendChild(presetGrid);
    teamStatusBoard.appendChild(presetTaskContainer);


    // --- Section 2: ALL TEAM MEMBER STATUS ---
    const allMembersContainer = document.createElement('div');
    allMembersContainer.id = 'all-members-container'; // ✅ [추가] 토글을 위한 ID
    
    const allMembersHeader = document.createElement('div');
    // ✅ [수정] 모바일에서도 헤더가 보이도록 'hidden' 클래스 제거, 토글 버튼 추가
    allMembersHeader.className = 'flex justify-between items-center border-b pb-2 mb-4 mt-8';
    allMembersHeader.innerHTML = `
        <h3 class="text-lg font-bold text-gray-700 hidden md:block">전체 팀원 현황 (클릭하여 근태 설정/취소/수정)</h3>
        <h3 class="text-lg font-bold text-gray-700 md:hidden">팀원 현황</h3>
        <button id="toggle-all-members-mobile"
                class="md:hidden bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-xs py-1 px-2 rounded-md transition active:scale-[0.98]">
            전체보기
        </button>
    `;
    allMembersContainer.appendChild(allMembersHeader);

    const ongoingRecordsForStatus = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const workingMembers = new Map(ongoingRecordsForStatus.map(r => [r.member, r.task]));
    const pausedMembers = new Map((appState.workRecords || []).filter(r => r.status === 'paused').map(r => [r.member, r.task]));

    const combinedOnLeaveMembers = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
    const onLeaveStatusMap = new Map(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime))
            .map(item => [item.member, item])
    );

    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'),
        teamGroups.find(g => g.name === '공통파트'),
        teamGroups.find(g => g.name === '담당파트'),
        teamGroups.find(g => g.name === '제작파트'),
    ].filter(Boolean);


    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        // ✅ [수정] 모바일에서 그룹 전체 숨김 ('hidden md:block') -> ('mb-4')
        groupContainer.className = 'mb-4'; // 이 컨테이너는 항상 보이도록 수정
        const groupHeader = document.createElement('div');
        // ✅ [수정] 모바일에서 그룹 헤더 숨김 ('hidden md:flex')
        groupHeader.className = 'flex items-center gap-2 mb-2 hidden md:flex'; // 헤더만 숨김
        groupHeader.innerHTML = `<h4 class="text-md font-semibold text-gray-600">${group.name}</h4>`;
        groupContainer.appendChild(groupHeader);
        const groupGrid = document.createElement('div');
        groupGrid.className = 'flex flex-wrap gap-2';
        const uniqueMembersInGroup = [...new Set(group.members)];

        uniqueMembersInGroup.forEach(member => {
            const card = document.createElement('button');
            card.type = 'button';
            const leaveInfo = onLeaveStatusMap.get(member);
            const isOnLeave = !!leaveInfo;
            const isWorking = workingMembers.has(member) || pausedMembers.has(member);
            const isSelf = (member === currentUserName); // ✅ [추가] 본인 확인

            // === 📌 [재수정] 팀원 카드 className 설정 ===
            // ✅ [수정] 토글을 위해 'mobile-member-hidden' 클래스 추가
            const visibilityClass = isSelf ? 'flex' : 'hidden md:flex mobile-member-hidden'; 
            const widthClass = isSelf ? 'w-full md:w-28' : 'w-28'; 
            card.className = `p-1 rounded-lg border text-center transition-shadow min-h-[72px] ${visibilityClass} ${widthClass} flex-col justify-center`;
            // ============================================

            // ✅ [수정] data-action을 설정 (근태 중이면 edit-leave-record, 아니면 member-toggle-leave)
            card.dataset.memberName = member; // 공통: 이름
            if (isOnLeave) {
                // [수정] 근태 중이면 무조건 수정 모달 열기
                card.dataset.action = 'edit-leave-record'; 
                card.dataset.leaveType = leaveInfo.type;
                card.dataset.startTime = leaveInfo.startTime || ''; // 식별자
                card.dataset.startDate = leaveInfo.startDate || ''; // 식별자
                card.dataset.endTime = leaveInfo.endTime || '';
                card.dataset.endDate = leaveInfo.endDate || '';
                
            } else {
                // [수정] 근태 중이 아니면 근태 설정 모달 열기 (기존)
                card.dataset.action = 'member-toggle-leave'; 
            }
            
            // ✅ [수정] 권한에 따라 커서/투명도 조절 (근태 중일 때도 수정 가능하도록)
            if (!isWorking) {
                // 업무 중이 아닐 때
                if (currentUserRole === 'admin' || isSelf) {
                    // 관리자거나 본인이면 활성화
                    card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
                } else {
                    // 관리자가 아니고 타인이면 비활성화
                    card.classList.add('cursor-not-allowed', 'opacity-70'); 
                }
            } else {
                // 업무 중이면 비활성화
                card.classList.add('opacity-70', 'cursor-not-allowed');
            }

            if (isOnLeave) {
                card.classList.add('bg-gray-200', 'border-gray-300', 'text-gray-500');
                let detailText = '';
                if (leaveInfo.startTime) {
                    detailText = formatTimeTo24H(leaveInfo.startTime);
                    if (leaveInfo.endTime) {
                         detailText += ` - ${formatTimeTo24H(leaveInfo.endTime)}`;
                    } else if (leaveInfo.type === '외출') {
                         detailText += ' ~';
                    }
                }
                else if (leaveInfo.startDate) {
                    detailText = leaveInfo.startDate.substring(5);
                    if (leaveInfo.endDate && leaveInfo.endDate !== leaveInfo.startDate) {
                        detailText += ` ~ ${leaveInfo.endDate.substring(5)}`;
                    }
                }
                card.innerHTML = `<div class="font-semibold text-sm break-keep">${member}</div>
                                  <div class="text-xs">${leaveInfo.type}</div>
                                  ${detailText ? `<div class="text-[10px] leading-tight mt-0.5">${detailText}</div>` : ''}`;
            } else if (workingMembers.has(member)) {
                card.classList.add('bg-red-50', 'border-red-200');
                card.innerHTML = `<div class="font-semibold text-sm text-red-800 break-keep">${member}</div><div class="text-xs text-gray-600 truncate" title="${workingMembers.get(member)}">${workingMembers.get(member)}</div>`;
            } else if (pausedMembers.has(member)) {
                card.classList.add('bg-yellow-50', 'border-yellow-200');
                card.innerHTML = `<div class="font-semibold text-sm text-yellow-800 break-keep">${member}</div><div class="text-xs text-yellow-600">휴식 중</div>`;
            } else {
                card.classList.add('bg-green-50', 'border-green-200');
                card.innerHTML = `<div class="font-semibold text-sm text-green-800 break-keep">${member}</div><div class="text-xs text-green-600">대기 중</div>`;
            }
            groupGrid.appendChild(card);
        });
        groupContainer.appendChild(groupGrid);
        allMembersContainer.appendChild(groupContainer);
    });

    // --- 알바 섹션 ---
    const workingAlbaMembers = new Set((appState.workRecords || []).filter(r => (r.status === 'ongoing' || r.status === 'paused')).map(r => r.member));
    const activePartTimers = (appState.partTimers || []).filter(pt => {
        return workingAlbaMembers.has(pt.name) || onLeaveStatusMap.has(pt.name);
    });

    if (activePartTimers.length > 0) {
        const albaContainer = document.createElement('div');
        // ✅ [수정] 모바일에서 알바 섹션 숨김 ('hidden md:block') -> ('mb-4')
        albaContainer.className = 'mb-4'; // 이 컨테이너는 항상 보이도록 수정
        // ✅ [수정] 모바일에서 알바 헤더 숨김 ('hidden md:block')
        albaContainer.innerHTML = `<h4 class="text-md font-semibold text-gray-600 mb-2 hidden md:block">알바</h4>`; // 헤더만 숨김

        const albaGrid = document.createElement('div');
        albaGrid.className = 'flex flex-wrap gap-2';

        activePartTimers.forEach(pt => {
             const card = document.createElement('button');
             card.type = 'button';
             
             const isSelfAlba = (pt.name === currentUserName); // ✅ [추가] 본인 확인 (알바)

             // === 📌 [재수정] 알바 카드 className 설정 ===
             // ✅ [수정] 토글을 위해 'mobile-member-hidden' 클래스 추가
             const visibilityClassAlba = isSelfAlba ? 'flex' : 'hidden md:flex mobile-member-hidden'; 
             const widthClassAlba = isSelfAlba ? 'w-full md:w-28' : 'w-28'; 
             card.className = `relative p-1 rounded-lg border text-center transition-shadow min-h-[72px] ${visibilityClassAlba} ${widthClassAlba} flex-col justify-center`;
             // ===========================================

             const currentlyWorkingTask = workingMembers.get(pt.name);
             const isPaused = pausedMembers.has(pt.name);
             const albaLeaveInfo = onLeaveStatusMap.get(pt.name);
             const isAlbaOnLeave = !!albaLeaveInfo;
             const isAlbaWorking = currentlyWorkingTask || isPaused;

            // ✅ [수정] data-action을 설정 (근태 중이면 edit-leave-record, 아니면 member-toggle-leave)
            card.dataset.memberName = pt.name; // 공통: 이름
            if (isAlbaOnLeave) {
                // [수정] 근태 중이면 무조건 수정 모달 열기
                card.dataset.action = 'edit-leave-record';
                card.dataset.leaveType = albaLeaveInfo.type;
                card.dataset.startTime = albaLeaveInfo.startTime || ''; // 식별자
                card.dataset.startDate = albaLeaveInfo.startDate || ''; // 식별자
                card.dataset.endTime = albaLeaveInfo.endTime || '';
                card.dataset.endDate = albaLeaveInfo.endDate || '';
            } else {
                // [수정] 근태 중이 아니면 근태 설정 모달 열기 (기존)
                card.dataset.action = 'member-toggle-leave';
            }

             // ✅ [수정] 권한에 따라 커서/투명도 조절 (근태 중일 때도 수정 가능하도록)
             if (!isAlbaWorking) {
                 if (currentUserRole === 'admin' || isSelfAlba) {
                    card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
                 } else {
                    card.classList.add('cursor-not-allowed', 'opacity-70'); // 본인이 아니면 비활성
                 }
             } else {
                 card.classList.add('opacity-70', 'cursor-not-allowed');
             }

             if (isAlbaOnLeave) {
                 card.classList.add('bg-gray-200', 'border-gray-300', 'text-gray-500');
                 let detailText = '';
                  if (albaLeaveInfo.startTime) {
                     detailText = formatTimeTo24H(albaLeaveInfo.startTime);
                     if (albaLeaveInfo.endTime) { detailText += ` - ${formatTimeTo24H(albaLeaveInfo.endTime)}`; }
                     else if (albaLeaveInfo.type === '외출') { detailText += ' ~'; }
                  } else if (albaLeaveInfo.startDate) {
                    detailText = albaLeaveInfo.startDate.substring(5);
                    if (albaLeaveInfo.endDate && albaLeaveInfo.endDate !== albaLeaveInfo.startDate) { detailText += ` ~ ${albaLeaveInfo.endDate.substring(5)}`; }
                  }
                 card.innerHTML = `<div class="font-semibold text-sm break-keep">${pt.name}</div>
                                   <div class="text-xs">${albaLeaveInfo.type}</div>
                                   ${detailText ? `<div class="text-[10px] leading-tight mt-0.5">${detailText}</div>` : ''}`;
             } else if (currentlyWorkingTask) {
                 card.classList.add('bg-red-50', 'border-red-200');
                 card.innerHTML = `<div class="font-semibold text-sm text-red-800">${pt.name}</div><div class="text-xs text-gray-600 truncate" title="${currentlyWorkingTask}">${currentlyWorkingTask}</div>`;
             } else if (isPaused) {
                 card.classList.add('bg-yellow-50', 'border-yellow-200');
                 card.innerHTML = `<div class="font-semibold text-sm text-yellow-800">${pt.name}</div><div class="text-xs text-yellow-600">휴식 중</div>`;
             }
             albaGrid.appendChild(card);
        });
        albaContainer.appendChild(albaGrid);
        allMembersContainer.appendChild(albaContainer);
    }
    
    // ✅ [수정] 직원 현황판(allMembersContainer)은 항상 추가되도록 수정 (내부에서 모바일 숨김 처리)
    teamStatusBoard.appendChild(allMembersContainer);
};

export const renderCompletedWorkLog = (appState) => {
    const workLogBody = document.getElementById('work-log-body');
    if (!workLogBody) return;
    workLogBody.innerHTML = '';
    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    if (!completedRecords || completedRecords.length === 0) {
        workLogBody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-400">완료된 업무가 없습니다.</td></tr>`;
        return;
    }

    const groupedRecords = completedRecords.reduce((acc, record) => {
        if (!acc[record.task]) acc[record.task] = [];
        acc[record.task].push(record);
        return acc;
    }, {});
    const sortedTasks = Object.keys(groupedRecords).sort();

    if (sortedTasks.length === 0) {
        workLogBody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-400">완료된 업무가 없습니다.</td></tr>`;
    } else {
        sortedTasks.forEach(task => {
            const groupHeaderRow = document.createElement('tr');
            groupHeaderRow.className = 'bg-gray-100';
            groupHeaderRow.innerHTML = `<th colspan="6" class="px-6 py-3 text-left text-base text-blue-700 font-bold">${task}</th>`;
            workLogBody.appendChild(groupHeaderRow);
            groupedRecords[task].sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(record => {
                const row = document.createElement('tr');
                row.className = 'bg-white border-b border-gray-200 hover:bg-gray-50';
                row.innerHTML = `<td class="px-6 py-4 font-medium text-gray-900">${record.member || 'N/A'}</td><td class="px-6 py-4">${record.task || 'N/A'}</td><td class="px-6 py-4">${formatTimeTo24H(record.startTime)}</td><td class="px-6 py-4">${formatTimeTo24H(record.endTime)}</td><td class="px-6 py-4">${formatDuration(record.duration)}</td><td class="px-6 py-4 text-right space-x-2"><button data-action="edit" data-record-id="${record.id}" class="font-medium text-blue-500 hover:underline">수정</button><button data-action="delete" data-record-id="${record.id}" class="font-medium text-red-500 hover:underline">삭제</button></td>`;
                workLogBody.appendChild(row);
            });
        });
    }
};