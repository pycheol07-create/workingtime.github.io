// === js/lib/ship-transmit.js ===
// 직진배송·에이블리배송 '전송값' — 출고자동화가 로케이션으로 보낸 수량을 다음 근무일 예상으로 쓴다(2026-10-12).
//
// 왜: 직진·에이블리는 전 근무일에 '직진배송 사전작업'으로 물건을 준비하고 다음 근무일에 내보낸다.
//     준비하는 날 출고자동화가 그 물량을 로케이션(ZikjinData)으로 전송한다 — 빈도형 추정보다 정확한 실제 숫자다.
//
// 데이터: Firestore ZikjinData/CHUNK_n 문서 { dataStr: JSON(행 배열), updatedAt }.
//   행 { 상품코드, 상품명, 수량, _q: { ZG, ZGF, AB, ABF }, _d: 'YYYYMMDD' }
//   ZG = 직진 일반 / ZGF = 직진 즉시출고 / AB = 에이블리 일반 / ABF = 에이블리 즉시출고.
//   (출처: 앱\플랫폼출고자동화\firestore_sync.py merge_rows — 전송할 때마다 오늘(_d) 것만 남기고 덮어쓴다)
//   _d·_q 가 없는 행(LEGACY, 앱에서 엑셀 직접 업로드)은 쓰지 않는다.
//   ⚠️ 컬렉션에는 마지막 전송일 하루치만 남는다 — 앱이 읽은 요약을 mergeTransmitByDate 로 쌓아 둔다(localStorage).
//
// 규칙: 근무일 D 에 사전작업 기록이 있고, 같은 D 의 전송 기록이 있으면
//       nextWorkingDay(D) 의 직진배송 = ZG+ZGF, 에이블리배송 = AB+ABF (즉시출고 포함).
//       업무별로 따로 본다 — 한쪽 합이 0 이면 그 업무는 null(기존 예측 그대로).
//
// 순수 모듈(import 0). 달력(nextWorkingDay)·사전작업 판정(hasPrecursorOn)은 인자로 받는다.

/** 업무 → 그 업무로 합칠 전송 소스 */
export const TRANSMIT_SOURCES = {
    '직진배송': ['ZG', 'ZGF'],
    '에이블리배송': ['AB', 'ABF']
};
const ALL_SOURCES = ['ZG', 'ZGF', 'AB', 'ABF'];
const NORMAL_SOURCE = { '직진배송': 'ZG', '에이블리배송': 'AB' };   // 설명 문구의 '일반' 몫

const D_RE = /^(\d{4})(\d{2})(\d{2})$/;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** 행 배열 → 날짜별 소스 합계.
 *  @param {Array} rows        모든 CHUNK 의 행을 이어 붙인 배열
 *  @param {Array<number>} chunkTimes  각 CHUNK 의 updatedAt(ms). 최대값을 전송 시각(at)으로 쓴다
 *         (전송 한 번에 모든 CHUNK 를 같은 시각으로 덮어쓰므로 날짜별로 나눌 필요가 없다)
 *  @returns {{[ymd:string]: {ZG:number, ZGF:number, AB:number, ABF:number, at:number}}}  키는 'YYYY-MM-DD' */
export function summarizeTransmitRows(rows, chunkTimes) {
    let at = 0;
    (Array.isArray(chunkTimes) ? chunkTimes : []).forEach(t => { const v = num(t); if (v > at) at = v; });
    const out = {};
    (Array.isArray(rows) ? rows : []).forEach(row => {
        if (!row || typeof row !== 'object') return;
        const q = row._q;
        if (!q || typeof q !== 'object') return;           // LEGACY(내역 없는 행)
        const m = D_RE.exec(String(row._d == null ? '' : row._d));
        if (!m) return;                                     // 날짜 없는 행
        const key = `${m[1]}-${m[2]}-${m[3]}`;
        if (!out[key]) out[key] = { ZG: 0, ZGF: 0, AB: 0, ABF: 0, at };
        ALL_SOURCES.forEach(s => { out[key][s] += num(q[s]); });
    });
    return out;
}

/** 출고자동화가 쓴 행인가 — _q(소스 내역)와 _d(YYYYMMDD)가 다 있어야 한다 */
const isTransmitRow = (row) => !!row && typeof row === 'object'
    && !!row._q && typeof row._q === 'object' && D_RE.test(String(row._d == null ? '' : row._d));

/** CHUNK 문서들 → { byDate } 또는 { error }.
 *  @param {Array<{dataStr?:string, at?:number}>} chunks  at = 그 청크의 updatedAt(ms)
 *  - 청크 하나라도 해석 못 하면 실패(일부만 더한 숫자를 쓰지 않는다).
 *  - 출고자동화가 쓴 행(_q·_d)을 담은 청크끼리 updatedAt 이 다르면 실패 — 청크를 차례로 덮어쓰는
 *    도중이거나 옛 청크가 남은 상태라 두 전송이 섞인다.
 *    앱에서 엑셀을 직접 올린 청크(location.js updateDatabaseB — 청크마다 시각이 다르고 _d 가 없다)는
 *    비교에서 뺀다. 그 행은 어차피 summarizeTransmitRows 가 버린다. */
