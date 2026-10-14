// === js/ui-main-dashboard.js ===
import { getAllDashboardDefinitions } from './ui.js?v=202610141249';
import * as State from './state.js?v=202610141249';
import { getRegularMembersForCount } from './utils.js?v=202610141249';
import { withBuiltinMenus } from './menu-catalog.js?v=202610141249';
import { onEzadminChange, 상태 as ezadmin상태, STALE_분 } from './ezadmin-sync.js?v=202610141249';

// 실시간 인원 현황 행 중 상세 펼침을 지원할 항목들
const EXPANDABLE_ITEMS = new Set(['leave-staff', 'idle-staff', 'working-staff', 'paused-staff', 'ongoing-tasks']);
// 실시간 인원 맨 위 큰 숫자(D안). 관리자가 대시보드 항목에서 빼도 늘 보인다 — 아래 목록에서는 건너뛴다.
const HERO_ITEMS = [
    { key: 'working-staff', label: '업무 중', valueId: 'summary-working-staff', tone: 'is-working' },
    { key: 'idle-staff',    label: '대기',    valueId: 'summary-idle-staff',    tone: 'is-idle' },
    { key: 'paused-staff',  label: '휴식',    valueId: 'summary-paused-staff',  tone: 'is-paused' },
];
const HERO_KEYS = new Set(HERO_ITEMS.map(h => h.key));
// 가장 최근에 계산된 상세 데이터 (호버 툴팁용)
let lastPersonnelDetail = null;

/** 공지 일정 표시용. 지난 일정·오늘·앞으로를 색으로 구분한다.
 *  반환 { text, tone } / 일정이 없으면 null. */
const noticeScheduleLabel = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(v || ''));
    if (!m) return null;
    const [, y, mo, d, hh, mi] = m;
    const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(Number(y), Number(mo) - 1, Number(d)).getDay()];
    const time = (hh && !(hh === '00' && mi === '00')) ? ` ${hh}:${mi}` : '';

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(Number(y), Number(mo) - 1, Number(d));
    const diff = Math.round((day - today) / 86400000);

    // 오늘 = 장미(risk), 1~7일 = 본문색, 그 뒤 = 보조색, 지남 = 흐림 (색은 css/dash-d.css)
    let when = '', tone = 't-1';
    if (diff < 0) { when = ` · ${-diff}일 지남`; tone = 't-3'; }
    else if (diff === 0) { when = ' · 오늘'; tone = 't-risk'; }
    else if (diff === 1) when = ' · 내일';
    else if (diff <= 7) when = ` · ${diff}일 뒤`;
    else tone = 't-2';

    return { text: `${Number(mo)}월 ${Number(d)}일(${wd})${time}${when}`, tone };
};

