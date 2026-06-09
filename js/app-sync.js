// === js/app-sync.js ===
import * as State from './state.js';
import * as DOM from './dom-elements.js';
import { getTodayDateString, getCurrentTime, showToast } from './utils.js';
// ✨ limit가 추가되었습니다.
import { doc, onSnapshot, collection, query, where, limit, writeBatch, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderDashboardLayout, renderTaskSelectionModal } from './ui.js';
import { renderTodoList } from './inspection-logic.js';
import { renderNotificationList } from './app-notifications.js';

let unsubLeave = null;
let unsubConfig = null;
let unsubToday = null;
let unsubWorkRecords = null;
export let unsubscribeNotifications = null;

// ✨ 핵심 방어막: 초기화 잠금 변수
let isListenersInitialized = false;

export function setupFirebaseListeners(renderCallback, markDirtyCallback, force = false) {
    // 🚨 라우터 이동이나 토큰 갱신 시 리스너가 중복 재실행되어 데이터를 다시 통째로 다운받는 현상 차단
    if (isListenersInitialized && !force) {
        console.log("Listeners already active. Bypassing redundant DB reads.");
        return;
    }
    isListenersInitialized = true;

    if (unsubLeave) { unsubLeave(); unsubLeave = null; }
    if (unsubConfig) { unsubConfig(); unsubConfig = null; }
    if (unsubToday) { unsubToday(); unsubToday = null; }
    if (unsubWorkRecords) { unsubWorkRecords(); unsubWorkRecords = null; }
    if (unsubscribeNotifications) { unsubscribeNotifications(); unsubscribeNotifications = null; }

    const leaveScheduleDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
    unsubLeave = onSnapshot(leaveScheduleDocRef, (docSnap) => {
        State.setPersistentLeaveSchedule(docSnap.exists() ? docSnap.data() : { onLeaveMembers: [] });
        const today = getTodayDateString();
        const leaves = State.persistentLeaveSchedule.onLeaveMembers || [];
        
        State.appState.dateBasedOnLeaveMembers = leaves.filter(entry => {
            if (['연차', '출장', '결근', '매장근무', '재택근무', '휴직', '외근'].includes(entry.type)) {
                const endDate = entry.endDate || entry.startDate;
                return entry.startDate && typeof entry.startDate === 'string' &&
                    today >= entry.startDate && today <= (endDate || entry.startDate);
            }
            return false;
        });
        markDirtyCallback();
        renderCallback();
    });

    const configDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
    unsubConfig = onSnapshot(configDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const loadedConfig = docSnap.data();
            const mergedConfig = { ...State.appConfig, ...loadedConfig };
            
            if (Array.isArray(loadedConfig.taskGroups)) mergedConfig.taskGroups = loadedConfig.taskGroups;
            State.setAppConfig(mergedConfig); 

            renderDashboardLayout(State.appConfig);
            renderTaskSelectionModal(State.appConfig.taskGroups);
            renderCallback();
        }
    });

    const todayDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
    unsubToday = onSnapshot(todayDocRef, (docSnap) => {
        const data = docSnap.exists() ? docSnap.data() : {};
        State.appState.taskQuantities = { ...data.taskQuantities };
        State.appState.partTimers = data.partTimers || [];
        State.appState.hiddenGroupIds = data.hiddenGroupIds || [];
        State.appState.dailyAttendance = data.dailyAttendance || {};
        State.appState.lunchPauseExecuted = data.lunchPauseExecuted ?? false;
        State.appState.lunchResumeExecuted = data.lunchResumeExecuted ?? false;
        
        State.appState.inspectionList = data.inspectionList || []; 
        State.appState.dailyOnLeaveMembers = data.onLeaveMembers || [];

        State.setIsDataDirty(false); 
        renderCallback();
        renderTodoList();
        
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '동기화 (메타)';
        if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
    });
    
    const workRecordsCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords');
    unsubWorkRecords = onSnapshot(workRecordsCollectionRef, (querySnapshot) => {
        State.appState.workRecords = [];
        querySnapshot.forEach(doc => State.appState.workRecords.push(doc.data()));
        State.appState.workRecords.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

        // 🛡️ 무결성 점검: 한 사람이 동시에 2개 이상 ongoing/paused 상태인 경우 감지 및 자동 정리
        try { detectAndCleanupDuplicateOngoing(workRecordsCollectionRef); } catch (e) { console.error('Duplicate check failed:', e); }

        // 🛡️ 마이그레이션: lock doc이 없는 살아있는 레코드에 backfill (1회성, 세션당 1회)
        try { backfillActiveLocksOnce(workRecordsCollectionRef); } catch (e) { console.error('Lock backfill failed:', e); }

        // 🛡️ stale lock 정리: workRecords에 ongoing/paused가 없는데 lock이 남아있으면 자동 삭제
        try { reconcileActiveLocksDebounced(); } catch (e) { console.error('Stale lock reconcile failed:', e); }

        renderCallback();
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '동기화 (업무)';
    });

    if (State.appState.currentUser) {
        const notiColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications');
        const d = new Date();
        
        // 🚨 기존 15일 -> 3일로 축소
        d.setDate(d.getDate() - 3);
        const recentDaysAgoStr = d.toISOString();

        const notiQuery = query(
            notiColRef, 
            where("targetMember", "==", State.appState.currentUser),
            where("createdAt", ">=", recentDaysAgoStr),
            limit(30) // ✨ 핵심 방어막: 최근 3일 내의 알림 중 최대 30개까지만 가져와 읽기 폭탄 방지
        );
        
        let isInitialLoad = true;

        unsubscribeNotifications = onSnapshot(notiQuery, (snapshot) => {
            const notifications = [];
            let unreadCount = 0;
            
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && !isInitialLoad) {
                    const data = change.doc.data();
                    if (!data.isRead) {
                        showToast(`🔔 새 알림이 도착했습니다.`);
                        const modal = document.getElementById('notification-modal');
                        if (modal && modal.classList.contains('hidden')) {
                            modal.classList.remove('hidden'); 
                        }
                    }
                }
            });

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
        try {
            await cleanupDuplicateOngoing(workRecordsColRef, dupes);
            _dupCleanupLastRun = Date.now();
        } catch (e) {
            console.error('자동 중복 정리 실패:', e);
        }
    }, 5_000);
}

