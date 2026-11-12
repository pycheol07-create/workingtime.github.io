// === js/mibal2-fallback-watch.js ===
// 부족수량관리 비상 스위치 읽기(2026-11-10) — 신규(js/china-mibal2.js)·기존(js/china-stock-goods.js) 두 화면이 같이 쓴다. 쓰기 없음.
// 판정 규칙은 js/lib/mibal2-fallback.js. 쓰기는 신규 화면의 js/mibal2-fallback-switch.js 한 곳.
import { doc, getDocFromServer, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FALLBACK_PATH, fallbackOf } from './lib/mibal2-fallback.js?v=202611120908';

const UNKNOWN = (error) => ({ known: false, on: false, atMs: 0, offAtMs: 0, atServerMs: 0, offServerMs: 0, ships: [], error });
export const STALE_MS = 30000;   // 서버 확인 없이(캐시 스냅샷만) 이만큼 지나면 '모름'

/**
 * 서버에서 한 번 읽는다(캐시 안 씀). timeoutMs 안에 못 읽으면 모름.
 * @returns {Promise<{known, on, atMs, offAtMs, atServerMs, offServerMs, ships, error?, badShape?}>}
 */
export async function readFallback(db, { timeoutMs = 8000 } = {}) {
    let timer;
    try {
        const read = getDocFromServer(doc(db, FALLBACK_PATH));
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), timeoutMs); });
        const snap = await Promise.race([read, timeout]);
        const fb = fallbackOf(snap.exists() ? snap.data() : null);
        if (!fb.known) fb.badShape = true;
        return fb;
    } catch (e) {
        return UNKNOWN((e && e.code) || 'error');
    } finally { clearTimeout(timer); }
}

/**
 * 구독 — cb(fb, { fromCache }). 오류면 cb(모름, { error }) 후 구독은 끝난다.
 * 연결이 끊기거나(브라우저 offline) 캐시 스냅샷만 staleMs 넘게 받으면 cb(모름(error 'offline'·'stale'), { stale: true }) — 쓰던 탭은 멈춘다.
 * 쓰기 가능으로 바꾸는 판단에는 쓰지 말 것(조회 전용으로 바꾸는 데만) — 쓰기 가능은 새로고침 뒤 readFallback 으로만.
 * @returns {() => void} 구독 해제
 */
export function watchFallback(db, cb, { staleMs = STALE_MS } = {}) {
    let cacheSince = 0;      // 캐시 스냅샷만 받기 시작한 때(서버 스냅샷이 오면 0)
    let staleSent = false;
    const stale = (why) => { if (staleSent) return; staleSent = true; cb(UNKNOWN(why), { stale: true }); };
    // offline 이벤트는 바로 멈추지 않고 30초 시계만 건다 — 1~2초 끊김·VPN 전환은 Firestore 가 오프라인으로 안 넘어가 스냅샷이 다시 안 와서,
    //   바로 '모름'으로 두면 새로고침 전까지 풀리지 않는다. online 이 오고 마지막 스냅샷이 서버 것이면 시계를 푼다.
    let lastFromCache = false;
    const onOffline = () => { if (!cacheSince) cacheSince = Date.now(); };
    const onOnline = () => { if (!lastFromCache && !staleSent) cacheSince = 0; };
    if (typeof window !== 'undefined') { window.addEventListener('offline', onOffline); window.addEventListener('online', onOnline); }
    const timer = setInterval(() => { if (cacheSince && Date.now() - cacheSince > staleMs) stale('stale'); }, 2000);
    const unsub = onSnapshot(doc(db, FALLBACK_PATH), { includeMetadataChanges: true }, (snap) => {
        const fromCache = !!snap.metadata.fromCache;
        lastFromCache = fromCache;
        if (fromCache) { if (!cacheSince) cacheSince = Date.now(); }
        else { cacheSince = 0; staleSent = false; }
        if (staleSent) return;   // 끊긴 동안의 캐시 값은 넘기지 않는다(이미 '모름'으로 알림)
        const fb = fallbackOf(snap.exists() ? snap.data() : null);
        if (!fb.known) fb.badShape = true;
        cb(fb, { fromCache });
    }, (err) => {
        clearInterval(timer);
        cb(UNKNOWN((err && err.code) || 'error'), { error: true });
    });
    return () => { clearInterval(timer); unsub(); if (typeof window !== 'undefined') { window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); } };
}

/** 모름 이유 → 띠 문구 앞부분 */
export function unknownWhy(fb) {
    if (fb && fb.badShape) return '비상 스위치 값이 올바르지 않아';
    if (fb && (fb.error === 'offline' || fb.error === 'stale')) return '인터넷 연결이 끊겨(서버에서 스위치를 확인하지 못함)';
    return '비상 스위치를 읽지 못해';
}
