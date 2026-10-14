// === js/lib/product-price.js ===
// 상품 관리 — 원가(단가) 계산 규칙. 2026-10-13. 설계: 상품DB_설계.md 5-1 (v2 3-3 에서 그대로 씀)
//
// 환율 = **1달러당 위안**(예 7.20). 위안 ÷ 환율 = 달러.
// 정밀도: 위안·달러 소수 2자리, 환율 4자리. 반올림한 뒤 비교한다(같은 파일 재업로드가 '변경' 으로 잡히지 않게).
// src = 사람이 실제로 넣은 통화(cny / usd / both) — 환율을 바꿔도 원래 입력값이 흔들리지 않게 반대쪽만 다시 계산.
//
// 순수 모듈(DOM/Firebase 의존 없음). ⚠️ 원가 값을 console 에 찍지 말 것(영업비밀).

export const RATE_MIN = 3, RATE_MAX = 15;      // 이 밖이면 방향을 거꾸로 넣은 것(달러당 위안이 아님)
export const RATE_TOLERANCE = 0.02;            // 위안/달러 로 계산한 환율과 환율 칸이 ±2% 넘게 다르면 경고
export const CNY_WARN = 100000;                // 이보다 크면 경고(자리 실수)

export const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
export const round4 = (v) => Math.round((Number(v) + Number.EPSILON) * 10000) / 10000;

/** '¥58.00' · '$8.05' · '1,234원' · ' 7.2 ' → 숫자. 빈칸 → null. 숫자가 아니면 NaN */
export function parseNum(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const s = String(v).replace(/[¥￥$₩원元,\s]/g, '').replace(/^USD|^CNY|^RMB/i, '');
    if (s === '') return null;
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
}

/** 'YYYY-MM-DD' · 'YYYY/M/D' · 'YYYY.M.D' · '2026년 1월 2일' · 'm/d/yy'(엑셀 미국식) · 엑셀 날짜 숫자 → 'YYYY-MM-DD'. 못 읽으면 null */
export function parseDate(v) {
    if (v === null || v === undefined || v === '') return null;
    const pad = (n) => String(n).padStart(2, '0');
    if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
        const n = Number(v);
        if (n < 20000 || n > 80000) return null;
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    const t = String(v).trim();
    let y, mo, da, m;
    if ((m = t.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/))) { y = +m[1]; mo = +m[2]; da = +m[3]; }
    else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {       // 엑셀 기본(미국식) m/d/yy
        mo = +m[1]; da = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    } else return null;
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    const chk = new Date(Date.UTC(y, mo - 1, da));                 // 없는 날짜(2/31, 4/31 등)는 거른다
    if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== da) return null;
    return `${y}-${pad(mo)}-${pad(da)}`;
}

/**
 * SheetJS 셀 하나 → 글자. 서식 문자열(w) 대신 원시값으로 만든다:
 *   · 숫자 칸 13자리 바코드·품목코드 → 지수표기(8.80123E+12) 없이 그대로('8801234000011')
 *   · 날짜 서식 칸 → 'YYYY-MM-DD' (표시 서식이 m/d/yy·'2026년 1월 2일' 이어도)
 * ssf = XLSX.SSF (is_date·parse_date_code). 앞자리 0 이 이미 빠진 숫자 칸은 되살릴 수 없다(바코드 경고로 알림).
 */
