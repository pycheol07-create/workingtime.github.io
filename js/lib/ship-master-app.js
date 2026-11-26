// === js/lib/ship-master-app.js ===
// 직진 원본(직진배송출고ver.5) '앱 저장본'(2026-11-25 사용자 결정) — 원본 파일이 없는 자리도 시즌·공장상품명을 채우게
//   원본에서 6칸(SKU번호·바코드·상품명·옵션·시즌·공장상품명)만 뽑아(js/lib/ship-zikjin.js extractZikjinMaster) gzip → base64 조각으로
//   Firestore ShipMaster 에 둔다(js/ship-store.js). 원본 파일 자체·다른 열·다른 시트는 올리지 않는다.
// 문서 모양
//   ShipMaster/meta        { schema: 1, cur, ids: [≤3], vers: [≤3], updatedAt, rolledBy?, rolledAt? }
//     vers[i] = { id, srcMs, hash, rows, chunks, gzBytes, name, by(앱 직원 이름), byEmail, at } — srcMs 큰 것(새 원본)이 앞.
//     id = 'v' + srcMs(13자리) + '_' + hash 앞 12자. 되돌리기는 cur 만 옛 판으로(+ rolledBy·rolledAt).
//   ShipMaster/{id}_c{n}   { v: id, i: n, d: base64(≤ 190,000자) }
//   풀기 전 JSON = {"schema":1,"cols":[6칸 이름],"rows":[[6칸]…]} — 파일 줄 순서 그대로, 칸 값은 글자·숫자·참거짓·null 만(숫자/글자 구분 유지).
//   hash = 그 JSON 글자의 SHA-256(js/lib/ship-batch.js sha256Hex). 풀 때 다시 계산해 맞는지 본다.
// 순수 모듈(gzip 은 CompressionStream — 브라우저·node 18+). 칸 값은 로그·화면 글에 쓰지 않는다(숫자·날짜·이름만).
// 테스트: tests/ship-master-app.test.js · tests/ship-zikjin-master.test.js(뽑은 칸만 올라가는지) · 규칙테스트.js(ShipMaster) · tools/ship-check.py

import { sha256Hex } from './ship-batch.js?v=202611260948';
import { MASTER_FIELDS } from './ship-zikjin.js?v=202611260948';

export const MASTER_COLLECTION = 'ShipMaster';
export const META_ID = 'meta';
export const SCHEMA = 1;
export const MAX_ROWS = 60000;
export const CELL_MAX = 300;          // 칸 하나 글자 수 상한(원본 칸이 아닌 것이 섞였는지 — 넘으면 올리지 않음)
export const CHUNK_CHARS = 190000;    // 조각 하나 base64 글자 수(규칙 상한 200,000 · 4의 배수)
export const MAX_CHUNKS = 40;
export const KEEP = 3;                // 남겨 두는 판 수
export const FUTURE_SLACK_MS = 10 * 60 * 1000;   // 파일 저장 시각이 지금보다 10분 넘게 뒤면(PC 시계 이상) 올리지 않음 — 규칙과 같은 값(2026-11-25 리뷰)
export const OLD_MS = 7 * 86400000;        // 쓰는 앱 저장본이 이보다 오래되면 경고

const ID_RE = /^v\d{13}_[0-9a-f]{12}$/;

// ---------------------------------------------------------------- 내용
const cellOk = (v) => v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

/** 줄 목록 검사 — 맞지 않으면 던진다 */
function checkRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('원본 줄이 없습니다.');
    if (rows.length > MAX_ROWS) throw new Error(`원본 줄이 너무 많습니다(${rows.length}줄 — ${MAX_ROWS}줄까지).`);
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!Array.isArray(r) || r.length !== MASTER_FIELDS.length) throw new Error(`원본 ${i + 1}번째 줄이 6칸이 아닙니다.`);
        for (const v of r) {
            if (!cellOk(v)) throw new Error(`원본 ${i + 1}번째 줄에 쓸 수 없는 값 종류가 있습니다.`);
            if (typeof v === 'string' && v.length > CELL_MAX) throw new Error(`원본 ${i + 1}번째 줄에 ${CELL_MAX}자 넘는 칸이 있습니다.`);
        }
    }
}

/**
 * 뽑은 6칸(extractZikjinMaster 결과) → 올릴 내용 { schema, cols, rows }. 맞지 않으면 던진다(6칸 아님 · 6만 줄 넘음 · 300자 넘는 칸 · 이상한 값).
 *   머리글 6칸이 모두 정확해야(ext.allExact — ship-zikjin MASTER_EXACT) 만든다: 어림으로 찾은 열(예: '공장단가')이 올라가지 않게(code 'inexact').
 *   undefined 칸은 null 로(파일에서 빈 칸).
 */
