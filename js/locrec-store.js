// === js/locrec-store.js ===
// 로케이션 변경 추천 데이터(구독·처리 표시 쓰기·엑셀). 화면은 js/locrec-card.js(로케이션 띠) · js/locrec-table.js(표 창) · js/locrec-dash.js(대시보드).
// 문서 모양·순수 함수는 js/lib/locrec-view.js 머리말 참고.
// 한 탭에 store 는 하나만 둔다(getLocRecStore 싱글턴) — 같은 문서를 두 번 구독하지 않게.
//   로케이션관리는 카드를 띄울 때 start() 하고 계속 둔다. 대시보드는 표 창을 열 때 start(), 닫을 때 stop()(상시 구독 없음).
// ⚠️ Firebase 를 여기서 초기화하지 않는다 — 페이지가 만든 db·auth 를 받아 쓴다(두 번 초기화하면 duplicate-app).
// ⚠️ 표시에 남기는 이름은 getMemberName()(= memberNameFor, 직원 이름)만. 없으면 '이름 없음' — 이메일은 쓰지 않는다.
//   쓰기는 locRecWork/marks 한 곳(firestore.rules: hasFeature('location.locrec')). 다시 만들기 요청 쓰기는 js/rebuild-bar.js.
// 다시 만들기: 대시보드 머리줄 [지금 재고로 다시 만들기](js/rebuild-bar.js) → 권한 쪽 요청 문서 덮어쓰기 → 이 PC 예약작업 채우기요청
//   (채우기.py --요청확인, 5분)이 채우기 지시서 뒤에 추천.py --요청확인 을 불러 오늘 문서를 바꾼다(rev +1). 여기서는 상태만 읽는다.
//   표 창이 열려 있는 동안 오늘 문서 판(dayVer — 서버 at, 없으면 rev)이 바뀌면 바로 바꾸지 않고 pendingDay 에 둔다
//   — 띠 '새 추천이 도착했습니다' [새로 보기](applyPending). 기다리는 동안 [처리함]·[안 함]·[전체 처리함]은 막고(PENDING_TEXT),
//   [처리함] 트랜잭션도 날짜 문서를 다시 읽어 보던 판(dayVer)과 다르면 쓰지 않는다(2026-11-03 옛 판으로 처리한 사건).
//   재고 업로드 자동 감지 문구용으로 Locations/INFO_CONFIG.lastDataUpdate 도 구독한다(로케이션관리는 location.js 가 이미 같은 문서를 구독).
// 데이터 리스트 반영(2026-10-29): [처리함] = 추천대로 Locations ZONE_* 상품 칸을 옮기고 marks 를 한 트랜잭션에(둘 다 쓰이거나 둘 다 안 쓰임).
//   [되돌리기] = 반영한 그날 + 그 사이 안 바뀌었으면 자리까지 원복. 계획(판정)은 js/lib/locrec-apply.js, 여기는 읽기·쓰기·확인창만.
//   ZONE 문서는 트랜잭션 안에서 직접 읽는다(대시보드는 Locations 를 구독하지 않는다). 업로드 중(locationStock/uploadStatus)이면 막는다.
//   ⚠️ 로그·alert 에는 상품코드·자리 id·e.code 만 — 상품명·rawDataStr 를 넣지 않는다.
// 도착 자리 막힘(2026-11-12): [처리함]이 도착 자리 문제(사용 중·오늘 다른 상품·선지정·예약·당일지정)로 실패하면
//   단독은 지금 자리 목록(altCtx — location.js originalData·동선 기준)으로 대신 자리(loc-recommend.js pickAltTarget)를 묻고, 예면 그 자리로 같은 트랜잭션을
//   다시 돈다(marks alt:{to}). 없거나 거절하면 '자리 막힘'(marks state blocked, block:{loc, reason}) — 그날 숨김 · 서버가 그 자리를 그날 판에서 뺀다.
//   [전체 처리함]은 끝에서 대신 자리를 하나씩 차례로 잡아(앞에서 잡은 자리는 다음 계산에서 뺌) 한 번에 묻는다. 막힘은 다시 만들기 요청을 보내지 않는다.
// 예정 자리(2026-11-12): plannedSlotMap() = 오늘 판에서 아직 처리 안 한 단독·페어·뒤로 보내기 도착 자리 — location.js 입고대기 추천·빈칸 엑셀·당일지정이 쓴다.
//   예정 자리는 표에서 고른 날짜와 상관없이 기본(오늘 — defaultDay) 판으로 센다: 지난 날짜를 보는 동안은 기본 판 문서를 따로 구독한다(planDay).
//   변경 추천 권한이 없는 로케이션관리(lite)는 구독하지 않는다 — 입고대기 추천·빈칸 엑셀·당일지정·업로드 경고를 쓸 때만 ensureFresh() 가
//   색인·marks·기본 판 날짜 문서를 getDoc 으로 한 번 읽고 LITE_TTL_MS(3분) 기억한다. 권한 있는 카드가 나중에 getLocRecStore 를 부르면 전체 구독으로 바꾼다.
// '안 함' 붙잡기(2026-11-12): 서버 색인 holds(판정.hold_list) — 붙잡혀 결과 행에서 빠진 추천도 표 '안 함도 보기'에서 [되돌리기](unhold = marks 의 skip 지우기).
// 칸수 무관 허용(2026-11-13): locRecWork/sizeAllow 를 구독하고 표 [칸수 무관 허용]이 setSizeFree 로 쓴다(코드·시각·이름만, 문서 모양은 locrec-view.js).
//   서버는 다음 판부터 그 상품을 칸수가 다른 자리로도 추천하고, 대신 자리(findAlt)도 같은 목록을 쓴다. 다시 만들기 요청은 보내지 않는다(사용자 결정).
import { doc, onSnapshot, setDoc, getDoc, serverTimestamp, deleteField, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    dayKey, parseRecDay, rowState, dayOptions, defaultDay, canMark, excelRows, EXCEL_COLS, SHEET_NAME, fileNameOf,
    stripRows, fileNameAll, recReqUi, tsMs, TABS, dayVer, movedToday, PENDING_TEXT, plannedSlots, HOLD_UNDO_TEXT,
    sizeFreeList, sizeFreeSet, sizeFreeWrite, sizeFreeCode, sizeFreeToast
} from './lib/locrec-view.js?v=202611131153';
import { laterMs } from './lib/rebuild-view.js?v=202611131153';
import { docIdsForRow, docIdsForApplied, planApply, planUndo, planClearMoves, applyFailText, undoFailText, bulkSummaryText, markOnlyOk, reasonText,
         dstBlocked, altOk, altRow, blockOf, altConfirmText, bulkAltText, EZ_REMIND_TEXT, BLOCKED_STATE,
         recentAppliedMoves } from './lib/locrec-apply.js?v=202611131153';
