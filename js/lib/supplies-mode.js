// === js/lib/supplies-mode.js — 비품 재고 기준(이지어드민 / 앱 원장) 판정(순수, node 시험 tests/supplies-mode.test.js) ===
// 비품관리 앱 기준 전환 2단계(2026-11-26). 스위치 문서 persistent_data/suppliesSettings:
//   { ledgerLive:bool, liveAt, liveBy, cutover:{ batchId, startedAt }, updatedAt }  — 쓰기는 관리자만(firestore.rules)
//   켜짐(ledgerLive true) = 재고는 suppliesStock(원장) — items[].stock 은 읽지도 바꾸지도 않는다.
//   꺼짐 = 예전처럼 items[].stock(이지어드민 연동이 매일 맞춤).

const num = (v) => Number(v) || 0;

/** 스위치가 켜져 있나(값이 정확히 true 일 때만) */
export const isLive = (settings) => !!(settings && settings.ledgerLive === true);

/** 시각 값 → ms(Firestore Timestamp·Date·ISO 글자·숫자). 못 읽으면 NaN */
export function atMs(v) {
    if (v == null) return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'string') return v.trim() ? Date.parse(v) : NaN;
    if (v instanceof Date) return v.getTime();
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (_) { return NaN; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor(num(v.nanoseconds) / 1e6);
    return NaN;
}

/** 화면에 보일 재고 — 켜짐이면 원장 재고(없으면 0), 꺼짐이면 items[].stock */
export function stockOf(it, live, ledgerStock) {
    if (!it) return 0;
    if (live) {
        const v = ledgerStock ? ledgerStock[it.id] : undefined;
        return v == null ? 0 : num(v);
    }
    return num(it.stock);
}

/** 안전재고 이하인가(안전재고 0 이면 부족 아님) */
export const isLowBy = (it, stock) => num(it && it.safetyStock) > 0 && num(stock) <= num(it.safetyStock);

/**
 * 켠 뒤에도 이지어드민 연동이 돌았나 — 비품 문서 ezSyncedAt 이 liveAt 보다 뒤면 true.
 * 켠 직후 liveAt 이 아직 서버 시각으로 안 채워졌으면(null) now 를 켠 시각으로 본다.
 */
export function ezLeftover(settings, ezSyncedAt, now = Date.now()) {
    if (!isLive(settings)) return false;
    let live = atMs(settings.liveAt);
    if (!Number.isFinite(live)) live = atMs(now);
    const ez = atMs(ezSyncedAt);
    return Number.isFinite(live) && Number.isFinite(ez) && ez > live;
}

/**
 * 전환 때 쓸 묶음 id — 끝나지 않은 전환(cutover 가 있고, 켠 적이 없거나 켠 시각보다 뒤에 시작)이면 그 batchId 를 다시 쓴다
 * (끊긴 뒤 다시 눌러도 이미 저장한 실사가 두 번 들어가지 않게). 아니면 null(새로 만든다).
 */
export function resumeBatchId(settings) {
    const c = settings && settings.cutover;
    if (!c || typeof c.batchId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(c.batchId)) return null;
    if (isLive(settings)) return null;
    const started = atMs(c.startedAt), live = atMs(settings.liveAt);
    if (!Number.isFinite(live)) return c.batchId;
    if (!Number.isFinite(started)) return null;
    return started > live ? c.batchId : null;
}

/** 끝나지 않은 전환을 '오래됨'으로 보는 시간 — 넘으면 이어 하기 전에 '새로 시작'을 묻는다(미리 채운 수량이 낡았을 수 있다) */
export const CUTOVER_STALE_MS = 6 * 60 * 60 * 1000;

/** 이어 할 전환(resumeBatchId)이 시작한 지 CUTOVER_STALE_MS 넘었나(시작 시각을 못 읽어도 오래됨) */
export function cutoverStale(settings, now = Date.now()) {
    if (!resumeBatchId(settings)) return false;
    const started = atMs(settings.cutover.startedAt);
    return !Number.isFinite(started) || atMs(now) - started > CUTOVER_STALE_MS;
}

/**
 * 전환 시작 기록을 써도 되나(트랜잭션 안에서 지금 문서로 본다) — 관리자 둘이 동시에 누를 때.
 *   켜져 있으면 'live' · 다른 사람이 막 시작한 전환(끝나지 않았고 오래되지 않음)이 있고 그게 내 것(mine)이 아니면 'busy' · 아니면 null(써도 됨)
 *   mine = 이어 하려는 batchId(이어 하기면 문서의 batchId 가 그대로여야 한다 — 바뀌었으면 'changed')
 */
export function cutoverStartBlock(settings, mine, now = Date.now()) {
    if (isLive(settings)) return 'live';
    const open = resumeBatchId(settings);
    if (mine) return open === mine ? null : 'changed';
    if (open && !cutoverStale(settings, now)) return 'busy';
    return null;
}

/** 켜기를 써도 되나 — 아직 꺼짐이고 문서의 cutover.batchId 가 내 묶음일 때만(null = 써도 됨) */
export function liveOnBlock(settings, batchId) {
    if (isLive(settings)) return 'live';
    const c = settings && settings.cutover;
    return c && c.batchId === batchId ? null : 'changed';
}

/** 원장 기록 → 화면 이름: byEmail 을 앱 설정 memberEmails({이름: 이메일})로 찾는다(by 칸은 쓰지 않는다 — 아무나 적을 수 있다) */
export function ledgerWho(entry, memberEmails) {
    const e = String((entry && entry.byEmail) || '').trim().toLowerCase();
    if (!e) return '';
    if (memberEmails && typeof memberEmails === 'object') {
        for (const [name, v] of Object.entries(memberEmails)) {
            if (name && typeof v === 'string' && v.trim().toLowerCase() === e) return name;
        }
    }
    return e;
}
