// === js/refill-store.js ===
// 채우기 지시서 데이터(구독·rev 캐시·쓰기). 화면은 js/refill-card.js(로케이션 띠) · js/refill-table.js(표 창) · js/refill-dash.js(대시보드).
// 문서 모양·순수 함수는 js/lib/refill-view.js 머리말 참고.
// 한 탭에 store 는 하나만 둔다(getRefillStore 싱글턴) — 같은 문서를 두 번 구독하지 않게.
// ⚠️ Firebase 를 여기서 초기화하지 않는다 — 페이지가 만든 db·auth 를 받아 쓴다(두 번 초기화하면 duplicate-app).
// ⚠️ 체크·요청에 남기는 이름은 getMemberName()(= memberNameFor, 직원 이름)만. 없으면 '이름 없음' — 이메일은 쓰지 않는다.
// 💰 그날 지시서 문서(refillDay_*)에는 엑셀(base64)이 들어 있다 — 날짜나 rev 가 바뀔 때만 getDoc 1회. 매번 구독하지 않는다.
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getHolidayName } from './utils.js?v=202610201426';
import { tsMs, dayKey, lastDays, parseDay, progress, runDay, reqUi, b64ToBytes, fileNameOf } from './lib/refill-view.js?v=202610201426';

const APP = 'artifacts/team-work-logger-v2';
const META_PATH = `${APP}/integrations/refillLatest`;
const DAY_PATH = (key) => `${APP}/integrations/refillDay_${key}`;
const WORK_PATH = (key) => `${APP}/refillWork/${key}`;
const REQUEST_PATH = `${APP}/refillWork/request`;
export const NO_NAME = '이름 없음';
export const SHEETS = { rows: '채우기(현장용)', checks: '확인필요' };
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const todayKey = () => dayKey(Date.now());
export const holidayName = (y, m, d) => getHolidayName(y, m, d);

let single = null;

/** 한 탭에 하나. 처음 부른 쪽의 db·auth·getMemberName 을 쓴다. watchRequest=false 면 다시 만들기 요청 문서를 구독하지 않는다(대시보드). */
export function getRefillStore(opts) {
    if (!single) single = createRefillStore(opts || {});
    return single;
}

