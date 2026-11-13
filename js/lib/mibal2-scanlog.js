// === js/lib/mibal2-scanlog.js ===
// 부족수량관리(신규) '스캔 내역' — 순수 함수(DOM/Firebase 없음). 2026-11-09. tests/mibal2-scanlog.test.js 가 본다.
//
// 입력 = 입고이력(ChinaStockGoods_InboundHistory) 문서 배열.
//   스캔 문서 { id, barcode, qty, location, dest, timestamp, worker:'Scanner_Web', workerName?, pickQty?, reserveQty? }
//   수동 수정 문서 { id:'fix__코드', barcode, qty, rev, log:[{at,by,before,after,d,note}] } — timestamp 없음(js/lib/inbound-fix.js)
// 보관 문서(마감 때 입고이력을 지우기 전에 쓴다) 한 조각:
//   { v:1, id, partialOf?, part, parts, closedAtMs, by, n, t0, names[], dests[], locs[], rows[{c, s, fq?, f?}] }
//   s = "초차이,수량,작업자번호,보낸곳번호,위치번호,피킹,비축;…" — 번호는 그 조각의 사전(names·dests·locs) 위치(위치에 쉼표가 있어도 안전).
//   초차이 = t0 부터의 초(시각 없는 문서는 빈칸). 시각은 초 단위까지만 남는다(화면도 초까지). 옛 문서는 피킹·비축이 빈칸.
//   상품명은 넣지 않는다 — 엑셀은 nameOf 로 받는다.

import { isFixId } from './inbound-fix.js?v=202611131006';

export const SCANLOG_JOBS_COLL = ['ChinaStockGoods_ScanDB_Versions', '_archiveScans', 'jobs'];   // 마감 때 보관하는 곳(문서 id = docIdOf(id, part))
export const SCANLOG_MAX_PARTS = 9;   // 보관함 문서와 한 batch 로 올리는 조각 수 상한(요청 하나 10MiB 한도 안쪽)

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;   // 시간대 설정과 무관하게 한국시간(js/lib/kst-time.js 와 같은 방식)
const DEFAULT_LIMIT_BYTES = 900000;
const ROW_MAX = 3000;         // 한 행에 넣는 스캔 건수
const ROW_OVERHEAD = 40;      // 행 하나의 Firestore 내부 추가 크기 몫(글자 수 계산에 더해 작은 행이 많아도 1MiB 를 넘지 않게)
const ELEMS_MAX = 30000;      // 한 조각의 행 + 사전 칸 수(문서당 색인 40,000개 한도 안쪽)
const TEXT_MAX = 1000;        // 사전 글자 한 칸의 글자 수 상한(한 건이 조각 크기를 넘지 못하게)
const SCANNER_FIXED = 'Scanner_Web';   // 스캐너가 worker 칸에 넣는 고정값 — 이름이 아니다
const UNKNOWN = '미상';
const DASH = '–';

const int0 = (v) => parseInt(v) || 0;
const intOrBlank = (v) => {
    if (v === null || v === undefined || v === '') return '';
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? '' : n;
};
const clip = (v) => {
    const s = String(v == null ? '' : v);
    return s.length <= TEXT_MAX ? s : Array.from(s).slice(0, TEXT_MAX).join('');
};
const utf8 = new TextEncoder();
const jsonBytes = (v) => utf8.encode(JSON.stringify(v)).length;

/** Firestore Timestamp · 숫자 → ms. 없거나 모르면 0 */
function msOf(t) {
    if (!t) return 0;
    let n;
    if (typeof t.toMillis === 'function') {
        try { n = t.toMillis(); } catch (e) { return 0; }
    } else {
        n = Number(t);
    }
    return Number.isFinite(n) && n > 0 ? n : 0;
}

const workerOf = (x) => {
    const w = String(x.workerName == null ? '' : x.workerName).trim();
    return w && w !== SCANNER_FIXED ? clip(w) : UNKNOWN;
};

/** 수정 기록 한 건의 수량 변화 — d 가 없으면 after − before */
const deltaOf = (l) => {
    const d = parseInt(l.d, 10);
    return Number.isNaN(d) ? int0(l.after) - int0(l.before) : d;
};