export function masterPayload(ext) {
    if (!ext || ext.allExact !== true) {
        const which = ext && Array.isArray(ext.inexact) && ext.inexact.length ? ext.inexact.join('·') : '알 수 없음';
        throw Object.assign(new Error(`머리글이 정확하지 않아 앱에 올리지 않음(정확하지 않은 칸: ${which})`), { code: 'inexact' });
    }
    const rows = ((ext && ext.rows) || []).map(r => (Array.isArray(r) ? r.map(v => (v === undefined ? null : v)) : r));
    checkRows(rows);
    return { schema: SCHEMA, cols: [...MASTER_FIELDS], rows };
}

/** 풀어 낸 내용 검사 → 그대로 돌려줌 */
function checkPayload(p) {
    if (!p || p.schema !== SCHEMA || !Array.isArray(p.cols) || p.cols.join(',') !== MASTER_FIELDS.join(',')) {
        throw new Error('앱 저장본 모양이 다릅니다.');
    }
    checkRows(p.rows);
    return p;
}

// ---------------------------------------------------------------- gzip · base64
async function pipeBytes(u8, stream) {
    const s = new Blob([u8]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
}
const gzip = (u8) => pipeBytes(u8, new CompressionStream('gzip'));
const gunzip = (u8) => pipeBytes(u8, new DecompressionStream('gzip'));

function toBase64(u8) {
    let out = '';
    const STEP = 0x8000;
    for (let i = 0; i < u8.length; i += STEP) out += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
    return btoa(out);
}
function fromBase64(s) {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
}
const asU8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
/** base64 조각(순서대로) → gzip 바이트(이 PC 보관용) */
export const chunksToGz = (chunks) => fromBase64((chunks || []).join(''));

/** 판 id — 'v' + 파일 저장 시각(13자리) + '_' + hash 앞 12자 */
export function versionId(srcMs, hash) {
    return 'v' + String(Math.trunc(Number(srcMs) || 0)).padStart(13, '0') + '_' + String(hash).slice(0, 12);
}
export const chunkId = (id, n) => `${id}_c${n}`;
export const isVersionId = (id) => typeof id === 'string' && ID_RE.test(id);

/**
 * 내용 → { hash, gz(Uint8Array), chunks(base64 조각), rows, gzBytes }. 조각이 MAX_CHUNKS 넘으면 던진다.
 */
export async function encodeMaster(payload) {
    checkPayload(payload);
    const json = JSON.stringify({ schema: payload.schema, cols: payload.cols, rows: payload.rows });
    const hash = await sha256Hex(json);
    const gz = await gzip(new TextEncoder().encode(json));
    const b64 = toBase64(gz);
    const chunks = [];
    for (let i = 0; i < b64.length; i += CHUNK_CHARS) chunks.push(b64.slice(i, i + CHUNK_CHARS));
    if (chunks.length > MAX_CHUNKS) throw new Error(`원본이 너무 큽니다(조각 ${chunks.length}개 — ${MAX_CHUNKS}개까지).`);
    return { hash, gz, chunks, rows: payload.rows.length, gzBytes: gz.byteLength };
}

/**
 * 조각(chunks — 순서대로) 또는 gzip 바이트(gz, 이 PC 보관본) → 내용. hash 는 꼭 넘긴다 — 다시 계산해 다르면 던진다.
 */
export async function decodeMaster({ chunks = null, gz = null, hash }) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('앱 저장본 해시가 없습니다.');
    const bytes = gz ? asU8(gz) : fromBase64((chunks || []).join(''));
    const json = new TextDecoder().decode(await gunzip(bytes));
    if ((await sha256Hex(json)) !== hash) throw new Error('앱 저장본이 깨졌습니다(해시가 다름) — 다시 올려야 합니다.');
    return checkPayload(JSON.parse(json));
}

// ---------------------------------------------------------------- meta
/** Firestore 시각(Timestamp)·Date·숫자 → ms (모르면 0) */
export function msOf(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
    return 0;
}

/**
 * meta 문서 값 → 화면·판단용 { cur, ids, vers: [{…, atMs}], rolled, rolledBy, rolledAtMs } 또는 null(없음·모양 틀림).
 *   vers 는 srcMs 큰 순. cur 가 vers 에 없으면 null.
 */