function createRefillStore({ db, auth, getMemberName, watchRequest = true }) {
    const S = {
        signedIn: false, meta: null, metaErr: '', request: null,
        key: '', userPicked: false,            // 선택한 날짜(기본 = 오늘)
        day: null,                             // { key, rev, data, parsed } — 선택 날짜 문서
        dayLoading: '', dayErr: '',
        work: { key: '', checks: {} },
        saving: new Set()
    };
    let unsubs = [], unsubWork = null, unsubAuth = null, timer = null, started = false;
    const listeners = new Set();

    const emit = () => listeners.forEach(fn => { try { fn(S); } catch (e) { console.warn('[refill]', e); } });
    const nameOf = () => {
        try { const n = getMemberName && getMemberName(); return (typeof n === 'string' && n.trim()) ? n.trim().slice(0, 20) : NO_NAME; }
        catch (e) { return NO_NAME; }
    };
    const entryOf = (key) => (S.meta && S.meta.days && S.meta.days[key]) || null;
    /** 선택 날짜의 지시서(읽은 것만) — 없으면 null */
    const currentDay = () => (S.day && S.day.key === S.key ? S.day : null);

    // ── 구독 ──
    function stopSnaps() {
        unsubs.forEach(u => { try { u(); } catch (e) { /* 무시 */ } });
        unsubs = [];
        if (unsubWork) { try { unsubWork(); } catch (e) { /* 무시 */ } unsubWork = null; }
        S.work = { key: '', checks: {} };
    }

    function startSnaps() {
        stopSnaps();
        unsubs.push(onSnapshot(doc(db, META_PATH), snap => {
            S.meta = snap.exists() ? (snap.data() || {}) : {};
            S.metaErr = '';
            syncDay();
            emit();
        }, err => { S.metaErr = (err && err.code) || '읽기 오류'; emit(); }));
        if (watchRequest) {
            unsubs.push(onSnapshot(doc(db, REQUEST_PATH), snap => {
                S.request = snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) || {}) : null;
                emit();
            }, () => { S.request = null; }));
        }
    }

    // 선택 날짜 문서: 날짜가 바뀌거나 그날 rev 가 바뀔 때만 다시 읽는다(xlsx 가 들어 있어 매번 받지 않는다)
    function syncDay() {
        const today = todayKey();
        if (!S.userPicked || !lastDays(today, 7).includes(S.key)) S.key = today;
        const e = entryOf(S.key);
        const rev = e && e.status === 'ok' ? e.rev : null;
        if (rev == null) {
            S.day = null; S.dayErr = '';
        } else if (!S.day || S.day.key !== S.key || S.day.rev !== rev) {
            const key = S.key, want = `${key}#${rev}`;
            if (S.dayLoading !== want) {
                S.dayLoading = want;
                getDoc(doc(db, DAY_PATH(key))).then(snap => {
                    if (S.dayLoading !== want) return;
                    S.dayLoading = '';
                    const data = snap.exists() ? snap.data() : null;
                    S.day = data ? { key, rev, data, parsed: parseDay(data) } : null;
                    S.dayErr = data ? '' : '지시서 문서를 찾지 못했습니다';
                    emit();
                }).catch(err => {
                    if (S.dayLoading !== want) return;
                    S.dayLoading = ''; S.dayErr = `지시서를 읽지 못했습니다(${(err && err.code) || '오류'})`;
                    emit();
                });
            }
        }
        if (S.work.key !== S.key) {
            if (unsubWork) { try { unsubWork(); } catch (e) { /* 무시 */ } }
            const key = S.key;
            S.work = { key, checks: {} };
            unsubWork = onSnapshot(doc(db, WORK_PATH(key)), snap => {
                if (S.work.key !== key) return;
                const d = snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) || {}) : {};
                S.work.checks = (d.checks && typeof d.checks === 'object') ? d.checks : {};
                emit();
            }, () => { /* 못 읽으면 체크 없이 */ });
        }
    }

    /** 구독 시작(여러 번 불러도 한 번). 로그인 상태를 따라 켜고 끈다 */
    function start() {
        if (started || !db || !auth) return;
        started = true;
        unsubAuth = auth.onAuthStateChanged(user => {
            S.signedIn = !!user;
            if (user) startSnaps();
            else { stopSnaps(); S.meta = null; S.day = null; S.dayLoading = ''; }
            emit();
        });
        // 시간에 따라 바뀌는 문구(08:20 대기 → 확인 중, 처리 대기 15분, 자정 넘김)를 1분마다 다시
        timer = setInterval(() => { if (S.signedIn && S.meta) { syncDay(); emit(); } }, 60 * 1000);
    }

    /** 구독을 모두 끊는다(대시보드에서 채우기 카드가 사라졌을 때). 다시 start() 하면 처음부터 */
    function stop() {
        if (!started) return;
        started = false;
        if (unsubAuth) { try { unsubAuth(); } catch (e) { /* 무시 */ } unsubAuth = null; }
        if (timer) { clearInterval(timer); timer = null; }
        stopSnaps();
        S.signedIn = false; S.meta = null; S.metaErr = ''; S.request = null; S.day = null; S.dayLoading = ''; S.dayErr = '';
        emit();
    }

    function setDay(key) {
        S.key = key;
        S.userPicked = S.key !== todayKey();
        syncDay();
        emit();
    }

    async function toggleCheck(code, done) {
        if (S.key !== todayKey() || S.saving.has(code)) return;
        const key = S.key;
        S.saving.add(code);
        try {
            await setDoc(doc(db, WORK_PATH(key)), { checks: { [code]: { done, by: nameOf(), at: serverTimestamp() } } }, { merge: true });
        } catch (e) {
            alert(`완료 표시를 저장하지 못했습니다(${(e && e.code) || '오류'}). 다시 눌러 주세요.`);
        } finally {
            S.saving.delete(code);
            emit();
        }
    }

    // 보이는 시트(tab)의 행을 한 번에 완료(또는 모두 완료면 해제) — 문서 하나에 merge 1회(행마다 키라 다른 사람 체크와 섞이지 않음)
    async function toggleAll(tab) {
        const key = S.key;
        const d = currentDay();
        if (key !== todayKey() || !d || S.saving.has('*all')) return;
        const sheet = tab === 'checks' ? 'checks' : 'rows';
        const list = d.parsed[sheet] || [];
        const pr = progress(list, S.work.checks);
        const done = !(pr.total > 0 && pr.done >= pr.total);
        const targets = list.map(r => r.code).filter(c => c && ((S.work.checks[c] || {}).done === true) !== done);
        if (!targets.length) return;
        const msg = done ? `${SHEETS[sheet]} ${targets.length}행을 모두 완료로 표시할까요?`
                         : `${SHEETS[sheet]} ${targets.length}행의 완료 표시를 모두 지울까요?`;
        if (!confirm(msg)) return;
        S.saving.add('*all');
        emit();
        try {
            const by = nameOf(), at = serverTimestamp(), checks = {};
            targets.forEach(c => { checks[c] = { done, by, at }; });
            await setDoc(doc(db, WORK_PATH(key)), { checks }, { merge: true });
        } catch (e) {
            alert(`한꺼번에 저장하지 못했습니다(${(e && e.code) || '오류'}). 다시 눌러 주세요.`);
        } finally {
            S.saving.delete('*all');
            emit();
        }
    }

    function download() {
        const d = currentDay();
        if (!d || !d.data.file || !d.data.file.b64) return;
        let url = '';
        try {
            const blob = new Blob([b64ToBytes(d.data.file.b64)], { type: XLSX_TYPE });
            url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileNameOf(d.data, d.key);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('엑셀 파일을 만들지 못했습니다. PC 채우기자동화\\출력\\ 의 파일을 쓰세요.');
        } finally {
            if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
    }

    /** 다시 만들기 버튼 상태(reqUi) — 오늘 기준 */
    function reqState(isToday) {
        const today = todayKey();
        return reqUi({ req: S.meta && S.meta.req, requestMs: S.request ? tsMs(S.request.requestedAt) : 0, nowMs: Date.now(),
                       isToday, isRunDay: runDay(today, S.meta && S.meta.schedule, holidayName).run, todayKey: today });
    }

    async function rebuild() {
        const today = todayKey();
        if (S.key !== today || !S.meta) return;
        if (!reqState(true).enabled) { emit(); return; }
        if (!confirm('이 PC 프로그램이 지금 재고로 지시서를 새로 만듭니다.\n슬랙에는 다시 보내지 않습니다(앱에서만 바뀝니다). 보통 3~8분 걸립니다.\n\n다시 만들까요?')) return;
        try {
            await setDoc(doc(db, REQUEST_PATH), { requestedAt: serverTimestamp(), by: nameOf(), day: today });
        } catch (e) {
            alert(`요청하지 못했습니다(${(e && e.code) || '오류'}).`);
        }
    }

    /** fn(state) 를 바뀔 때마다 부른다. 돌려준 함수로 해제 */
    function on(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    return {
        get: () => S, on, start, stop, setDay, currentDay, entryOf, reqState,
        toggleCheck, toggleAll, download, rebuild
    };
}
