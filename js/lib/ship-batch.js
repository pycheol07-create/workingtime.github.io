// === js/lib/ship-batch.js ===
// 플랫폼 출고 전송 — 같은 날 여러 묶음 합산(2026-11-12).
//   직원은 하루에 일반 출고를 여러 묶음 보낸다. 옛 방식(ship-merge.mergeRows · buildPackPatch — exe 호환판)은 같은 날·같은 소스를
//   덮어써 마지막 묶음만 남았다. 웹판은 묶음마다 따로 기억하고 합을 쓴다.
//
// 모양
//   ZikjinData 행(코드당 1행 그대로 — js/location.js 가 코드당 마지막 행만 쓴다):
//     { 상품코드, 상품명, _q:{소스:합}, _d:'YYYYMMDD', 수량:모든 소스 합, _qb:{ 소스:{ '<묶음키12>':수량, '_':옛 몫 } } }
//     _q[s] === Σ _qb[s]. _qb 가 없는 옛 행(exe 가 쓴 것)은 _q[s] 전부를 '_' 묶음으로 본다.
//   zabPacks: days.{d}.bat:{ 소스:{ '<키>':{ n:봉, q:총수량, k:품목수, at:ISO }, '_':{ n } } } · src[s] = Σ bat[s].n · zikjin/ably 합 그대로.
//     exe 가 src 만 바꿔 src ≠ Σbat 이면 차이를 '_' 로 넣는다(mixed — 화면이 'exe 와 섞임' 경고).
//   읽는 쪽(ship-transmit.summarizeTransmitRows · 처리량자동입력 전송값 · 로케이션추천 load_zikjin_days · 비품 예측 · 업무예상 봉 수)은
//   _q·수량·zikjin·ably·src 만 본다 — 이 모듈이 그 값을 늘 합과 같게 맞춘다(공용 사례 tests/fixtures/ship-batch-case.json).
// 묶음키: 이번 location.rows 를 코드별로 더해 코드순 `소스\n코드\t수량…` 의 SHA-256 앞 12자. 같은 전표를 다시 보내면 같은 키.
// 순수 모듈(해시만 crypto.subtle — 브라우저·node 둘 다). 행 내용은 로그에 남기지 않는다. 테스트: tests/ship-batch.test.js

import { pyStr, pyStrip, pyTruthy, kstIso } from './ship-core.js?v=202611131136';
import { toNum, PACK_CHANNEL_BY_SOURCE } from './ship-merge.js?v=202611131136';

export const LEGACY = '_';          // 옛 몫(exe 가 쓴 것·_qb 없는 행)
export const KEY_LEN = 12;
export const BATCH_MAX = 20;        // 소스·날짜마다 묶음 상한(옛 몫 '_' 는 세지 않음)
const KEY_RE = /^[0-9a-f]{12}$/;

const isDict = (q) => q !== null && typeof q === 'object' && !Array.isArray(q);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const checkSource = (s) => { if (!PACK_CHANNEL_BY_SOURCE[s]) throw new Error(`알 수 없는 소스 ${s}`); };

/** 묶음키 모양인가(12자 소문자 16진) */
export const isBatchKey = (k) => typeof k === 'string' && KEY_RE.test(k);

/** location.rows([코드, 이름, 수량]) → Map(코드 → 합), 코드순. 빈 코드·0 은 뺀다 */
export function codeTotals(rows) {
    const m = new Map();
    for (const item of rows || []) {
        if (!item) continue;
        const code = pyStrip(pyStr(item[0]));
        if (!code) continue;
        const qty = toNum(item.length > 2 ? item[2] : 0);
        m.set(code, (m.get(code) || 0) + qty);
    }
    const out = new Map();
    for (const c of [...m.keys()].sort(byCode)) if (m.get(c)) out.set(c, m.get(c));
    return out;
}

/** 묶음키를 만들 글자(소스\n코드\t수량…) */
export function batchText(source, rows) {
    const lines = [String(source)];
    for (const [c, q] of codeTotals(rows)) lines.push(`${c}\t${pyStr(q)}`);
    return lines.join('\n');
}

