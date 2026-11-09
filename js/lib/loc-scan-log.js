// === js/lib/loc-scan-log.js ===
// 입고 스캐너(scan.html) 위치지정 '건별 기록' 문서 만들기 — 순수 함수(DOM/Firebase 없음). 2026-11-09. tests/loc-scan-log.test.js 가 본다.
//
// 경로: ChinaStockGoods_ScanDB_Versions/_locScans/sends/{YYYYMMDD-HHMMSS-난수6}(한국시간). 전송 1회당 문서 1건, 5,000건마다 나눈다(id 끝에 -1, -2 …).
// 모양: { v:1, sentAtMs, by, n, expireAt(전송 시각 + 90일 Date), items:[{ c, l, s, at, time }] }
//   c 상품코드 · l 위치 · s 'today'|'existing' · at 찍은 시각(ms, 옛 큐 항목은 null) · time 'HH:MM:SS'(기기 시각)
//   상품명·이메일은 넣지 않는다. by 는 직원 이름(모르면 빈칸).

export const LOC_SCAN_COLL = ['ChinaStockGoods_ScanDB_Versions', '_locScans', 'sends'];
export const LOC_SCAN_MAX_ITEMS = 5000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const EXPIRE_MS = 90 * 24 * 60 * 60 * 1000;
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

const str = (v) => String(v == null ? '' : v);
const p2 = (n) => String(n).padStart(2, '0');

/** 전송 시각 → 문서 id 'YYYYMMDD-HHMMSS-난수6'(한국시간) */
export function locScanSendId(sentAtMs, rand = Math.random) {
    const d = new Date(sentAtMs + KST_OFFSET_MS);
    const day = `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`;
    const time = `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}`;
    let r = '';
    for (let i = 0; i < 6; i++) r += ID_CHARS[Math.floor(rand() * ID_CHARS.length)];
    return `${day}-${time}-${r}`;
}

/** 큐 항목 → 기록 항목(모든 칸을 채운다 — Firestore 는 undefined 를 받지 않는다) */
function itemOf(it) {
    const at = Number(it.at);
    return { c: str(it.barcode), l: str(it.location), s: str(it.sub), at: Number.isFinite(at) && at > 0 ? at : null, time: str(it.time) };
}

/**
 * 전송한 위치 큐 항목(최신이 앞) → [{ id, data }] (찍은 순서대로, 상품코드가 없는 항목은 뺀다. 없으면 []).
 *   첫 문서 id 는 그대로, 다음부터 id-1, id-2 …
 */
export function buildLocScanDocs(items, { sentAtMs, by, rand } = {}) {
    const list = [...(items || [])].reverse().filter(it => it && it.barcode).map(itemOf);
    if (!list.length) return [];
    const ms = Number(sentAtMs) || 0;
    const id = locScanSendId(ms, rand);
    const out = [];
    for (let i = 0; i < list.length; i += LOC_SCAN_MAX_ITEMS) {
        const part = list.slice(i, i + LOC_SCAN_MAX_ITEMS);
        out.push({ id: out.length ? `${id}-${out.length}` : id,
            data: { v: 1, sentAtMs: ms, by: str(by), n: part.length, expireAt: new Date(ms + EXPIRE_MS), items: part } });
    }
    return out;
}