async function cleanupDuplicateOngoing(workRecordsColRef, dupes) {
    const batch = writeBatch(workRecordsColRef.firestore);
    const lockColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'activeLocks');
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
            pauses.forEach(p => { if (p && p.end === null) p.end = endTime; });

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

// 🛡️ 마이그레이션: 살아있는 record에 대응되는 activeLock이 없으면 만들어준다.
// 세션당 한 번만 실행 (재배포 후 새로고침 시점에 자동 1회).
let _lockBackfillDone = false;
async function backfillActiveLocksOnce(workRecordsColRef) {
    if (_lockBackfillDone) return;
    const liveRecords = (State.appState.workRecords || []).filter(r =>
        r.status === 'ongoing' || r.status === 'paused'
    );
    if (liveRecords.length === 0) {
        _lockBackfillDone = true;
        return;
    }
    const lockColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'activeLocks');

    // 멤버별 최우선 1건만 lock으로 등록 (중복 시 자동 정리가 이어서 처리함)
    const byMember = new Map();
    liveRecords.forEach(r => {
        if (!r.member) return;
        const prev = byMember.get(r.member);
        if (!prev || (r.startTime || '') > (prev.startTime || '')) byMember.set(r.member, r);
    });

    const batch = writeBatch(State.db);
    let count = 0;
    byMember.forEach((rec, member) => {
        batch.set(doc(lockColRef, String(member)), {
            member,
            recordId: rec.id,
            task: rec.task,
            startTime: rec.startTime,
            groupId: rec.groupId || null,
            since: Date.now(),
            backfilled: true
        });
        count++;
    });

    if (count > 0) {
        try {
            await batch.commit();
            console.log(`[activeLocks backfill] ${count}개 멤버의 진행 중 lock 등록.`);
        } catch (e) {
            console.warn('[activeLocks backfill] commit 실패 — 일부 race 방지가 미가동일 수 있음:', e);
        }
    }
    _lockBackfillDone = true;
}

// 🛡️ Stale lock 정리:
// workRecords에 ongoing/paused 상태 레코드가 없는데도 activeLock이 남아있으면
// 그 멤버는 "이미 진행 중" 으로 오인되어 새 업무 시작이 차단됨.
// 디바운스 + 쿨다운으로 read 비용 최소화.
let _staleLockTimer = null;
let _staleLockLastRun = 0;
const STALE_LOCK_COOLDOWN_MS = 30_000;

async function reconcileActiveLocksNow() {
    const lockColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'activeLocks');
    const snap = await getDocs(lockColRef);
    const aliveMembers = new Set(
        (State.appState.workRecords || [])
            .filter(r => r.status === 'ongoing' || r.status === 'paused')
            .map(r => r.member)
    );
    const stales = [];
    snap.forEach(d => {
        if (!aliveMembers.has(d.id)) stales.push({ ref: d.ref, id: d.id });
    });
    if (stales.length === 0) return { removed: 0 };
    const batch = writeBatch(State.db);
    stales.forEach(s => batch.delete(s.ref));
    await batch.commit();
    console.warn(`[stale lock cleanup] ${stales.length}건 정리: ${stales.map(s => s.id).join(', ')}`);
    showToast(`종료된 멤버 잠금 ${stales.length}건 자동 정리`);
    return { removed: stales.length, members: stales.map(s => s.id) };
}

function reconcileActiveLocksDebounced() {
    if (_staleLockTimer) return;
    if (Date.now() - _staleLockLastRun < STALE_LOCK_COOLDOWN_MS) return;
    _staleLockTimer = setTimeout(async () => {
        _staleLockTimer = null;
        try {
            await reconcileActiveLocksNow();
            _staleLockLastRun = Date.now();
        } catch (e) {
            console.error('Stale lock reconcile failed:', e);
        }
    }, 5_000);
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
        pauses.forEach(p => { if (p && p.end === null) p.end = finalEnd; });
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