export function cellToText(cell, ssf, date1904 = false) {
    if (!cell || cell.v === undefined || cell.v === null) return '';
    const v = cell.v;
    const pad = (n) => String(n).padStart(2, '0');
    if (cell.t === 'n' && typeof v === 'number') {
        if (cell.z && ssf && ssf.is_date(cell.z)) {
            const p = ssf.parse_date_code(v, { date1904 });   // 1904 날짜 체계(옛 Mac 엑셀) 파일이면 4년 보정
            return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : String(v);
        }
        if (Number.isInteger(v)) return Math.abs(v) < 1e21 ? BigInt(v).toString() : String(v);
        return String(Math.round(v * 1e10) / 1e10);
    }
    if (cell.t === 'd' && v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    if (cell.t === 'b') return v ? 'TRUE' : 'FALSE';
    if (cell.t === 'e') return '';
    return String(v);
}

/**
 * 단가 하나 정리. input = { cny, usd, rate, rateDate } (숫자 또는 null), defaults = { rate, rateDate }
 * → { price: {cny, usd, rate, rateDate, src} | null, errors: [], warnings: [] }
 *   · 위안만 + 환율 → 달러 = 위안 ÷ 환율, src=cny
 *   · 달러만 + 환율 → 위안 = 달러 × 환율, src=usd
 *   · 둘 다 → 그대로, src=both. 환율 칸이 있으면 ±2% 검사(경고), 없으면 환율 = 위안 ÷ 달러
 *   · 환율 칸이 비면 defaults.rate (업로드 화면의 기본 환율)
 */
export function normalizePrice(input, defaults = {}) {
    const errors = [], warnings = [];
    let { cny, usd, rate, rateDate } = input || {};
    cny = cny ?? null; usd = usd ?? null; rate = rate ?? null;
    for (const [k, v] of [['위안', cny], ['달러', usd], ['환율', rate]]) {
        if (v !== null && !Number.isFinite(v)) errors.push(`${k}이(가) 숫자가 아님`);
    }
    if (errors.length) return { price: null, errors, warnings };
    if (cny === null && usd === null) {
        if (rate !== null) errors.push('단가 없이 환율만 있음');
        return { price: null, errors, warnings };
    }
    if (cny !== null && cny <= 0) errors.push('위안이 0 이하');
    if (usd !== null && usd <= 0) errors.push('달러가 0 이하');
    if (errors.length) return { price: null, errors, warnings };
    if (cny !== null && cny > CNY_WARN) warnings.push('위안이 10만 초과 — 자리 확인');

    const rateGiven = rate !== null;
    if (!rateGiven) rate = defaults.rate ?? null;
    if (rate !== null && (rate < RATE_MIN || rate > RATE_MAX)) {
        errors.push(`환율 ${rate} — 1달러당 위안(${RATE_MIN}~${RATE_MAX})이 아님`);
        return { price: null, errors, warnings };
    }
    let src;
    if (cny !== null && usd !== null) {
        src = 'both';
        if (rateGiven) {
            const implied = cny / usd;
            if (Math.abs(implied - rate) / rate > RATE_TOLERANCE) warnings.push('위안÷달러가 환율과 2% 넘게 다름');
        } else {
            rate = cny / usd;
            if (rate < RATE_MIN || rate > RATE_MAX) {
                errors.push('위안÷달러가 1달러당 위안 범위 밖');
                return { price: null, errors, warnings };
            }
        }
    } else if (rate === null) {
        errors.push('환율이 없음(기본 환율을 넣어 주세요)');
        return { price: null, errors, warnings };
    } else if (cny !== null) {
        src = 'cny'; usd = cny / rate;
    } else {
        src = 'usd'; cny = usd * rate;
    }
    const d = rateDate ?? defaults.rateDate ?? null;
    return {
        price: { cny: round2(cny), usd: round2(usd), rate: round4(rate), rateDate: d, src },
        errors, warnings
    };
}

/** 두 단가가 같은가(반올림 기준, src 무시 — 숫자·기준일이 같으면 같다) */
export function samePrice(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return round2(a.cny) === round2(b.cny) && round2(a.usd) === round2(b.usd)
        && round4(a.rate) === round4(b.rate) && (a.rateDate || null) === (b.rateDate || null);
}

/** 옵션 실효 단가 = 개별값 ?? 기본값. → { price, inherited } */
export function effectivePrice(cost, scode) {
    if (!cost) return { price: null, inherited: true };
    const own = cost.o && cost.o[scode];
    if (own) return { price: own, inherited: false };
    return { price: cost.base || null, inherited: true };
}

/** 옵션 실효 원화 원가 = 옵션 원화(ok) ?? 기본 원화(krw). → { krw: 정수|null, inherited } */
export function effectiveKrw(cost, scode) {
    if (!cost) return { krw: null, inherited: true };
    const own = cost.ok && cost.ok[scode];
    if (own !== undefined && own !== null) return { krw: own, inherited: false };
    return { krw: cost.krw ?? null, inherited: true };
}

/** 이 상품의 옵션 개별 단가(위안·달러 또는 원화) 중 기본값과 다른 것이 있는가 */
export function hasOptionPrices(cost) {
    return !!(cost && ((cost.o && Object.keys(cost.o).length) || (cost.ok && Object.keys(cost.ok).length)));
}

/** 표시용: 12.3 → '12.30' */
export const fmt2 = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '' : Number(v).toFixed(2);
