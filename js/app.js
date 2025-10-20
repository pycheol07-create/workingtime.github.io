/* Refactored main app module: refactored_app.js
 - 개선사항 반영:
   1) Firebase config 노출 제거: 런타임에서 안전하게 제공 (window.__FIREBASE_CONFIG__ 또는 /api/firebase-config 사용)
   2) 중복/충돌 방지를 위한 Firestore merge, 트랜잭션 사용
   3) 저장 debounce + 백오프 재시도 로직 추가
   4) ID 생성에 crypto.randomUUID 사용
   4) 시간 계산 유틸 정리 및 타이머 안정화
   5) 코드 구조 모듈화(핸들러/저장/타이머/렌더 분리)

주의: 이 파일은 브라우저에서 동작할 때 firebaseConfig를 직접 포함하지 않습니다.
서버에서 안전하게 제공하거나 빌드 타임 환경변수로 주입하세요.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { teamGroups, taskGroups, taskTypes } from './config.js'; // config.js는 민감정보 제외 버전으로 유지
import * as UI from './ui.js';
import * as U from './utils.js';

// ---------- 설정 및 상태 ----------
const APP_ID = 'team-work-logger-v2';
let db, auth;
let appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
let saveDebounceTimer = null;
let saveRetryCount = 0;
const MAX_SAVE_RETRY = 4;
const SAVE_DEBOUNCE_MS = 800; // 자주 호출되는 저장을 디바운스

// ---------- Firebase 초기화 (config를 노출하지 않음) ----------
function initFirebaseRuntime() {
    const cfg = window.__FIREBASE_CONFIG__ || null;
    if (!cfg) {
        console.warn('Firebase config not found on window.__FIREBASE_CONFIG__. Call a secure endpoint to inject it.');
        return false;
    }
    try {
        const app = initializeApp(cfg);
        db = getFirestore(app);
        auth = getAuth(app);
        signInAnonymously(auth).catch(e => console.error('Anonymous sign-in failed', e));
        onAuthStateChanged(auth, user => {
            if (user) {
                console.log('Authenticated (anonymous) uid=', user.uid);
                // 로컬 스토어 로딩 시도
                loadStateFromFirestore().then(() => renderAll());
            }
        });
        return true;
    } catch (e) {
        console.error('Firebase init error', e);
        return false;
    }
}

// ---------- 안정적인 ID 생성 ----------
function genId(prefix = '') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return prefix + crypto.randomUUID();
    return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

// ---------- 저장 로직 (debounced + retry + transaction/merge) ----------
function scheduleSaveState() {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
        saveStateToFirestore().catch(err => console.error('saveState failed', err));
    }, SAVE_DEBOUNCE_MS);
}

async function saveStateToFirestore() {
    if (!db || !auth || !auth.currentUser) {
        console.warn('saveState skipped: not initialized or not authenticated');
        return;
    }
    const dateKey = U.getTodayDateString();
    const docRef = doc(db, 'artifacts', APP_ID, 'daily_data', dateKey);

    const payload = {
        state: JSON.stringify(appState),
        updatedAt: new Date().toISOString()
    };

    // retry logic with exponential backoff
    try {
        await setDoc(docRef, payload, { merge: true });
        saveRetryCount = 0;
        console.log('State saved (merge).');
    } catch (e) {
        saveRetryCount++;
        if (saveRetryCount <= MAX_SAVE_RETRY) {
            const backoff = Math.pow(2, saveRetryCount) * 300;
            console.warn(`Save failed, retrying in ${backoff}ms`, e);
            await new Promise(r => setTimeout(r, backoff));
            return saveStateToFirestore();
        }
        saveRetryCount = 0;
        U.showToast('데이터 저장 실패(네트워크 문제).', true);
        throw e;
    }
}

// ---------- Load 로직 (검증 포함) ----------
async function loadStateFromFirestore() {
    if (!db) return;
    const dateKey = U.getTodayDateString();
    const docRef = doc(db, 'artifacts', APP_ID, 'daily_data', dateKey);
    try {
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
            console.info('No existing daily state. Initializing default.');
            // 기본 taskQuantities 보장
            taskTypes.forEach(t => { appState.taskQuantities[t] = appState.taskQuantities[t] || 0; });
            return;
        }
        const data = snap.data();
        if (data && data.state) {
            try {
                const parsed = JSON.parse(data.state);
                // 최소 스키마 체크
                if (!Array.isArray(parsed.workRecords)) parsed.workRecords = [];
                parsed.taskQuantities = parsed.taskQuantities || {};
                parsed.onLeaveMembers = parsed.onLeaveMembers || [];
                appState = { ...appState, ...parsed };
                console.log('Loaded appState from firestore.');
            } catch (e) {
                console.error('Failed to parse stored state, ignoring.');
            }
        }
    } catch (e) {
        console.error('Error loading state from firestore', e);
    }
}

// ---------- 고수준 작업 API (시작/중지/일시정지 등) ----------
function startWorkGroup(members, task) {
    if (!Array.isArray(members) || members.length === 0) return;
    const groupId = Date.now();
    const startTime = U.getCurrentTime();
    const newRecords = members.map(member => ({
        id: genId('r-'),
        member,
        task,
        startTime,
        endTime: null,
        duration: null,
        status: 'ongoing',
        groupId,
        pauses: []
    }));
    appState.workRecords = [...(appState.workRecords || []), ...newRecords];
    scheduleSaveState();
    renderAll();
}

function pauseWorkGroup(groupId) {
    const now = U.getCurrentTime();
    let changed = false;
    (appState.workRecords || []).forEach(r => {
        if (r.groupId === groupId && r.status === 'ongoing') {
            r.status = 'paused';
            r.pauses = r.pauses || [];
            r.pauses.push({ start: now, end: null });
            changed = true;
        }
    });
    if (changed) { scheduleSaveState(); renderAll(); }
}

function resumeWorkGroup(groupId) {
    const now = U.getCurrentTime();
    let changed = false;
    (appState.workRecords || []).forEach(r => {
        if (r.groupId === groupId && r.status === 'paused') {
            r.status = 'ongoing';
            const lastPause = r.pauses && r.pauses[r.pauses.length - 1];
            if (lastPause && lastPause.end === null) lastPause.end = now;
            changed = true;
        }
    });
    if (changed) { scheduleSaveState(); renderAll(); }
}

function stopWorkGroup(groupId, quantityMap = null) {
    const now = U.getCurrentTime();
    let changed = false;
    (appState.workRecords || []).forEach(r => {
        if (r.groupId === groupId && (r.status === 'ongoing' || r.status === 'paused')) {
            if (r.status === 'paused') {
                const lastPause = r.pauses && r.pauses[r.pauses.length - 1];
                if (lastPause && lastPause.end === null) lastPause.end = now;
            }
            r.status = 'completed';
            r.endTime = now;
            r.duration = calcRecordDurationMinutes(r);
            changed = true;
        }
    });
    if (quantityMap) {
        Object.entries(quantityMap).forEach(([task, qty]) => {
            const q = parseInt(qty, 10);
            if (!isNaN(q) && q > 0) appState.taskQuantities[task] = (appState.taskQuantities[task] || 0) + q;
        });
    }
    if (changed) { scheduleSaveState(); renderAll(); }
}

function stopWorkIndividual(recordId) {
    const now = U.getCurrentTime();
    const rec = (appState.workRecords || []).find(r => r.id === recordId);
    if (!rec) return;
    if (rec.status === 'paused') {
        const lastPause = rec.pauses && rec.pauses[rec.pauses.length - 1];
        if (lastPause && lastPause.end === null) lastPause.end = now;
    }
    rec.status = 'completed';
    rec.endTime = now;
    rec.duration = calcRecordDurationMinutes(rec);
    scheduleSaveState(); renderAll();
}

function calcRecordDurationMinutes(record) {
    try {
        const start = new Date(`1970-01-01T${record.startTime}`);
        const end = record.endTime ? new Date(`1970-01-01T${record.endTime}`) : new Date();
        if (isNaN(start) || isNaN(end) || end < start) return 0;
        let totalPauseMin = 0;
        (record.pauses || []).forEach(p => {
            if (p.start && p.end) {
                const ps = new Date(`1970-01-01T${p.start}`);
                const pe = new Date(`1970-01-01T${p.end}`);
                if (!isNaN(ps) && !isNaN(pe) && pe > ps) totalPauseMin += (pe - ps) / 60000;
            }
        });
        const minutes = (end - start) / 60000 - totalPauseMin;
        return Math.max(0, Math.round(minutes));
    } catch (e) {
        console.error('duration calc error', e);
        return 0;
    }
}

// ---------- 고급 저장: 중간저장/마감(트랜잭션 사용) ----------
async function saveProgressToHistory() {
    if (!db) throw new Error('db not initialized');
    const dateKey = U.getTodayDateString();
    const historyRef = doc(db, 'artifacts', APP_ID, 'history', dateKey);

    // 트랜잭션을 사용해 병합 처리
    try {
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(historyRef);
            let existing = { workRecords: [], taskQuantities: {}, onLeaveMembers: [] };
            if (snap.exists()) existing = snap.data();
            const completed = (appState.workRecords || []).filter(r => r.status === 'completed');
            const combined = [...(existing.workRecords || []), ...completed];
            // 중복 제거
            const unique = Array.from(new Map(combined.map(i => [i.id, i])).values());
            const mergedQuantities = { ...(existing.taskQuantities || {}) };
            Object.entries(appState.taskQuantities || {}).forEach(([k,v]) => { mergedQuantities[k] = (mergedQuantities[k] || 0) + (Number(v) || 0); });
            tx.set(historyRef, { workRecords: unique, taskQuantities: mergedQuantities, onLeaveMembers: appState.onLeaveMembers || [] });
        });
        // 완료된 레코드 앱 상태에서 제거
        appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
        // 처리량 초기화
        appState.taskQuantities = {};
        taskTypes.forEach(t => { appState.taskQuantities[t] = 0; });
        await saveStateToFirestore();
        U.showToast('중간 저장 완료');
        renderAll();
    } catch (e) {
        console.error('saveProgressToHistory failed', e);
        U.showToast('중간 저장 실패', true);
        throw e;
    }
}

async function finalizeDayAndReset() {
    // 진행중인 기록 강제 완료
    const ongoing = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    if (ongoing.length > 0) {
        const now = U.getCurrentTime();
        ongoing.forEach(r => {
            if (r.status === 'paused') {
                const lastPause = r.pauses && r.pauses[r.pauses.length-1];
                if (lastPause && lastPause.end === null) lastPause.end = now;
            }
            r.status = 'completed';
            r.endTime = now;
            r.duration = calcRecordDurationMinutes(r);
        });
        await saveStateToFirestore();
    }
    await saveProgressToHistory();
    // 상태 초기화
    appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], hiddenGroupIds: [], partTimers: [] };
    taskTypes.forEach(t => appState.taskQuantities[t] = 0);
    await saveStateToFirestore();
    U.showToast('오늘의 업무를 마감하고 초기화했습니다.');
    renderAll();
}

// ---------- 렌더링 헬퍼 ----------
function renderAll() {
    UI.renderRealtimeStatus(appState);
    UI.renderCompletedWorkLog(appState);
    UI.updateSummary && UI.updateSummary(appState);
    UI.renderTaskAnalysis(appState);
    // 실시간 경과시간 업데이트는 UI 내부에 맡김
}

// ---------- 공개 API (index.html에서 연결) ----------
window.__refactored = {
    init: () => {
        const ok = initFirebaseRuntime();
        if (!ok) U.showToast('Firebase 설정이 필요합니다. 서버에서 안전하게 제공하세요.', true);
    },
    startWorkGroup,
    pauseWorkGroup,
    resumeWorkGroup,
    stopWorkGroup,
    stopWorkIndividual,
    saveProgressToHistory,
    finalizeDayAndReset,
    getState: () => JSON.parse(JSON.stringify(appState)),
    setStateForTesting: (s) => { appState = s; renderAll(); }
};

// 자동 init 시도 (index에서 window.__FIREBASE_CONFIG__를 설정한 경우)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => { try { window.__refactored && window.__refactored.init(); } catch(e){} }, 50);
} else {
    window.addEventListener('DOMContentLoaded', () => { try { window.__refactored && window.__refactored.init(); } catch(e){} });
}