import { pickAltTarget, prioritiesOf } from './lib/loc-recommend.js?v=202611131153';
import { uploadView, uploadBlockText } from './lib/busy-view.js?v=202611131153';

const APP = 'artifacts/team-work-logger-v2';
const LATEST_PATH = `${APP}/integrations/locRecLatest`;
const DAY_PATH = (key) => `${APP}/integrations/locRec_${key}`;
const MARKS_PATH = `${APP}/locRecWork/marks`;
const REQUEST_PATH = `${APP}/locRecWork/request`;
const SIZE_ALLOW_PATH = `${APP}/locRecWork/sizeAllow`;     // 칸수 무관 허용 상품 { codes: {코드: {at, by}} }
const REFILL_REQUEST_PATH = `${APP}/refillWork/request`;    // 채우기 권한이 있는 사람의 요청 — 서버는 두 문서 중 늦은 쪽을 본다
const INFO_PATH = 'Locations/INFO_CONFIG';               // lastDataUpdate = 오늘 재고 올린 시각(ms, location.js Date.now())
const LOC_COLLECTION = 'Locations';
const UPLOAD_STATUS_PATH = `${APP}/locationStock/uploadStatus`;   // 오늘 재고·도면 업로드 상태(js/busy-banner.js 계약 B)
export const NO_NAME = '이름 없음';
export const LITE_TTL_MS = 3 * 60 * 1000;     // lite(권한 없는 화면) 예정 자리 자료를 기억하는 시간

export const todayKey = () => dayKey(Date.now());

let single = null;

/** 한 탭에 하나. 처음 부른 쪽의 db·auth·getMemberName 을 쓴다.
 *  opts.lite(로케이션관리에서 변경 추천 권한이 없을 때) — 구독 없이 ensureFresh() 로 필요할 때만 읽는다. lite 로 만든 뒤 lite 없이 부르면 전체로 바꾼다 */
export function getLocRecStore(opts) {
    const o = opts || {};
    if (!single) single = createLocRecStore(o);
    else if (!o.lite && single.isLite()) single.upgrade(o);
    return single;
}
/** 만들지 않고 지금 store(없으면 null) — location.js 예정 자리·엑셀 경고용 */
export const peekLocRecStore = () => single;

