// === calculator/calc-packings.js ===
// [패킹 불러오기] 목록 ← Firestore integrations/calcPackings (2026-11-17).
//   값은 시트 「패킹.송금관리」 바인딩 Apps Script(앱\업무현황 앱\입고위젯_apps_script.gs)가 시트 수정 즉시 + 1시간마다 쓴다.
//   문서 모양·읽기: ../js/lib/calc-pack-map.js parsePacks. 클라이언트 쓰기는 규칙이 막는다(integrations 쓰기 금지).
//   등록 직원만 읽는다(규칙 artifacts/** 읽기 = isMember). 명단 밖 로그인 사용자(guest)에게는 열지 않는다 —
//     logis-defaults.js 와 같은 방식: window.__calcAuth.role === 'guest' 면 읽지 않고, permission-denied 여도 guest 로 본다.
//
// 결과는 window.__calcPackings 에 두고 'calc-packings' 이벤트로 알린다.
//   { status: 'loading' | 'ok' | 'signed-out' | 'error' | 'guest', packs, updatedAt(ms), docOk, error }
//   status 'ok' 일 때만 packs(배열)가 있다. 문서가 없으면(연동 전) 'error' — 화면은 [패킹 불러오기] 버튼을 그리지 않는다.
//   docOk = 문서의 ok(마지막 시트 반영이 실패했으면 false — 목록은 마지막 성공분).
// 다시 읽기: window.__reloadCalcPackings({ quiet }) — 목록을 펼칠 때 PackPicker.js 가 조용히 다시 읽는다.
// 공통 상단바 로그인 표시(setShellContext)는 logis-defaults.js 가 이미 한다 — 여기서는 부르지 않는다.
import { db, auth } from './firebase-init.js?v=202611190922';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { parsePacks } from '../js/lib/calc-pack-map.js?v=202611190922';

const DOC_PATH = 'artifacts/team-work-logger-v2/integrations/calcPackings';

const publish = (state) => {
    window.__calcPackings = state;
    try { window.dispatchEvent(new CustomEvent('calc-packings', { detail: state })); } catch (e) { /* 무시 */ }
};

const tsMs = (v) => {
    if (!v) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    const t = new Date(v).getTime();
    return isNaN(t) ? null : t;
};

const GUEST_STATE = { status: 'guest', packs: null, updatedAt: null, docOk: null, error: null };
const isGuest = () => !!(window.__calcAuth && window.__calcAuth.role === 'guest');

publish({ status: 'loading', packs: null, updatedAt: null, docOk: null, error: null });

let seq = 0;    // 늦게 끝난 앞 요청이 뒤 결과를 덮지 않게

// 로그인 게이트가 guest 로 통과시키면(이 모듈의 읽기보다 늦을 수 있다) 그때 guest 로 바꾼다
window.addEventListener('calc-auth', () => {
    if (isGuest() && (window.__calcPackings || {}).status !== 'guest') { ++seq; publish(GUEST_STATE); }
});

// quiet: 이미 목록이 있을 때 다시 읽기 — 'loading' 을 알리지 않아 목록이 깜빡이지 않는다
async function load(user, quiet = false) {
    const my = ++seq;
    if (!db || !auth) {
        publish({ status: 'error', packs: null, updatedAt: null, docOk: null, error: 'Firebase 초기화 실패' });
        return;
    }
    if (!user) {
        publish({ status: 'signed-out', packs: null, updatedAt: null, docOk: null, error: null });
        return;
    }
    if (isGuest()) { publish(GUEST_STATE); return; }        // 직원 전용 — 읽어 보지도 않는다
    if (!quiet) publish({ status: 'loading', packs: null, updatedAt: null, docOk: null, error: null });
    try {
        const snap = await getDoc(doc(db, DOC_PATH));
        if (my !== seq) return;
        if (!snap.exists()) {
            publish({ status: 'error', packs: null, updatedAt: null, docOk: null, error: '아직 시트 연동 전입니다' });
            return;
        }
        const d = snap.data() || {};
        const r = parsePacks(d);
        if (!r.ok) {
            publish({ status: 'error', packs: null, updatedAt: tsMs(d.updatedAt), docOk: d.ok !== false,
                      error: r.error === 'version' ? '문서 모양이 이 화면과 다릅니다(새로고침)' : '목록을 읽지 못했습니다' });
            return;
        }
        publish({ status: 'ok', packs: r.packs, updatedAt: tsMs(d.updatedAt), docOk: d.ok !== false, error: null });
    } catch (e) {
        if (my !== seq) return;
        // 직원이면 규칙상 거부될 일이 없다 — 거부 = 명단 밖(guest). 오류로 보이지 않는다
        if (e && e.code === 'permission-denied') { publish(GUEST_STATE); return; }
        console.warn('패킹 목록 읽기 실패:', e && e.code ? e.code : e);
        const prev = window.__calcPackings || {};
        if (quiet && prev.status === 'ok') return;          // 조용히 다시 읽다 실패하면 보던 목록을 그대로 둔다
        publish({ status: 'error', packs: null, updatedAt: null, docOk: null, error: '읽기 실패 — 네트워크 확인' });
    }
}

window.__reloadCalcPackings = (opts) => {
    const quiet = !!(opts && opts.quiet) && (window.__calcPackings || {}).status === 'ok';
    return load(auth ? auth.currentUser : null, quiet);
};

if (auth) {
    onAuthStateChanged(auth, (user) => load(user));
} else {
    load(null);
}
