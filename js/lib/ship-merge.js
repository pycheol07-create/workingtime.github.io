// === js/lib/ship-merge.js ===
// 플랫폼 출고 → Firestore 에 '무엇을 쓸지' 만 만든다(쓰기는 화면 쪽 ship-store 가 트랜잭션으로).
// Python 판 firestore_sync.py 의 merge_rows · build_pack_patch · pack 기록과 같은 결과(비교 시험 test_웹판비교.py).
//   ZikjinData/CHUNK_n { dataStr: JSON(행 200개), updatedAt } — 행 { 상품코드, 상품명, _q:{소스:수량}, _d:'YYYYMMDD', 수량 }
//   artifacts/team-work-logger-v2/integrations/zabPacks  days.{YYYY-MM-DD}.{zikjin|ably} · src.{소스} · updatedAt(+09:00)
// 숫자만 기록한다 — 고객 정보는 넣지 않는다.
// ⚠️ mergeRows · buildPackPatch 는 'exe 호환판'이다(같은 날·같은 소스를 덮어씀 — Python 판 비교 시험이 이것을 본다).
//   웹판 전송은 같은 날 여러 묶음을 더하는 js/lib/ship-batch.js(mergeRowsBatched · packBatchPatch)를 쓴다(2026-11-12).

import { pyStr, pyStrip, pyFloat, pyTruthy, kstDay, kstIso } from './ship-core.js?v=202611131153';

export const CHUNK_SIZE = 200;
export const PACKS_DOC_PATH = 'artifacts/team-work-logger-v2/integrations/zabPacks';
export const PACK_CHANNEL_BY_SOURCE = Object.freeze({ ZG: 'zikjin', ZGF: 'zikjin', AB: 'ably', ABF: 'ably' });
export const PACK_KEEP_DAYS = 90;

/** _to_num — 정수면 정수, 아니면 소수, 못 읽으면 0 */
export function toNum(v) {
    let f;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') f = v;
    else if (typeof v === 'boolean') f = v ? 1 : 0;
    else if (typeof v === 'string') { f = pyFloat(v); if (f === null) return 0; }
    else return 0;
    if (Number.isNaN(f)) return 0;
    if (!Number.isFinite(f)) return 0;   // Python 은 OverflowError 로 멈춘다 — 웹판은 0
    return f === Math.trunc(f) ? (f === 0 ? 0 : f) : f;
}

const isDict = (q) => q !== null && typeof q === 'object' && !Array.isArray(q);

/**
 * merge_rows — 기존 행 + 이번 소스의 새 행 → 합본(오늘 _d 만 남김, 이번 소스는 덮어씀, 합 0 이하 삭제, 코드순).
 * newRows: [[상품코드, 상품명, 수량], …]
 */
export function mergeRows(existingRows, newRows, sourceId, sessionDate) {
    const day = pyStr(sessionDate);
    const merged = new Map();
    for (const row of existingRows || []) {
        if (!row || pyStr(row._d !== undefined ? row._d : '') !== day) continue;
        const code = pyStrip(pyStr(row['상품코드'] !== undefined ? row['상품코드'] : ''));
        if (!code) continue;
        const q = row._q;
        if (!isDict(q)) continue;
        const qq = {};
        for (const [k, v] of Object.entries(q)) qq[k] = toNum(v);
        const nm = row['상품명'];
        merged.set(code, { '상품코드': code, '상품명': pyTruthy(nm) ? nm : '', _q: qq, _d: day });
    }
    for (const row of merged.values()) row._q[sourceId] = 0;
    for (const item of newRows || []) {
        const code = pyStrip(pyStr(item[0]));
        if (!code) continue;
        let name = item.length > 1 ? item[1] : '';
        if (!pyTruthy(name)) name = '';
        const qty = toNum(item.length > 2 ? item[2] : 0);
        if (!merged.has(code)) merged.set(code, { '상품코드': code, '상품명': name, _q: {}, _d: day });
        const cur = merged.get(code);
        cur._q[sourceId] = (cur._q[sourceId] || 0) + qty;
        if (pyTruthy(name) && !pyTruthy(cur['상품명'])) cur['상품명'] = name;
    }
    const out = [];
    for (const row of merged.values()) {
        const q = {};
        for (const [k, v] of Object.entries(row._q)) if (v) q[k] = v;
        row._q = q;
        let total = 0;
        for (const v of Object.values(q)) total += v;
        if (total <= 0) continue;
        row['수량'] = total;
        out.push(row);
    }
    out.sort((a, b) => (a['상품코드'] < b['상품코드'] ? -1 : a['상품코드'] > b['상품코드'] ? 1 : 0));
    return out;
}

