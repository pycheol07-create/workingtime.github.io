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
//   표 창이 열려 있는 동안 오늘 문서 rev 가 바뀌면 바로 바꾸지 않고 pendingDay 에 둔다 — 띠 '새 추천이 도착했습니다' [새로 보기](applyPending).
//   재고 업로드 자동 감지 문구용으로 Locations/INFO_CONFIG.lastDataUpdate 도 구독한다(로케이션관리는 location.js 가 이미 같은 문서를 구독).
// 데이터 리스트 반영(2026-10-29): [처리함] = 추천대로 Locations ZONE_* 상품 칸을 옮기고 marks 를 한 트랜잭션에(둘 다 쓰이거나 둘 다 안 쓰임).
//   [되돌리기] = 반영한 그날 + 그 사이 안 바뀌었으면 자리까지 원복. 계획(판정)은 js/lib/locrec-apply.js, 여기는 읽기·쓰기·확인창만.
//   ZONE 문서는 트랜잭션 안에서 직접 읽는다(대시보드는 Locations 를 구독하지 않는다). 업로드 중(locationStock/uploadStatus)이면 막는다.
//   ⚠️ 로그·alert 에는 상품코드·자리 id·e.code 만 — 상품명·rawDataStr 를 넣지 않는다.
import { doc, onSnapshot, setDoc, serverTimestamp, deleteField, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    dayKey, parseRecDay, rowState, dayOptions, defaultDay, canMark, excelRows, EXCEL_COLS, SHEET_NAME, fileNameOf,
    stripRows, fileNameAll, recReqUi, tsMs, TABS
} from './lib/locrec-view.js?v=202610291119';
import { laterMs } from './lib/rebuild-view.js?v=202610291119';
import { docIdsForRow, docIdsForApplied, planApply, planUndo, planClearMoves, applyFailText, undoFailText, bulkSummaryText } from './lib/locrec-apply.js?v=202610291119';
import { uploadView, uploadBlockText } from './lib/busy-view.js?v=202610291119';

const APP = 'artifacts/team-work-logger-v2';
const LATEST_PATH = `${APP}/integrations/locRecLatest`;
const DAY_PATH = (key) => `${APP}/integrations/locRec_${key}`;
const MARKS_PATH = `${APP}/locRecWork/marks`;
const REQUEST_PATH = `${APP}/locRecWork/request`;
const REFILL_REQUEST_PATH = `${APP}/refillWork/request`;    // 채우기 권한이 있는 사람의 요청 — 서버는 두 문서 중 늦은 쪽을 본다
const INFO_PATH = 'Locations/INFO_CONFIG';               // lastDataUpdate = 오늘 재고 올린 시각(ms, location.js Date.now())
const LOC_COLLECTION = 'Locations';
const UPLOAD_STATUS_PATH = `${APP}/locationStock/uploadStatus`;   // 오늘 재고·도면 업로드 상태(js/busy-banner.js 계약 B)
export const NO_NAME = '이름 없음';

export const todayKey = () => dayKey(Date.now());

let single = null;

/** 한 탭에 하나. 처음 부른 쪽의 db·auth·getMemberName 을 쓴다 */
export function getLocRecStore(opts) {
    if (!single) single = createLocRecStore(opts || {});
    return single;
}