/** 입고이력 문서 → Map(code → { scans, fq(수정 문서 없으면 null), log }). barcode 가 비면 건너뛴다(inboundMapOf 와 같음) */
function collect(docs) {
    const byCode = new Map();
    (docs || []).forEach(d => {
        const x = d || {};
        if (!x.barcode) return;
        const code = String(x.barcode);
        const e = byCode.get(code) || { scans: [], fq: null, log: [] };
        byCode.set(code, e);
        if (isFixId(x.id)) {
            e.fq = (e.fq || 0) + int0(x.qty);
            if (Array.isArray(x.log)) {
                x.log.forEach(l => {
                    if (!l || typeof l !== 'object') return;
                    const item = { at: msOf(l.at), by: clip(l.by), before: int0(l.before), after: int0(l.after), d: deltaOf(l) };
                    if (l.note) item.note = clip(l.note);
                    e.log.push(item);
                });
            }
            return;
        }
        e.scans.push({ ms: msOf(x.timestamp), qty: int0(x.qty), worker: workerOf(x), dest: clip(x.dest), location: clip(x.location),
            pick: intOrBlank(x.pickQty), reserve: intOrBlank(x.reserveQty) });
    });
    return byCode;
}

/** 수정 순합계·로그 → 화면·복원 줄. 로그는 최근 20건뿐이라 합이 모자라면 '이전 수정' 줄로 맞춘다 */
function fixLines(fq, log) {
    if (fq === null || fq === undefined) return [];
    let sum = 0;
    const blank = { dest: DASH, location: DASH, pick: DASH, reserve: DASH, fix: true };
    const lines = (Array.isArray(log) ? log : []).filter(l => l && typeof l === 'object').map(l => {
        const d = deltaOf(l);
        sum += d;
        return { ms: msOf(l.at), qty: d, worker: l.by ? String(l.by) : UNKNOWN, ...blank };
    });
    const rest = int0(fq) - sum;
    if (rest !== 0) lines.push({ ms: 0, qty: rest, worker: DASH, ...blank, older: true });
    return lines;
}

const newestFirst = (a, b) => b.ms - a.ms;

/** Firestore 문서(snap) → 이 모듈 입력 한 건. 필요한 칸만 꺼낸다(상품명은 받지 않음) */
export function scanLogInputOf(snap) {
    const x = snap.data() || {};
    return { id: snap.id, barcode: x.barcode, qty: x.qty, location: x.location, dest: x.dest, timestamp: x.timestamp,
        workerName: x.workerName, pickQty: x.pickQty, reserveQty: x.reserveQty, log: x.log };
}

/** 읽어 온 조각이 빠짐없는가(expandScanLogDocs 는 검사하지 않는다) — 일부만 있으면 합계를 믿을 수 없다. → { ok, expected, got } */
export function checkScanLogParts(parts, id) {
    const docs = (parts || []).filter(p => p && String(p.id) === String(id));
    const first = docs.find(p => int0(p.part) === 0);
    const expected = first ? int0(first.parts) : 0;
    const seen = new Set(docs.filter(p => int0(p.parts) === expected).map(p => int0(p.part)));
    let ok = expected >= 1 && seen.size === expected;
    for (let i = 0; ok && i < expected; i++) ok = seen.has(i);
    return { ok, expected, got: seen.size };
}

/** 보관 문서 id — 첫 조각은 id 그대로, 다음부터 id_1, id_2 … */
export function docIdOf(id, part) {
    const p = int0(part);
    return p > 0 ? `${id}_${p}` : String(id);
}

/**
 * 입고이력 → 보관 문서 조각 배열(문서가 없으면 []).
 *   각 조각은 자기 사전을 가져 혼자서 복원된다. 크기는 UTF-8 바이트로 재서 limitBytes 를 넘지 않게 나눈다.
 *   한 건도 빈 조각에 못 들어가는 limitBytes 면 오류(자료를 말없이 버리지 않는다) — 기본값에서는 일어나지 않는다.
 */