/** json.dumps(x, ensure_ascii=False) 와 같은 글자(', ' · ': ' 구분) — dataStr 을 Python 판과 똑같이 */
export function pyJsonDumps(x) {
    if (x === null || x === undefined) return 'null';
    if (typeof x === 'boolean') return x ? 'true' : 'false';
    if (typeof x === 'number') {
        if (Number.isNaN(x)) return 'NaN';
        if (x === Infinity) return 'Infinity';
        if (x === -Infinity) return '-Infinity';
        return pyStr(x);
    }
    if (typeof x === 'string') return JSON.stringify(x);
    if (Array.isArray(x)) return '[' + x.map(pyJsonDumps).join(', ') + ']';
    return '{' + Object.entries(x).map(([k, v]) => JSON.stringify(k) + ': ' + pyJsonDumps(v)).join(', ') + '}';
}

// 문서 하나의 dataStr 상한 — 규칙(firestore.rules ZikjinData)이 20만 자까지 받는다. 묶음 내역(_qb)으로 행이 길어져 여유를 둔다.
export const CHUNK_CHARS_MAX = 190000;

/** 합본 행 → CHUNK 문서들 [{ id:'CHUNK_0', dataStr }] (빈 목록이면 [])
 *  200행마다 나누고, 그 전에 dataStr 이 CHUNK_CHARS_MAX 자를 넘게 되면 다음 CHUNK 로(행이 짧으면 Python 판과 같다) */
export function chunkDocs(rows, maxChars = CHUNK_CHARS_MAX) {
    const out = [];
    let cur = [], len = 2;   // '[' ']'
    const flush = () => { out.push({ id: `CHUNK_${out.length}`, dataStr: pyJsonDumps(cur) }); cur = []; len = 2; };
    for (const row of rows) {
        const n = pyJsonDumps(row).length;
        if (cur.length && (cur.length >= CHUNK_SIZE || len + 2 + n > maxChars)) flush();   // 2 = ', '
        len += n + (cur.length ? 2 : 0);
        cur.push(row);
    }
    if (cur.length) flush();
    return out;
}

/** 지울 옛 CHUNK 문서 id (이번에 안 쓴 것) */
export function leftoverChunkIds(oldIds, docs) {
    const keep = new Set(docs.map(d => d.id));
    return (oldIds || []).filter(id => !keep.has(id));
}

/** CHUNK 문서들의 dataStr → 행 목록 (깨진 문서는 건너뜀) */
export function rowsFromChunks(dataStrs) {
    const rows = [];
    for (const s of dataStrs || []) {
        if (!s) continue;
        try {
            const chunk = JSON.parse(s);
            if (Array.isArray(chunk)) rows.push(...chunk);
        } catch (_) { /* Python 판도 건너뜀 */ }
    }
    return rows;
}

const fsInt = (v) => {
    if (!isDict(v)) return 0;
    if ('integerValue' in v) { const n = parseInt(v.integerValue, 10); return Number.isFinite(n) ? n : 0; }
    if ('doubleValue' in v) { const n = Math.trunc(Number(v.doubleValue)); return Number.isFinite(n) ? n : 0; }
    return 0;
};