function createLocRecStore({ db, auth, getMemberName }) {
    const S = {
        authKnown: false, signedIn: false, latest: null, latestErr: '',
        key: '', userPicked: false,
        day: null, dayErr: '', dayLoading: false,       // day = { key, data, parsed }
        marks: {}, marksErr: '', saving: new Set(),
        applying: null,                                 // [전체 처리함] 진행 { i, n } — 표 창 버튼 '반영 중 i/n'
        request: null, refillRequest: null, lastDataMs: 0,   // 다시 만들기 요청 문서 2곳 · INFO_CONFIG.lastDataUpdate
        pendingDay: null                                // 표 창이 열려 있을 때 도착한 새 판 { key, data, parsed }
    };
    let unsubs = [], unsubDay = null, dayKeyWatching = '', unsubAuth = null, timer = null, reqTimer = null, started = false;
    let hold = () => false;                             // 표 창이 열려 있는가(locrec-table.js 가 setHold 로 준다)
    const listeners = new Set();

    const emit = () => listeners.forEach(fn => { try { fn(S); } catch (e) { console.warn('[locrec]', e); } });
    const nameOf = () => {
        try { const n = getMemberName && getMemberName(); return (typeof n === 'string' && n.trim()) ? n.trim().slice(0, 20) : NO_NAME; }
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
    function stopSnaps() {
        unsubs.forEach(u => { try { u(); } catch (e) { /* 무시 */ } });
        unsubs = [];
        stopDay();
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
            // 표 창을 보는 중에 다시 만든 판(rev 다름)이 오면 띠로만 알리고 [새로 보기] 때 바꾼다
            if (data && S.day && S.day.key === key && hold() && (data.rev || 0) !== (S.day.data.rev || 0)) {
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

    /** 구독 시작(여러 번 불러도 한 번). 로그인 상태를 따라 켜고 끈다 */
    function start() {
        if (started || !db || !auth) return;
        started = true;
        unsubAuth = auth.onAuthStateChanged(user => {
            S.authKnown = true;
            S.signedIn = !!user;
            if (user) startSnaps();
            else { stopSnaps(); S.latest = null; S.day = null; S.marks = {}; S.marksErr = ''; }
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
        emit();
    }

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
        return list.map(r => ({ r, st: rowState({ row: r, open: open[r.recKey], mark: S.marks[r.recKey], viewDay: S.key, todayKey: today, nowMs: now }) }));
    }

    const errCode = (e) => (e && e.code) || '오류';

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
        list.forEach(k => S.saving.add(k));
        emit();
        try {
            const by = nameOf();
            const marks = {};
            list.forEach(k => { marks[k] = state ? { state, by, at: serverTimestamp(), applied: deleteField() } : deleteField(); });
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
     *  → {status:'applied'|'already'|'marked'|'fail'|'blocked', fail?, text?}. 권한·네트워크 오류는 throw(아무것도 안 쓰임) */
    function txApply(row, by) {
        const ids = docIdsForRow(row);
        const key = row.recKey;
        return runTransaction(db, async (tx) => {
            const blocked = await uploadBusy(tx);
            const mk = await tx.get(doc(db, MARKS_PATH));
            const docs = await readZones(tx, ids);
            if (blocked) return { status: 'blocked', text: blocked };
            const cur = mk.exists() ? (((mk.data() || {}).marks) || {})[key] : null;
            // 다른 사람이 막 처리함 — 반영 기록(applied)을 덮어쓰지 않는다
            if (cur && cur.state === 'done') return { status: 'marked' };
            const del = deleteField();
            const plan = planApply(row, docs, Date.now(), { del });
            if (!plan.ok) return { status: 'fail', fail: { ...plan, code: plan.code || row.code } };
            Object.entries(plan.writes).forEach(([docId, locs]) => tx.set(doc(db, LOC_COLLECTION, docId), locs, { merge: true }));
            tx.set(doc(db, MARKS_PATH), { marks: { [key]: { state: 'done', by, at: serverTimestamp(), applied: plan.applied || del } } }, { merge: true });
            return { status: plan.allSkipped ? 'already' : 'applied' };
        });
    }

    /** [처리함] 한 줄 — 반영 못 하면 '표시만 할까요?' */
    async function applyMark(key, row) {
        S.saving.add(key);
        emit();
        let r = null;
        try {
            r = await txApply(row, nameOf());
        } catch (e) {
            alert(`데이터 리스트에 반영하지 못했습니다(${errCode(e)}). 아무것도 바뀌지 않았습니다 — 다시 눌러 주세요.`);
            return;
        } finally {
            S.saving.delete(key);
            emit();
        }
        if (r.status === 'blocked') { alert(r.text); return; }
        if (r.status === 'fail' && confirm(applyFailText(r.fail))) await writeMarks([key], 'done');
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
        if (state === 'done') {
            const row = rowOf(key);
            if (row) return applyMark(key, row);
        } else if (!state && S.marks[key] && S.marks[key].applied) {
            return undoMark(key);
        }
        await writeMarks([key], state || null);
    }

    /** 여러 추천에 같은 표시 — 표 창 [전체 처리함]. 저장 중인 키는 뺀다.
     *  'done' 은 추천마다 트랜잭션 1개씩 차례로(S.applying 진행), 끝에 못 한 건을 모아 '표시만 할까요?' 한 번.
     *  권한·네트워크 오류·업로드 중이면 거기서 멈춘다(이미 반영한 건은 그대로). 그 밖의 상태는 표시만 1회 쓰기 */
    async function markMany(keys, state) {
        const list = (Array.isArray(keys) ? keys : []).filter(k => k && !S.saving.has(k));
        if (!list.length || S.applying || !canMark(S.latest, S.key, todayKey())) return;
        if (state !== 'done') { await writeMarks(list, state || null); return; }
        const by = nameOf();
        const fails = [];
        let ok = 0, done = 0, stopText = '';      // ok = 실제로 자리를 옮긴 건, done = 이미 처리됨(남이 표시·이미 그 자리)
        list.forEach(k => S.saving.add(k));
        S.applying = { i: 0, n: list.length };
        emit();
        try {
            for (let i = 0; i < list.length; i++) {
                const key = list[i];
                S.applying = { i: i + 1, n: list.length };
                emit();
                const row = rowOf(key);
                if (!row) { fails.push({ key, reason: 'badRow', code: '' }); continue; }
                let r;
                try { r = await txApply(row, by); }
                catch (e) { stopText = `${ok}건 반영한 뒤 멈췄습니다(${errCode(e)}). 남은 추천은 다시 눌러 주세요.`; break; }
                if (r.status === 'blocked') { stopText = `${ok}건 반영한 뒤 멈췄습니다.\n${r.text}`; break; }
                if (r.status === 'fail') fails.push({ key, ...r.fail });
                else if (r.status === 'applied') ok++;
                else done++;
            }
        } finally {
            list.forEach(k => S.saving.delete(k));
            S.applying = null;
            emit();
        }
        if (stopText) alert(stopText);
        if (fails.length && confirm(bulkSummaryText(ok, fails, undefined, done))) await writeMarks(fails.map(f => f.key), 'done');
    }

    function writeXlsx(rows, sheetName, fileName) {
        const X = window.XLSX;
        if (!X || !X.utils) { alert('엑셀 도구를 불러오지 못했습니다. 새로고침 후 다시 해 주세요.'); return; }
        if (!rows.length) return;
        const ws = X.utils.json_to_sheet(excelRows(rows), { header: EXCEL_COLS });
        ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 40 }, { wch: 25 }, { wch: 15 }];   // 기존 [변경 추천] 엑셀과 같은 폭
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, ws, sheetName);
        X.writeFile(wb, fileName);
    }
    /** 표 창: 지금 탭(안 함도 보기면 그것까지). 이월 행(지금 기준 추천에서 빠짐)은 넣지 않는다 */
    function downloadTab(tab, showSkipped) {
        const rows = visibleRows(tab).filter(x => !x.r.carried && (showSkipped || !x.st.hidden)).map(x => x.r);
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
        reqState, setHold, applyPending
    };
}
