// === js/app-sync.js ===
import * as State from './state.js?v=202610270959';
import { isPersistentLeaveType } from './state.js?v=202610270959';
import * as DOM from './dom-elements.js?v=202610270959';
import { getTodayDateString, getCurrentTime, showToast } from './utils.js?v=202610270959';
// ✨ limit가 추가되었습니다.
import { doc, onSnapshot, collection, query, where, limit, writeBatch, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderDashboardLayout, renderTaskSelectionModal } from './ui.js?v=202610270959';
import { renderTodoList } from './inspection-logic.js?v=202610270959';
import { renderNotificationList } from './app-notifications.js?v=202610270959';
import { onLeaveScheduleChanged } from './leave-schedule-sync.js?v=202610270959';
import { PRIVATE_CONFIG_KEYS } from './config.js?v=202610270959';
import { isAutomation, loadDismissed, pickPopup, findOpenModal } from './lib/noti-popup.js?v=202610270959';

let unsubConfig = null;
let unsubToday = null;
let unsubWorkRecords = null;
export let unsubscribeNotifications = null;

// ✨ 핵심 방어막: 초기화 잠금 변수
let isListenersInitialized = false;

// 📅 지금 구독 중인 날짜(daily_data/{날짜}). 자정을 넘긴 탭은 어제 문서를 계속 구독하고 있으므로
//    오늘 날짜로 정리·잠금 쓰기를 하면 어제 기록으로 오늘 문서를 건드리게 된다 — 이 값과 오늘이 다르면 쓰지 않는다.
//    (탭은 js/app-lifecycle.js handleDayRollover 가 새로고침한다)
let subscribedDate = null;
export const getSubscribedDate = () => subscribedDate;
const isStaleDay = () => !!subscribedDate && subscribedDate !== getTodayDateString();
const syncDate = () => subscribedDate || getTodayDateString();   // 구독 전(콘솔 도구 등)에는 오늘

// 🔔 안 읽은 알림이 있으면 알림창(#notification-modal)을 저절로 연다(2026-10-22).
//    - 봇(Playwright — navigator.webdriver)에서는 열지 않는다(업무마감봇·업무예상알림 화면 보호).
//    - 이 탭에서 닫은 알림(js/lib/noti-popup.js — sessionStorage id)은 다시 열지 않는다.
//    - 다른 창(로그인·처리량 입력·#open= 으로 연 창 등)이 떠 있으면 기다렸다가 닫힌 뒤 한 번만 연다(최대 NOTI_WAIT_MAX).
const NOTI_LIMIT = 200;   // 개인 알림 구독 상한(최근 3일) — js/app-shell-noti.js 와 같은 값
const NOTI_WAIT_STEP = 1000;
const NOTI_WAIT_MAX = 30 * 60 * 1000;
let notiWaitTimer = null;
function maybeOpenNotificationModal() {
    if (isAutomation() || !State.appState.currentUser) return;
    const modal = document.getElementById('notification-modal');
    if (!modal || !modal.classList.contains('hidden')) return;          // 없음 · 이미 열림(목록은 스냅샷이 다시 그린다)
    if (!pickPopup(State.appState.notifications, loadDismissed()).length) return;
    if (!findOpenModal(document, { except: ['notification-modal'] })) {
        modal.classList.remove('hidden');
        renderNotificationList();
        return;
    }
    if (notiWaitTimer) return;                                          // 이미 기다리는 중
    const until = Date.now() + NOTI_WAIT_MAX;
    const who = State.appState.currentUser;
    notiWaitTimer = setInterval(() => {
        const sameUser = State.appState.currentUser === who;            // 로그아웃·다른 사람 → 앞 사람 목록으로 열지 않는다
        if (sameUser && findOpenModal(document, { except: ['notification-modal'] }) && Date.now() < until) return;
        clearInterval(notiWaitTimer);
        notiWaitTimer = null;
        if (!sameUser || Date.now() >= until) return;                   // 너무 오래 — 다음 스냅샷 때 다시 본다
        maybeOpenNotificationModal();                                   // 그 사이 읽음·닫음이 반영된 목록으로 다시 판단
    }, NOTI_WAIT_STEP);
}

// 오늘 문서·업무기록 첫 스냅샷이 들어왔는지 — 대시보드 #open=quantity(js/app.js)가
// 숫자를 받기 전에 처리량 창을 열어 빈 값으로 저장하는 일이 없게 기다리는 데 쓴다.
let todayDocLoaded = false, workRecordsLoaded = false;
const todayLoadedWaiters = [];
const flushTodayLoaded = () => { if (todayDocLoaded && workRecordsLoaded) todayLoadedWaiters.splice(0).forEach(r => r()); };
export const whenTodayLoaded = () => new Promise(r => { todayLoadedWaiters.push(r); flushTodayLoaded(); });