/** parse_pack_days — REST 문서 → { 날짜: { 소스: 봉 수 } } */
export function parsePackDays(doc) {
    const days = (((doc || {}).fields || {}).days || {}).mapValue?.fields || {};
    const out = {};
    for (const [day, v] of Object.entries(days)) {
        const f = ((v || {}).mapValue || {}).fields || {};
        const src = (f.src || {}).mapValue?.fields || {};
        out[day] = {};
        for (const [k, x] of Object.entries(src)) out[day][k] = fsInt(x);
    }
    return out;
}

/** SDK 로 읽은 문서 값(data()) → { 날짜: { 소스: 봉 수 } }
 *  src 가 없고 묶음 내역(bat, js/lib/ship-batch.js)만 있는 소스는 Σ bat[s].n 으로 본다(src 가 있으면 src 가 먼저 — exe 가 쓴 값) */
export function packDaysFromData(data) {
    const days = (data && isDict(data.days)) ? data.days : {};
    const out = {};
    for (const [day, v] of Object.entries(days)) {
        const src = (v && isDict(v.src)) ? v.src : {};
        out[day] = {};
        for (const [k, n] of Object.entries(src)) out[day][k] = Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0;
        const bat = (v && isDict(v.bat)) ? v.bat : {};
        for (const [k, b] of Object.entries(bat)) {
            if (Object.prototype.hasOwnProperty.call(out[day], k) || !isDict(b) || !PACK_CHANNEL_BY_SOURCE[k]) continue;
            let n = 0;
            for (const x of Object.values(b)) if (isDict(x)) n += Number.isFinite(Number(x.n)) ? Math.trunc(Number(x.n)) : 0;
            out[day][k] = n;
        }
    }
    return out;
}

const DAY_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
function dayMs(k) {
    const m = DAY_RE.exec(k);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const ms = Date.UTC(y, mo - 1, d);
    const back = new Date(ms);
    if (mo < 1 || mo > 12 || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return ms;
}

/**
 * build_pack_patch — (updateMask 필드 경로, REST 본문). 그 날의 해당 채널·src 항목·updatedAt 만 덮고
 * keepDays 보다 오래된 날짜 키는 마스크에만 넣어 지운다.
 */
export function buildPackPatch(existing, day, sourceId, count, now = new Date(), keepDays = PACK_KEEP_DAYS) {
    const channel = PACK_CHANNEL_BY_SOURCE[sourceId];
    if (!channel) throw new Error(`알 수 없는 소스 ${sourceId}`);
    const n = Math.max(0, Math.trunc(Number(count)) || 0);
    const src = { ...((existing || {})[day] || {}) };
    src[sourceId] = n;
    let total = 0;
    for (const [k, v] of Object.entries(src)) if (PACK_CHANNEL_BY_SOURCE[k] === channel) total += v;
    const d = `days.\`${day}\``;
    const mask = [`${d}.${channel}`, `${d}.src.${sourceId}`, `${d}.updatedAt`];
    const iso = kstIso(now);
    const dayFields = {
        [channel]: { integerValue: String(total) },
        src: { mapValue: { fields: { [sourceId]: { integerValue: String(n) } } } },
        updatedAt: { stringValue: iso },
    };
    const cutoff = kstDay(now).ms - keepDays * 86400000;
    const old = [];
    for (const k of Object.keys(existing || {}).sort()) {
        const ms = dayMs(k);
        if (ms === null) continue;
        if (ms < cutoff && k !== day) {
            mask.push(`days.\`${k}\``);
            old.push(k);
        }
    }
    const body = { fields: { days: { mapValue: { fields: { [day]: { mapValue: { fields: dayFields } } } } } } };
    return { mask, body, total, count: n, updatedAt: iso, channel, removeDays: old };
}

/** buildPackPatch 결과 → SDK updateDoc 용 { set: {필드경로: 값}, remove: [필드경로] } (경로 조각 배열) */
export function packPatchForSdk(p, sourceId, day) {
    return {
        set: [
            [['days', day, p.channel], p.total],
            [['days', day, 'src', sourceId], p.count],
            [['days', day, 'updatedAt'], p.updatedAt],
        ],
        remove: p.removeDays.map(k => ['days', k]),
    };
}
