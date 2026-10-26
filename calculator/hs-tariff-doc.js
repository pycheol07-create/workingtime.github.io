// === calculator/hs-tariff-doc.js ===
// HS 관세율 자료 ← Firestore artifacts/team-work-logger-v2/hsTariff (2026-10-26).
//   자료는 앱\HS관세율\실행.py 가 관세청 공개 자료로 만들어 쓴다(연 1회, 클라이언트 쓰기는 규칙이 막는다).
//   규칙 isCalcUser — 로그인한 계산기 사용자(퇴사자 제외)가 읽는다. 규칙 게시 전에는 직원만 읽힌다(denied).
//
// customs-fxrt-doc.js 와 같은 방식이지만 페이지를 열 때 읽지 않는다 — [HS코드로 찾기] 패널을 처음 열 때
//   window.HsTariff.load() 로 hsTariff 목록 한 번(_meta + 류 문서 약 96개, 합계 약 1.7MB)을 읽고 이 탭 메모리에 둔다.
// 상태는 window.HsTariff.state 에 두고 'hs-tariff' 이벤트로 알린다.
//   { status: 'idle' | 'loading' | 'ok' | 'missing' | 'denied' | 'error', meta, index, error }
//   meta  = _meta 문서 { version, ruleDate, baseDate, validTo, chapters, counts, ... }
//   index = { [류 2자리]: 류 문서 } — js/lib/hs-search.js 가 그대로 쓴다
//   missing: _meta 가 없음(아직 안 올림) · denied: 읽기 권한 없음/로그아웃 · error: 그 밖(네트워크·버전 어긋남)
// 다시 읽기: window.HsTariff.load({ force: true }) ([다시 시도]) · 로그인 계정이 바뀌면 idle 로 되돌린다.
// 저장값 확인: window.HsTariff.checkSaved(saved) — 계산기를 열 때 _meta 1회(+ ver 가 다르면 류 문서 1개) — 아래 설명.
import { db, auth } from './firebase-init.js?v=202610261315';
import { doc, getDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const COL_PATH = 'artifacts/team-work-logger-v2/hsTariff';
const META_ID = '_meta';

const HsTariff = {
    state: { status: 'idle', meta: null, index: null, error: null },
    load: (opts) => load(opts),
    checkSaved: (saved) => checkSaved(saved),
};
window.HsTariff = HsTariff;

const publish = (state) => {
    HsTariff.state = state;
    try { window.dispatchEvent(new CustomEvent('hs-tariff', { detail: state })); } catch (e) { /* 무시 */ }
};

let seq = 0;            // 늦게 끝난 앞 요청이 뒤 결과를 덮지 않게
let lastUid = null;

const isDenied = (e) => !!(e && (e.code === 'permission-denied' || e.code === 'unauthenticated'));

async function load(opts = {}) {
    const st = HsTariff.state;
    if (!opts.force && (st.status === 'ok' || st.status === 'loading')) return st;
    const my = ++seq;
    if (!db || !auth) {
        publish({ status: 'error', meta: null, index: null, error: 'Firebase 초기화 실패' });
        return HsTariff.state;
    }
    publish({ status: 'loading', meta: null, index: null, error: null });
    try {
        if (typeof auth.authStateReady === 'function') await auth.authStateReady();
        if (my !== seq) return HsTariff.state;
        if (!auth.currentUser) {
            publish({ status: 'denied', meta: null, index: null, error: '로그인 필요' });
            return HsTariff.state;
        }
        // 목록 한 번에 _meta 까지 받는다(_meta 를 따로 읽지 않는다)
        const snap = await getDocs(collection(db, COL_PATH));
        if (my !== seq) return HsTariff.state;
        const metaDoc = snap.docs.find(d => d.id === META_ID);
        if (!metaDoc) {
            publish({ status: 'missing', meta: null, index: null, error: null });
            return HsTariff.state;
        }
        const meta = metaDoc.data() || {};
        const index = {};
        let mismatch = 0;
        snap.forEach((d) => {
            if (d.id === META_ID) return;
            const data = d.data() || {};
            if (data.version !== meta.version) { mismatch++; return; }
            index[d.id] = data;
        });
        if (mismatch || !Object.keys(index).length) {
            // 올리기는 한 번의 commit 이라 정상이면 어긋나지 않는다 — 어긋나면 옛 자료와 섞인 것이니 쓰지 않는다
            publish({ status: 'error', meta: null, index: null, error: mismatch ? 'HS 자료 버전이 맞지 않음' : 'HS 자료가 비어 있음' });
            return HsTariff.state;
        }
        publish({ status: 'ok', meta, index, error: null });
    } catch (e) {
        if (my !== seq) return HsTariff.state;
        console.warn('HS 관세율 읽기 실패:', e && e.code ? e.code : e);
        if (isDenied(e)) publish({ status: 'denied', meta: null, index: null, error: '읽기 권한 없음' });
        else publish({ status: 'error', meta: null, index: null, error: '읽기 실패 — 네트워크 확인' });
    }
    return HsTariff.state;
}

// ── 저장한 HS 세율 확인(계산기를 열 때, 패널을 안 열어도) ─────────────────────
//   _meta 를 한 번만 읽어(이 탭에서 캐시) 저장 ver 와 비교한다. ver 가 다를 때만 그 류 문서 1개를 더 읽어
//   같은 구분 세율을 다시 본다(js/lib/hs-search.js hsCheckSaved). 패널 자료(ok)가 있으면 그것을 쓴다(추가 읽기 없음).
//   → { version, check } | null(로그아웃·권한 없음·자료 없음·실패 — 경고하지 않는다)
let metaPeek = null;                 // Promise<meta|null>
const chapterPeek = new Map();       // 류 → Promise<doc|null>
const peekMeta = () => {
    if (HsTariff.state.status === 'ok' && HsTariff.state.meta) return Promise.resolve(HsTariff.state.meta);
    if (!metaPeek) {
        metaPeek = (async () => {
            try {
                if (typeof auth.authStateReady === 'function') await auth.authStateReady();
                if (!auth.currentUser) return null;
                const snap = await getDoc(doc(db, COL_PATH, META_ID));
                return snap.exists() ? (snap.data() || null) : null;
            } catch (e) {
                console.warn('HS 관세율 _meta 읽기 실패:', e && e.code ? e.code : e);
                return null;
            }
        })();
    }
    return metaPeek;
};
const peekChapter = (ch, version) => {
    const st = HsTariff.state;
    if (st.status === 'ok' && st.index && st.meta && st.meta.version === version) return Promise.resolve(st.index[ch] || null);
    if (!chapterPeek.has(ch)) {
        chapterPeek.set(ch, getDoc(doc(db, COL_PATH, ch))
            .then(s => (s.exists() ? s.data() : null))
            .catch(e => { console.warn('HS 관세율 류 문서 읽기 실패:', e && e.code ? e.code : e); return undefined; }));
    }
    return chapterPeek.get(ch);
};
async function checkSaved(saved) {
    if (!saved || !db || !auth || !window.HsSearch) return null;
    const meta = await peekMeta();
    if (!meta || typeof meta.version !== 'string') return null;
    if (saved.ver && saved.ver === meta.version) return { version: meta.version, check: { status: 'same', newRate: saved.rate } };
    const d = await peekChapter(saved.code.slice(0, 2), meta.version);
    if (d === undefined) return null;                                  // 읽기 실패 — 모른다
    if (d && d.version !== meta.version) return null;                  // 옛 류 문서(올리는 중) — 모른다
    const item = d && d.it ? d.it[saved.code] || null : null;
    return { version: meta.version, check: window.HsSearch.hsCheckSaved(saved, meta.version, item) };
}

// 계정이 바뀌면(로그아웃·다른 계정) 읽은 자료를 버린다 — 다음에 패널을 열 때 새 계정 권한으로 다시 읽는다
if (auth) {
    let first = true;       // 첫 알림은 처음 로그인 상태 — 진행 중인 읽기(authStateReady 를 기다리는 중)를 끊지 않는다
    onAuthStateChanged(auth, (user) => {
        const uid = user ? user.uid : null;
        if (first) { first = false; lastUid = uid; return; }
        if (uid === lastUid) return;
        lastUid = uid;
        metaPeek = null;
        chapterPeek.clear();
        if (HsTariff.state.status !== 'idle') {
            seq++;
            publish({ status: 'idle', meta: null, index: null, error: null });
        }
    });
}