export const renderNoticeWidget = (appState) => {
    const memoList = document.getElementById('widget-memo-list');
    if (!memoList) return;

    const notices = appState.importantNotices || [];

    const countEl = document.getElementById('widget-notice-count');
    if (countEl) countEl.textContent = notices.length;

    if (notices.length === 0) {
        memoList.innerHTML = `<li class="list-none t-3 text-center text-xs px-3 py-3 font-normal">등록된 중요 공지사항이 없습니다.</li>`;
        return;
    }

    // 일정이 있는 공지를 먼저(이른 날짜순), 일정 없는 것은 최근 등록순으로 뒤에
    const ordered = [...notices].sort((a, b) => {
        if (a.scheduleAt && b.scheduleAt) return a.scheduleAt.localeCompare(b.scheduleAt);
        if (a.scheduleAt) return -1;
        if (b.scheduleAt) return 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    let html = '';
    ordered.forEach(notice => {
        // 완료한 공지는 취소선 + 흐림 (예전 ✅/📌 아이콘은 D안에서 뺐다)
        const textClass = notice.completed ? 'line-through t-3' : 't-1 font-medium';

        const safeText = notice.text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');

        const mentionStyle = '<span class="inline-block d-mention align-baseline leading-tight">@$1</span>';
        const highlightedText = safeText.replace(/@([가-힣a-zA-Z0-9]+)/g, mentionStyle);

        const sched = noticeScheduleLabel(notice.scheduleAt);
        const schedHtml = sched ? `<span class="block mt-1 text-xs font-semibold ${sched.tone}">${sched.text}</span>` : '';

        html += `<li class="${textClass} list-none flex items-start gap-2 px-3 py-2"><span class="leading-snug break-words flex-1">${highlightedText}${schedHtml}</span></li>`;
    });
    memoList.innerHTML = html;
};

/** 지금 무엇을 보여 줄지 고른다.
 *
 *  값은 Firestore(상주 수집기, 앱\이지어드민연동) 하나뿐이다. 오래됐으면 흐리게 + 사유.
 *  (예전 Chrome 확장 ezadmin-bridge 의 postMessage 폴백은 2026-10-14 확장 폐기로 삭제했다.)
 */
const EZ사유문구 = {
    'not-logged-in': '이지어드민 로그인 끊김',
    'no-element': '이지어드민 화면이 바뀜',
    'partial-element': '이지어드민 화면이 일부 바뀜',
    'empty-value': '숫자를 못 읽음',
    'nav-failed': '화면 접속 실패',
};

const ezadmin표시값 = () => {
    const fs = ezadmin상태();
    if (fs.있음 && !fs.오래됨) {
        return { invoice: fs.invoice, delivery: fs.delivery,
                 라벨: fs.라벨, 흐림: false, 출처: '' };
    }
    if (fs.있음) {
        // Firestore 값이 오래됐다 — 왜 그런지(error)를 같이 알려 줘야 조치가 갈린다.
        const 사유 = !fs.ok && fs.error
            ? (EZ사유문구[fs.error] || fs.error)
            : '수집기 멈춤?';
        return { invoice: fs.invoice, delivery: fs.delivery,
                 라벨: `${fs.라벨 || `${STALE_분}분 넘게 갱신 없음`} · ${사유}`,
                 흐림: true, 사유 };
    }
    // ★ 숫자는 없지만 '왜 없는지' 는 알 때가 있다 — 수집기가 한 번도 성공하지 못한 경우다
    //   (화면 개편이면 invoice·delivery·lastOkAt 이 아예 안 쓰인다).
    //   그걸 '연동 대기 중' 으로 보여 주면 "아직 안 켰다" 로 읽혀 아무도 손대지 않는다.
    if (fs.ok === false && fs.error) {
        return { invoice: null, delivery: null,
                 라벨: EZ사유문구[fs.error] || fs.error, 흐림: true,
                 사유: '수집기가 숫자를 한 번도 읽지 못했습니다' };
    }
    return null;          // 아직 아무 값도 없다 → '연동 대기 중'
};

export const updateEzadminDisplay = () => {
    const invoiceEl = document.getElementById('ezadmin-invoice-count');
    const deliveryEl = document.getElementById('ezadmin-delivery-count');
    const 라벨El = document.getElementById('ezadmin-asof');
    if (!invoiceEl && !deliveryEl && !라벨El) return;

    const v = ezadmin표시값();
    if (v && v.invoice == null) {
        // 사유는 아는데 숫자는 없는 상태 — 숫자 자리는 비우고 사유를 장미색(is-warn)으로 보여 준다.
        if (invoiceEl) { invoiceEl.textContent = '–'; invoiceEl.classList.add('opacity-50'); }
        if (deliveryEl) { deliveryEl.textContent = '–'; deliveryEl.classList.add('opacity-50'); }
        if (라벨El) {
            라벨El.textContent = v.라벨;
            라벨El.className = 'ez-asof is-warn mt-1.5';
            라벨El.title = [v.사유, '앱 폴더의 이지어드민연동/로그 를 확인하세요.']
                .filter(Boolean).join('\n');
        }
        return;
    }
    if (!v) {
        // 0 을 보여 주면 '송장 0건' 과 구분이 안 된다. 아예 숫자를 안 쓴다.
        if (invoiceEl) invoiceEl.textContent = '–';
        if (deliveryEl) deliveryEl.textContent = '–';
        if (라벨El) {
            라벨El.textContent = '연동 대기 중';
            라벨El.className = 'ez-asof mt-1.5';
        }
        return;
    }

    // D안: 값이 바뀔 때 커지며 색이 번쩍이던 효과는 뺐다. 오래된 값만 흐리게 둔다.
    const 칠하기 = (el, n) => {
        if (!el) return;
        el.textContent = n.toLocaleString();
        el.classList.toggle('opacity-50', !!v.흐림);
    };
    칠하기(invoiceEl, v.invoice);
    칠하기(deliveryEl, v.delivery);

    if (라벨El) {
        라벨El.textContent = v.라벨;
        라벨El.className = 'ez-asof mt-1.5' + (v.흐림 ? ' is-warn' : '');
        const 도움 = [v.사유, '숫자는 마지막으로 읽은 값입니다.',
                     '앱 폴더의 이지어드민연동/로그 를 확인하세요.'].filter(Boolean);
        라벨El.title = v.흐림 ? 도움.join('\n') : '';
    }
};

// Firestore 값이 바뀌거나 '몇 분 전' 이 흘러가면 다시 그린다.
onEzadminChange(() => { try { updateEzadminDisplay(); } catch (e) {} });

export const renderDashboardLayout = (appConfig) => {
    const personnelContainer = document.getElementById('summary-personnel');
    const workloadContainer = document.getElementById('summary-workload');
    
    if (!personnelContainer && !workloadContainer) return;

    const itemIds = appConfig.dashboardItems || [];
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    // 큰 숫자(업무 중·대기·휴식) — 누르면 아래에 명단이 펼쳐진다(상세 칸은 data-detail-content 로 찾는다)
    let personnelHtml = `
        <div class="d-hero">
            ${HERO_ITEMS.map(h => `
            <div class="personnel-row d-hero-item ${h.tone}" data-detail-key="${h.key}">
                <div class="d-hero-label">${h.label}</div>
                <div id="${h.valueId}" class="d-hero-num">0</div>
            </div>`).join('')}
        </div>
        ${HERO_ITEMS.map(h => `<div class="personnel-detail hidden" data-detail-content="${h.key}"></div>`).join('')}
    `;
    let workloadHtml = '';

    itemIds.forEach(id => {
        const def = allDefinitions[id];
        if (!def) return;

        const isQuantity = def.isQuantity === true;
        if (!isQuantity && HERO_KEYS.has(id)) return;   // 위 큰 숫자로 이미 보인다
        // 라벨-값 한 줄 목록이라 제목 안의 줄바꿈(<br>)은 띄어쓰기로 편다
        const safeTitle = def.title.replace(/<br\s*\/?>/gi, ' ').replace(/ /g, '&nbsp;');

        if (isQuantity) {
            workloadHtml += `
                <div class="d-kv d-kv-lg overflow-hidden">
                    <span class="d-kv-label whitespace-nowrap shrink-0 break-keep">${safeTitle}</span>
                    <span id="${def.valueId}" class="d-kv-val shrink-0">0</span>
                </div>
            `;
        } else if (EXPANDABLE_ITEMS.has(id)) {
            personnelHtml += `
                <div class="personnel-row d-kv is-x select-none" data-detail-key="${id}">
                    <div class="d-kv-line">
                        <span class="d-kv-label whitespace-nowrap shrink-0 break-keep">${safeTitle}</span>
                        <span id="${def.valueId}" class="d-kv-val shrink-0">0</span>
                    </div>
                    <div class="personnel-detail hidden" data-detail-content="${id}"></div>
                </div>
            `;
        } else {
            personnelHtml += `
                <div class="d-kv overflow-hidden">
                    <span class="d-kv-label whitespace-nowrap shrink-0 break-keep">${safeTitle}</span>
                    <span id="${def.valueId}" class="d-kv-val shrink-0">0</span>
                </div>
            `;
        }
    });

    // 첫 그림은 빈 칸으로 두고, 아래 updateEzadminDisplay() 가 실제 값을 채운다.
    // (0 을 먼저 그리면 '송장 0건' 처럼 보인다)

    workloadHtml += `
        <div class="d-sub mt-3 px-4 py-3">
            <div class="text-[13px] font-semibold t-1">이지어드민 연동</div>
            <div class="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
                <span class="whitespace-nowrap"><span class="t-2">송장</span> <span id="ezadmin-invoice-count" class="ez-num">–</span></span>
                <span class="whitespace-nowrap"><span class="t-2">배송</span> <span id="ezadmin-delivery-count" class="ez-num">–</span></span>
            </div>
            <div id="ezadmin-asof" class="ez-asof mt-1.5"></div>
        </div>
    `;

    if (personnelContainer) personnelContainer.innerHTML = personnelHtml;
    if (workloadContainer) workloadContainer.innerHTML = workloadHtml;

    // ⚠️ 위에서 workloadContainer 를 통째로 갈아끼웠다 — 방금 만든 element 는 새것이고
    //    숫자·라벨이 비어 있다. 그려 넣지 않으면 30초마다 '–' 로 깜빡인다.
    try { updateEzadminDisplay(); } catch (e) {}
};

export const updateSummary = (appState, appConfig) => {
    const allDefinitions = getAllDashboardDefinitions(appConfig);
    const elements = {};
    Object.keys(allDefinitions).forEach(id => {
        const def = allDefinitions[id];
        if (def && def.valueId) {
            elements[id] = document.getElementById(def.valueId);
        }
    });

    // 정직원 인원 카운트는 (1) 중복 제거, (2) 프로그램 전용 ID 제외 — getRegularMembersForCount 사용.
    const allStaffMembers = getRegularMembersForCount(appConfig);
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));
    const totalStaffCount = allStaffMembers.size;
    const totalPartTimerCount = allPartTimers.size;

    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
    const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];

    const onLeaveMemberNames = new Set(
        combinedOnLeaveMembers
            .filter(item => {
                if (item.type === '외출' && item.endTime) return false;
                if (item.type === '지각') return false;
                return allStaffMembers.has(item.member) || allPartTimers.has(item.member);
            })
            .map(item => item.member)
    );
    const onLeaveTotalCount = onLeaveMemberNames.size;

    const attendanceMap = appState.dailyAttendance || {};
    const currentlyClockedIn = new Set(
        Object.keys(attendanceMap).filter(member => 
            attendanceMap[member].status === 'active' && !onLeaveMemberNames.has(member)
        )
    );

    const availableStaffCount = [...currentlyClockedIn].filter(member => allStaffMembers.has(member)).length;
    const availablePartTimerCount = [...currentlyClockedIn].filter(member => allPartTimers.has(member)).length;

    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' && !onLeaveMemberNames.has(r.member));
    const pausedRecords = (appState.workRecords || []).filter(r => r.status === 'paused' && !onLeaveMemberNames.has(r.member));
    
    const ongoingMembers = new Set(ongoingRecords.map(r => r.member));
    const pausedMembers = new Set(pausedRecords.map(r => r.member));

    const totalWorkingCount = ongoingMembers.size;
    
    const pausedStaffCount = [...pausedMembers].filter(member => allStaffMembers.has(member)).length;
    const pausedPartTimerCount = [...pausedMembers].filter(member => allPartTimers.has(member)).length;
    
    const workingStaffCount = [...ongoingMembers].filter(member => allStaffMembers.has(member)).length;
    const workingPartTimerCount = [...ongoingMembers].filter(member => allPartTimers.has(member)).length;

    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount - pausedStaffCount);
    const idlePartTimerCount = Math.max(0, availablePartTimerCount - workingPartTimerCount - pausedPartTimerCount);
    
    const totalIdleCount = idleStaffCount + idlePartTimerCount;

    const ongoingOrPausedRecords = (appState.workRecords || []).filter(r => (r.status === 'ongoing' || r.status === 'paused') && !onLeaveMemberNames.has(r.member));
    const ongoingTaskCount = new Set(ongoingOrPausedRecords.map(r => r.task)).size;

    if (elements['total-staff']) elements['total-staff'].textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (elements['leave-staff']) elements['leave-staff'].textContent = `${onLeaveTotalCount}`;
    if (elements['active-staff']) elements['active-staff'].textContent = `${availableStaffCount}/${availablePartTimerCount}`;
    if (elements['working-staff']) elements['working-staff'].textContent = `${totalWorkingCount}`;
    if (elements['idle-staff']) elements['idle-staff'].textContent = `${totalIdleCount}`;
    if (elements['ongoing-tasks']) elements['ongoing-tasks'].textContent = `${ongoingTaskCount}`;
    // 휴식(일시정지) 인원 — 대시보드 항목 정의에는 없고 인원 큰 숫자에만 있다
    const pausedEl = document.getElementById('summary-paused-staff');
    if (pausedEl) pausedEl.textContent = `${pausedStaffCount + pausedPartTimerCount}`;

    const quantitiesFromState = appState.taskQuantities || {};
    const quantityStatuses = appState.taskQuantityStatuses || {};
    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
    
    for (const task in quantitiesFromState) {
        const quantity = quantitiesFromState[task] || 0;
        const targetDashboardId = taskNameToDashboardIdMap[task];

        if (targetDashboardId && elements[targetDashboardId]) {
            const el = elements[targetDashboardId];
            el.textContent = quantity;

            el.classList.remove('quantity-estimated', 'quantity-confirmed', 'text-red-500', 'text-green-500', 'q-est', 'q-ok');

            const status = quantityStatuses[task];
            if (status === 'estimated') {
                el.classList.add('q-est');   // 예상(미확정) — 색은 css/dash-d.css
            } else if (status === 'confirmed') {
                el.classList.add('q-ok');    // 확정
            }
        }
    }

    updateEzadminDisplay();
    renderNoticeWidget(appState);

    // 실시간 인원 현황 상세 펼침 데이터 + 인터랙션
    lastPersonnelDetail = buildPersonnelDetailData(appState, appConfig);
    paintPersonnelDetailContainers(lastPersonnelDetail);
    setupPersonnelInteractions();
};