/** 오늘 날짜에 걸리는 '기간형 근태'만 추려 둔다(대시보드 인원 계산이 이 값을 쓴다). */
function recomputeDateBasedLeaves() {
    const today = getTodayDateString();
    const leaves = (State.persistentLeaveSchedule && State.persistentLeaveSchedule.onLeaveMembers) || [];
    State.appState.dateBasedOnLeaveMembers = leaves.filter(entry => {
        if (!isPersistentLeaveType(entry.type)) return false;
        const endDate = entry.endDate || entry.startDate;
        return entry.startDate && typeof entry.startDate === 'string' &&
               today >= entry.startDate && today <= (endDate || entry.startDate);
    });
}

let leaveRenderCallback = null;

// markDirtyCallback 은 더 이상 쓰지 않는다(위 근태 구독 주석 참고).
// app.js 의 호출부를 그대로 두려고 인자는 남겨 둔다.
/** 로그아웃 때 부른다 — 구독을 모두 풀고 초기화 잠금도 푼다.
 *  잠금이 남아 있으면 같은 탭에서 다른 사람이 로그인했을 때 구독이 'Bypassing' 되어
 *  새 사람의 알림이 붙지 않고, 종을 누르면 앞 사람 알림이 보였다(2026-10-22 수정). */
export function stopFirebaseListeners() {
    if (unsubConfig) { unsubConfig(); unsubConfig = null; }
    if (unsubToday) { unsubToday(); unsubToday = null; }
    if (unsubWorkRecords) { unsubWorkRecords(); unsubWorkRecords = null; }
    if (unsubscribeNotifications) { unsubscribeNotifications(); unsubscribeNotifications = null; }
    isListenersInitialized = false;
    subscribedDate = null;
    // 다음 사람은 새 스냅샷을 받은 뒤에 '오늘 데이터 도착'으로 본다(앞 세션의 옛 값으로 창이 먼저 열리지 않게)
    todayDocLoaded = false;
    workRecordsLoaded = false;
}