async function subtle() {
    const c = globalThis.crypto;
    if (c && c.subtle) return c.subtle;
    const m = await import('node:crypto');   // 옛 node
    return m.webcrypto.subtle;
}

/** 바이트·글자 → SHA-256 16진 */
export async function sha256Hex(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const buf = await (await subtle()).digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 묶음키(12자) */
export async function batchKeyOf(source, rows) {
    checkSource(source);
    return (await sha256Hex(batchText(source, rows))).slice(0, KEY_LEN);
}

/** 같은 내용을 '새 묶음으로 더하기' 할 때 쓰는 다른 키 — 앞 10자 + 두 자리 번호(16진) */
export function freshKey(key, used) {
    const u = new Set(used || []);
    for (let i = 1; i < 256; i++) {
        const k = key.slice(0, KEY_LEN - 2) + i.toString(16).padStart(2, '0');
        if (k !== key && !u.has(k)) return k;
    }
    throw new Error('새 묶음 키를 만들지 못했습니다.');
}

/** 행 한 줄의 소스별 묶음 → { 소스: {키: 수량} } (합이 _q 와 다르면 차이를 '_' 로) + mixed */
function rowBatches(row) {
    const q = row._q;
    const qb = isDict(row._qb) ? row._qb : {};
    const out = {};
    let mixed = false;
    for (const [s, v] of Object.entries(q)) {
        const total = toNum(v);
        if (!total) continue;
        const b = isDict(qb[s]) ? qb[s] : null;
        if (!b) { out[s] = { [LEGACY]: total }; continue; }
        const named = {};
        let sumNamed = 0;
        for (const [k, x] of Object.entries(b)) {
            if (k === LEGACY) continue;
            const n = toNum(x);
            if (!n) continue;
            named[k] = n;
            sumNamed += n;
        }
        const legacyWas = toNum(b[LEGACY]);
        let legacy = total - sumNamed;
        if (legacy < 0) {             // exe 가 줄여 썼다 — 묶음 내역을 믿을 수 없다
            mixed = true;
            out[s] = { [LEGACY]: total };
            continue;
        }
        if (legacy !== legacyWas) mixed = true;
        out[s] = legacy ? { [LEGACY]: legacy, ...named } : named;
    }
    return { batches: out, mixed };
}

/**
 * 그날 행들에서 한 소스의 묶음 모아 보기.
 * @returns {{ keys: Object<string, {q:number, k:number, codes: Map<string, number>}>, legacy: number, mixed: boolean }}
 *   keys 에 '_'(옛 몫)도 들어간다(있으면).
 */
export function batchesOf(rows, source, day = null) {
    const keys = {};
    let mixed = false;
    for (const row of rows || []) {
        if (!row || !isDict(row._q)) continue;
        if (day !== null && pyStr(row._d !== undefined ? row._d : '') !== pyStr(day)) continue;
        const code = pyStrip(pyStr(row['상품코드'] !== undefined ? row['상품코드'] : ''));
        if (!code) continue;
        const r = rowBatches(row);
        if (r.mixed) mixed = true;
        const b = r.batches[source];
        if (!b) continue;
        for (const [k, n] of Object.entries(b)) {
            if (!keys[k]) keys[k] = { q: 0, k: 0, codes: new Map() };
            keys[k].q += n;
            keys[k].k += 1;
            keys[k].codes.set(code, (keys[k].codes.get(code) || 0) + n);
        }
    }
    return { keys, legacy: keys[LEGACY] ? keys[LEGACY].q : 0, mixed };
}

/** 두 묶음(코드 → 수량)이 얼마나 같은가 — Σ min / max(합A, 합B). 0~1 */
export function overlapShare(a, b) {
    const A = a instanceof Map ? a : new Map(Object.entries(a || {}));
    const B = b instanceof Map ? b : new Map(Object.entries(b || {}));
    let ta = 0, tb = 0, common = 0;
    for (const v of A.values()) ta += Math.max(0, v);
    for (const v of B.values()) tb += Math.max(0, v);
    for (const [c, v] of A) if (B.has(c)) common += Math.max(0, Math.min(v, B.get(c)));
    const den = Math.max(ta, tb);
    return den > 0 ? common / den : 0;
}

/**
 * 묶음별 합치기 — 기존 행(그날 _d 만 남김) + 이번 묶음.
 * @param {Array} existingRows  CHUNK 들의 행
 * @param {Array<[string,string,number]>} newRows  이번 location.rows (빼기만 할 때는 [])
 * @param {string} source  ZG·ZGF·AB·ABF
 * @param {string} day     'YYYYMMDD'
 * @param {{ key: string|null, mode?: 'add'|'replace', drop?: string[] }} opt
 *   add     — 같은 키가 이미 있으면 오류(두 번 더해지지 않게)
 *   replace — 같은 키 몫을 지우고 새로(다시 보내기)
 *   drop    — 이 키들의 몫을 먼저 지운다(고친 전표로 바꾸기 · 묶음 빼기)
 *   subtractLegacy — replace 인데 키가 행에 없고 옛 몫만 있을 때(exe 가 묶음 내역을 지움) '_' 에서 이번 묶음 코드별 수량만 뺀다.
 *                    이번 묶음의 모든 코드가 '_' 안에 다 들어 있을 때만(담김 검사) — 아니면 오류(exe 가 같은 소스를 덮어씀)
 * @returns {{ rows, keys: Object<string, number>, legacy: number, mixed: boolean, removed: number, added: number }}
 *   keys = 이번 소스의 묶음별 합(쓴 뒤), removed = 지운 수량, added = 더한 수량
 */
export function mergeRowsBatched(existingRows, newRows, source, day, { key = null, mode = 'add', drop = [], subtractLegacy = false } = {}) {
    checkSource(source);
    if (key !== null && !isBatchKey(key)) throw new Error('묶음 키 모양이 틀렸습니다.');
    if (mode !== 'add' && mode !== 'replace') throw new Error(`알 수 없는 방식 ${mode}`);
    const d = pyStr(day);
    const merged = new Map();
    let mixed = false;
    for (const row of existingRows || []) {
        if (!row || pyStr(row._d !== undefined ? row._d : '') !== d) continue;
        const code = pyStrip(pyStr(row['상품코드'] !== undefined ? row['상품코드'] : ''));
        if (!code || !isDict(row._q)) continue;
        const r = rowBatches(row);
        if (r.mixed) mixed = true;
        const nm = row['상품명'];
        merged.set(code, { code, name: pyTruthy(nm) ? nm : '', b: r.batches });
    }
    const dropSet = new Set(drop || []);
    if (key !== null && mode === 'replace') dropSet.add(key);
    if (key !== null && mode === 'add' && !dropSet.has(key)) {
        for (const r of merged.values()) {
            if (r.b[source] && has(r.b[source], key)) throw new Error('같은 묶음이 이미 들어 있습니다 — 다시 보내기(바꾸기)로 하세요.');
        }
    }
    // 바꾸기인데 지울 묶음이 행에 없고 옛 몫('_')이 있으면 — exe 가 행을 다시 써 묶음 내역이 지워진 상태다
    //   ('_' 안에 이 묶음과 오늘 다른 웹 묶음·exe 몫이 합쳐져 있다). 그대로 더하면 두 번 들어가므로 멈춘다.
    //   subtractLegacy 면 같은 키 = 같은 내용이므로 '_' 에서 이번 묶음의 코드별 수량만 min('_', 수량) 만큼 뺀다(다른 몫은 그대로).
    let removed = 0;
    if (key !== null && mode === 'replace' && !dropSet.has(LEGACY)) {
        let found = false, legacy = false;
        for (const r of merged.values()) {
            const b = r.b[source];
            if (!b) continue;
            if (has(b, key)) found = true;
            if (has(b, LEGACY)) legacy = true;
        }
        if (!found && legacy) {
            if (!subtractLegacy) throw new Error('이 묶음 몫을 로케이션에서 찾을 수 없습니다(exe 기록과 섞임) — 그대로 바꾸면 두 번 들어가 멈췄습니다.');
            // 담김 검사 — 이번 묶음의 모든 코드가 옛 몫 안에 다 들어 있어야 뺀다(exe 가 같은 소스를 덮어쓰면 안 들어 있다)
            const mine = codeTotals(newRows);
            const legacyOf = (code) => { const b = merged.has(code) ? merged.get(code).b[source] : null; return b && has(b, LEGACY) ? b[LEGACY] : 0; };
            for (const [code, q] of mine) {
                if (legacyOf(code) < q) throw new Error('exe 가 같은 소스를 덮어써 이 묶음 몫을 가릴 수 없습니다 — 보내지 않습니다(로케이션 관리에서 확인).');
            }
            for (const [code, q] of mine) {
                merged.get(code).b[source][LEGACY] -= q;
                removed += q;
            }
        }
    }
    for (const r of merged.values()) {
        const b = r.b[source];
        if (!b) continue;
        for (const k of dropSet) if (has(b, k)) { removed += b[k]; delete b[k]; }
    }
    let added = 0;
    if (key !== null) {
        for (const item of newRows || []) {
            const code = pyStrip(pyStr(item[0]));
            if (!code) continue;
            let name = item.length > 1 ? item[1] : '';
            if (!pyTruthy(name)) name = '';
            const qty = toNum(item.length > 2 ? item[2] : 0);
            if (!merged.has(code)) merged.set(code, { code, name, b: {} });
            const cur = merged.get(code);
            if (!cur.b[source]) cur.b[source] = {};
            cur.b[source][key] = (cur.b[source][key] || 0) + qty;
            added += qty;
            if (pyTruthy(name) && !pyTruthy(cur.name)) cur.name = name;
        }
    }
    // 마무리 — 0 인 묶음·소스 빼고 _q·수량을 합으로, 합 0 이하 행 삭제, 코드순
    const keys = {};
    const out = [];
    for (const r of merged.values()) {
        const q = {}, qb = {};
        let total = 0;
        for (const [s, b] of Object.entries(r.b)) {
            const nb = {};
            let sum = 0;
            for (const [k, n] of Object.entries(b)) if (n) { nb[k] = n; sum += n; }
            if (!sum) continue;
            q[s] = sum;
            qb[s] = nb;
            total += sum;
        }
        if (total <= 0) continue;
        if (qb[source]) for (const [k, n] of Object.entries(qb[source])) keys[k] = (keys[k] || 0) + n;
        // 칸 순서: mergeRows 와 같고 _qb 만 끝에(빼면 exe 호환판과 같은 모양)
        out.push({ '상품코드': r.code, '상품명': r.name, _q: q, _d: d, '수량': total, _qb: qb });
    }
    out.sort((a, b) => byCode(a['상품코드'], b['상품코드']));
    const named = Object.keys(keys).filter(k => k !== LEGACY).length;
    if (named > BATCH_MAX) throw new Error(`오늘 ${source} 묶음이 ${BATCH_MAX}개를 넘습니다 — 필요 없는 묶음을 먼저 빼 주세요.`);
    return { rows: out, keys, legacy: keys[LEGACY] || 0, mixed, removed, added };
}

/** zabPacks 하루치 → 한 소스의 묶음 { 키: {n,q,k,at} } + mixed(src ≠ Σbat 이면 차이를 '_' 로) */
export function packBatchesOf(dayEntry, source) {
    const e = isDict(dayEntry) ? dayEntry : {};
    const src = isDict(e.src) ? e.src : {};
    const bat = isDict(e.bat) && isDict(e.bat[source]) ? e.bat[source] : {};
    const out = {};
    let sumNamed = 0;
    for (const [k, v] of Object.entries(bat)) {
        if (k === LEGACY || !isDict(v)) continue;
        const n = Math.max(0, Math.trunc(Number(v.n)) || 0);
        out[k] = { n, q: toNum(v.q), k: Math.trunc(Number(v.k)) || 0, at: typeof v.at === 'string' ? v.at : '' };
        sumNamed += n;
    }
    const hasSrc = has(src, source);
    const srcN = hasSrc ? (Math.trunc(Number(src[source])) || 0) : null;
    const legacyWas = isDict(bat[LEGACY]) ? (Math.trunc(Number(bat[LEGACY].n)) || 0) : 0;
    let mixed = false;
    if (srcN === null) {
        if (legacyWas) out[LEGACY] = { n: legacyWas };
    } else {
        let legacy = srcN - sumNamed;
        if (legacy < 0) {                         // exe 가 줄여 썼다 — 묶음 내역을 버리고 옛 몫으로
            mixed = true;
            for (const k of Object.keys(out)) delete out[k];
            legacy = srcN;
        } else if (legacy !== legacyWas && Object.keys(bat).length) {
            mixed = true;                         // exe 가 src 만 바꿨다
        }
        if (legacy) out[LEGACY] = { n: legacy };
    }
    return { batches: out, mixed };
}

/**
 * 봉 수 묶음 갱신 계획 — 그 날 그 소스의 bat 를 통째로 바꾸고 src·채널 합을 Σ 로.
 * @param {object|undefined} dayEntry  문서의 days[day] (없으면 undefined)
 * @param {string} day 'YYYY-MM-DD'
 * @param {string} source
 * @param {string|null} key  더할 묶음(빼기만 할 때 null)
 * @param {{n:number, q:number, k:number}} val
 * @param {Date} now
 * @param {{ mode?: 'add'|'replace', drop?: string[] }} opt
 * @returns {{ bat: object, count: number, total: number, channel: string, mixed: boolean, removed: number }}
 *   bat = 그 소스의 새 묶음 맵(쓸 값), count = src[source] 새 값, total = 그날 채널 합
 */
export function packBatchPatch(dayEntry, day, source, key, val, now = new Date(), { mode = 'add', drop = [] } = {}) {
    checkSource(source);
    const channel = PACK_CHANNEL_BY_SOURCE[source];
    if (key !== null && !isBatchKey(key)) throw new Error('묶음 키 모양이 틀렸습니다.');
    const { batches, mixed } = packBatchesOf(dayEntry, source);
    const dropSet = new Set(drop || []);
    if (key !== null && mode === 'replace') dropSet.add(key);
    if (key !== null && mode === 'add' && !dropSet.has(key) && has(batches, key)) {
        throw new Error('같은 묶음이 이미 들어 있습니다 — 다시 보내기(바꾸기)로 하세요.');
    }
    let removed = 0;
    for (const k of dropSet) if (has(batches, k)) { removed += batches[k].n; delete batches[k]; }
    if (key !== null) {
        const v = val || {};
        batches[key] = {
            n: Math.max(0, Math.trunc(Number(v.n)) || 0),
            q: toNum(v.q), k: Math.max(0, Math.trunc(Number(v.k)) || 0),
            at: kstIso(now),
        };
    }
    const named = Object.keys(batches).filter(k => k !== LEGACY).length;
    if (named > BATCH_MAX) throw new Error(`이 날 ${source} 묶음이 ${BATCH_MAX}개를 넘습니다 — 필요 없는 묶음을 먼저 빼 주세요.`);
    let count = 0;
    for (const v of Object.values(batches)) count += v.n;
    const src = { ...((isDict(dayEntry) && isDict(dayEntry.src)) ? dayEntry.src : {}) };
    src[source] = count;
    let total = 0;
    for (const [k, v] of Object.entries(src)) if (PACK_CHANNEL_BY_SOURCE[k] === channel) total += Math.trunc(Number(v)) || 0;
    return { bat: batches, count, total, channel, mixed, removed };
}

/**
 * 묶음 빼기(행) — mergeRowsBatched 의 빼기만.
 * @returns mergeRowsBatched 결과
 */
export function removeBatch(existingRows, source, day, key) {
    if (!isBatchKey(key) && key !== LEGACY) throw new Error('묶음 키 모양이 틀렸습니다.');
    return mergeRowsBatched(existingRows, [], source, day, { key: null, drop: [key] });
}

/**
 * 미리보기 정리(읽기만) — 행 묶음 + 봉 수 묶음 → 화면이 물을 것.
 * @param {Array} rows   CHUNK 행
 * @param {object|undefined} packDayEntry  zabPacks days[packDay]
 * @param {{source, key, newRows, day}} p  day = 'YYYYMMDD'
 * @returns {{ sameKey: boolean, keyInRows: boolean, keyInPacks: boolean, lost: boolean,
 *             overlaps: Array<{key, at, share}>, today: Array<{key, at, n, q, k}>, legacy: number, mixed: boolean }}
 *   sameKey    = 바꾸기로 그 몫만 바꿀 수 있다(행 _qb 에 같은 키, 또는 봉 수에만 있고 행에 옛 몫이 없음)
 *   keyInRows  = 행(_qb)에 같은 키가 있다
 *   keyInPacks = 봉 수(bat)에 같은 키가 있다
 *   lost       = 봉 수에만 있고 행에는 옛 몫('_')만 — exe 가 행을 다시 써 이 묶음 몫을 찾을 수 없다(바꾸면 두 번 들어감)
 *   legacyHolds = 이번 묶음의 모든 코드가 옛 몫 안에 다 들어 있다(lost 일 때 옛 몫에서 이번 몫만 빼도 되는 조건 — mixed 가 아닐 때만)
 */
export function previewBatches(rows, packDayEntry, { source, key, newRows, day }) {
    checkSource(source);
    const rb = batchesOf(rows, source, day);
    const pb = packBatchesOf(packDayEntry, source);
    const mine = codeTotals(newRows);
    const all = new Set([...Object.keys(rb.keys), ...Object.keys(pb.batches)]);
    const today = [];
    const overlaps = [];
    for (const k of all) {
        const r = rb.keys[k], p = pb.batches[k];
        const at = p && p.at ? p.at : '';
        today.push({ key: k, at, n: p ? p.n : null, q: r ? r.q : (p && p.q ? p.q : 0), k: r ? r.k : (p && p.k ? p.k : 0) });
        if (k !== key && r) overlaps.push({ key: k, at, share: overlapShare(mine, r.codes) });
    }
    today.sort((a, b) => (a.key === LEGACY ? -1 : b.key === LEGACY ? 1 : byCode(a.at, b.at) || byCode(a.key, b.key)));
    overlaps.sort((a, b) => b.share - a.share);
    const keyInRows = key !== null && has(rb.keys, key);
    const keyInPacks = key !== null && has(pb.batches, key);
    const lost = !keyInRows && keyInPacks && rb.legacy > 0;
    // 담김 검사 — 이번 묶음 코드마다 옛 몫('_') ≥ 수량이면 옛 몫에서 이번 몫만 뺄 수 있다(mergeRowsBatched subtractLegacy 와 같은 조건)
    const leg = rb.keys[LEGACY] ? rb.keys[LEGACY].codes : new Map();
    const legacyHolds = mine.size > 0 && [...mine].every(([c, q]) => (leg.get(c) || 0) >= q);
    return {
        legacyHolds,
        // 봉 수에만 있고 행에 옛 몫도 없으면(그때 로케이션 전송만 실패) 바꾸기가 안전하다 — 같은 묶음으로 본다
        sameKey: keyInRows || (keyInPacks && !lost), keyInRows, keyInPacks, lost,
        overlaps, today, legacy: rb.legacy, mixed: rb.mixed || pb.mixed,
    };
}