export function buildScanLogDocs(docs, { id, partialOf, closedAtMs, by, limitBytes = DEFAULT_LIMIT_BYTES } = {}) {
    const byCode = collect(docs);
    if (!byCode.size) return [];
    let minMs = 0;
    byCode.forEach(e => e.scans.forEach(s => { if (s.ms && (!minMs || s.ms < minMs)) minMs = s.ms; }));
    const t0 = Math.floor(minMs / 1000) * 1000;
    const head = { v: 1, id: String(id == null ? '' : id), ...(partialOf ? { partialOf: String(partialOf) } : {}) };
    const meta = { closedAtMs: Number(closedAtMs) || 0, by: String(by == null ? '' : by) };
    const baseBytes = jsonBytes({ ...head, part: 999999, parts: 999999, ...meta, n: 999999999, t0, names: [], dests: [], locs: [], rows: [] });

    const out = [];
    const blankDoc = () => ({ names: [], dests: [], locs: [], rows: [], n: 0, size: baseBytes, elems: 0, ixN: new Map(), ixD: new Map(), ixL: new Map(), row: null, rowCount: 0 });
    let cur = blankDoc();
    const flush = () => {
        out.push({ ...head, part: out.length, parts: 0, ...meta, n: cur.n, t0, names: cur.names, dests: cur.dests, locs: cur.locs, rows: cur.rows });
        cur = blankDoc();
    };
    const fits = (cost, elems) => cur.size + cost <= limitBytes && cur.elems + elems <= ELEMS_MAX;
    const tooSmall = () => new RangeError('스캔 내역 조각 크기(limitBytes)가 너무 작습니다.');
    const rowCost = (row) => jsonBytes(row) + 1 + ROW_OVERHEAD + (row.f ? row.f.length * ROW_OVERHEAD : 0);   // 수정 로그 1건도 맵 하나
    const openRow = (row, cost) => { cur.rows.push(row); cur.row = row; cur.rowCount = 0; cur.size += cost; cur.elems += 1; };

    const strCost = (ix, v) => (ix.has(v) ? 0 : jsonBytes(v) + 1);
    const ixOf = (ix, v) => (ix.has(v) ? ix.get(v) : ix.size);
    const remember = (ix, arr, v) => { if (!ix.has(v)) { ix.set(v, arr.length); arr.push(v); } };
    const segOf = (e) => {
        const dt = e.ms ? Math.floor(e.ms / 1000) - t0 / 1000 : '';
        return [dt, e.qty, ixOf(cur.ixN, e.worker), ixOf(cur.ixD, e.dest), ixOf(cur.ixL, e.location), e.pick, e.reserve].join(',');
    };
    const entryNeed = (e) => ({
        bytes: segOf(e).length + 1 + strCost(cur.ixN, e.worker) + strCost(cur.ixD, e.dest) + strCost(cur.ixL, e.location),
        elems: (cur.ixN.has(e.worker) ? 0 : 1) + (cur.ixD.has(e.dest) ? 0 : 1) + (cur.ixL.has(e.location) ? 0 : 1)
    });

    /** 코드의 첫 행(수정 칸 포함)을 연다 — 빈 조각에도 안 들어가면 오래된 수정 로그부터 줄인다(fq 는 그대로라 '이전 수정' 줄로 합이 맞는다) */
    const openFixRow = (row) => {
        if (!fits(rowCost(row), 1) && cur.rows.length) flush();
        while (!fits(rowCost(row), 1) && row.f) {
            row.f.shift();
            if (!row.f.length) delete row.f;
        }
        if (!fits(rowCost(row), 1)) throw tooSmall();
        openRow(row, rowCost(row));
    };

    [...byCode.keys()].sort().forEach(code => {
        const e = byCode.get(code);
        cur.row = null;
        if (e.fq !== null) {
            const row = { c: code, s: '', fq: e.fq };
            if (e.log.length) row.f = e.log.slice();
            openFixRow(row);
        }
        e.scans.slice().sort((a, b) => a.ms - b.ms).forEach(entry => {
            const newRowBytes = rowCost({ c: code, s: '' });
            const needRow = () => !cur.row || cur.rowCount >= ROW_MAX;
            const over = (n) => (needRow() ? !fits(n.bytes + newRowBytes, n.elems + 1) : !fits(n.bytes, n.elems));
            let need = entryNeed(entry);
            if (over(need)) {
                if (!cur.rows.length) throw tooSmall();
                flush();
                need = entryNeed(entry);
                if (over(need)) throw tooSmall();
            }
            if (needRow()) openRow({ c: code, s: '' }, newRowBytes);
            const seg = segOf(entry);
            remember(cur.ixN, cur.names, entry.worker);
            remember(cur.ixD, cur.dests, entry.dest);
            remember(cur.ixL, cur.locs, entry.location);
            cur.row.s += (cur.rowCount ? ';' : '') + seg;
            cur.rowCount += 1;
            cur.n += 1;
            cur.size += need.bytes;
            cur.elems += need.elems;
        });
    });
    if (cur.rows.length) flush();
    out.forEach(p => { p.parts = out.length; });
    return out;
}