export function setupFirebaseListeners(renderCallback, markDirtyCallback, force = false) {
    // 🚨 라우터 이동이나 토큰 갱신 시 리스너가 중복 재실행되어 데이터를 다시 통째로 다운받는 현상 차단
    if (isListenersInitialized && !force) {
        console.log("Listeners already active. Bypassing redundant DB reads.");
        return;
    }
    isListenersInitialized = true;
    subscribedDate = getTodayDateString();

    if (unsubConfig) { unsubConfig(); unsubConfig = null; }
    if (unsubToday) { unsubToday(); unsubToday = null; }
    if (unsubWorkRecords) { unsubWorkRecords(); unsubWorkRecords = null; }
    if (unsubscribeNotifications) { unsubscribeNotifications(); unsubscribeNotifications = null; }

    // 🔗 근태 일정은 leave-schedule-sync.js 가 구독한다(구독처는 한 곳이어야 한다).
    //    여기서는 그 알림을 받아 '오늘 해당되는 근태'만 다시 계산하고 화면을 새로 그린다.
    //
    //    ⚠️ 예전에는 이 자리에서 같은 문서를 또 구독하면서 markDirtyCallback() 까지 불렀다.
    //       구독은 붙는 즉시 첫 스냅샷을 쏘므로, 탭을 열기만 해도 dirty 가 서고
    //       1분 뒤 자동저장이 daily_data 문서를 통째로 썼다(열린 탭 수만큼 반복).
    //       dirty 는 '사람이 고쳤을 때'만 서야 하므로 여기서는 세우지 않는다.
    leaveRenderCallback = renderCallback;
    onLeaveScheduleChanged('app-sync', () => {
        recomputeDateBasedLeaves();
        if (leaveRenderCallback) leaveRenderCallback();
    });
    recomputeDateBasedLeaves();   // 알림이 오기 전에도 한 번은 맞춰 둔다

    const configDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
    unsubConfig = onSnapshot(configDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const loadedConfig = docSnap.data();
            // 🔒 급여·원가의 기준은 adminPrivate 다(관리자일 때 시작 시 받아 둔다).
            //    mainConfig 에 옛 값이 남아 있거나 옛 버전 탭이 되써도 그걸로 덮지 않는다.
            PRIVATE_CONFIG_KEYS.forEach(k => { delete loadedConfig[k]; });
            const mergedConfig = { ...State.appConfig, ...loadedConfig };
            
            if (Array.isArray(loadedConfig.taskGroups)) mergedConfig.taskGroups = loadedConfig.taskGroups;
            State.setAppConfig(mergedConfig); 

            renderDashboardLayout(State.appConfig);
            renderTaskSelectionModal(State.appConfig.taskGroups);
            renderCallback();
        }
    });

    const todayDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', subscribedDate);
    unsubToday =onSnapshot(todayDocRef, (docSnap) => {
        const data = docSnap.exists() ? docSnap.data() : {};
        State.appState.taskQuantities = { ...data.taskQuantities };
        State.appState.partTimers = data.partTimers || [];
        State.appState.hiddenGroupIds = data.hiddenGroupIds || [];
        State.appState.dailyAttendance = data.dailyAttendance || {};
        State.appState.lunchPauseExecuted = data.lunchPauseExecuted ?? false;
        State.appState.lunchResumeExecuted = data.lunchResumeExecuted ?? false;
        
        State.appState.inspectionList = data.inspectionList || []; 
        State.appState.dailyOnLeaveMembers = data.onLeaveMembers || [];
        // ⚠️ 이 값을 되읽지 않으면 메모리에는 늘 빈 배열이 남는다.
        //    그 상태로 1분 자동저장이 돌면 '0으로 확인' 표시가 통째로 지워진다.
        State.appState.confirmedZeroTasks = data.confirmedZeroTasks || [];

        // 💹 경영지표도 같은 이유로 되읽는다.
        //    되읽지 않으면 메모리에는 환율만 든 반쪽 객체가 남고, 다른 사람이 넣은
        //    매출·재고·환율이 화면에 안 보인 채로 저장돼 0으로 덮이는 일이 생긴다.
        State.appState.management = data.management || {};
        const todayKey = subscribedDate;
        const ti =(State.allHistoryData || []).findIndex(d => d.id === todayKey);
        if (ti > -1 && data.management) {
            State.allHistoryData[ti].management = {
                ...(State.allHistoryData[ti].management || {}),
                ...data.management
            };
        }

        State.setIsDataDirty(false); 
        renderCallback();
        renderTodoList();
        todayDocLoaded = true; flushTodayLoaded();
        
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '실시간 연결';
        if (DOM.statusDotEl) DOM.statusDotEl.className = 'd-live-dot';   // 색은 css/dash-d.css
    });
    
    const workRecordsCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', subscribedDate, 'workRecords');
    unsubWorkRecords =onSnapshot(workRecordsCollectionRef, (querySnapshot) => {
        State.appState.workRecords = [];
        querySnapshot.forEach(doc => State.appState.workRecords.push(doc.data()));
        State.appState.workRecords.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

        // 🛡️ 무결성 점검: 한 사람이 동시에 2개 이상 ongoing/paused 상태인 경우 감지 및 자동 정리
        try { detectAndCleanupDuplicateOngoing(workRecordsCollectionRef); } catch (e) { console.error('Duplicate check failed:', e); }

        // 🛡️ 잠금 맞추기: 진행 중이 아닌데 남은 잠금은 삭제, 진행 중인데 잠금이 없으면 새로 만든다
        //    (예전 backfillActiveLocksOnce 의 일도 여기서 한다 — 잠금 전체를 한 번만 읽는다)
        try { reconcileActiveLocksDebounced(); } catch (e) { console.error('Stale lock reconcile failed:', e); }

        renderCallback();
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '실시간 연결';
        workRecordsLoaded = true; flushTodayLoaded();
    });

    // 🔔 개인 알림은 알림창(#notification-modal)이 있는 대시보드에서만 여기서 구독한다.
    //    데이터 관리(history.html)는 공통 상단바(js/app-shell.js → app-shell-noti.js)가 같은 조건으로 구독한다
    //    — 두 곳에서 구독하면 읽기·토스트가 두 번씩 생긴다(UI 1단계 P2).
    if (State.appState.currentUser && document.getElementById('notification-modal')) {
        const notiColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications');
        const d = new Date();
        
        // 🚨 기존 15일 -> 3일로 축소
        d.setDate(d.getDate() - 3);
        const recentDaysAgoStr = d.toISOString();

        const notiQuery = query(
            notiColRef, 
            where("targetMember", "==", State.appState.currentUser),
            where("createdAt", ">=", recentDaysAgoStr),
            // ✨ 핵심 방어막: 최근 3일 내의 알림 중 최대 NOTI_LIMIT(200)개까지만 — 읽기 폭탄 방지.
            //    3일 창이라 보통 이보다 훨씬 적다. 예전 30건은 정렬 없이 잘려서 최신 알림이 빠질 수 있었다
            //    (정렬은 아래에서 클라이언트가 한다 — 색인을 새로 만들지 않으려고 orderBy 를 쓰지 않는다).
            limit(NOTI_LIMIT)
        );
        
        let isInitialLoad = true;

        unsubscribeNotifications = onSnapshot(notiQuery, (snapshot) => {
            if (snapshot.size >= NOTI_LIMIT) console.warn(`[알림] 최근 3일 알림이 상한(${NOTI_LIMIT}건)에 닿았습니다 — 일부가 빠졌을 수 있습니다.`);
            const notifications = [];
            let unreadCount = 0;
            
            let freshUnread = false;
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && !isInitialLoad && !change.doc.data().isRead) freshUnread = true;
            });
            // 봇(업무예상알림이 #toast 글자를 읽는다)에서는 토스트도 띄우지 않는다
            if (freshUnread && !isAutomation()) showToast(`🔔 새 알림이 도착했습니다.`);

            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                data.id = docSnap.id;
                notifications.push(data);
                if (!data.isRead) unreadCount++;
            });
            
            notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            State.appState.notifications = notifications;
            
            document.querySelectorAll('.notification-badge').forEach(badge => {
                unreadCount > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
            });
            
            const modal = document.getElementById('notification-modal');
            if (modal && !modal.classList.contains('hidden')) renderNotificationList();
            // 첫 스냅샷이든 새 알림이든 안 읽고 안 닫은 게 있으면 연다(자동화 가드·다른 창 대기는 함수 안).
            // 첫 스냅샷은 오늘 데이터가 들어오고 조금 뒤에 본다 — #open=quantity|leave(js/app.js handleOpenHash)가
            // 먼저 창을 열게 해서, 그 창이 닫힌 뒤에 알림창이 뜨도록(최대 15초 기다림).
            else if (!isAutomation()) {
                if (isInitialLoad) {
                    // 기다리는 사이 로그아웃·다른 사람으로 바뀌면 앞 사람 목록으로 열지 않는다
                    const who = State.appState.currentUser;
                    Promise.race([whenTodayLoaded(), new Promise(r => setTimeout(r, 15000))])
                        .then(() => setTimeout(() => { if (State.appState.currentUser === who) maybeOpenNotificationModal(); }, 800));
                } else {
                    maybeOpenNotificationModal();
                }
            }

            isInitialLoad = false;
        });
    }
}