export function summarizeTransmitChunks(chunks) {
    const rows = [];
    const times = new Set();
    for (const c of (Array.isArray(chunks) ? chunks : [])) {
        if (!c || !c.dataStr) continue;
        let arr;
        try { arr = JSON.parse(c.dataStr); } catch (e) { return { error: '해석 실패' }; }
        if (!Array.isArray(arr)) return { error: '해석 실패' };
        if (arr.some(isTransmitRow)) times.add(num(c.at));
        rows.push(...arr);
    }
    if (times.size > 1) return { error: '청크 전송 시각이 서로 다름(전송 중일 수 있음)' };
    return { byDate: summarizeTransmitRows(rows, [...times]) };
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const minusDays = (ymd, n) => {
    const m = YMD_RE.exec(String(ymd || ''));
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - n));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
/** 요약 한 날치가 쓸 만한 모양인가 — localStorage 에서 읽은 값은 믿지 않는다 */
const cleanEntry = (e) => {
    if (!e || typeof e !== 'object') return null;
    const out = { at: Math.max(0, num(e.at)) };
    ALL_SOURCES.forEach(s => { out[s] = num(e[s]); });
    return out;
};

/** 날짜별 요약을 쌓는다 — ZikjinData 에는 마지막 전송일 하루치만 남으므로, 앱이 읽을 때마다 모아 둔다.
 *  새로 읽은 날짜는 덮어쓰고(같은 날 재전송은 최신이 맞다), 새 결과에 없는 날짜는 그대로 둔다.
 *  todayStr 기준 keepDays 일보다 오래된 날짜와 형식이 틀린 키는 버린다.
 *  @returns {object} 새 객체(prev·fresh 는 건드리지 않는다) */
export function mergeTransmitByDate(prev, fresh, todayStr, keepDays = 14) {
    const cutoff = minusDays(todayStr, keepDays);
    const out = {};
    const put = (src) => {
        if (!src || typeof src !== 'object') return;
        Object.keys(src).forEach(k => {
            if (!YMD_RE.test(k)) return;
            if (cutoff && k < cutoff) return;
            const e = cleanEntry(src[k]);
            if (e) out[k] = e;
        });
    };
    put(prev);
    put(fresh);
    return out;
}

const fmtMd = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const fmtAt = (ms) => {
    if (!(ms > 0)) return '';
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 대상일·업무의 전송값. 없으면 null.
 *  @param {object} p
 *  @param {string} p.targetDate  'YYYY-MM-DD'
 *  @param {string} p.taskKey     '직진배송' | '에이블리배송' (그 밖은 null)
 *  @param {object} p.byDate      summarizeTransmitRows 결과
 *  @param {(d:string)=>string} p.nextWorkingDay  D 다음의 첫 근무일
 *  @param {(d:string, taskKey:string)=>boolean} p.hasPrecursorOn  D 에 그 업무의 사전작업 기록이 있나
 *  @returns {{value:number, source:'transmit', detail:string}|null}
 *  같은 대상일로 이어지는 D 가 여럿이면(예: 금요일·토요일 → 월요일) 가장 늦은 D 를 쓴다. */
export function transmitValueFor({ targetDate, taskKey, byDate, nextWorkingDay, hasPrecursorOn } = {}) {
    const srcs = TRANSMIT_SOURCES[taskKey];
    if (!srcs || !byDate || typeof byDate !== 'object' || typeof targetDate !== 'string') return null;
    if (typeof nextWorkingDay !== 'function' || typeof hasPrecursorOn !== 'function') return null;

    let best = null;
    Object.keys(byDate).forEach(d => {
        if (!(d < targetDate)) return;                       // 대상일 당일·이후 전송은 근거가 아니다
        if (best && d <= best.d) return;
        const s = byDate[d];
        if (!s) return;
        const total = Math.round(srcs.reduce((a, k) => a + num(s[k]), 0));
        if (!(total > 0)) return;                            // 이 업무는 전송이 없다
        if (nextWorkingDay(d) !== targetDate) return;
        if (!hasPrecursorOn(d, taskKey)) return;
        best = { d, s, total };
    });
    if (!best) return null;

    const normalKey = NORMAL_SOURCE[taskKey];
    const normal = Math.round(num(best.s[normalKey]));
    const instant = Math.round(srcs.filter(k => k !== normalKey).reduce((a, k) => a + num(best.s[k]), 0));
    const atText = fmtAt(best.s.at);
    const detail = `${fmtMd(best.d)} 사전작업 기록 + 로케이션 전송${atText ? ' ' + atText : ''}`
                 + ` · 일반 ${normal.toLocaleString()} / 즉시 ${instant.toLocaleString()}`;
    return { value: best.total, source: 'transmit', detail };
}
