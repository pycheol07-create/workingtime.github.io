// === calculator/customs-fxrt-doc.js ===
// 관세청 고시환율(수입, 주간) ← Firestore integrations/customsFxrt (2026-10-16).
//   값은 앱\고시환율\실행.py 가 매일 2회 쓴다(클라이언트 쓰기는 규칙이 막는다).
//   로그인한 사람(퇴사자 제외 — 규칙 isCalcUser)이 읽을 수 있다 — 로그아웃·실패면 app.js 가 이 PC 저장값을 쓴다.
//
// 결과는 window.__customsFxrt 에 두고 'customs-fxrt' 이벤트로 알린다.
//   { status: 'loading' | 'ok' | 'signed-out' | 'error', doc, error }
//   doc = { usd{rate,start,end}, cny, ok, error } (status 'ok' 일 때. 문서가 없으면 null)
//   이번 주 값인지 판정은 app.js 가 js/lib/customs-fxrt.js(window.CustomsFxrt)로 한다.
// 다시 읽기: window.__reloadCustomsFxrt() · 탭이 다시 보이면(visibilitychange) 조용히 다시 읽는다
//   (토요일에 연 창을 일요일에 다시 볼 때 새 주 값을 받게).
// 공통 상단바 로그인 표시(setShellContext)는 logis-defaults.js 가 이미 한다 — 여기서는 부르지 않는다.
import { db, auth } from './firebase-init.js?v=202610261041';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const DOC_PATH = 'artifacts/team-work-logger-v2/integrations/customsFxrt';

const publish = (state) => {
    window.__customsFxrt = state;
    try { window.dispatchEvent(new CustomEvent('customs-fxrt', { detail: state })); } catch (e) { /* 무시 */ }
};

const rateOf = (m) => (m && typeof m === 'object')
    ? { rate: m.rate, start: m.start, end: m.end }
    : null;

publish({ status: 'loading', doc: null, error: null });

let seq = 0;    // 늦게 끝난 앞 요청이 뒤 결과를 덮지 않게

// quiet: 이미 값이 있을 때 다시 읽기 — 'loading' 을 알리지 않아 표시줄이 깜빡이지 않는다
async function load(user, quiet = false) {
    const my = ++seq;
    if (!db || !auth) {
        publish({ status: 'error', doc: null, error: 'Firebase 초기화 실패' });
        return;
    }
    if (!user) {
        publish({ status: 'signed-out', doc: null, error: null });
        return;
    }
    if (!quiet) publish({ status: 'loading', doc: null, error: null });
    try {
        const snap = await getDoc(doc(db, DOC_PATH));
        if (my !== seq) return;
        if (!snap.exists()) {
            publish({ status: 'ok', doc: null, error: null });
            return;
        }
        const d = snap.data() || {};
        publish({ status: 'ok', doc: { usd: rateOf(d.usd), cny: rateOf(d.cny), ok: d.ok !== false, error: d.error || null }, error: null });
    } catch (e) {
        if (my !== seq) return;
        console.warn('관세청 고시환율 읽기 실패:', e && e.code ? e.code : e);
        const msg = (e && e.code === 'permission-denied') ? '읽기 권한 없음(계정 확인)' : '읽기 실패 — 네트워크 확인';
        publish({ status: 'error', doc: null, error: msg });
    }
}

window.__reloadCustomsFxrt = () => load(auth ? auth.currentUser : null);

if (auth) {
    onAuthStateChanged(auth, (user) => load(user));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !auth.currentUser) return;
        const st = window.__customsFxrt || {};
        load(auth.currentUser, st.status === 'ok');
    });
} else {
    load(null);
}
