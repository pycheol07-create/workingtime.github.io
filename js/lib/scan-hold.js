// === js/lib/scan-hold.js ===
// 입고 스캐너(scan.html) '미발 동시 스캔' 방지 — 순수 함수(DOM/Firebase 없음). tests/scan-hold.test.js 가 본다.
//
// 상품마다 '잡아 둠' 문서 ChinaStockGoods_ScanDB/{code}/hold/now = { h: { [항목ID]: { q, at } } }
//   q  = 그 스캔이 피킹용(3층)으로 잡은 미발 수량, at = 잡은 시각(ms, 기기 시계)
//   수량을 확정하는 순간 트랜잭션으로 h.{id} 를 쓰고, [전송하기] 때 같은 batch 에서 지운다.
//   남은 미발 = max(ScanDB.mibalQty − 유효 hold 합, 0). ScanDB 의 뜻은 그대로(웹 동기화·버전 비교 영향 없음).
//   전송하지 못하고 남은 hold(폰 꺼짐 등)는 HOLD_TTL_MS 가 지나면 무시하고, 다음 트랜잭션 때 지운다.

export const HOLD_TTL_MS = 30 * 60 * 1000;   // 30분 (2026-11-09 8시간에서 줄임) — 잡고 전송하지 않은 몫이 이 시간 지나면 남의 미발로 풀린다
// 한 스캔이 쪼개질 때 비축으로 갈 몫이 이 수량 이하이면 그 스캔 전량을 피킹으로 보낸다(allocOf)
export const SMALL_RESERVE_MAX = 2;
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

/** 남이 잡아 둔 유효 hold 합 — myIds(이 기기 목록의 항목 id)는 뺀다. 수량 팝업 안내용 */
export function heldByOthers(holdDoc, myIds, nowMs, ttlMs = HOLD_TTL_MS) {
    const mine = new Set(myIds || []);
    const v = validHolds(holdDoc, nowMs, ttlMs);
    return Object.keys(v).reduce((s, id) => (mine.has(id) ? s : s + v[id].q), 0);
}

/** 남은 미발 = max(ScanDB.mibalQty − 유효 hold 합, 0). ScanDB 값은 음수일 수 있다(입고 초과분). */
export function availOf(scanMibal, holdDoc, nowMs, ttlMs = HOLD_TTL_MS) {
    return Math.max(int(scanMibal) - heldOf(holdDoc, nowMs, ttlMs), 0);
}

/** 이 기기 목록의 같은 상품 몫 [{ id, q }] — 확인된(hold 'ok') 것만. excludeIds(Set) = 전송 중, skipId = 지금 잡는 항목 */
export function myHoldsOf(queue, code, excludeIds, skipId) {
    return (queue || []).filter(it => it && it.id && it.barcode === code && it.hold === 'ok' && it.id !== skipId
        && !(excludeIds && excludeIds.has(it.id)) && int(it.mibalTaken) > 0).map(it => ({ id: it.id, q: int(it.mibalTaken) }));
}

/** 남은 미발 — availOf 에 더해 내 몫(mine)은 만료됐거나 문서에서 지워졌어도 뺀다. 아직 전송하지 않았으므로 ScanDB 에는 빠지지 않았다 */
export function availWithMine(scanMibal, holdDoc, mine, nowMs, ttlMs = HOLD_TTL_MS) {
    const v = validHolds(holdDoc, nowMs, ttlMs);
    const extra = (mine || []).reduce((s, m) => (m.id in v ? s : s + int(m.q)), 0);
    return Math.max(int(scanMibal) - heldOf(holdDoc, nowMs, ttlMs) - extra, 0);
}

/**
 * 이번 스캔이 잡을 몫.
 *   shown = 팝업에 보여 준 미발(조회 시점), avail = 트랜잭션 안에서 다시 계산한 남은 미발, qty = 확정 수량
 * → { take, warn, notice, othersTook }
 *   take = min(qty, avail) (0 이상). othersTook = shown − avail(보여 준 것보다 줄어든 만큼, 다른 작업자가 그새 잡음).
 *   warn   = 남이 가져가서 이번 스캔에 비축 몫이 생김(allocOf reserve > 0) → 경고창(음성·진동·확인)
 *   notice = 남이 일부 가져갔지만 이번 스캔은 전량 피킹(작은 비축 포함) → 토스트만(흐름 안 끊음)
 *   (남이 안 가져갔는데 qty 가 미발보다 큰 것은 평소 '쪼갬' — 둘 다 false)
 */
export function planTake({ shown, avail, qty }) {
    const s = Math.max(int(shown), 0), a = Math.max(int(avail), 0), q = Math.max(int(qty), 0);
    const take = Math.min(q, a);
    const othersTook = s > a ? s - a : 0;
    const warn = othersTook > 0 && allocOf(q, take).reserve > 0;
    const notice = othersTook > 0 && !warn;
    return { take, warn, notice, othersTook };
}

/**
 * 잡은 몫으로 나눈 이번 스캔의 피킹·비축. 안내 문구와 비축 배분(floor2Step)이 이 값 하나를 쓴다.
 *   take > 0 이고 비축으로 갈 몫이 1~SMALL_RESERVE_MAX 면 전량 피킹(2026-11-09 사용자 지시).
 *   take = 0(미발이 이미 다 찬 뒤의 스캔)은 그대로 전량 비축 — 소량씩 찍을 때 비축이 피킹으로 새지 않게.
 *   hold 의 q 는 이 값이 아니라 실제 잡은 몫(take) 그대로 둔다(다른 작업자의 남은 미발 계산).
 * → { pick, reserve }
 */
export function allocOf(qty, take) {
    const q = Math.max(int(qty), 0);
    const t = Math.min(Math.max(int(take), 0), q);
    const rest = q - t;
    if (t > 0 && rest > 0 && rest <= SMALL_RESERVE_MAX) return { pick: q, reserve: 0 };
    return { pick: t, reserve: rest };
}

/**
 * 비축(2층) 배분 한 걸음. state = { received, mibal, floor2 } (상품 하나, 스캔 시간순으로 이어서 부른다)
 *   item = { qty, mibalTaken? }
 *   split(=item.mibalTaken 이 숫자) : allocOf — 3층 = take, 비축 = qty − take(2026-10-28 사용자 결정: 쪼갬), 작은 비축은 전량 3층
 *   옛 항목·오프라인 항목         : 미발이 남아 있으면(mibal − received > 0) 전부 3층, 다 찼으면 전부 비축(안 쪼갬)
 *   received 는 언제나 += qty.
 * → { state: 새 state, floor2Add }
 */
export function floor2Step(state, item, split) {
    const s = { received: int(state && state.received), mibal: int(state && state.mibal), floor2: int(state && state.floor2) };
    const qty = Math.max(int(item && item.qty), 0);
    let add;
    if (split) {
        add = allocOf(qty, item.mibalTaken).reserve;
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
