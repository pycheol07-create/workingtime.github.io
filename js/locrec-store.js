// === js/locrec-store.js ===
// 로케이션 변경 추천 데이터(구독·처리 표시 쓰기·엑셀). 화면은 js/locrec-card.js(로케이션 띠) · js/locrec-table.js(표 창) · js/locrec-dash.js(대시보드).
// 문서 모양·순수 함수는 js/lib/locrec-view.js 머리말 참고.
// 한 탭에 store 는 하나만 둔다(getLocRecStore 싱글턴) — 같은 문서를 두 번 구독하지 않게.
//   로케이션관리는 카드를 띄울 때 start() 하고 계속 둔다. 대시보드는 표 창을 열 때 start(), 닫을 때 stop()(상시 구독 없음).
// ⚠️ Firebase 를 여기서 초기화하지 않는다 — 페이지가 만든 db·auth 를 받아 쓴다(두 번 초기화하면 duplicate-app).
// ⚠️ 표시에 남기는 이름은 getMemberName()(= memberNameFor, 직원 이름)만. 없으면 '이름 없음' — 이메일은 쓰지 않는다.
//   쓰기는 locRecWork/marks 한 곳(firestore.rules: hasFeature('location.locrec')).
import { doc, onSnapshot, setDoc, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    dayKey, parseRecDay, rowState, dayOptions, defaultDay, canMark, excelRows, EXCEL_COLS, SHEET_NAME, fileNameOf,
    stripRows, fileNameAll
} from './lib/locrec-view.js?v=202610231017';

const APP = 'artifacts/team-work-logger-v2';
const LATEST_PATH = `${APP}/integrations/locRecLatest`;
const DAY_PATH = (key) => `${APP}/integrations/locRec_${key}`;
const MARKS_PATH = `${APP}/locRecWork/marks`;
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
        marks: {}, marksErr: '', saving: new Set()
    };
    let unsubs = [], unsubDay = null, dayKeyWatching = '', unsubAuth = null, timer = null, started = false;
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
        unsubDay = onSnapshot(doc(db, DAY_PATH(key)), snap => {
            if (dayKeyWatching !== key) return;
            S.dayLoading = false;
            const data = snap.exists() ? snap.data() : null;
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
    }

    /** 구독을 모두 끊는다(대시보드에서 표 창을 닫을 때). 다시 start() 하면 처음부터 */
    function stop() {
        if (!started) return;
        started = false;
        if (unsubAuth) { try { unsubAuth(); } catch (e) { /* 무시 */ } unsubAuth = null; }
        if (timer) { clearInterval(timer); timer = null; }
        stopSnaps();
        S.authKnown = false; S.signedIn = false; S.latest = null; S.latestErr = ''; S.day = null; S.dayErr = ''; S.dayLoading = false;
        S.marks = {}; S.marksErr = ''; S.key = ''; S.userPicked = false;
        emit();
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

    /** 처리 표시(state = 'done' | 'skip', null 이면 지우기). 처음 보여 주는 날짜만 — 지난 날짜는 볼 수만 */
    async function mark(key, state) {
        if (!key || S.saving.has(key) || !canMark(S.latest, S.key, todayKey())) return;
        S.saving.add(key);
        emit();
        try {
            const val = state ? { state, by: nameOf(), at: serverTimestamp() } : deleteField();
            await setDoc(doc(db, MARKS_PATH), { marks: { [key]: val } }, { merge: true });
        } catch (e) {
            alert(`표시를 저장하지 못했습니다(${(e && e.code) || '오류'}). 다시 눌러 주세요.`);
        } finally {
            S.saving.delete(key);
            emit();
        }
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
    /** 표 창: 지금 탭(안 함도 보기면 그것까지) */
    function downloadTab(tab, showSkipped) {
        const rows = visibleRows(tab).filter(x => showSkipped || !x.st.hidden).map(x => x.r);
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
        mark, downloadTab, downloadAll, isStarted: () => started
    };
}