const dictOf = (d, v) => {
    const i = parseInt(v, 10);
    return Array.isArray(d) && Number.isInteger(i) && i >= 0 && i < d.length && d[i] != null ? String(d[i]) : '';
};

/** 보관 조각들 → { code: [{ ms, qty, worker, dest, location, pick, reserve, fix?, older? }] } (최신순). 사전 번호가 범위 밖이면 빈칸 */
export function expandScanLogDocs(parts) {
    const out = new Map();
    (parts || []).filter(Boolean).slice().sort((a, b) => int0(a.part) - int0(b.part)).forEach(p => {
        const t0 = Number(p.t0) || 0;
        (Array.isArray(p.rows) ? p.rows : []).forEach(r => {
            if (!r || !r.c) return;
            const code = String(r.c);
            const lines = out.get(code) || [];
            out.set(code, lines);
            String(r.s == null ? '' : r.s).split(';').forEach(seg => {
                if (!seg) return;
                const a = seg.split(',');
                const dt = a[0] === '' ? NaN : parseInt(a[0], 10);
                lines.push({ ms: Number.isNaN(dt) ? 0 : t0 + dt * 1000, qty: int0(a[1]), worker: dictOf(p.names, a[2]), dest: dictOf(p.dests, a[3]),
                    location: dictOf(p.locs, a[4]), pick: intOrBlank(a[5]), reserve: intOrBlank(a[6]) });
            });
            if (r.fq !== undefined && r.fq !== null) lines.push(...fixLines(r.fq, r.f));
        });
    });
    out.forEach(lines => lines.sort(newestFirst));
    return Object.fromEntries(out);
}

/** 지금 입고이력 → 화면용 코드별 내역(최신순). 모양은 expandScanLogDocs 와 같다 */
export function liveScanLogOf(docs) {
    const out = new Map();
    collect(docs).forEach((e, code) => {
        out.set(code, [...e.scans, ...fixLines(e.fq, e.log)].sort(newestFirst));
    });
    return Object.fromEntries(out);
}