// =====================================================================
// 🛡️ 동시 진행 업무 중복 방지/정리
// =====================================================================
// 한 멤버가 동시에 2개 이상 ongoing/paused 인 상태를 감지.
// 가장 startTime 이 최근인 1건만 살리고 나머지는 자동 종료(completed)로 마감.
// - 종료 시각: 다음으로 시작된 업무의 startTime (있으면) → 자연스러운 끊김.
//   없으면 현재시각.
// - duration 계산: end - start - sum(pauses)
// - 한 화면에서 다중 클라이언트가 동시에 정리하지 않도록 5초 디바운스 + 1분 쿨다운.

let _dupCleanupTimer = null;
let _dupCleanupLastRun = 0;
const DUP_CLEANUP_COOLDOWN_MS = 60_000;

function detectAndCleanupDuplicateOngoing(workRecordsColRef) {
    if (isStaleDay()) return;
    const records = (State.appState.workRecords || []).filter(r =>
        r.status === 'ongoing' || r.status === 'paused'
    );
    if (records.length < 2) return;

    // 멤버별 그룹화
    const byMember = new Map();
    records.forEach(r => {
        if (!r.member) return;
        if (!byMember.has(r.member)) byMember.set(r.member, []);
        byMember.get(r.member).push(r);
    });

    const dupes = [];
    byMember.forEach((arr, member) => {
        if (arr.length > 1) dupes.push({ member, records: arr });
    });
    if (dupes.length === 0) return;

    // 진단 출력 (항상)
    console.warn(
        `[중복 진행 감지] ${dupes.length}명의 멤버가 동시에 여러 업무 중:`,
        dupes.map(d => ({
            member: d.member,
            tasks: d.records.map(r => `${r.task}@${r.startTime}(${r.status})`)
        }))
    );

    // 자동 정리 (디바운스 + 쿨다운)
    if (_dupCleanupTimer) return;
    if (Date.now() - _dupCleanupLastRun < DUP_CLEANUP_COOLDOWN_MS) return;

    _dupCleanupTimer = setTimeout(async () => {
        _dupCleanupTimer = null;
        if (isStaleDay()) return;
        try {
            await cleanupDuplicateOngoing(workRecordsColRef, dupes);
            _dupCleanupLastRun = Date.now();
        } catch (e) {
            console.error('자동 중복 정리 실패:', e);
        }
    }, 5_000);
}

