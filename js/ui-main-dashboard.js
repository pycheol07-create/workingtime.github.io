// === js/ui-main-dashboard.js ===
import { getAllDashboardDefinitions } from './ui.js?v=202610291637';
import * as State from './state.js?v=202610291637';
import { getRegularMembersForCount, formatHM, escapeHtml, showToast } from './utils.js?v=202610291637';
import { visibleMenuFor } from './menu-catalog.js?v=202610291637';
import { sidebarLinkTarget } from './app-shell-data.js?v=202610291637';   // 창 이름 규칙(공통 상단바와 같은 표·같은 열기 방식)
import { onEzadminChange, 상태 as ezadmin상태, STALE_분 } from './ezadmin-sync.js?v=202610291637';
import { renderSuppliesAlert } from './supplies-alert-dash.js?v=202610291637';
import { canonicalTaskName } from './lib/task-ids.js?v=202610291637';
import { checkMissingQuantities } from './analysis-logic.js?v=202610291637';
import { minToHhmm } from './forecast-progress.js?v=202610291637';
import { taskPace, combinePace, expectedRatio, rowsForDashboard } from './lib/task-pace.js?v=202610291637';

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
    // 맨 위 '처리량 미입력 N개' — 0개면 숨긴다(paintWorkloadPace 가 채운다). 지난 그림을 그대로 넣어 깜빡이지 않게 한다.
    let workloadHtml = `
        <button type="button" id="wl-missing" class="wl-missing${paceMissingLast ? '' : ' hidden'}"${paceMissingLast?.disabled ? ' disabled' : ''}
                title="${paceMissingLast ? escapeHtml(paceMissingLast.title) : ''}">${paceMissingLast ? paceMissingLast.html : ''}</button>
    `;

    itemIds.forEach(id => {
        const def = allDefinitions[id];
        if (!def) return;

        const isQuantity = def.isQuantity === true;
        if (!isQuantity && HERO_KEYS.has(id)) return;   // 위 큰 숫자로 이미 보인다
        // 라벨-값 한 줄 목록이라 제목 안의 줄바꿈(<br>)은 띄어쓰기로 편다
        const safeTitle = def.title.replace(/<br\s*\/?>/gi, ' ').replace(/ /g, '&nbsp;');

        if (isQuantity) {
            // 한 줄: [업무명] [막대 · 실적/계획 · %](wl-pace-*) — 진행 재료가 없으면 지금처럼 숫자(valueId)만.
            // 숫자 span(valueId)은 updateSummary 가 채운다. 진행 칸이 있으면 CSS 로 숨긴다(has-pace).
            // 둘째 줄(wl-sub-*)은 경고가 있거나 펼쳤을 때만. 안쪽은 paintWorkloadPace 가 갈아끼운다.
            const last = paceHtmlLast[id];
            workloadHtml += `
                <div id="wl-row-${id}" class="${wlRowClass(last)}" data-wl-row="${id}" title="${last ? escapeHtml(last.title) : ''}">
                    <div class="wl-line">
                        <span class="wl-label">${safeTitle}</span>
                        <span id="wl-pace-${id}" class="wl-pace">${last ? last.line : ''}</span>
                        <span id="${def.valueId}" class="wl-val">0</span>
                    </div>
                    <div id="wl-sub-${id}" class="wl-sub">${last ? last.sub : ''}</div>
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

    // 계획 0 · 활동 없는 칸을 접어 둔 줄 — 개수는 paintWorkloadPace 가 채운다
    workloadHtml += `
        <button type="button" id="wl-more" class="wl-more hidden">${paceMoreCount ? (wlOpen.more ? `그 외 ${paceMoreCount}개 접기` : `그 외 ${paceMoreCount}개 (계획·활동 없음)`) : ''}</button>
    `;

    // 첫 그림은 빈 칸으로 두고, 아래 updateEzadminDisplay() 가 실제 값을 채운다.
    // (0 을 먼저 그리면 '송장 0건' 처럼 보인다)

    workloadHtml += `
        <div class="d-sub px-4 py-3" style="margin-top:16px;"><!-- 업무 칸과 띄우기 — 부모의 space-y-0.5 가 mt-3 을 덮어써서 style 로 준다(2026-10-26) -->
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
    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
    
    // 🆔 업무 이름을 바꾼 날: 옛 이름 키는 지금 이름으로 맞춰 본다. 같은 업무에 지금 이름 값이 있으면 그것, 없으면 옛 이름 값(더하지 않음)
    const qtyByTask = {};
    for (const key in quantitiesFromState) {
        const task = canonicalTaskName(key, appConfig);
        if (!(task in qtyByTask) || task === key) qtyByTask[task] = quantitiesFromState[key];
    }
    for (const task in qtyByTask) {
        const quantity = qtyByTask[task] || 0;
        const targetDashboardId = taskNameToDashboardIdMap[task];

        if (targetDashboardId && elements[targetDashboardId]) {
            const el = elements[targetDashboardId];
            el.textContent = (Number(quantity) || 0).toLocaleString();   // 천 단위 쉼표(표시 전용 — 이 글자를 다시 숫자로 읽는 곳 없음)
        }
    }

    // 진행률·종료 예상·미입력 — 실패해도 위 숫자 줄은 그대로 둔다
    try { paintWorkloadPace(appState, appConfig, qtyByTask); }
    catch (e) { console.warn('[처리량 카드] 진행률 그리기 실패:', e); }

    updateEzadminDisplay();
    renderNoticeWidget(appState);
    renderSuppliesAlert();     // 비품 발주 알림 — 받아 둔 값으로만 다시 그린다(날짜가 바뀌면 남은 날이 준다)

    // 실시간 인원 현황 상세 펼침 데이터 + 인터랙션
    lastPersonnelDetail = buildPersonnelDetailData(appState, appConfig);
    paintPersonnelDetailContainers(lastPersonnelDetail);
    setupPersonnelInteractions();
};

// ───────────────────────────────────────────────────────────
// 오늘 업무 처리량 — 계획 대비 진행률 · 남은 시간 · 예상 종료 · 처리량 미입력
//  계산은 js/lib/task-pace.js, 재료(계획·UPH·인원·정시)는 ui-history-prediction.js getTodayTaskPaceInputs.
//  업무 예상 모듈은 무겁고(대시보드에서는 '오늘 진행' 띠가 이미 싣는다) 이 파일과 import 가 돌고 돌아서,
//  필요할 때 import() 로 가져온다. updateSummary 는 상태가 바뀔 때마다 불리므로 3초에 한 번만 그린다.
// ───────────────────────────────────────────────────────────
const PACE_MIN_GAP_MS = 3000;
let paceMod = null, paceModLoading = false;
let paceLastAt = 0, paceTimer = null, paceArgs = null;
let paceRetryTimer = null, paceRetries = 0;   // 이력이 아직 안 실렸을 때 다시 그려 보기(최대 2분)
const paceHtmlLast = {};          // 칸 id → 마지막 그림 { line, sub, title, hasPace, idle } (레이아웃을 다시 그려도 같은 그림으로 시작 — 깜빡임 방지)
let paceMissingLast = null;       // { html, title, disabled } / null = 숨김
let paceMoreCount = 0;            // '그 외 N개' (계획 0 · 활동 없음으로 접힌 칸 수)

const paceFmtMin = (m) => formatHM((Number(m) || 0) / 60);

/** 처리량 입력창을 여는 사이드바 버튼(PC·휴대폰 중 문서에 붙어 있는 것) */
const quantityOpener = () => ['open-quantity-modal-today', 'open-quantity-modal-today-mobile']
    .map(id => document.getElementById(id)).find(el => el && el.isConnected) || null;

/** '처리량 미입력 N개' → 기존 오늘 처리량 입력창.
 *  오늘 숫자를 받기 전에 열면 빈 칸이 저장될 수 있어 기다린다(app.js #open=quantity 와 같은 규칙). */
const openQuantityFromCard = async () => {
    try {
        const { whenTodayLoaded } = await import('./app-sync.js?v=202610291637');
        const ok = await Promise.race([whenTodayLoaded().then(() => true), new Promise(r => setTimeout(() => r(false), 15000))]);
        if (!ok) { showToast('오늘 데이터를 아직 받지 못해 처리량 입력 창을 열지 않았습니다. 사이드바에서 다시 눌러 주세요.', true); return; }
    } catch (e) { console.warn('[처리량 카드] 오늘 데이터 확인 실패:', e); return; }
    const btn = quantityOpener();
    if (btn) btn.click();
};

// 펼침 상태 — 그 탭에서만 기억(sessionStorage). rows: 펼친 칸 id, more: '그 외 N개' 펼침
const WL_OPEN_KEY = 'wlCardOpen_v1';
const wlOpen = (() => {
    try {
        const v = JSON.parse(sessionStorage.getItem(WL_OPEN_KEY) || '{}');
        return { rows: new Set(Array.isArray(v.rows) ? v.rows : []), more: !!v.more };
    } catch (e) { return { rows: new Set(), more: false }; }
})();
const saveWlOpen = () => {
    try { sessionStorage.setItem(WL_OPEN_KEY, JSON.stringify({ rows: [...wlOpen.rows], more: wlOpen.more })); } catch (e) {}
};

// 카드 칸(#summary-workload)은 레이아웃을 다시 그려도 그대로 남는다 — 클릭은 한 번만 위임해 둔다
const bindWorkloadClicks = (container) => {
    if (!container || container.dataset.wlBound) return;
    container.dataset.wlBound = '1';
    container.addEventListener('click', (e) => {
        const t = e.target;
        if (!t || !t.closest) return;
        const b = t.closest('#wl-missing');
        if (b) { if (!b.disabled) openQuantityFromCard(); return; }
        if (t.closest('#wl-more')) {
            wlOpen.more = !wlOpen.more; saveWlOpen();
            try { paintWorkloadPaceNow(); } catch (err) {}
            return;
        }
        const row = t.closest('.wl-row.has-pace');
        if (row && row.dataset.wlRow) {
            const id = row.dataset.wlRow;
            if (wlOpen.rows.has(id)) wlOpen.rows.delete(id); else wlOpen.rows.add(id);
            saveWlOpen();
            try { paintWorkloadPaceNow(); } catch (err) {}
        }
    });
};

/** 펼쳤을 때·마우스 올렸을 때 보이는 상세 한 줄(글자만) */
const paceDetailText = (p) => {
    if (p.state === 'done') return p.ended ? '완료' : '계획 달성';
    if (p.state === 'stopped') return p.remainQty > 0 ? `멈춤 · 남은 ${p.remainQty.toLocaleString()}` : '멈춤 · 처리량 입력 전';
    if (p.state === 'noPlan') return '오늘 계획 없음';
    if (p.state === 'noUph') return '기준 속도 없음';
    if (p.state === 'noWorker') return '진행 인원 없음';
    if (p.remainQty <= 0) return `계획량 도달(추정) · ${p.working}명 진행`;   // 어림값이 계획에 닿음 — 입력 전이라 완료 아님
    let s = `남은 ${paceFmtMin(p.remainMin)} · ${p.working}명 진행 · 종료 ${minToHhmm(p.finishMin)}`;
    if (p.overMin > 0) s += ` (정시 +${paceFmtMin(p.overMin)})`;
    if (p.cannotMeet) s += ' · 정시 마감 어려움';
    else if (p.extraWorkers > 0) s += ` · +${p.extraWorkers}명 있으면 정시`;
    return s;
};

/** 경고가 있을 때만 접힌 상태에서도 보이는 짧은 둘째 줄 — { text, tone } / 경고 없으면 null */
const paceWarnShort = (p) => {
    if (p.state === 'stopped') {
        return { text: p.remainQty > 0 ? `멈춤 · 남은 ${p.remainQty.toLocaleString()}` : '멈춤 · 입력 전', tone: p.tone === 'risk' ? 't-risk' : 't-warn' };
    }
    if (p.overMin > 0 && p.finishMin != null) {
        const tail = p.cannotMeet ? ' · 마감 어려움' : p.extraWorkers > 0 ? ` · +${p.extraWorkers}명` : '';
        return { text: `종료 ${minToHhmm(p.finishMin)} (+${paceFmtMin(p.overMin)})${tail}`, tone: p.tone === 'risk' ? 't-risk' : 't-warn' };
    }
    if (p.tone === 'warn' || p.tone === 'risk') {
        return { text: `${paceDetailText(p)} · 예정보다 늦음`, tone: p.tone === 'risk' ? 't-risk' : 't-warn' };
    }
    return null;
};

/** 한 칸의 그림.
 *  반환 { line(막대·실적/계획·% html), sub(둘째 줄 html), title, hasPace, idle }
 *  연결 업무가 없거나 재료가 없으면 hasPace=false — 지금처럼 숫자(valueId)만 보인다. */
const paceRowView = (row, inp, expected, qtyByTask, open) => {
    const none = { line: '', sub: '', title: '', hasPace: false, idle: false };
    if (row.kind === 'none' || !inp) return none;
    const paces = row.tasks.map(task => {
        const t = inp.tasks[task] || { planQty: 0, uph: 0, working: 0, spentHours: 0, activeHours: 0, started: false, ended: false };
        const doneQty = Number(qtyByTask[task]) || 0;
        const p = taskPace({
            planQty: t.planQty, doneQty, uph: t.uph, working: t.working,
            spentHours: t.spentHours, activeHours: t.activeHours, nowMin: inp.nowMin, baseFinishMin: inp.baseFinishMin,
            skipLunch: inp.skipLunch, expected, available: inp.available, started: t.started, ended: t.ended
        });
        return { ...p, working: t.working, ended: t.ended, task, doneQty };
    });

    // 계획 0 · 오늘 활동 없음 → 숨김 대상('그 외 N개')
    const idle = paces.every(x => !(x.planQty > 0) && !x.started && !(x.doneQty > 0));
    const srcText = inp.planSrc === 'snap' ? '확정 계획 기준' : '자동 계획 기준(얼려 둔 계획 없음)';
    const srcDot = `<span class="wl-src${inp.planSrc === 'snap' ? ' is-snap' : ''}" title="${srcText}"></span>`;

    let p, details, warn;
    if (row.kind === 'single') {
        p = paces[0];
        details = [paceDetailText(p)];
        warn = paceWarnShort(p);
    } else {
        p = combinePace(paces, expected);
        details = paces.map(x => `${x.task} ${x.shownQty.toLocaleString()}${x.estimated ? '~' : ''} / ${x.planQty.toLocaleString()} · ${paceDetailText(x)}`);
        const bad = paces.map(paceWarnShort).filter(Boolean);
        warn = bad.length ? { text: `업무 ${bad.length}개 확인 필요`, tone: bad.some(w => w.tone === 't-risk') ? 't-risk' : 't-warn' } : null;
    }
    const estNote = p.estimated ? '~ 는 추정: 오늘 쓴 시간 × 기준 속도(처리량은 업무를 끝낸 뒤 입력)' : '';
    const title = [...details, srcText, estNote].filter(Boolean).join('\n');

    const tone = p.tone === 'risk' ? ' is-risk' : p.tone === 'warn' ? ' is-warn' : '';
    const pctTone = p.tone === 'risk' ? 't-risk' : p.tone === 'warn' ? 't-warn' : 't-2';
    const plan = p.planQty > 0 ? p.planQty.toLocaleString() : '–';
    const line = `<span class="tp-track wl-track"><span class="tp-bar wl-bar${tone}${p.estimated ? ' is-est' : ''}" style="width:${p.barPct}%"></span></span>`
        + `<span class="wl-qty">${p.shownQty.toLocaleString()}${p.estimated ? '<span class="wl-est">~</span>' : ''}<span class="wl-plan">/${plan}</span></span>`
        + `<span class="wl-pct ${pctTone}">${p.pct == null ? '–' : p.pct + '%'}</span>${srcDot}`;

    let sub = '';
    if (open) {
        sub = details.map(d => `<div>${escapeHtml(d)}</div>`).join('')
            + `<div>${escapeHtml(srcText)}${estNote ? ' · ' + escapeHtml(estNote) : ''}</div>`;
    } else if (warn) {
        sub = `<span class="${warn.tone}">${escapeHtml(warn.text)}</span>`;
    }
    return { line, sub, title, hasPace: true, idle };
};

/** 미입력 줄 그림 — { html, title, disabled } / 0개면 null.
 *  끝난(시간이 잡힌) 처리량 업무 중 처리량이 0 이고 '0 확정' 도 아닌 것 — 데이터관리·마감 미리보기와 같은 판정. */
const missingLineOf = (appState, appConfig, qtyByTask) => {
    const canon = (t) => canonicalTaskName(t, appConfig);
    const list = checkMissingQuantities({
        workRecords: (appState.workRecords || []).map(r => (r && r.task) ? { ...r, task: canon(r.task) } : r),
        taskQuantities: qtyByTask,
        confirmedZeroTasks: (appState.confirmedZeroTasks || []).map(canon)
    });
    if (!list.length) return null;
    const opener = quantityOpener();
    return {
        html: `처리량 미입력 <b>${list.length}개</b>${opener ? '<span class="wl-missing-go">입력하기</span>' : ''}`,
        title: `끝난 업무 중 처리량이 없는 것: ${list.join(', ')}`,
        disabled: !opener
    };
};

/** 행 class — 레이아웃을 새로 그릴 때도 같은 값을 쓴다(깜빡임 방지) */
const wlRowClass = (v) => 'wl-row' + (v && v.hasPace ? ' has-pace' : '')
    + (v && v.idle ? ' is-idle' : '');   // 계획·활동 없는 칸도 접지 않고 늘 보인다(2026-10-23 사용자 요청)

const paintWorkloadPaceNow = () => {
    const container = document.getElementById('summary-workload');
    if (!container || !paceArgs) return;
    const { appState, appConfig, qtyByTask } = paceArgs;
    bindWorkloadClicks(container);

    // ① 미입력 줄
    const miss = missingLineOf(appState, appConfig, qtyByTask);
    paceMissingLast = miss;
    const mb = document.getElementById('wl-missing');
    if (mb) {
        mb.classList.toggle('hidden', !miss);
        if (miss) {
            if (mb.innerHTML !== miss.html) mb.innerHTML = miss.html;
            mb.title = miss.title;
            mb.disabled = !!miss.disabled;
        }
    }

    // ② 업무별 진행 — 재료(업무 예상 모듈)가 아직 없으면 실어 온 뒤 다시 그린다
    if (!paceMod) {
        if (!paceModLoading) {
            paceModLoading = true;
            import('./ui-history-prediction.js?v=202610291637')
                .then(m => { paceMod = m; paceLastAt = 0; schedulePace(); })
                .catch(e => console.warn('[처리량 카드] 업무 예상 모듈 로드 실패:', e))
                .finally(() => { paceModLoading = false; });
        }
        return;
    }
    const inp = paceMod.getTodayTaskPaceInputs();
    const expected = inp ? expectedRatio(inp) : 0;
    // 재료가 아직 없다(로그인 직후 이력 로딩 중) — 다음 30초 갱신을 기다리지 않고 3초 뒤 다시 본다
    if (!inp && paceRetries < 40 && !paceRetryTimer) {
        paceRetries++;
        paceRetryTimer = setTimeout(() => { paceRetryTimer = null; schedulePace(); }, PACE_MIN_GAP_MS);
    }
    if (inp) paceRetries = 0;
    // 🆔 옛 이름으로 남은 연결도 지금 이름으로 본다(숫자 줄과 같은 규칙)
    const map = {};
    Object.entries(appConfig.quantityToDashboardMap || {}).forEach(([task, id]) => { map[canonicalTaskName(task, appConfig)] = id; });
    let idleCount = 0;
    rowsForDashboard(appConfig.dashboardItems || [], getAllDashboardDefinitions(appConfig), map).forEach(row => {
        const rowEl = document.getElementById(`wl-row-${row.id}`);
        const lineEl = document.getElementById(`wl-pace-${row.id}`);
        const subEl = document.getElementById(`wl-sub-${row.id}`);
        if (!rowEl || !lineEl || !subEl) return;
        const v = paceRowView(row, inp, expected, qtyByTask, wlOpen.rows.has(row.id));
        paceHtmlLast[row.id] = v;
        if (v.idle) idleCount++;
        // 같은 그림이면 건드리지 않는다(깜빡임 방지)
        const cls = wlRowClass(v);
        if (rowEl.className !== cls) rowEl.className = cls;
        if (rowEl.title !== v.title) rowEl.title = v.title;
        if (lineEl.innerHTML !== v.line) lineEl.innerHTML = v.line;
        if (subEl.innerHTML !== v.sub) subEl.innerHTML = v.sub;
    });

    // ③ '그 외 N개' — 계획 0 · 활동 없는 칸
    paceMoreCount = idleCount;
    const more = document.getElementById('wl-more');
    if (more) {
        more.classList.add('hidden');   // '그 외 N개' 접기는 쓰지 않는다(전부 기본 표시)
        const txt = wlOpen.more ? `그 외 ${idleCount}개 접기` : `그 외 ${idleCount}개 (계획·활동 없음)`;
        if (more.textContent !== txt) more.textContent = txt;
    }
};

const schedulePace = () => {
    const wait = PACE_MIN_GAP_MS - (Date.now() - paceLastAt);
    if (wait <= 0) {
        clearTimeout(paceTimer); paceTimer = null;
        paceLastAt = Date.now();
        try { paintWorkloadPaceNow(); } catch (e) { console.warn('[처리량 카드] 진행률 그리기 실패:', e); }
        return;
    }
    if (!paceTimer) paceTimer = setTimeout(() => { paceTimer = null; schedulePace(); }, wait);
};

/** updateSummary 가 숫자를 채운 직후 부른다. 가장 최근 값으로 3초에 한 번만 그린다. */
const paintWorkloadPace = (appState, appConfig, qtyByTask) => {
    if (!document.getElementById('summary-workload')) return;   // 데이터관리 등 카드가 없는 화면
    paceArgs = { appState, appConfig, qtyByTask };
    schedulePace();
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
                <strong class="font-semibold">${it.member}</strong><span class="text-[11px] t-2">${it.type}</span>
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
                <span class="text-[11px] t-2 truncate">${it.task}${it.paused ? ' (휴식)' : ''}</span>
             </div>`
        ).join('') + '</div>';
    }
    if (key === 'ongoing-tasks') {
        return '<div class="space-y-0.5 py-1">' + items.map(it =>
            `<div class="flex items-center justify-between text-[11px] gap-2 t-1">
                <span class="font-medium truncate">${it.task}</span>
                <span class="text-[11px] t-2 shrink-0">${it.count}명${it.paused > 0 ? ` <span class="t-warn">(${it.paused}명 휴식)</span>` : ''}</span>
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
    const footer = '<div class="text-[11px] text-gray-400 mt-2">클릭으로 고정</div>';
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
    { match: 'manual.html',   icon: 선아이콘('<path d="M4 4h12l4 4v12H4z"/><path d="M8 12h8M8 16h5"/>') },          // 업무 매뉴얼
    { match: 'calculator/',   icon: 선아이콘('<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 7h6M9 12h1M14 12h1M9 16h1M14 16h1"/>') }, // 통합 계산기(통관·수입·배송비·창고비) — 별도 탭
    { match: 'location.html', icon: 선아이콘('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>') }, // 로케이션 관리
    { match: 'supplies.html', icon: 선아이콘('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/>') }, // 비품 관리
    { match: 'admin.html',    icon: 선아이콘('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>') },    // 관리자 페이지
    { match: 'worktime.html', icon: 선아이콘('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>') }, // 출퇴근 기록표
    { match: 'china-stock-goods.html', icon: 선아이콘('<path d="M4 6h16M4 12h16M4 18h10"/>') }, // 중국제작 미발계산기
    { match: 'china-mibal2.html', icon: 선아이콘('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/>') },     // 미발계산기(신규·시험) — 병행 비교용
    { match: 'products.html', icon: 선아이콘('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>') }, // 상품 관리
    { match: 'scan.html',     icon: 선아이콘('<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 12h8"/>') },      // 입고 스캐너(미발계산기 안에서도 열림)
];

// 신규·폐기 메뉴 보정은 js/menu-catalog.js 로 옮겼다.
// 관리자 페이지의 '권한 관리'도 같은 목록을 봐야 해서(신규 메뉴의 권한을 못 고르던 문제)
// 양쪽에서 쓰는 공용 모듈로 뺐다.

// 창 이름(target)은 js/app-shell-data.js 한 곳에서 정한다(공통 상단바 메뉴와 같게).
// 1b(2026-10-16): SHELL_OPEN_MODE 가 'same-tab' 이면 '' — 같은 탭에서 연다.
const resolveLinkMeta = (link) => {
    if (!link) return null;
    const m = EXTERNAL_LINK_META.find(x => link.includes(x.match));
    return m ? { ...m, target: sidebarLinkTarget(link) } : null;
};

// 사이드바 동적 필터링 및 재배치 (매뉴얼/대시보드 등 별도 창 열기 포함)
export const applyDynamicSidebar = (appConfig) => {
    if (!appConfig || !appConfig.dashboardMenu) return;

    const pcNav = document.querySelector('aside nav');
    const mobileNav = document.getElementById('nav-content');
    if (!pcNav && !mobileNav) return;

    const currentUserEmail = State.auth.currentUser?.email?.toLowerCase() || '';
    const currentUserRole = State.appState.currentUserRole;
    // 보이는 메뉴는 공통 상단바와 같은 함수로 정한다(권한 개편) — 차이는 surface 하나(사이드바는 업무 마감을 권한대로 둔다).
    const visibleGroups = visibleMenuFor(appConfig, currentUserEmail, currentUserRole, 'sidebar');

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

    visibleGroups.forEach((group, index) => {
        const visibleItems = group.items;

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