// ───────────────────────────────────────────────────────────
// 실시간 인원 현황 상세(펼침/툴팁)
// ───────────────────────────────────────────────────────────
// 기록 목록에서 조건에 맞는 인원을 한 번씩만 뽑는다(인원별 첫 업무), 업무명·이름순
const pickMembers = (records, pred) => {
    const seen = new Set();
    const out = [];
    records.forEach(r => {
        if (!pred(r) || seen.has(r.member)) return;
        seen.add(r.member);
        out.push({ member: r.member, task: r.task || '-', paused: false });
    });
    return out.sort((a, b) => (a.task || '').localeCompare(b.task || '') || a.member.localeCompare(b.member));
};

const buildPersonnelDetailData = (appState, appConfig) => {
    const allStaffMembers = getRegularMembersForCount(appConfig);
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));

    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
    const combinedOnLeave = [...dailyLeaves, ...dateLeaves];

    // 휴무: 외출(복귀 완료) + 지각 제외, 중복 제거 (한 사람의 첫 항목 유지)
    const seenLeave = new Set();
    const leaveDetail = [];
    combinedOnLeave.forEach(item => {
        if (!item || !item.member) return;
        if (item.type === '외출' && item.endTime) return;
        if (item.type === '지각') return;
        if (!(allStaffMembers.has(item.member) || allPartTimers.has(item.member))) return;
        if (seenLeave.has(item.member)) return;
        seenLeave.add(item.member);
        leaveDetail.push({ member: item.member, type: item.type });
    });
    leaveDetail.sort((a, b) => a.member.localeCompare(b.member));
    const onLeaveSet = new Set(leaveDetail.map(l => l.member));

    // 진행 업무: ongoing/paused, 휴무자 제외, 멤버별 첫 업무 채택
    const workingRecords = (appState.workRecords || []).filter(r =>
        (r.status === 'ongoing' || r.status === 'paused') && !onLeaveSet.has(r.member)
    );
    const seenWorking = new Set();
    const workingDetail = [];
    workingRecords.forEach(r => {
        if (seenWorking.has(r.member)) return;
        seenWorking.add(r.member);
        workingDetail.push({ member: r.member, task: r.task || '-', paused: r.status === 'paused' });
    });
    workingDetail.sort((a, b) => (a.task || '').localeCompare(b.task || '') || a.member.localeCompare(b.member));
    const workingSet = new Set(workingDetail.map(w => w.member));

    // 진행 업무(태스크) 집계: 업무명 → {총원, 휴식 인원}
    const taskMap = new Map();
    workingRecords.forEach(r => {
        const t = r.task || '(미지정)';
        if (!taskMap.has(t)) taskMap.set(t, { task: t, members: new Set(), paused: 0 });
        const g = taskMap.get(t);
        if (!g.members.has(r.member)) {
            g.members.add(r.member);
            if (r.status === 'paused') g.paused++;
        }
    });
    const ongoingTasksDetail = Array.from(taskMap.values())
        .map(g => ({ task: g.task, count: g.members.size, paused: g.paused }))
        .sort((a, b) => b.count - a.count || a.task.localeCompare(b.task));

    // 대기: 출근(active)이지만 휴무·진행/휴식 모두 아닌 인원
    const attendanceMap = appState.dailyAttendance || {};
    const idleDetail = Object.keys(attendanceMap)
        .filter(m => attendanceMap[m].status === 'active' && !onLeaveSet.has(m) && !workingSet.has(m))
        .sort();

    return {
        'leave-staff': leaveDetail,
        'idle-staff': idleDetail,
        // 큰 숫자(updateSummary)와 같은 기준: 업무 중 = ongoing 기록이 있는 인원, 휴식 = paused 기록이 있는 직원·알바
        'working-staff': pickMembers(workingRecords, r => r.status === 'ongoing'),
        'paused-staff': pickMembers(workingRecords, r => r.status === 'paused' && (allStaffMembers.has(r.member) || allPartTimers.has(r.member)))
            .map(w => ({ ...w, paused: true })),
        'ongoing-tasks': ongoingTasksDetail
    };
};