async function cleanupDuplicateOngoing(workRecordsColRef, dupes) {
    if (isStaleDay()) return;
    const batch = writeBatch(workRecordsColRef.firestore);
    const lockColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', syncDate(), 'activeLocks');
    const now = getCurrentTime();
    let closedCount = 0;
    const closedSummaries = [];

    for (const { member, records } of dupes) {
        // startTime 오름차순으로 정렬: [가장 오래된, ..., 가장 최근]
        const sorted = [...records].sort((a, b) =>
            (a.startTime || '').localeCompare(b.startTime || '')
        );
        const keepIdx = sorted.length - 1; // 가장 최근 1건 유지
        const keep = sorted[keepIdx];

        for (let i = 0; i < sorted.length; i++) {
            if (i === keepIdx) continue;
            const r = sorted[i];
            // 종료 시각: 다음 레코드의 startTime (있으면) — 자연스러운 끊김
            const nextStart = sorted[i + 1]?.startTime || null;
            const endTime = (nextStart && nextStart > (r.startTime || '00:00')) ? nextStart : now;

            // pauses 정리: 미종료 pause가 있으면 endTime에서 닫음
            const pauses = Array.isArray(r.pauses) ? r.pauses.map(p => ({ ...p })) : [];
            // `=== null` 이 아니라 `!p.end` — end 키가 아예 없는 휴식(undefined)은
            // 닫히지 않고, calcDurationMinutes 가 끝없는 휴식을 무시해 휴식시간이
            // 통째로 근무시간에 더해진다. (마감 경로들과 같은 판정으로 맞춤)
            pauses.forEach(p => { if (p && !p.end) p.end = (endTime > p.start) ? endTime : p.start; });

            const duration = calcDurationMinutes(r.startTime, endTime, pauses);

            const ref = doc(workRecordsColRef, r.id);
            batch.update(ref, {
                endTime,
                duration,
                status: 'completed',
                pauses,
                autoClosedReason: 'duplicate_ongoing_cleanup'
            });
            closedCount++;
            closedSummaries.push(`${member}: '${r.task}' (${r.startTime}~${endTime}, ${duration}분)`);
        }

        // 🛡️ 멤버 잠금을 살아남는 1건으로 정렬 — 후속 종료 흐름이 정확히 해제 가능
        if (keep && keep.member) {
            batch.set(doc(lockColRef, String(keep.member)), {
                member: keep.member,
                recordId: keep.id,
                task: keep.task,
                startTime: keep.startTime,
                groupId: keep.groupId || null,
                since: Date.now(),
                resyncedBy: 'duplicate_ongoing_cleanup'
            });
        }
    }

    if (closedCount === 0) return;

    await batch.commit();
    console.warn(
        `[중복 진행 자동 정리] ${closedCount}건 종료 처리됨:\n` + closedSummaries.join('\n')
    );
    showToast(`동시 진행 중복 ${closedCount}건을 자동 정리했습니다.`);
}