const p2 = (n) => String(n).padStart(2, '0');
/** ms → 'MM/DD HH:mm:ss'(한국시간), 없으면 '–' */
function shortTime(ms) {
    if (!ms) return DASH;
    const d = new Date(ms + KST_OFFSET_MS);
    return `${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}
/** ms → 'YYYY-MM-DD HH:mm:ss'(한국시간, 엑셀용), 없으면 '' */
function fullTime(ms) {
    if (!ms) return '';
    const d = new Date(ms + KST_OFFSET_MS);
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}
const num = (v) => (typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v == null ? '' : v));
const signed = (v) => (v > 0 ? '+' : '') + v.toLocaleString('ko-KR');

/**
 * 한 상품의 내역 줄 → 표 HTML. 행 상세(china-mibal2.js detailHtml)의 .formula·.muted·.t-risk 를 쓴다.
 *   list = expandScanLogDocs / liveScanLogOf 의 값 하나 · esc = 이스케이프 함수 · limit 넘는 줄은 '외 n건'(합계는 전체 기준)
 */
export function scanLogHtml(list, esc, { limit = 200 } = {}) {
    const all = Array.isArray(list) ? list : [];
    if (!all.length) return '<span class="muted">스캔 내역이 없습니다.</span>';
    const max = Number.isInteger(limit) && limit > 0 ? limit : 200;
    const scanSum = all.reduce((s, l) => s + (l.fix ? 0 : int0(l.qty)), 0);
    const fixSum = all.reduce((s, l) => s + (l.fix ? int0(l.qty) : 0), 0);
    const th = (t) => `<th style="position:static; padding:3px 8px; text-align:left; white-space:nowrap; border-bottom:1px solid var(--c-line); font-size:11.5px;">${esc(t)}</th>`;
    const td = (t, cls) => `<td${cls ? ` class="${cls}"` : ''} style="padding:2px 8px; white-space:nowrap; font-size:12px; background:transparent;">${esc(t)}</td>`;
    const rows = all.slice(0, max).map(l => {
        const when = l.older ? `이전 수정 ${signed(int0(l.qty))}` : shortTime(l.ms);
        const qty = l.fix ? signed(int0(l.qty)) : num(int0(l.qty));
        return `<tr>${td(when)}${td(qty, l.fix ? 't-risk' : '')}${td(num(l.pick))}${td(num(l.reserve))}${td(l.worker)}${td(l.location)}${td(l.dest)}</tr>`;
    }).join('');
    const more = all.length > max ? `<div class="muted">외 ${esc((all.length - max).toLocaleString('ko-KR'))}건</div>` : '';
    return `<table style="border-collapse:collapse; margin:4px 0;"><thead><tr>${['전송 시각', '수량', '피킹', '비축', '작업자', '위치', '보낸 곳'].map(th).join('')}</tr></thead><tbody>${rows}</tbody></table>${more}`
        + `<div class="formula">${esc(`스캔 합 ${num(scanSum)} + 수정 합 ${signed(fixSum)} = 입고확인 ${num(scanSum + fixSum)}`)}</div>`;
}

/**
 * 복원 내역 전체 → 조회 창 목록 HTML(상품별로 접힘, 검색은 상품코드 일부). maxCodes 넘는 상품은 '외 n개'.
 *   nameOf(code) = 상품명 · 검색 결과가 하나면 펼친다
 */
export function scanLogListHtml(expanded, nameOf, esc, { query = '', maxCodes = 100, limit = 200 } = {}) {
    const data = expanded || {};
    const q = String(query == null ? '' : query).trim().toUpperCase();
    const all = Object.keys(data).sort();
    const codes = q ? all.filter(c => c.toUpperCase().includes(q)) : all;
    const lines = (c) => (Array.isArray(data[c]) ? data[c] : []);
    const scanN = all.reduce((s, c) => s + lines(c).filter(l => !l.fix).length, 0);
    const head = `<div class="t-3" style="margin-bottom:6px;">${esc(`상품 ${num(all.length)}개 · 스캔 ${num(scanN)}건${q ? ` · 검색 결과 ${num(codes.length)}개` : ''}`)}</div>`;
    if (!codes.length) return head + `<span class="muted">${esc(q ? '검색 결과가 없습니다.' : '스캔 내역이 없습니다.')}</span>`;
    const shown = codes.slice(0, maxCodes);
    const body = shown.map(c => {
        const list = lines(c);
        const name = typeof nameOf === 'function' ? (nameOf(c) || '') : '';
        const sum = list.reduce((s, l) => s + int0(l.qty), 0);
        return `<details${shown.length === 1 ? ' open' : ''} style="margin:3px 0;"><summary style="cursor:pointer;">${esc(`${c}${name ? ' · ' + name : ''} · ${num(list.length)}줄 · 입고확인 ${num(sum)}`)}</summary>${scanLogHtml(list, esc, { limit })}</details>`;
    }).join('');
    const more = codes.length > shown.length ? `<div class="muted">${esc(`외 ${num(codes.length - shown.length)}개 상품 — 상품코드로 검색해 좁혀 보세요`)}</div>` : '';
    return head + body + more;
}

export const SCANLOG_EXCEL_HEAD = ['상품코드', '상품명', '전송 시각', '수량', '피킹', '비축', '구분', '작업자', '위치', '보낸 곳'];

/** 복원 내역 → 엑셀용 행 배열(첫 줄 머리글, 상품코드 순). nameOf(code) = 상품명(보관 문서에 없어 부르는 쪽이 준다) */
export function scanLogExcelRows(expanded, nameOf) {
    const data = expanded || {};
    const aoa = [[...SCANLOG_EXCEL_HEAD]];
    Object.keys(data).sort().forEach(code => {
        const name = typeof nameOf === 'function' ? (nameOf(code) || '') : '';
        (data[code] || []).forEach(l => {
            aoa.push([code, name, fullTime(l.ms), int0(l.qty), l.pick, l.reserve, l.older ? '이전 수정' : l.fix ? '수정' : '스캔', l.worker, l.location, l.dest]);
        });
    });
    return aoa;
}