const renderDetailListHtml = (key, items) => {
    if (!items || items.length === 0) {
        return '<div class="text-xs t-3 italic py-1">해당 인원 없음</div>';
    }
    if (key === 'leave-staff') {
        return '<div class="flex flex-wrap gap-1 py-1">' + items.map(it =>
            `<span class="inline-flex items-center gap-1 d-chip text-[11px] px-1.5 py-0.5">
                <strong class="font-semibold">${it.member}</strong><span class="text-[10px] t-2">${it.type}</span>
             </span>`
        ).join('') + '</div>';
    }
    if (key === 'idle-staff') {
        return '<div class="flex flex-wrap gap-1 py-1">' + items.map(name =>
            `<span class="inline-flex d-chip text-[11px] px-1.5 py-0.5">${name}</span>`
        ).join('') + '</div>';
    }
    if (key === 'working-staff' || key === 'paused-staff') {
        return '<div class="space-y-0.5 py-1">' + items.map(it =>
            `<div class="flex items-center justify-between text-[11px] gap-2 ${it.paused ? 't-warn' : 't-1'}">
                <span class="font-medium shrink-0">${it.member}</span>
                <span class="text-[10px] t-2 truncate">${it.task}${it.paused ? ' (휴식)' : ''}</span>
             </div>`
        ).join('') + '</div>';
    }
    if (key === 'ongoing-tasks') {
        return '<div class="space-y-0.5 py-1">' + items.map(it =>
            `<div class="flex items-center justify-between text-[11px] gap-2 t-1">
                <span class="font-medium truncate">${it.task}</span>
                <span class="text-[10px] t-2 shrink-0">${it.count}명${it.paused > 0 ? ` <span class="t-warn">(${it.paused}명 휴식)</span>` : ''}</span>
             </div>`
        ).join('') + '</div>';
    }
    return '';
};