function calcDurationMinutes(startHHMM, endHHMM, pauses) {
    if (!startHHMM || !endHHMM) return 0;
    const toMin = (hhmm) => {
        const [h, m] = hhmm.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    let total = toMin(endHHMM) - toMin(startHHMM);
    if (total < 0) total = 0;
    (pauses || []).forEach(p => {
        if (!p || !p.start) return;
        const pe = p.end || endHHMM;
        const dur = toMin(pe) - toMin(p.start);
        if (dur > 0) total -= dur;
    });
    return Math.max(0, total);
}

// 🛡️ 잠금 맞추기(activeLocks ↔ 진행 중 업무기록):
// - 진행 중(ongoing/paused) 기록이 없는데 잠금이 남아 있으면 그 멤버는 "이미 진행 중" 으로 오인되어
//   새 업무 시작이 막힌다 → 삭제.
// - 진행 중인데 잠금이 없으면(옛 버전에서 시작한 기록 등) 동시 시작 차단이 안 걸린다 → 만든다.
//   (2026-10-22 — 세션당 1회 돌던 backfillActiveLocksOnce 를 여기로 합쳤다. 잠금 전체를 한 번만 읽는다)
// 디바운스 + 쿨다운으로 read 비용 최소화.
let _staleLockTimer = null;
let _staleLockLastRun = 0;
const STALE_LOCK_COOLDOWN_MS = 30_000;
// 읽기 절약(2026-10-13, 2026-10-22 수정): 업무 기록이 바뀔 때마다 잠금 전체를 다시 읽지 않는다.
// 바로 확인하는 건 탭을 연 첫 스냅샷과, 이 탭에서 업무를 끝냈을 때(markLocalWorkEnded)뿐이다.
// 다른 탭에서 끝낸 업무는 끝낸 탭이 확인하므로, 여기서는 이 간격마다 한 번만 확인한다(안전망).
// (예전엔 '진행 중이던 사람이 빠지면 즉시' 였는데, 그러면 한 사람이 끝낼 때 열린 탭 전부가 잠금을 읽었다)
const STALE_LOCK_IDLE_RECHECK_MS = 10 * 60_000;
let _staleLockPrevAlive = null;
let _staleLockPending = false;   // 바로 확인해야 하는데 쿨다운에 걸려 아직 확인 못 함

/** 지금 진행 중인 기록 — 멤버별로 startTime 이 가장 늦은 1건(중복 정리가 살리는 것과 같은 기준). */
function liveRecordByMember() {
    const byMember = new Map();
    (State.appState.workRecords || []).forEach(r => {
        if (!r.member || (r.status !== 'ongoing' && r.status !== 'paused')) return;
        const prev = byMember.get(r.member);
        if (!prev || (r.startTime || '') > (prev.startTime || '')) byMember.set(r.member, r);
    });
    return byMember;
}

const isLive = (r) => !!r && (r.status === 'ongoing' || r.status === 'paused');

// 화면의 업무기록(스냅샷)은 서버보다 늦을 수 있다 — 그걸로 후보만 고르고, 실제 쓰기는 트랜잭션 안에서
// 서버의 기록·잠금을 다시 읽어 그때도 맞을 때만 한다(다른 탭이 방금 끝낸 사람에게 잠금을 되살리거나
// 방금 시작한 사람의 잠금을 지우지 않게). 후보는 드물어서 후보당 읽기 1~2건이다.
async function reconcileActiveLocksNow() {
    if (isStaleDay()) return { removed: 0, created: 0 };
    const day = syncDate();
    const lockColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', day, 'activeLocks');
    const wrColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', day, 'workRecords');
    const snap = await getDocs(lockColRef);
    if (isStaleDay()) return { removed: 0, created: 0 };

    const live = liveRecordByMember();
    const lockIds = new Set();
    const stales = [];
    snap.forEach(d => {
        lockIds.add(d.id);
        if (!live.has(d.id)) stales.push({ ref: d.ref, id: d.id, recordId: (d.data() || {}).recordId || null });
    });
    const missing = [];
    live.forEach((rec, member) => { if (rec.id && !lockIds.has(String(member))) missing.push({ member, rec }); });
    if (stales.length === 0 && missing.length === 0) return { removed: 0, created: 0 };

    const removed = [];
    for (const s of stales) {
        try {
            const ok = await runTransaction(State.db, async (tx) => {
                const lockSnap = await tx.get(s.ref);
                if (!lockSnap.exists()) return false;
                const recordId = (lockSnap.data() || {}).recordId || null;
                if (recordId !== s.recordId) return false;                 // 그 사이 다른 기록으로 바뀜(새로 시작)
                if (recordId) {
                    const recSnap = await tx.get(doc(wrColRef, String(recordId)));
                    // 서버에선 아직 진행 중이고 담당자도 그대로면 남긴다(담당자를 바꾼 기록이면 원래 사람 잠금은 지운다)
                    if (recSnap.exists() && isLive(recSnap.data()) && recSnap.data().member === s.id) return false;
                }
                // recordId 가 없는 옛 잠금은 화면 판단(진행 중 아님)만으로 지운다 — 예전과 같다
                tx.delete(s.ref);
                return true;
            });
            if (ok) removed.push(s.id);
        } catch (e) {
            console.warn('[stale lock cleanup] 건너뜀:', e && e.code);
        }
    }
    let created = 0;
    for (const { member, rec } of missing) {
        const lockRef = doc(lockColRef, String(member));
        try {
            const ok = await runTransaction(State.db, async (tx) => {
                const [recSnap, lockSnap] = await Promise.all([tx.get(doc(wrColRef, String(rec.id))), tx.get(lockRef)]);
                if (lockSnap.exists() || !recSnap.exists() || !isLive(recSnap.data())) return false;
                const r = recSnap.data();
                // 모양은 예전 backfillActiveLocksOnce 와 같다
                tx.set(lockRef, {
                    member,
                    recordId: rec.id,
                    task: r.task,
                    startTime: r.startTime,
                    groupId: r.groupId || null,
                    since: Date.now(),
                    backfilled: true
                });
                return true;
            });
            if (ok) created++;
        } catch (e) {
            console.warn('[activeLocks backfill] 건너뜀:', e && e.code);
        }
    }
    if (removed.length) {
        console.warn(`[stale lock cleanup] ${removed.length}건 정리: ${removed.join(', ')}`);
        showToast(`종료된 멤버 잠금 ${removed.length}건 자동 정리`);
    }
    if (created) console.log(`[activeLocks backfill] ${created}개 멤버의 진행 중 lock 등록.`);
    return { removed: removed.length, members: removed, created };
}

function reconcileActiveLocksDebounced() {
    const alive = new Set(liveRecordByMember().keys());
    const prev = _staleLockPrevAlive;
    _staleLockPrevAlive = alive;
    // 처음(prev 없음)이면 바로 확인 대상, 아니면 10분 안전망만(이 탭에서 끝낸 업무는 markLocalWorkEnded 가 세운다)
    if (!prev) _staleLockPending = true;
    if (!_staleLockPending && Date.now() - _staleLockLastRun < STALE_LOCK_IDLE_RECHECK_MS) return;
    if (_staleLockTimer) return;
    if (Date.now() - _staleLockLastRun < STALE_LOCK_COOLDOWN_MS) {
        // 쿨다운이 끝나면 다시 시도(기록 변경이 더 없어도 놓치지 않게)
        _staleLockTimer = setTimeout(() => { _staleLockTimer = null; reconcileActiveLocksDebounced(); },
            STALE_LOCK_COOLDOWN_MS - (Date.now() - _staleLockLastRun) + 50);
        return;
    }
    _staleLockTimer = setTimeout(async () => {
        _staleLockTimer = null;
        if (isStaleDay()) return;
        try {
            _staleLockPending = false;
            await reconcileActiveLocksNow();
            _staleLockLastRun = Date.now();
        } catch (e) {
            _staleLockPending = true;   // 다음 기회에 다시
            console.error('Stale lock reconcile failed:', e);
        }
    }, 5_000);
}

/** 이 탭에서 업무를 끝냈을 때(종료·강제 종료) 부른다 — 남은 잠금이 없는지 바로(5초 뒤) 확인한다.
 *  js/app-logic.js 의 종료 함수들과 forceEndMemberWork 가 커밋 성공 뒤에 부른다. */
export function markLocalWorkEnded() {
    _staleLockPending = true;
    try { reconcileActiveLocksDebounced(); } catch (e) { console.error('Stale lock reconcile failed:', e); }
}

/**
 * 업무기록을 끝내거나(update) 지우고(data 없음), 그 기록을 가리키는 멤버 잠금을 **같은 트랜잭션에서** 지운다.
 * 잠금은 lock.recordId 가 이 기록일 때만 지운다(같은 사람이 다른 업무를 진행 중이면 그 잠금은 둔다).
 * 기록 수정 창·진행 중 기록 삭제처럼 app-logic.js 종료 함수를 거치지 않는 경로가 쓴다 — 예전엔 잠금이 남아
 * 다음 확인(최대 10분)까지 그 사람이 새 업무를 시작하지 못했다.
 * @param {{ id: string, member?: string, data?: object|null }[]} ops
 * @param {{ dateKey?: string }} [opts] 기록 날짜(없으면 구독 중인 날짜, 구독 전이면 오늘)
 * @returns {Promise<number>} 지운 잠금 수. 실패하면 throw(기록도 안 바뀐다)
 */
export async function writeRecordsReleasingLocks(ops, { dateKey } = {}) {
    const list = (ops || []).filter(o => o && o.id);
    if (!list.length) return 0;
    const base = ['artifacts', 'team-work-logger-v2', 'daily_data', dateKey || syncDate()];
    const ids = new Set(list.map(o => String(o.id)));
    const members = [...new Set(list.map(o => o.member).filter(Boolean).map(String))];
    const hadLive = (State.appState.workRecords || []).some(r => ids.has(String(r.id)) && isLive(r));
    let released = 0;
    await runTransaction(State.db, async (tx) => {
        released = 0;
        const lockRefs = members.map(m => doc(State.db, ...base, 'activeLocks', m));
        const lockSnaps = await Promise.all(lockRefs.map(r => tx.get(r)));   // 읽기는 쓰기보다 먼저
        list.forEach(o => {
            const ref = doc(State.db, ...base, 'workRecords', String(o.id));
            if (o.data) tx.update(ref, o.data); else tx.delete(ref);
        });
        lockSnaps.forEach((ls, i) => {
            if (ls.exists() && ids.has(String((ls.data() || {}).recordId))) { tx.delete(lockRefs[i]); released++; }
        });
    });
    if (hadLive || released) markLocalWorkEnded();
    return released;
}

// 🛡️ 멤버의 ongoing/paused workRecord를 지정 시각(또는 현재 시각)으로 강제 종료.
// 외출/조퇴 등록 시점에 호출되어 비정상 진행 중 record가 외출 시간까지 끌고 가는 것을 방지.
export async function forceEndMemberWork(memberName, endHHMM) {
    if (!memberName) return { ended: 0 };
    const now = getCurrentTime();
    const cutTime = endHHMM || now;

    const colRefWR = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords');
    const lockColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'activeLocks');

    const targets = (State.appState.workRecords || []).filter(r =>
        r.member === memberName && (r.status === 'ongoing' || r.status === 'paused')
    );
    if (targets.length === 0) return { ended: 0 };

    const batch = writeBatch(State.db);
    const summaries = [];
    targets.forEach(rec => {
        // 시작 시각이 cutTime 이후이면 0분 → 아예 삭제
        const startMins = hhmmToMin(rec.startTime);
        const endMins = hhmmToMin(cutTime);
        const finalEnd = endMins < startMins ? rec.startTime : cutTime;

        const pauses = Array.isArray(rec.pauses) ? rec.pauses.map(p => ({ ...p })) : [];
        // 위와 같은 이유로 `!p.end`. end < start 가 되지 않게 최소 방어도 함께.
        pauses.forEach(p => { if (p && !p.end) p.end = (finalEnd > p.start) ? finalEnd : p.start; });
        const duration = calcDurationMinutes(rec.startTime, finalEnd, pauses);

        const recRef = doc(colRefWR, rec.id);
        if (duration <= 0) {
            batch.delete(recRef);
            summaries.push(`${rec.task}@${rec.startTime} (0분 → 삭제)`);
        } else {
            batch.update(recRef, {
                status: 'completed',
                endTime: finalEnd,
                duration,
                pauses,
                autoClosedReason: 'leave_register'
            });
            summaries.push(`${rec.task}@${rec.startTime}~${finalEnd} (${duration}분)`);
        }
        // lock 해제
        batch.delete(doc(lockColRef, memberName));
    });

    await batch.commit();
    console.warn(`[forceEndMemberWork] ${memberName}: ${targets.length}건 종료 — ${summaries.join(', ')}`);
    markLocalWorkEnded();
    return { ended: targets.length, summaries };
}

