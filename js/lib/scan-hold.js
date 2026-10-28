// === js/lib/scan-hold.js ===
// 입고 스캐너(scan.html) '미발 동시 스캔' 방지 — 순수 함수(DOM/Firebase 없음). tests/scan-hold.test.js 가 본다.
//
// 상품마다 '잡아 둠' 문서 ChinaStockGoods_ScanDB/{code}/hold/now = { h: { [항목ID]: { q, at } } }
//   q  = 그 스캔이 피킹용(3층)으로 잡은 미발 수량, at = 잡은 시각(ms, 기기 시계)
//   수량을 확정하는 순간 트랜잭션으로 h.{id} 를 쓰고, [전송하기] 때 같은 batch 에서 지운다.
//   남은 미발 = max(ScanDB.mibalQty − 유효 hold 합, 0). ScanDB 의 뜻은 그대로(웹 동기화·버전 비교 영향 없음).
//   전송하지 못하고 남은 hold(폰 꺼짐 등)는 HOLD_TTL_MS 가 지나면 무시하고, 다음 트랜잭션 때 지운다.

export const HOLD_TTL_MS = 8 * 60 * 60 * 1000;   // 8시간
// '확인 중'(트랜잭션 결과 모름)으로 이만큼 지나면 '확인 불가'(옛 비축 배분 식)로 내려 전송할 수 있게 한다.
//   늦게 온 트랜잭션이 몫을 써도 scan.html 이 그 몫을 바로 푼다(고아 hold 방지). 전송 batch 도 h.{id} 를 지운다.
export const HOLD_PENDING_MAX_MS = 15 * 1000;

const int = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };

/** hold 문서 데이터의 h 맵에서 아직 유효한 항목만 { id: {q, at} }. q 는 1 이상 정수, at 은 숫자여야 한다.
 *  기기 시계가 앞서 있어 at 이 지금보다 뒤인 것도 유효로 본다(지우면 남의 몫을 빼앗는다). */
export function validHolds(holdDoc, nowMs, ttlMs = HOLD_TTL_MS) {
    const h = holdDoc && holdDoc.h && typeof holdDoc.h === 'object' ? holdDoc.h : {};
    const out = {};
    for (const id of Object.keys(h)) {
        const v = h[id];
        if (!v || typeof v !== 'object') continue;
        const q = int(v.q), at = Number(v.at);
        if (q < 1 || !Number.isFinite(at)) continue;
        if (nowMs - at >= ttlMs) continue;
        out[id] = { q, at };
    }
    return out;
}

/** 지워도 되는 항목 id — 만료됐거나 모양이 틀린 것. 트랜잭션에서 남의 새 hold 를 쓰면서 같이 정리한다. */
export function staleHoldIds(holdDoc, nowMs, ttlMs = HOLD_TTL_MS) {
    const h = holdDoc && holdDoc.h && typeof holdDoc.h === 'object' ? holdDoc.h : {};
    const ok = validHolds(holdDoc, nowMs, ttlMs);
    return Object.keys(h).filter(id => !(id in ok));
}

/** 유효 hold 합 */
export function heldOf(holdDoc, nowMs, ttlMs = HOLD_TTL_MS) {
    const v = validHolds(holdDoc, nowMs, ttlMs);
    return Object.keys(v).reduce((s, id) => s + v[id].q, 0);
}

/** 남은 미발 = max(ScanDB.mibalQty − 유효 hold 합, 0). ScanDB 값은 음수일 수 있다(입고 초과분). */
export function availOf(scanMibal, holdDoc, nowMs, ttlMs = HOLD_TTL_MS) {
    return Math.max(int(scanMibal) - heldOf(holdDoc, nowMs, ttlMs), 0);
}

/**
 * 이번 스캔이 잡을 몫.
 *   shown = 팝업에 보여 준 미발(조회 시점), avail = 트랜잭션 안에서 다시 계산한 남은 미발, qty = 확정 수량
 * → { take, warn, notice, othersTook }
 *   take = min(qty, avail) (0 이상). othersTook = shown − avail(보여 준 것보다 줄어든 만큼, 다른 작업자가 그새 잡음).
 *   warn   = 남이 가져가서 이번 수량을 다 피킹으로 못 잡음(take < qty) → 경고창(음성·진동·확인)
 *   notice = 남이 일부 가져갔지만 이번 수량은 다 잡음(take === qty) → 토스트만(흐름 안 끊음)
 *   (남이 안 가져갔는데 qty 가 미발보다 큰 것은 평소 '쪼갬' — 둘 다 false)
 */
export function planTake({ shown, avail, qty }) {
    const s = Math.max(int(shown), 0), a = Math.max(int(avail), 0), q = Math.max(int(qty), 0);
    const take = Math.min(q, a);
    const othersTook = s > a ? s - a : 0;
    const warn = othersTook > 0 && take < q;
    const notice = othersTook > 0 && !warn;
    return { take, warn, notice, othersTook };
}

/**
 * 비축(2층) 배분 한 걸음. state = { received, mibal, floor2 } (상품 하나, 스캔 시간순으로 이어서 부른다)
 *   item = { qty, mibalTaken? }
 *   split(=item.mibalTaken 이 숫자) : 3층 = take, 비축 = qty − take  (2026-10-28 사용자 결정: 쪼갬)
 *   옛 항목·오프라인 항목         : 미발이 남아 있으면(mibal − received > 0) 전부 3층, 다 찼으면 전부 비축(안 쪼갬)
 *   received 는 언제나 += qty.
 * → { state: 새 state, floor2Add }
 */
export function floor2Step(state, item, split) {
    const s = { received: int(state && state.received), mibal: int(state && state.mibal), floor2: int(state && state.floor2) };
    const qty = Math.max(int(item && item.qty), 0);
    let add;
    if (split) {
        const take = Math.min(Math.max(int(item.mibalTaken), 0), qty);
        add = qty - take;
    } else {
        add = (s.mibal - s.received > 0) ? 0 : qty;
    }
    return { state: { received: s.received + qty, mibal: s.mibal, floor2: s.floor2 + add }, floor2Add: add };
}

/** '확인 중' 항목이 너무 오래됐나 — holdStart(확정 시각, ms) 기준. 시작 시각이 없거나(옛 큐) 시계가 거꾸로면 오래된 것으로 본다. */
export function pendingExpired(item, nowMs, maxMs = HOLD_PENDING_MAX_MS) {
    if (!item || item.hold !== 'pending') return false;
    const t = Number(item.holdStart);
    if (!Number.isFinite(t) || t <= 0 || t > nowMs) return true;
    return nowMs - t >= maxMs;
}

/** 큐 항목이 쪼갬(새 방식) 대상인가 — 트랜잭션 결과(mibalTaken)가 숫자로 있을 때만 */
export function isSplitItem(item) {
    return !!item && typeof item.mibalTaken === 'number' && Number.isFinite(item.mibalTaken);
}

/** 항목 id — Firestore 필드 경로(h.{id})에 그대로 쓰므로 영문 소문자·숫자만 */
export function newHoldId(nowMs = Date.now(), rand = Math.random) {
    let r = '';
    for (let i = 0; i < 8; i++) r += Math.floor(rand() * 36).toString(36);
    return 'q' + nowMs.toString(36) + r;
}

export const HOLD_ID_RE = /^[a-z0-9]{6,40}$/;