const paintPersonnelDetailContainers = (data) => {
    if (!data) return;
    Object.keys(data).forEach(key => {
        const el = document.querySelector(`[data-detail-content="${key}"]`);
        if (el) el.innerHTML = renderDetailListHtml(key, data[key]);
    });
};

const buildTooltipHtml = (key) => {
    const items = lastPersonnelDetail && lastPersonnelDetail[key];
    const title = { 'leave-staff': '휴무 인원', 'idle-staff': '대기 인원', 'working-staff': '진행 인력', 'paused-staff': '휴식 인원', 'ongoing-tasks': '진행 업무' }[key] || '';
    const header = `<div class="font-semibold text-white mb-1.5">${title}</div>`;
    const footer = '<div class="text-[10px] text-gray-400 mt-2">클릭으로 고정</div>';
    if (!items || items.length === 0) {
        return header + '<div class="text-gray-300">해당 인원 없음</div>' + footer;
    }
    let body = '';
    if (key === 'leave-staff') {
        body = items.map(it => `<div>${it.member} <span class="text-gray-400">(${it.type})</span></div>`).join('');
    } else if (key === 'idle-staff') {
        body = items.map(n => `<div>${n}</div>`).join('');
    } else if (key === 'working-staff' || key === 'paused-staff') {
        body = items.map(it => `<div>${it.member} <span class="text-gray-400">— ${it.task}${it.paused ? ' (휴식)' : ''}</span></div>`).join('');
    } else if (key === 'ongoing-tasks') {
        body = items.map(it => `<div>${it.task} <span class="text-gray-400">— ${it.count}명${it.paused > 0 ? ` (${it.paused}명 휴식)` : ''}</span></div>`).join('');
    }
    return header + body + footer;
};