export function normalizeMeta(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.vers) || !raw.vers.length) return null;
    const vers = raw.vers
        .filter(v => v && isVersionId(v.id) && typeof v.hash === 'string' && Number.isFinite(Number(v.srcMs)) && Number(v.chunks) >= 1)
        .map(v => ({ id: v.id, srcMs: Number(v.srcMs), hash: v.hash, rows: Number(v.rows) || 0, chunks: Number(v.chunks), gzBytes: Number(v.gzBytes) || 0,
            name: String(v.name || ''), by: String(v.by || ''), atMs: msOf(v.at) }))
        .sort((a, b) => b.srcMs - a.srcMs);
    const cur = vers.find(v => v.id === raw.cur) || null;
    if (!cur) return null;
    const rb = raw.rolledBy && typeof raw.rolledBy === 'object' ? raw.rolledBy : null;
    return {
        cur: cur.id, curVer: cur, ids: vers.map(v => v.id), vers,
        rolled: cur.id !== vers[0].id,   // 지금 판이 가장 새 원본이 아님 = 되돌림
        rolledBy: rb ? String(rb.name || '') : '', rolledAtMs: msOf(raw.rolledAt),
    };
}

/**
 * 이번에 무엇을 쓸지 — 이 PC 원본(local) · 앱 저장본(meta) · 올릴 권한(canUpload).
 * @param {{ local: { srcMs, hash: string|null, from: 'pc'|'once'|'temp' }|null, meta: object|null, canUpload: boolean, now?: number|Date }} p
 *   local.hash null = 내용·머리글 검사에 걸려 올릴 수 없음(이 PC 에서는 그대로 쓴다). from 'temp'(서식용 원본 임시 칸)는 올리지 않는다.
 *   srcMs 0(저장 시각 없음 — 옛 PC 기억 원본 등)·10분 넘게 미래 = bad-time: 앱 저장본이 있으면 그것, 없으면 이 PC 원본(안 올림).
 * @returns {{ use: 'local'|'app'|'none', upload: boolean, why: string }}
 *   why: nothing · no-local · first · same · rolled · bad-time · newer · older · no-perm · bad-payload
 */
export function planMaster({ local = null, meta = null, canUpload = false, now = Date.now() }) {
    const m = meta && meta.curVer ? meta : normalizeMeta(meta);
    const nowMs = msOf(now);
    if (!local) return m ? { use: 'app', upload: false, why: 'no-local' } : { use: 'none', upload: false, why: 'nothing' };
    const allow = !!canUpload && local.from !== 'temp';
    const srcMs = Number(local.srcMs) || 0;
    const badTime = !(srcMs > 0) || srcMs > nowMs + FUTURE_SLACK_MS;
    const up = (why) => {
        if (!allow) return { use: 'local', upload: false, why: 'no-perm' };
        if (!local.hash) return { use: 'local', upload: false, why: 'bad-payload' };
        return { use: 'local', upload: true, why };
    };
    if (!m) return badTime ? { use: 'local', upload: false, why: 'bad-time' } : up('first');
    if (local.hash && local.hash === m.curVer.hash) return { use: 'local', upload: false, why: 'same' };
    // 남은 다른 판과 같은 내용 — 그 판이 지금 판보다 새것이면 되돌리기 전 판(rolled), 아니면 그냥 옛 판(older)
    const twin = local.hash ? m.vers.find(v => v.hash === local.hash) : null;
    if (twin) return { use: 'app', upload: false, why: twin.srcMs > m.curVer.srcMs ? 'rolled' : 'older' };
    if (badTime) return { use: 'app', upload: false, why: 'bad-time' };   // 저장 시각을 모르거나 미래 — 견줄 수 없으니 앱 저장본
    const max = Math.max(...m.vers.map(v => v.srcMs));
    if (srcMs > max) return up('newer');
    return { use: 'app', upload: false, why: 'older' };
}

/** 새 판 정보(vers 한 칸) */
export function newVersion({ srcMs, enc, name, by, byEmail, at }) {
    return {
        id: versionId(srcMs, enc.hash), srcMs: Math.trunc(Number(srcMs)), hash: enc.hash, rows: enc.rows, chunks: enc.chunks.length,
        gzBytes: enc.gzBytes, name: String(name || '').slice(0, 200), by: String(by || '').slice(0, 40), byEmail: String(byEmail || '').toLowerCase(), at,
    };
}

/**
 * 올린 뒤 meta(updatedAt 은 부르는 쪽이 서버 시각으로 더함) + 지울 조각 id.
 *   raw = 지금 meta 문서 값(그대로 — 옛 판 칸은 손대지 않고 옮긴다: 규칙이 '옛 판 그대로'를 본다). 새 판이 맨 앞, KEEP 개만.
 * @returns {{ meta: { schema, cur, ids, vers }, drop: string[] }}
 */