function hhmmToMin(hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return 0;
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

// 콘솔에서 즉시 강제 정리하고 싶을 때
if (typeof window !== 'undefined') {
    // 멤버 진행 중 업무 강제 종료
    window.__forceEndMemberWork = forceEndMemberWork;

    // 즉시 stale lock 전체 정리 (디바운스/쿨다운 무시)
    window.__reconcileLocks = async () => {
        const r = await reconcileActiveLocksNow();
        _staleLockLastRun = Date.now();
        return r;
    };

    // 특정 멤버 lock 강제 삭제 (긴급용)
    window.__forceUnlockMember = async (memberName) => {
        const { deleteDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const lockRef = doc(collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'activeLocks'), String(memberName));
        await deleteDoc(lockRef);
        console.log(`[force unlock] ${memberName} lock 삭제 완료`);
        showToast(`${memberName} 잠금 강제 해제 완료`);
    };

    window.__cleanupDupeOngoing = async () => {
        const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords');
        const records = (State.appState.workRecords || []).filter(r =>
            r.status === 'ongoing' || r.status === 'paused'
        );
        const byMember = new Map();
        records.forEach(r => {
            if (!r.member) return;
            if (!byMember.has(r.member)) byMember.set(r.member, []);
            byMember.get(r.member).push(r);
        });
        const dupes = [];
        byMember.forEach((arr, member) => {
            if (arr.length > 1) dupes.push({ member, records: arr });
        });
        if (dupes.length === 0) {
            console.log('✅ 중복 진행 업무 없음.');
            return;
        }
        await cleanupDuplicateOngoing(colRef, dupes);
        _dupCleanupLastRun = Date.now();
    };
}