const positionTooltip = (el, x, y) => {
    const pad = 12;
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 100;
    let left = x + pad;
    let top = y + pad;
    if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - pad);
    if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - pad);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
};

const setupPersonnelInteractions = () => {
    const container = document.getElementById('summary-personnel');
    if (!container || container.dataset.interactionsSetup === 'true') return;
    container.dataset.interactionsSetup = 'true';

    // 글로벌 툴팁 1개 (body에 부착)
    let tooltipEl = document.getElementById('personnel-hover-tooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'personnel-hover-tooltip';
        // 배경색은 css/dash-d.css 의 #personnel-hover-tooltip
        tooltipEl.className = 'fixed pointer-events-none z-[200] text-white text-xs rounded-lg shadow-xl p-3 max-w-xs leading-relaxed hidden';
        document.body.appendChild(tooltipEl);
    }

    let hoverTimer = null;
    const hideTooltip = () => {
        clearTimeout(hoverTimer);
        tooltipEl.classList.add('hidden');
    };

    container.addEventListener('mouseover', (e) => {
        const row = e.target.closest('.personnel-row[data-detail-key]');
        if (!row) return;
        if (row.dataset.expanded === 'true') return; // 펼친 상태에선 툴팁 생략
        const key = row.dataset.detailKey;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            tooltipEl.innerHTML = buildTooltipHtml(key);
            tooltipEl.classList.remove('hidden');
            positionTooltip(tooltipEl, e.clientX, e.clientY);
        }, 250);
    });

    container.addEventListener('mousemove', (e) => {
        if (tooltipEl.classList.contains('hidden')) return;
        positionTooltip(tooltipEl, e.clientX, e.clientY);
    });

    container.addEventListener('mouseout', (e) => {
        if (!e.target.closest('.personnel-row[data-detail-key]')) return;
        hideTooltip();
    });

    container.addEventListener('click', (e) => {
        const row = e.target.closest('.personnel-row[data-detail-key]');
        if (!row) return;
        // 큰 숫자(히어로)는 상세 칸이 행 밖(히어로 아래)에 있어 키로 찾는다
        const detailEl = container.querySelector(`[data-detail-content="${row.dataset.detailKey}"]`);
        if (!detailEl) return;
        const isExpanded = row.dataset.expanded === 'true';
        if (isExpanded) {
            row.dataset.expanded = 'false';
            detailEl.classList.add('hidden');
            row.classList.remove('is-open');
        } else {
            row.dataset.expanded = 'true';
            detailEl.classList.remove('hidden');
            row.classList.add('is-open');
            hideTooltip();
        }
    });
};