function createLocRecStore({ db, auth, getMemberName, sizeOf, altCtx, notify, lite }) {
    let liteMode = !!lite;
    let memberFn = getMemberName, sizeOfFn = sizeOf, altCtxFn = altCtx, notifyFn = notify;
    const S = {
        authKnown: false, signedIn: false, latest: null, latestErr: '',
        key: '', userPicked: false,
        day: null, dayErr: '', dayLoading: false,       // day = { key, data, parsed }
        marks: {}, marksErr: '', saving: new Set(),
        applying: null,                                 // [전체 처리함] 진행 { i, n } — 표 창 버튼 '반영 중 i/n'
        request: null, refillRequest: null, lastDataMs: 0,   // 다시 만들기 요청 문서 2곳 · INFO_CONFIG.lastDataUpdate
        pendingDay: null,                               // 표 창이 열려 있을 때 도착한 새 판 { key, data, parsed }
        planDay: null,                                  // 지난 날짜를 보는 동안의 기본(오늘) 판 { key, data, parsed } — 예정 자리용
        sizeAllow: null, sizeAllowErr: ''               // 칸수 무관 허용 문서 값(locRecWork/sizeAllow) · 못 읽으면 문구
    };
    let unsubs = [], unsubDay = null, dayKeyWatching = '', unsubAuth = null, timer = null, reqTimer = null, started = false;
    let unsubPlan = null, planWatching = '';
    let liteAt = 0, liteP = null;                       // lite 읽은 시각 · 읽는 중 Promise
    let hold = () => false;                             // 표 창이 열려 있는가(locrec-table.js 가 setHold 로 준다)
    const listeners = new Set();

    const emit = () => listeners.forEach(fn => { try { fn(S); } catch (e) { console.warn('[locrec]', e); } });
    const nameOf = () => {
        try { const n = memberFn && memberFn(); return (typeof n === 'string' && n.trim()) ? n.trim().slice(0, 20) : NO_NAME; }
        catch (e) { return NO_NAME; }
    };
    const entryOf = (key) => (S.latest && S.latest.days && S.latest.days[key]) || null;
    /** 선택 날짜 문서를 읽었는가 */
    const loaded = () => !!(S.signedIn && S.latest && S.day && S.day.key === S.key);

    // ── 구독 ──
    function stopDay() {
        if (unsubDay) { try { unsubDay(); } catch (e) { /* 무시 */ } unsubDay = null; }
        dayKeyWatching = '';
        S.pendingDay = null;
    }
    function stopPlan() {
        if (unsubPlan) { try { unsubPlan(); } catch (e) { /* 무시 */ } unsubPlan = null; }
        planWatching = '';
        S.planDay = null;
    }
    function stopSnaps() {
        unsubs.forEach(u => { try { u(); } catch (e) { /* 무시 */ } });
        unsubs = [];
        stopDay();
        stopPlan();
    }
    /** 고른 날짜가 기본(오늘) 판이 아니면 기본 판 문서도 따로 구독한다 — 예정 자리는 늘 기본 판으로(리뷰 2) */
    function syncPlanDay() {
        const dk = defaultDay(S.latest, todayKey());
        const e = entryOf(dk);
        if (dk === S.key || !e || e.status !== 'ok') { stopPlan(); return; }
        if (planWatching === dk) return;
        stopPlan();
        planWatching = dk;
        unsubPlan = onSnapshot(doc(db, DAY_PATH(dk)), snap => {
            if (planWatching !== dk) return;
            const data = snap.exists() ? snap.data() : null;
            S.planDay = data ? { key: dk, data, parsed: parseRecDay(data) } : null;
        }, () => { if (planWatching === dk) S.planDay = null; });
    }
    function startSnaps() {
        stopSnaps();
        unsubs.push(onSnapshot(doc(db, LATEST_PATH), snap => {
            S.latest = snap.exists() ? (snap.data() || {}) : {};
            S.latestErr = '';
            syncDay();
            emit();
        }, err => { S.latestErr = (err && err.code) || '읽기 오류'; emit(); }));
        unsubs.push(onSnapshot(doc(db, MARKS_PATH), snap => {
            const d = snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) || {}) : {};
            S.marks = (d.marks && typeof d.marks === 'object') ? d.marks : {};
            S.marksErr = '';
            emit();
        }, () => { S.marksErr = '완료 표시를 읽지 못했습니다'; emit(); }));   // 표시 없이 + 주의
        unsubs.push(onSnapshot(doc(db, SIZE_ALLOW_PATH), snap => {
            S.sizeAllow = snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) || {}) : {};
            S.sizeAllowErr = '';
            emit();
        }, () => { S.sizeAllow = null; S.sizeAllowErr = '칸수 무관 허용 목록을 읽지 못했습니다'; emit(); }));
        unsubs.push(onSnapshot(doc(db, REQUEST_PATH), snap => {
            S.request = snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) || {}) : null;
            emit();
        }, () => { S.request = null; }));
        unsubs.push(onSnapshot(doc(db, REFILL_REQUEST_PATH), snap => {
            S.refillRequest = snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) || {}) : null;
            emit();
        }, () => { S.refillRequest = null; }));
        unsubs.push(onSnapshot(doc(db, INFO_PATH), snap => {
            S.lastDataMs = snap.exists() ? tsMs((snap.data() || {}).lastDataUpdate) : 0;
            emit();
        }, () => { S.lastDataMs = 0; }));      // 못 읽으면 자동 감지 문구만 없다
    }

    function syncDay() {
        const today = todayKey();
        const opts = dayOptions(S.latest, today).map(o => o.key);
        if (!S.userPicked || !opts.includes(S.key)) S.key = defaultDay(S.latest, today);
        syncPlanDay();
        const e = entryOf(S.key);
        if (!e || e.status !== 'ok') { stopDay(); S.day = null; S.dayErr = ''; S.dayLoading = false; return; }
        if (dayKeyWatching === S.key) return;
        stopDay();
        const key = S.key;
        dayKeyWatching = key;
        S.dayLoading = true; S.dayErr = '';
        S.pendingDay = null;
        unsubDay = onSnapshot(doc(db, DAY_PATH(key)), snap => {
            if (dayKeyWatching !== key) return;
            S.dayLoading = false;
            const data = snap.exists() ? snap.data() : null;
            // 표 창을 보는 중에 다시 만든 판(dayVer 다름)이 오면 띠로만 알리고 [새로 보기] 때 바꾼다
            if (data && S.day && S.day.key === key && hold() && dayVer(data) !== dayVer(S.day.data)) {
                S.pendingDay = { key, data, parsed: parseRecDay(data) };
                emit();
                return;
            }
            S.pendingDay = null;
            S.day = data ? { key, data, parsed: parseRecDay(data) } : null;
            S.dayErr = data ? '' : '추천 문서를 찾지 못했습니다';
            emit();
        }, err => {
            if (dayKeyWatching !== key) return;
            S.dayLoading = false; S.dayErr = `추천을 읽지 못했습니다(${(err && err.code) || '오류'})`;
            emit();
        });
    }

    /** 구독 시작(여러 번 불러도 한 번). 로그인 상태를 따라 켜고 끈다. lite 는 구독하지 않는다(ensureFresh) */
    function start() {
        if (started || !db || !auth || liteMode) return;
        started = true;
        unsubAuth = auth.onAuthStateChanged(user => {
            S.authKnown = true;
            S.signedIn = !!user;
            if (user) startSnaps();
            else { stopSnaps(); S.latest = null; S.day = null; S.marks = {}; S.marksErr = ''; S.sizeAllow = null; S.sizeAllowErr = ''; }
            emit();
        });
        // 자정 넘김·'오래됨' 문구를 위해 10분마다 다시
        timer = setInterval(() => { if (S.signedIn && S.latest) { syncDay(); emit(); } }, 10 * 60 * 1000);
        // 다시 만들기 문구('PC 가 꺼져 있을 수 있음'·간격 끝)는 시간이 지나면 바뀐다 — 1분마다, 문구가 바뀔 때만 다시 그린다
        let lastNote = '';
        reqTimer = setInterval(() => {
            if (!S.signedIn || !S.latest) return;
            const u = reqState();
            const k = `${u.enabled}|${u.note}`;
            if (k !== lastNote) { lastNote = k; emit(); }
        }, 60 * 1000);
    }

    /** 구독을 모두 끊는다(대시보드에서 표 창을 닫을 때). 다시 start() 하면 처음부터 */
    function stop() {
        if (!started) return;
        started = false;
        if (unsubAuth) { try { unsubAuth(); } catch (e) { /* 무시 */ } unsubAuth = null; }
        if (timer) { clearInterval(timer); timer = null; }
        if (reqTimer) { clearInterval(reqTimer); reqTimer = null; }
        stopSnaps();
        S.authKnown = false; S.signedIn = false; S.latest = null; S.latestErr = ''; S.day = null; S.dayErr = ''; S.dayLoading = false;
        S.marks = {}; S.marksErr = ''; S.key = ''; S.userPicked = false;
        S.request = null; S.refillRequest = null; S.lastDataMs = 0; S.pendingDay = null;
        S.sizeAllow = null; S.sizeAllowErr = '';
        emit();
    }

    /** lite → 전체 구독(권한 있는 카드가 시작될 때). 함수 칸은 새 opts 것으로 */
    function upgrade(o) {
        if (o.getMemberName) memberFn = o.getMemberName;
        if (o.sizeOf) sizeOfFn = o.sizeOf;
        if (o.altCtx) altCtxFn = o.altCtx;
        if (o.notify) notifyFn = o.notify;
        if (!liteMode) return;
        liteMode = false;
        liteAt = 0;
        if (started && S.signedIn) startSnaps();
    }

    /** lite: 색인·marks·기본 판 날짜 문서를 getDoc 으로 읽어 LITE_TTL_MS 기억(실패해도 그 시간은 다시 안 읽는다).
     *  → 새로 읽었으면 true. 전체 구독 중이면(권한 있음) 늘 false(구독이 이미 최신) */
    function ensureFresh() {
        if (!liteMode || !db || !auth || !auth.currentUser) return Promise.resolve(false);
        if (liteP) return liteP;
        if (liteAt && Date.now() - liteAt < LITE_TTL_MS) return Promise.resolve(false);
        liteP = (async () => {
            try {
                const [l, m] = await Promise.all([getDoc(doc(db, LATEST_PATH)), getDoc(doc(db, MARKS_PATH))]);
                const latest = l.exists() ? (l.data() || {}) : {};
                const md = m.exists() ? (m.data({ serverTimestamps: 'estimate' }) || {}) : {};
                const key = defaultDay(latest, todayKey());
                const e = latest.days && latest.days[key];
                let day = null;
                if (e && e.status === 'ok') {
                    const d = await getDoc(doc(db, DAY_PATH(key)));
                    day = d.exists() ? { key, data: d.data(), parsed: parseRecDay(d.data()) } : null;
                }
                if (!liteMode) return false;            // 그사이 전체 구독으로 바뀜 — 구독 값을 덮지 않는다
                Object.assign(S, { signedIn: true, latest, marks: (md.marks && typeof md.marks === 'object') ? md.marks : {}, key, day });
                return true;
            } catch (e) {
                console.warn('[locrec] 예정 자리 자료를 읽지 못했습니다', (e && e.code) || '');
                return false;
            } finally {
                liteAt = Date.now();
                liteP = null;
            }
        })();
        return liteP;
    }

    /** 오늘 판 예정 자리(locrec-view.js plannedSlots) — Map<자리 id, {recKey, code}>. 표에서 고른 날짜와 상관없이 기본(오늘) 판으로.
     *  못 읽었으면 빈 Map(lite 는 ensureFresh 를 먼저 기다릴 것) */
    function plannedSlotMap() {
        if (!S.signedIn || !S.latest) return new Map();
        const today = todayKey();
        const dk = defaultDay(S.latest, today);
        const src = S.day && S.day.key === dk ? S.day : (S.planDay && S.planDay.key === dk ? S.planDay : null);
        if (!src) return new Map();
        return plannedSlots({ latest: S.latest, key: dk, todayKey: today, parsed: src.parsed, marks: S.marks, nowMs: Date.now() });
    }
    /** 최근 7일 [처리함] 반영 이동(엑셀 경고용 — locrec-apply.js recentAppliedMoves) */
    const recentMoves = () => recentAppliedMoves(S.marks, todayKey());

    /** 표 창이 열려 있는지 알려 줄 함수(열려 있으면 새 판을 pendingDay 에 둔다) */
    function setHold(fn) { hold = typeof fn === 'function' ? fn : () => false; }

    /** 기다리던 새 판으로 바꾼다(표 창 [새로 보기] · 창을 닫을 때) */
    function applyPending() {
        const p = S.pendingDay;
        if (!p) return;
        S.pendingDay = null;
        if (p.key === S.key) S.day = p;
        emit();
    }

    /** 다시 만들기 상태(recReqUi) — 오늘 날짜를 보고 있을 때만. 카드·표 창은 문구(note)만 보여 준다 —
     *  버튼은 대시보드 머리줄 하나(js/rebuild-bar.js). 요청 시각은 두 문서(locRecWork/request · refillWork/request) 중 늦은 쪽 */
    function reqState() {
        const today = todayKey();
        const L = S.latest || {};
        const requestMs = laterMs(tsMs(S.request && S.request.requestedAt), tsMs(S.refillRequest && S.refillRequest.requestedAt));
        return recReqUi({ req: L.req, requestMs, nowMs: Date.now(),
                          isToday: S.key === today, entry: entryOf(today), lastDataMs: S.lastDataMs,
                          stockDataMs: L.stockDataAt, todayKey: today });
    }

    function setDay(key) {
        S.key = key;
        S.userPicked = S.key !== defaultDay(S.latest, todayKey());
        syncDay();
        emit();
    }

    /** 선택 날짜·탭의 행 + 상태(rowState) — 안 읽었으면 [] */
    function visibleRows(tab) {
        if (!loaded()) return [];
        const list = S.day.parsed[tab] || [];
        const open = (S.latest && S.latest.open) || {};
        const today = todayKey(), now = Date.now();
        const moved = movedToday(S.marks, today);
        // 이월 행은 moved 없이(지금처럼 — recCount 와 같은 기준)
        return list.map(r => ({ r, st: rowState({ row: r, open: open[r.recKey], mark: S.marks[r.recKey], viewDay: S.key, todayKey: today, nowMs: now, moved: r.carried ? null : moved }) }));
    }

    const errCode = (e) => (e && e.code) || '오류';
    /** 보던 날짜에 새 판이 도착해 기다리는 중인가(표 창 띠 — [새로 보기] 전에는 처리 표시를 막는다) */
    const pendingNow = () => !!(S.pendingDay && S.pendingDay.key === S.key);

    /** 선택 날짜 문서에서 recKey 로 행 찾기(탭 상관없이) */
    function rowOf(key) {
        if (!loaded()) return null;
        for (const t of TABS) {
            const r = (S.day.parsed[t] || []).find(x => x.recKey === key);
            if (r) return r;
        }
        return null;
    }

    /** 표시만 쓰기(데이터 리스트는 안 건드림) — 문서 쓰기 1회. state null 이면 지우기.
     *  done·skip 은 applied 를 지운다(merge 라 옛 반영 기록이 남지 않게). 실패하면 alert 후 false */
    async function writeMarks(keys, state) {
        const list = keys.filter(k => k && !S.saving.has(k));
        if (!list.length) return false;
        if (state && pendingNow()) { alert(PENDING_TEXT); return false; }   // 표시 지우기(되돌리기)는 막지 않는다
        list.forEach(k => S.saving.add(k));
        emit();
        try {
            const by = nameOf();
            const marks = {};
            list.forEach(k => { marks[k] = state ? { state, by, at: serverTimestamp(), applied: deleteField(), alt: deleteField(), block: deleteField() } : deleteField(); });
            await setDoc(doc(db, MARKS_PATH), { marks }, { merge: true });
            return true;
        } catch (e) {
            alert(`표시를 저장하지 못했습니다(${errCode(e)}). 다시 눌러 주세요.`);
            return false;
        } finally {
            list.forEach(k => S.saving.delete(k));
            emit();
        }
    }

    /** 트랜잭션 안: 업로드 중이면 막기 문구, 아니면 null */
    async function uploadBusy(tx) {
        const up = await tx.get(doc(db, UPLOAD_STATUS_PATH));
        const v = uploadView(up.exists() ? up.data() : null, Date.now(), '');
        return v && v.active ? uploadBlockText(v) : null;
    }
    async function readZones(tx, ids) {
        const docs = {};
        for (const id of ids) {
            const s = await tx.get(doc(db, LOC_COLLECTION, id));
            docs[id] = s.exists() ? (s.data() || {}) : null;
        }
        return docs;
    }

    /** 한 추천을 데이터 리스트에 반영 + 처리함 표시(한 트랜잭션).
     *  ver = 화면이 보던 판(dayVer) — 날짜 문서를 다시 읽어 판이 바뀌었으면(없어졌으면) 쓰지 않고 'stale'.
     *  alt = 대신 자리({to}) — row 는 이미 altRow 로 to 를 바꾼 행. marks 에 alt:{to} 를 남긴다(없으면 지운다).
     *  → {status:'applied'|'already'|'marked'|'fail'|'blocked'|'stale', fail?, text?}. 권한·네트워크 오류는 throw(아무것도 안 쓰임) */
    function txApply(row, by, ver, alt) {
        const ids = docIdsForRow(row);
        const key = row.recKey;
        const dayPath = DAY_PATH(S.key);
        return runTransaction(db, async (tx) => {
            const blocked = await uploadBusy(tx);
            const mk = await tx.get(doc(db, MARKS_PATH));
            const dd = await tx.get(doc(db, dayPath));
            const docs = await readZones(tx, ids);
            if (blocked) return { status: 'blocked', text: blocked };
            if (!dd.exists() || dayVer(dd.data() || {}) !== ver) return { status: 'stale' };
            const cur = mk.exists() ? (((mk.data() || {}).marks) || {})[key] : null;
            // 다른 사람이 막 처리함 — 반영 기록(applied)을 덮어쓰지 않는다
            if (cur && cur.state === 'done') return { status: 'marked' };
            const del = deleteField();
            const plan = planApply(row, docs, Date.now(), { del });
            if (!plan.ok) return { status: 'fail', fail: { ...plan, code: plan.code || row.code } };
            Object.entries(plan.writes).forEach(([docId, locs]) => tx.set(doc(db, LOC_COLLECTION, docId), locs, { merge: true }));
            tx.set(doc(db, MARKS_PATH), { marks: { [key]: { state: 'done', by, at: serverTimestamp(), applied: plan.applied || del,
                alt: alt && alt.to ? { to: String(alt.to) } : del, block: del } } }, { merge: true });
            return { status: plan.allSkipped ? 'already' : 'applied' };
        });
    }

    /** txApply 를 저장 중 표시와 함께. 권한·네트워크 오류면 alert 후 null */
    async function runApply(key, row, alt) {
        S.saving.add(key);
        emit();
        try {
            return await txApply(row, nameOf(), dayVer(S.day && S.day.data), alt);
        } catch (e) {
            alert(`데이터 리스트에 반영하지 못했습니다(${errCode(e)}). 아무것도 바뀌지 않았습니다 — 다시 눌러 주세요.`);
            return null;
        } finally {
            S.saving.delete(key);
            emit();
        }
    }

    /** [처리함] 성공 뒤 한 줄 — 이지어드민 로케이션도 바꾸라고(location.js 는 토스트, 없으면 alert) */
    function remind() {
        try { (typeof notifyFn === 'function' ? notifyFn : (t) => alert(t))(EZ_REMIND_TEXT); } catch (e) { /* 무시 */ }
    }

    const REBUILD_HINT = '[지금 재고로 다시 만들기]나 내일 아침 추천에서, 쓸 빈 자리가 있으면 다른 자리로 다시 나옵니다';
    const BLOCK_AUTO_TEXT = (f) => `${reasonText(f)} — 처리하지 않고 넘겼습니다. ${REBUILD_HINT}.`;

    /** 짧은 안내 — location.js 는 토스트, 없으면(대시보드) alert */
    function say(t) {
        try { (typeof notifyFn === 'function' ? notifyFn : (x) => alert(x))(t); } catch (e) { /* 무시 */ }
    }

    /** 대신 자리 → {alt, why}. why: 'ok'(alt 있음) | 'none'(계산했지만 없음) | 'noCtx'(자리 목록이 없어 계산 못 함 — 대시보드) | 'notSingle'.
     *  예정 자리(plannedSlotMap) + taken(전체 처리함에서 앞서 잡은 대신 자리)을 예약으로 본다. minGain 은 색인 settings(서버 유효값), 없으면 기본 */
    function findAlt(row, taken) {
        const r = findAltRaw(row, taken);
        return r === NO_CTX ? { alt: null, why: 'noCtx' } : { alt: r, why: r ? 'ok' : 'none' };
    }
    const NO_CTX = Symbol('noCtx');
    function findAltRaw(row, taken) {
        if (typeof altCtxFn !== 'function' || !row) return NO_CTX;
        let ctx = null;
        try { ctx = altCtxFn(); } catch (e) { return NO_CTX; }
        if (!ctx || !Array.isArray(ctx.locs) || !ctx.locs.length) return NO_CTX;
        const planned = [...plannedSlotMap().keys()].concat(taken ? [...taken] : []);
        const ls = (S.latest && S.latest.settings) || {};
        const mg = ls.minGain == null || ls.minGain === '' ? NaN : Number(ls.minGain);
        try {
            return pickAltTarget({ row, locs: ctx.locs, priorities: prioritiesOf(ctx.priorities), settings: Number.isFinite(mg) ? { minGain: mg } : {},
                                   plannedSlots: planned, nowMs: Date.now(), sizeFree: [...sizeFreeCodes()] });
        } catch (e) {
            console.warn('[locrec] 대신 자리 계산 실패', (e && e.message) || e);
            return null;
        }
    }

    /** '자리 막힘' 표시 — items [{key, block:{loc, reason}}]. 트랜잭션: 그사이 남이 '처리함'으로 반영했으면 그 키는 건드리지 않는다.
     *  다시 만들기 요청은 보내지 않는다(사용자 결정). → 쓴 건수(실패하면 alert 후 0) */
    async function writeBlocked(items) {
        const list = (items || []).filter(x => x && x.key && !S.saving.has(x.key));
        if (!list.length) return 0;
        if (pendingNow()) { alert(PENDING_TEXT); return 0; }
        list.forEach(x => S.saving.add(x.key));
        emit();
        try {
            const by = nameOf();
            return await runTransaction(db, async (tx) => {
                const mk = await tx.get(doc(db, MARKS_PATH));
                const cur = mk.exists() ? (((mk.data() || {}).marks) || {}) : {};
                const del = deleteField();
                const marks = {};
                list.forEach(x => {
                    if (cur[x.key] && cur[x.key].state === 'done') return;
                    marks[x.key] = { state: BLOCKED_STATE, by, at: serverTimestamp(), block: { loc: String(x.block.loc || ''), reason: String(x.block.reason || '') },
                                     applied: del, alt: del };
                });
                const n = Object.keys(marks).length;
                if (n) tx.set(doc(db, MARKS_PATH), { marks }, { merge: true });
                return n;
            });
        } catch (e) {
            alert(`'자리 막힘'을 저장하지 못했습니다(${errCode(e)}). 다시 눌러 주세요.`);
            return 0;
        } finally {
            list.forEach(x => S.saving.delete(x.key));
            emit();
        }
    }

    /** [처리함] 한 줄 — 도착 자리 문제면 대신 자리 → 막힘 → (손으로 옮겼으면) 표시만, 그 밖의 실패는 표시만 */
    async function applyMark(key, row) {
        const r = await runApply(key, row, null);
        if (!r) return;
        if (r.status === 'blocked') { alert(r.text); return; }
        if (r.status === 'stale') { alert(PENDING_TEXT); return; }
        if (r.status === 'applied') { remind(); return; }
        if (r.status !== 'fail') return;
        const f = r.fail;
        if (dstBlocked(f)) {
            const fa = altOk(f, row) ? findAlt(row) : { alt: null, why: 'notSingle' };
            const alt = fa.alt;
            let pre = '';
            if (alt && confirm(altConfirmText(f, row, alt))) {
                const r2 = await runApply(key, altRow(row, alt), alt);
                if (!r2) return;
                if (r2.status === 'applied') { remind(); return; }
                if (r2.status === 'blocked') { alert(r2.text); return; }
                if (r2.status === 'stale') { alert(PENDING_TEXT); return; }
                if (r2.status !== 'fail') return;
                // 대신 자리 실패 — 도착 자리 문제가 아니면(출발 자리가 바뀜 등) 막힘을 남기지 않고 안내만
                if (!dstBlocked(r2.fail)) { say(`대신 자리 ${alt.to} 에도 반영하지 못했습니다(${reasonText(r2.fail)}).`); return; }
                pre = `대신 자리 ${alt.to} 도 쓸 수 없었습니다. `;
            }
            // 2026-11-13 사용자 요청: 막힘은 묻지 않는다 — 그대로 '자리 막힘'으로 남겨, 다음 다시 만들기 때 서버가
            //   그 자리를 빼고 다른 자리로 다시 추천한다. 확인창은 대신 자리 하나만(취소하면 여기서 끝, 안내는 토스트 하나).
            if (await writeBlocked([{ key, block: blockOf(f, row) }])) say(pre + BLOCK_AUTO_TEXT(f));
            return;
        }
        if (!markOnlyOk(f)) { if (!dstBlocked(f)) alert(`데이터 리스트에 반영하지 못했습니다(${reasonText(f)}).`); return; }
        if (confirm(applyFailText(f))) await writeMarks([key], 'done');
    }

    /** [되돌리기] — 반영 기록이 있으면 자리까지 원복(한 트랜잭션). 못 하면 '표시만 지울까요?'(clearMark).
     *  반영 뒤 오늘 재고를 올렸으면(INFO_CONFIG.lastDataUpdate > applied.at) 엑셀이 이동을 인정했을 수 있어 자리는 되돌리지 않는다 */
    async function undoMark(key) {
        S.saving.add(key);
        emit();
        let r = null;
        try {
            r = await runTransaction(db, async (tx) => {
                const blocked = await uploadBusy(tx);
                const mk = await tx.get(doc(db, MARKS_PATH));
                const cur = mk.exists() ? (((mk.data() || {}).marks) || {})[key] : null;
                const applied = cur && cur.applied;
                const info = applied ? await tx.get(doc(db, INFO_PATH)) : null;
                const docs = applied ? await readZones(tx, docIdsForApplied(applied)) : {};
                if (blocked) return { status: 'blocked', text: blocked };
                if (!cur) return { status: 'gone' };                       // 다른 사람이 이미 지움
                const del = deleteField();
                if (!applied) { tx.set(doc(db, MARKS_PATH), { marks: { [key]: del } }, { merge: true }); return { status: 'cleared' }; }
                const lastDataMs = info && info.exists() ? tsMs((info.data() || {}).lastDataUpdate) : 0;
                const plan = planUndo(applied, docs, Date.now(), { del, recKey: key, lastDataMs });
                if (!plan.ok) return { status: 'fail', fail: plan };
                Object.entries(plan.writes).forEach(([docId, locs]) => tx.set(doc(db, LOC_COLLECTION, docId), locs, { merge: true }));
                tx.set(doc(db, MARKS_PATH), { marks: { [key]: del } }, { merge: true });
                return { status: 'undone' };
            });
        } catch (e) {
            alert(`되돌리지 못했습니다(${errCode(e)}). 아무것도 바뀌지 않았습니다 — 다시 눌러 주세요.`);
            return;
        } finally {
            S.saving.delete(key);
            emit();
        }
        if (r.status === 'blocked') { alert(r.text); return; }
        if (r.status === 'fail' && confirm(undoFailText(r.fail))) await clearMark(key);
    }

    /** 되돌리기 못 한 표시 지우기 — 그 추천이 쓴 자리 locRecMove 만 지우고(상품 칸은 그대로) marks 도 지운다(한 트랜잭션).
     *  그래야 데이터 리스트 배지('엑셀 다름')·다음 업로드 경고가 남지 않는다 */
    async function clearMark(key) {
        S.saving.add(key);
        emit();
        try {
            const r = await runTransaction(db, async (tx) => {
                const blocked = await uploadBusy(tx);
                const mk = await tx.get(doc(db, MARKS_PATH));
                const cur = mk.exists() ? (((mk.data() || {}).marks) || {})[key] : null;
                const applied = cur && cur.applied;
                const docs = applied ? await readZones(tx, docIdsForApplied(applied)) : {};
                if (blocked) return { status: 'blocked', text: blocked };
                if (!cur) return { status: 'gone' };
                const del = deleteField();
                const writes = applied ? planClearMoves(applied, docs, key, { del }) : {};
                Object.entries(writes).forEach(([docId, locs]) => tx.set(doc(db, LOC_COLLECTION, docId), locs, { merge: true }));
                tx.set(doc(db, MARKS_PATH), { marks: { [key]: del } }, { merge: true });
                return { status: 'cleared' };
            });
            if (r.status === 'blocked') alert(r.text);
        } catch (e) {
            alert(`표시를 지우지 못했습니다(${errCode(e)}). 다시 눌러 주세요.`);
        } finally {
            S.saving.delete(key);
            emit();
        }
    }

    /** 처리 표시(state = 'done' | 'skip', null 이면 지우기). 처음 보여 주는 날짜만 — 지난 날짜는 볼 수만.
     *  'done' 은 데이터 리스트에 반영(applyMark), 반영 기록이 있는 표시를 지우면 자리도 되돌린다(undoMark). '안 함'은 표시만 */
    async function mark(key, state) {
        if (!key || S.saving.has(key) || S.applying || !canMark(S.latest, S.key, todayKey())) return;
        if ((state === 'done' || state === 'skip') && pendingNow()) { alert(PENDING_TEXT); return; }
        if (state === 'done') {
            const row = rowOf(key);
            if (row) return applyMark(key, row);
        } else if (!state && S.marks[key] && S.marks[key].applied) {
            return undoMark(key);
        } else if (!state && S.marks[key] && S.marks[key].state === 'skip') {
            return unhold(key);
        }
        await writeMarks([key], state || null);
    }

    /** '안 함' 되돌리기 — marks 의 skip 을 지운다(그 사람이 누른 것이 아니어도). 날짜와 상관없이 된다.
     *  서버는 다음 판(다시 만들기·정기 계산)부터 붙잡기를 풀고 다시 추천한다(판정.apply_marks 0단계). 결과 행에서 빠져
     *  색인 holds 에만 남은 추천도 이것으로 푼다(표 '안 함도 보기') */
    async function unhold(key) {
        if (!key || S.saving.has(key) || S.applying) return;
        if (await writeMarks([key], null)) say(HOLD_UNDO_TEXT);
    }

    /** 칸수 무관 허용 상품코드 Set(못 읽었으면 빈 Set) */
    const sizeFreeCodes = () => sizeFreeSet(S.sizeAllow);
    /** 칸수 무관 허용 목록 [{code, by, at}] — 표 '칸수 무관 보기' */
    const sizeFreeRows = () => sizeFreeList(S.sizeAllow);
    /** 저장 중 표시 키(같은 S.saving 을 쓴다 — recKey 와 겹치지 않게 앞에 sf:) */
    const sizeFreeBusyKey = (code) => `sf:${code}`;

    /** [칸수 무관 허용] 켜기·끄기 — locRecWork/sizeAllow 에 merge 쓰기 1회(날짜·새 판 대기와 상관없이). 다시 만들기 요청은 보내지 않고 안내만.
     *  → 저장했으면 true. 실패하면 alert 후 false */
    async function setSizeFree(code, on) {
        const c = sizeFreeCode(code);
        const bk = sizeFreeBusyKey(c);
        if (!c || S.saving.has(bk)) return false;
        const data = sizeFreeWrite(c, !!on, { by: nameOf(), at: serverTimestamp(), del: deleteField() });
        if (!data) return false;
        S.saving.add(bk);
        emit();
        try {
            await setDoc(doc(db, SIZE_ALLOW_PATH), data, { merge: true });
        } catch (e) {
            alert(`칸수 무관 허용을 저장하지 못했습니다(${errCode(e)}). 다시 눌러 주세요.`);
            return false;
        } finally {
            S.saving.delete(bk);
            emit();
        }
        say(sizeFreeToast(c, !!on));
        return true;
    }

    /** 여러 추천에 같은 표시 — 표 창 [전체 처리함]. 저장 중인 키는 뺀다.
     *  'done' 은 추천마다 트랜잭션 1개씩 차례로(S.applying 진행). 끝에 도착 자리 문제로 못 한 단독은 대신 자리를 하나씩 차례로 잡아
     *  (앞에서 잡은 자리는 다음 계산에서 뺌) 한 번에 묻고, 남은 도착 자리 문제는 '자리 막힘'을 한 번에 묻고, 그 밖은 '표시만 할까요?' 한 번.
     *  권한·네트워크 오류·업로드 중이면 거기서 멈춘다(이미 반영한 건은 그대로). 그 밖의 상태는 표시만 1회 쓰기 */
    async function markMany(keys, state) {
        const list = (Array.isArray(keys) ? keys : []).filter(k => k && !S.saving.has(k));
        if (!list.length || S.applying || !canMark(S.latest, S.key, todayKey())) return;
        if (state && pendingNow()) { alert(PENDING_TEXT); return; }
        if (state !== 'done') { await writeMarks(list, state || null); return; }
        const by = nameOf();
        const ver = dayVer(S.day && S.day.data);      // 시작 때 보던 판 — 도중에 새 판이 오면 거기서 멈춘다
        let fails = [];
        let ok = 0, done = 0, stopText = '';      // ok = 실제로 자리를 옮긴 건, done = 이미 처리됨(남이 표시·이미 그 자리)
        // items 를 차례로 run(x) → x.result. 오류·업로드 중·새 판이면 거기서 멈추고 stopText
        const step = async (items, run) => {
            items.forEach(x => S.saving.add(x.key));
            S.applying = { i: 0, n: items.length };
            emit();
            try {
                for (let i = 0; i < items.length; i++) {
                    S.applying = { i: i + 1, n: items.length };
                    emit();
                    let r;
                    try { r = await run(items[i]); }
                    catch (e) { stopText = `${ok}건 반영한 뒤 멈췄습니다(${errCode(e)}). 남은 추천은 다시 눌러 주세요.`; break; }
                    if (r.status === 'blocked') { stopText = `${ok}건 반영한 뒤 멈췄습니다.\n${r.text}`; break; }
                    if (r.status === 'stale') { stopText = `${ok}건 반영한 뒤 멈췄습니다.\n${PENDING_TEXT}`; break; }
                    items[i].result = r;
                    if (r.status === 'applied') ok++;
                }
            } finally {
                items.forEach(x => S.saving.delete(x.key));
                S.applying = null;
                emit();
            }
        };
        const items = list.map(key => ({ key, row: rowOf(key) }));
        await step(items, async (x) => (x.row ? txApply(x.row, by, ver) : { status: 'fail', fail: { reason: 'badRow', code: '' } }));
        items.forEach(x => {
            const r = x.result;
            if (!r) return;
            if (r.status === 'fail') fails.push({ key: x.key, row: x.row, ...r.fail });
            else if (r.status !== 'applied') done++;
        });
        let blockedN = 0;
        // 새 판이 와서 멈췄거나 오류로 멈췄으면 대신 자리·막힘을 묻지 않는다(묻고 나서 쓰기가 막혀 말과 결과가 어긋난다)
        if (!stopText && !pendingNow()) {
            // 1) 대신 자리 — 도착 자리 문제로 못 한 단독, 하나씩 차례로(앞에서 잡은 자리는 다음 계산에서 뺀다)
            const taken = new Set();
            const alts = [];
            let noCtx = false;                                      // 대시보드 — 자리 목록이 없어 대신 자리를 계산 못 함
            fails.filter(f => altOk(f, f.row)).forEach(f => {
                const fa = findAlt(f.row, taken);
                if (fa.why === 'noCtx') noCtx = true;
                if (!fa.alt) return;
                taken.add(fa.alt.to);
                alts.push({ key: f.key, alt: fa.alt, row: altRow(f.row, fa.alt) });
            });
            if (alts.length && confirm(bulkAltText(alts.map(x => ({ code: x.row.code, from: x.row.from, to: x.alt.to }))))) {
                await step(alts, (x) => txApply(x.row, by, ver, x.alt));
                const fixed = new Set();
                alts.forEach(x => {
                    const r = x.result;
                    if (!r || r.status === 'fail') return;
                    if (r.status !== 'applied') done++;
                    fixed.add(x.key);
                });
                fails = fails.filter(f => !fixed.has(f.key));
            }
            // 2) 자리 막힘 — 남은 도착 자리 문제(대신 자리가 없거나 거절·실패)
            const dst = fails.filter(f => dstBlocked(f));
            if (!stopText && !pendingNow() && dst.length) {          // 묻지 않는다(2026-11-13) — 다음 갱신 때 다른 자리로
                void noCtx;
                blockedN = await writeBlocked(dst.map(f => ({ key: f.key, block: blockOf(f, f.row) })));
                if (blockedN) { const bk = new Set(dst.map(f => f.key)); fails = fails.filter(f => !bk.has(f.key)); }
            }
        }
        if (ok) remind();
        if (stopText) alert(stopText);
        const clean = fails.map(({ row, ...f }) => f);           // 문구에는 코드·자리·이유만
        const head = blockedN ? `쓸 수 없는 자리 ${blockedN}건은 처리하지 않고 넘겼습니다 — ${REBUILD_HINT}.\n` : '';
        if (!clean.length) { if (head) alert(head.trim()); return; }
        if (stopText || pendingNow()) { alert(head + bulkSummaryText(ok, clean, undefined, done, 0)); return; }
        // 표시만 할 수 있는 건(markOnlyOk)만 묻는다 — 오늘 다른 상품을 넣은 자리(dstMovedToday)는 요약에만
        const markable = clean.filter(markOnlyOk);
        const text = head + bulkSummaryText(ok, clean, undefined, done, markable.length);
        if (!markable.length) { alert(text); return; }
        if (confirm(text)) await writeMarks(markable.map(f => f.key), 'done');
    }

    function writeXlsx(rows, sheetName, fileName) {
        const X = window.XLSX;
        if (!X || !X.utils) { alert('엑셀 도구를 불러오지 못했습니다. 새로고침 후 다시 해 주세요.'); return; }
        if (!rows.length) return;
        const ws = X.utils.json_to_sheet(excelRows(rows, { sizeOf: sizeOfFn }), { header: EXCEL_COLS });   // 로케이션(칸수) — sizeOf 는 옛 문서 행 보충(location.js)
        ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 40 }, { wch: 25 }, { wch: 15 }];   // 기존 [변경 추천] 엑셀과 같은 폭
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, ws, sheetName);
        X.writeFile(wb, fileName);
    }
    /** 표 창: 지금 탭(안 함도 보기면 그것까지). 이월 행(지금 기준 추천에서 빠짐)은 넣지 않는다 */
    /** keep(r) — 선택: 표에서 뺀 행(예: 비축 포함 총 재고 적은 추천)은 엑셀에서도 뺀다 */
    function downloadTab(tab, showSkipped, keep) {
        const rows = visibleRows(tab).filter(x => !x.r.carried && (showSkipped || !x.st.hidden) && !x.st.other && !x.st.taken
            && (typeof keep !== 'function' || keep(x.r))).map(x => x.r);
        writeXlsx(rows, SHEET_NAME[tab], fileNameOf(tab, S.key));
    }
    /** 접힌 띠·펼친 본문: 탭과 상관없이 그날 추천 전체(단독 → 맞바꾸기 → 페어, 안 함 제외) — 띠 건수와 같은 목록 */
    function downloadAll() {
        if (!S.day || S.day.key !== S.key) return;
        const rows = stripRows({ latest: S.latest, key: S.key, todayKey: todayKey(), parsed: S.day.parsed, marks: S.marks, nowMs: Date.now() }).map(x => x.r);
        writeXlsx(rows, '변경추천', fileNameAll(S.key));
    }

    /** fn(state) 를 바뀔 때마다 부른다. 돌려준 함수로 해제 */
    function on(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    return {
        get: () => S, on, start, stop, setDay, entryOf, loaded, visibleRows,
        mark, markMany, downloadTab, downloadAll, isStarted: () => started,
        reqState, setHold, applyPending,
        isLite: () => liteMode, upgrade, plannedSlotMap, recentMoves, ensureFresh, unhold,
        setSizeFree, sizeFreeCodes, sizeFreeRows, sizeFreeBusyKey
    };
}