export function metaAfterUpload(raw, ver) {
    const old = (raw && Array.isArray(raw.vers) ? raw.vers : []).filter(v => v && v.id !== ver.id);
    old.sort((a, b) => Number(b.srcMs) - Number(a.srcMs));
    const keep = old.slice(0, KEEP - 1);
    const gone = old.slice(KEEP - 1);
    const drop = [];
    for (const v of gone) for (let n = 0; n < (Number(v.chunks) || 0) && n < MAX_CHUNKS; n++) drop.push(chunkId(v.id, n));
    const vers = [ver, ...keep];
    return { meta: { schema: SCHEMA, cur: ver.id, ids: vers.map(v => v.id), vers }, drop };
}

/**
 * 관리자 [앱 저장본 비우기](2026-11-25 리뷰) — 새 meta(updatedAt 은 부르는 쪽이 서버 시각으로) + 지울 조각 id(남은 판 전부).
 *   비운 뒤 다음에 원본이 있는 자리에서 만들면 첫 판으로 다시 올라간다.
 */
export function metaReset(raw) {
    const drop = [];
    for (const v of (raw && Array.isArray(raw.vers) ? raw.vers : [])) {
        if (v && isVersionId(v.id)) for (let n = 0; n < (Number(v.chunks) || 0) && n < MAX_CHUNKS; n++) drop.push(chunkId(v.id, n));
    }
    return { meta: { schema: SCHEMA, cur: null, ids: [], vers: [] }, drop };
}

/**
 * 되돌리기 — 바꿀 칸 { cur, rolledBy }(rolledAt·updatedAt 은 부르는 쪽이 서버 시각으로). id 가 없거나 지금 판이면 던진다.
 */
export function metaRollback(raw, id, { name = '', email = '' } = {}) {
    const ids = raw && Array.isArray(raw.ids) ? raw.ids : [];
    if (!ids.includes(id)) throw new Error('없는 판입니다.');
    if (raw.cur === id) throw new Error('이미 지금 쓰는 판입니다.');
    return { cur: id, rolledBy: { name: String(name || '').slice(0, 40), email: String(email || '').toLowerCase() } };
}

// ---------------------------------------------------------------- 글
const p2 = (x) => String(x).padStart(2, '0');
/** ms → 한국시간 'M/D HH:mm' */
export function kstShort(ms) {
    if (!(ms > 0)) return '';
    const d = new Date(ms + 9 * 3600 * 1000);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
const fmtN = (n) => Number(n || 0).toLocaleString('ko-KR');

/** 앱 저장본이 오래됐나(원본 파일 저장 시각 기준) */
export const isOldVersion = (ver, now = Date.now()) => !!ver && msOf(now) - ver.srcMs > OLD_MS;

/**
 * 앱 저장본 한 줄 설명 — '앱 저장본: 상품 20,000줄 · 원본 11/24 14:03 저장 · 11/24 15:10 OO 올림' (+ 되돌림 표시)
 * @param {object} m  normalizeMeta 결과
 */
export function masterAppText(m, { now = Date.now() } = {}) {
    if (!m || !m.curVer) return '앱 저장본 없음';
    const v = m.curVer;
    let t = `앱 저장본: 상품 ${fmtN(v.rows)}줄 · 원본 ${kstShort(v.srcMs)} 저장 · ${kstShort(v.atMs)}${v.by ? ` ${v.by}` : ''} 올림`;
    if (m.rolled) t += ` · ⟲ 되돌린 판${m.rolledBy ? `(${m.rolledBy}${m.rolledAtMs ? ` ${kstShort(m.rolledAtMs)}` : ''})` : ''}`;
    if (isOldVersion(v, now)) t += ' · 7일 넘음';
    return t;
}

/** planMaster why → 진행 기록 한 줄(값 없음) */
export const PLAN_TEXT = Object.freeze({
    nothing: '이 PC 원본도 앱 저장본도 없음',
    'no-local': '이 PC 에 원본이 없어 앱 저장본을 씀',
    first: '앱 저장본이 아직 없어 이 PC 원본을 올림',
    same: '이 PC 원본 = 앱 저장본(같은 내용)',
    rolled: '이 PC 원본은 되돌리기 전 판 — 되돌린 앱 저장본을 씀',
    'bad-time': '이 PC 원본의 저장 시각을 알 수 없거나 지금보다 뒤라 견주지 않음(올리지 않음)',
    newer: '이 PC 원본이 앱 저장본보다 새것 — 올림',
    older: '이 PC 원본이 앱 저장본보다 옛것 — 앱 저장본을 씀',
    'no-perm': '올릴 권한이 없어 이 PC 원본만 씀',
    'bad-payload': '이 PC 원본은 앱 저장본에 올릴 수 없어(머리글·내용 검사) 이 PC 에서만 씀',
});
