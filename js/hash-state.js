// === js/hash-state.js ===
// 보던 위치(탭·날짜)를 주소 뒤 해시에 기억한다 — 새로고침·주소 공유·Ctrl+K 빠른 이동이 같은 자리로 온다. (UI 1단계 1c, 2026-10-16)
//   형식: #tab=forecast&fview=today · #tab=rawdata&sub=attendance&gran=week&date=2026-10-16
//   옛 형식 #forecast · #forecast-today 도 읽는다(→ tab=forecast[, fview=today]).
//   대시보드의 #open=… (js/app-shell-data.js parseOpenHash) 은 여기서 읽지 않는다 — 서로 건드리지 않는다.
// ⚠️ 해시에는 탭 이름·날짜만 넣는다(사람 이름·상품코드 금지). 값은 영문·숫자·-_. 만 받는다.
// 탭을 바꿀 때는 replaceState — 방문 기록이 쌓이지 않아 뒤로가기는 '이전 화면' 으로 간다. hashchange 도 나지 않는다.
// ES 모듈이면서 window.HashState 로도 쓴다(계산기는 Babel 이라 import 를 못 한다 — calculator/index.html).

export const HASH_KEYS = ['tab', 'sub', 'gran', 'date', 'fview'];
const VALUE_RE = /^[A-Za-z0-9_.-]{1,40}$/;

const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return ''; } };

/** '#tab=a&sub=b' → { tab: 'a', sub: 'b' }. 모르는 키·이상한 값은 버린다. 옛 형식(#forecast, #forecast-today)도 읽는다. */
export function parseHash(s) {
    const h = String(s || '').replace(/^#/, '');
    if (h === 'forecast') return { tab: 'forecast' };
    if (h === 'forecast-today') return { tab: 'forecast', fview: 'today' };
    const o = {};
    if (!h.includes('=')) return o;
    for (const part of h.split('&')) {
        const i = part.indexOf('=');
        if (i <= 0) continue;
        const k = dec(part.slice(0, i));
        const v = dec(part.slice(i + 1));
        if (HASH_KEYS.includes(k) && VALUE_RE.test(v)) o[k] = v;
    }
    return o;
}

/** { tab: 'a', sub: 'b' } → '#tab=a&sub=b' (키 순서 고정). 남는 것이 없으면 ''. */
export function formatHash(o) {
    const parts = [];
    for (const k of HASH_KEYS) {
        const v = o && o[k];
        if (v != null && VALUE_RE.test(String(v))) parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? '#' + parts.join('&') : '';
}

export const readHash = () => parseHash(typeof location !== 'undefined' ? location.hash : '');

/** 해시를 고친다(기록 안 쌓임). patch 의 null·'' 값과 opts.drop 키는 지운다. opts.replace 면 patch 만 남긴다. */
export function writeHash(patch, opts = {}) {
    try {
        const next = opts.replace ? {} : readHash();
        for (const [k, v] of Object.entries(patch || {})) {
            if (v == null || v === '') delete next[k]; else next[k] = v;
        }
        for (const k of (opts.drop || [])) delete next[k];
        const hash = formatHash(next);
        if (hash === (location.hash || '') || (!hash && !location.hash)) return;
        history.replaceState(history.state, '', location.pathname + location.search + hash);
    } catch (e) { /* 주소를 못 고쳐도 화면은 그대로 쓴다 */ }
}

/** 해시가 바뀌면(뒤로가기·Ctrl+K 같은 화면 이동) cb(새 상태). 해제 함수를 돌려준다. */
export function onHashNav(cb) {
    const fn = () => { try { cb(readHash()); } catch (e) { console.warn('[hash-state] 이동 처리 실패:', e && e.message); } };
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
}

if (typeof window !== 'undefined') {
    window.HashState = { HASH_KEYS, parseHash, formatHash, readHash, writeHash, onHashNav };
}