// 외부 페이지(별도 창으로 열려야 하는 링크)별 아이콘 + 창 타겟 매핑.
// 관리자 페이지에서 메뉴 이름을 다르게 등록해도 '링크' 기준으로 적용되므로
// 항상 페이지에 맞는 아이콘이 표시되고, 같은 named target으로 별도 창에서 열린다.
// 아이콘은 선 SVG(D안) — 메뉴 이름은 아이콘 span 밖의 텍스트 노드로 둔다(이름으로 메뉴를 찾음).
const 선아이콘 = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_LINK = 선아이콘('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>');
const EXTERNAL_LINK_META = [
    { match: 'manual.html',   icon: 선아이콘('<path d="M4 4h12l4 4v12H4z"/><path d="M8 12h8M8 16h5"/>'), target: '_blank' },          // 업무 매뉴얼
    { match: 'calculator/',   icon: 선아이콘('<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 7h6M9 12h1M14 12h1M9 16h1M14 16h1"/>'), target: 'calculator_window' }, // 통합 계산기(통관·수입·배송비·창고비) — 별도 탭
    { match: 'location.html', icon: 선아이콘('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'), target: 'location_window' }, // 로케이션 관리
    { match: 'supplies.html', icon: 선아이콘('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/>'), target: 'supplies_window' }, // 비품 관리
    { match: 'admin.html',    icon: 선아이콘('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'), target: 'admin_window' },    // 관리자 페이지
    { match: 'worktime.html', icon: 선아이콘('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), target: 'worktime_window' }, // 출퇴근 기록표
    { match: 'china-stock-goods.html', icon: 선아이콘('<path d="M4 6h16M4 12h16M4 18h10"/>'), target: 'chinastock_window' }, // 중국제작 미발계산기
    { match: 'china-mibal2.html', icon: 선아이콘('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/>'), target: 'chinamibal2_window' },     // 미발계산기(신규·시험) — 병행 비교용
    { match: 'products.html', icon: 선아이콘('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'), target: 'products_window' }, // 상품 관리
    { match: 'scan.html',     icon: 선아이콘('<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 12h8"/>'), target: 'scan_window' },      // 입고 스캐너(미발계산기 안에서도 열림)
];

// 신규·폐기 메뉴 보정은 js/menu-catalog.js 로 옮겼다.
// 관리자 페이지의 '권한 관리'도 같은 목록을 봐야 해서(신규 메뉴의 권한을 못 고르던 문제)
// 양쪽에서 쓰는 공용 모듈로 뺐다.

const resolveLinkMeta = (link) => {
    if (!link) return null;
    return EXTERNAL_LINK_META.find(m => link.includes(m.match)) || null;
};

// 사이드바 동적 필터링 및 재배치 (매뉴얼/대시보드 등 별도 창 열기 포함)
export const applyDynamicSidebar = (appConfig) => {
    if (!appConfig || !appConfig.dashboardMenu) return;

    const pcNav = document.querySelector('aside nav');
    const mobileNav = document.getElementById('nav-content');
    if (!pcNav && !mobileNav) return;

    const currentUserEmail = State.auth.currentUser?.email?.toLowerCase() || '';
    const currentUserRole = State.appState.currentUserRole;
    
    let allowedMenus = null; 
    if (currentUserRole !== 'admin') {
        allowedMenus = appConfig.memberMenuAccess?.[currentUserEmail] || [];
    }

    const pcElements = {};
    if (pcNav) {
        pcNav.querySelectorAll('button, a').forEach(el => {
            const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
            const name = textNode ? textNode.textContent.trim() : el.textContent.trim();
            if (name) pcElements[name] = el;
        });
        pcNav.innerHTML = '';
    }

    const mobileElements = {};
    let mobileHeader = null;
    let logoutBtn = null;
    
    if (mobileNav) {
        mobileHeader = mobileNav.firstElementChild; 
        logoutBtn = document.getElementById('logout-btn-mobile');
        
        mobileNav.querySelectorAll('button, a, div').forEach(el => {
            if (el.id === 'logout-btn-mobile' || el === mobileHeader || (mobileHeader && mobileHeader.contains(el))) return;
            if (el.tagName !== 'BUTTON' && el.tagName !== 'A') return;
            
            const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
            const name = textNode ? textNode.textContent.trim() : el.textContent.trim();
            if (name) mobileElements[name] = el;
        });

        Array.from(mobileNav.children).forEach(child => {
            if (child !== mobileHeader && child !== logoutBtn) {
                mobileNav.removeChild(child);
            }
        });
    }

    withBuiltinMenus(appConfig.dashboardMenu).forEach((group, index) => {
        const visibleItems = group.items.filter(item => {
            if (allowedMenus === null) return true; 
            return allowedMenus.includes(item.name);
        });

        if (visibleItems.length === 0) return;

        if (pcNav) {
            const pcCat = document.createElement('div');
            pcCat.className = 'd-nav-cat';   // 첫 대분류의 윗여백은 css(:first-child)가 줄인다
            pcCat.textContent = group.category;
            pcNav.appendChild(pcCat);
        }

        if (mobileNav) {
            const mobCat = document.createElement('div');
            mobCat.className = 'd-nav-cat';
            mobCat.textContent = group.category;
            if (logoutBtn) mobileNav.insertBefore(mobCat, logoutBtn);
            else mobileNav.appendChild(mobCat);
        }

        visibleItems.forEach(item => {
            // ✨ 외부 페이지 링크별 아이콘/창 타겟 결정 (메뉴 이름이 달라도 링크 기준 적용)
            const meta = resolveLinkMeta(item.link);

            if (pcNav) {
                const pcEl = pcElements[item.name];
                if (pcEl) {
                    if (pcEl.tagName === 'A' && item.link && item.link !== '#') {
                        pcEl.href = item.link;
                        if (meta) pcEl.target = meta.target; // 별도 창 / 새 탭
                    }
                    if (meta) { const ic = pcEl.querySelector('span'); if (ic) ic.innerHTML = meta.icon; }
                    pcNav.appendChild(pcEl);
                } else {
                    const newPc = document.createElement('a');
                    newPc.href = item.link || '#';
                    if (meta) newPc.target = meta.target; // 별도 창 / 새 탭
                    newPc.className = "d-nav-item w-full flex items-center gap-3";
                    newPc.innerHTML = `<span class="d-ico">${meta ? meta.icon : ICON_LINK}</span> ${item.name}`;
                    pcNav.appendChild(newPc);
                }
            }

            if (mobileNav) {
                const mobEl = mobileElements[item.name];
                if (mobEl) {
                    if (mobEl.tagName === 'A' && item.link && item.link !== '#') {
                        mobEl.href = item.link;
                        if (meta) mobEl.target = meta.target; // 별도 창 / 새 탭
                    }
                    if (meta) { const ic = mobEl.querySelector('span'); if (ic) ic.innerHTML = meta.icon; }
                    if (logoutBtn) mobileNav.insertBefore(mobEl, logoutBtn);
                    else mobileNav.appendChild(mobEl);
                } else {
                    const newMob = document.createElement('a');
                    newMob.href = item.link || '#';
                    if (meta) newMob.target = meta.target; // 별도 창 / 새 탭
                    newMob.className = "d-nav-item flex items-center gap-2";
                    newMob.innerHTML = `<span class="d-ico">${meta ? meta.icon : ICON_LINK}</span> ${item.name}`;
                    if (logoutBtn) mobileNav.insertBefore(newMob, logoutBtn);
                    else mobileNav.appendChild(newMob);
                }
            }
        });
    });
};