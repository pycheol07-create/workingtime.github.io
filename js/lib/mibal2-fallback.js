// === js/lib/mibal2-fallback.js ===
// 부족수량관리 비상 스위치(2026-11-10 사용자 결정) — 순수 모듈(DOM/Firebase 없음).
//
// 평소에는 신규 화면(china-mibal2.html)만 스캐너 자료를 쓴다. 신규 화면에 문제가 생기면 관리자가 신규 화면의 버튼으로
// 스위치 문서(FALLBACK_PATH)를 켜고, 그동안은 기존 화면(china-stock-goods.html)이 쓰고 신규는 조회 전용이 된다(배포 없이 즉시).
// 같은 버튼으로 되돌린다. 어느 순간에도 두 화면이 같이 쓰지 않게:
//   · 스위치를 모르면(못 읽음·모양 틀림·연결 끊김) 둘 다 조회 전용
//   · 쓰기 가능으로 바뀌는 것은 새로고침 뒤(서버에서 읽은 값)만, 조회 전용으로는 즉시
// 문서 모양 { on: bool, atMs: number, atTs?: 서버시각, offAtMs?: number, offTs?: 서버시각, by?: 직원이름, ships?: [작업 출고일], updatedAt? }
//   — 자유 글 칸 없음. atMs·offAtMs 는 누른 PC 시각(표시·옛 값 대체), atTs·offTs 는 서버 시각(비교는 서버 시각끼리 — PC 시계가 달라도 맞게).
// 문서가 없으면 '꺼짐(평소)' 으로 안다. 화면 쪽: js/mibal2-fallback-watch.js(읽기) · js/mibal2-fallback-switch.js(버튼·쓰기) · js/mibal2-gate.js(신규 쓰기 덮개).
// 규칙(firestore.rules)은 이미 게시된 mibal2/{docId} 쓰기(hasFeature('china.mibal2')) 그대로 — 관리자만 바꾸는 것은 화면 판정이다.

export const FALLBACK_PATH = 'artifacts/team-work-logger-v2/mibal2/fallback';

const ALLOWED_KEYS = new Set(['on', 'atMs', 'atTs', 'offAtMs', 'offTs', 'by', 'ships', 'updatedAt']);
const UNKNOWN = Object.freeze({ known: false, on: false, atMs: 0, offAtMs: 0, atServerMs: 0, offServerMs: 0, ships: [] });
const isMs = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isTs = (v) => v === null || v === undefined || (typeof v === 'object' && typeof v.toMillis === 'function');

/** Firestore Timestamp(서버 시각) → ms, 아니면 0 (쓰기 직후 로컬 값은 null — 서버 확인 전) */
export const tsMsOf = (v) => (v && typeof v.toMillis === 'function' ? (Number(v.toMillis()) || 0) : 0);

/**
 * 스위치 문서 → { known, on, atMs, offAtMs, atServerMs, offServerMs, ships }.
 * data 가 undefined/null = 문서 없음 → 알고 있음·꺼짐. 모양이 틀리면 known:false(모름).
 */
export function fallbackOf(data) {
    if (data === undefined || data === null) return { known: true, on: false, atMs: 0, offAtMs: 0, atServerMs: 0, offServerMs: 0, ships: [] };
    if (typeof data !== 'object' || Array.isArray(data)) return { ...UNKNOWN };
    if (Object.keys(data).some(k => !ALLOWED_KEYS.has(k))) return { ...UNKNOWN };
    if (typeof data.on !== 'boolean') return { ...UNKNOWN };
    if (!isMs(data.atMs)) return { ...UNKNOWN };
    if (data.on && !(data.atMs > 0)) return { ...UNKNOWN };
    if (data.offAtMs !== undefined && !isMs(data.offAtMs)) return { ...UNKNOWN };
    if (!isTs(data.atTs) || !isTs(data.offTs)) return { ...UNKNOWN };
    if (data.by !== undefined && typeof data.by !== 'string') return { ...UNKNOWN };
    if (data.ships !== undefined && !(Array.isArray(data.ships) && data.ships.every(s => typeof s === 'string'))) return { ...UNKNOWN };
    return { known: true, on: data.on, atMs: data.atMs, offAtMs: data.offAtMs || 0, atServerMs: tsMsOf(data.atTs), offServerMs: tsMsOf(data.offTs),
        ships: (data.ships || []).slice() };
}

/**
 * 두 화면의 쓰기 주인. constant = 단독 운영 상수(isMibal2Live()).
 *  신규 쓰기 = 상수 && 앎 && !on · 기존 쓰기 = !상수 || (앎 && on). 모르면 둘 다 false.
 */
export function modesOf({ constant, fb }) {
    const f = fb || UNKNOWN;
    return {
        newWrite: !!constant && f.known === true && !f.on,
        oldWrite: !constant || (f.known === true && f.on === true)
    };
}

/**
 * 기존 화면 — 미발재고로그(StockLog CHUNK)를 비상 전환 뒤에 올렸는가. 서버 시각이 양쪽 다 있으면 서버 시각끼리, 아니면 PC 시각끼리.
 * @param {{clientMs: number[], serverMs: number[]}} chunks  CHUNK 들의 updatedAt(PC) · savedAt(서버) ms
 * @param {{atMs, atServerMs}} fb
 */
export function stockLogFresh(chunks, fb) {
    const max = (a) => { const l = (Array.isArray(a) ? a : []).filter(v => isMs(v) && v > 0); return l.length ? Math.max(...l) : 0; };
    const f = fb || {};
    const srv = max(chunks && chunks.serverMs);
    if (srv > 0 && f.atServerMs > 0) return srv >= f.atServerMs;
    const cli = max(chunks && chunks.clientMs);
    if (!cli || !isMs(f.atMs)) return false;
    return cli >= f.atMs;
}

/**
 * 신규 [작업 마감] — 비상 기간 뒤 [스캐너에 반영]을 하지 않은 작업인가(작업 표시가 있는데 반영 시각이 되돌린 시각보다 이름).
 * 서버 시각(batch.appliedTs ↔ fb.offServerMs)이 양쪽 다 있으면 그것끼리, 아니면 PC 시각(appliedAt ↔ offAtMs).
 */
export function needReapply(batch, fb) {
    if (!batch || !fb || !fb.known || fb.on) return false;
    const srv = tsMsOf(batch.appliedTs);
    if (srv > 0 && fb.offServerMs > 0) return srv < fb.offServerMs;
    if (fb.offServerMs > 0 && !(fb.offAtMs > 0)) return true;   // 되돌린 기록은 있는데 비교할 PC 시각이 없음 → 다시 반영하게
    if (!(fb.offAtMs > 0)) return false;
    return (Number(batch.appliedAt) || 0) < fb.offAtMs;
}

/** 신규 [직전으로 되돌리기] — 고른 백업(atMs)이 비상 전환 전 것인가(되돌리면 기존 화면이 그동안 쓴 자료를 덮는다) */
export function staleRollback(verAtMs, fb) {
    if (!fb || !fb.known || !(fb.atMs > 0)) return false;
    const v = Number(verAtMs) || 0;
    return v > 0 && v < fb.atMs;
}
