// === js/lib/ship-core.js ===
// 플랫폼 출고(직진배송·에이블리) 웹판의 공용 규칙 — 옛 Python 판(앱\플랫폼출고자동화\직진배송_자동화.py·firestore_sync.py)과
// 같은 입력이면 같은 결과가 나오도록 Python 동작(str()·strip()·참/거짓·정렬)을 필요한 만큼 흉내 낸다. DOM·라이브러리 없음(node --test 대상).
// 2026-11-10 웹 이식 2단계. 비교 시험: 앱\플랫폼출고자동화\tests\test_웹판비교.py

// Python str.isspace() 글자(= re 의 \s). JS \s 와 달리 ﻿ 는 빼고 \x1c~\x1f·\x85 는 넣는다.
const PY_WS = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const RE_STRIP = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'g');
const RE_RSTRIP = new RegExp(`[${PY_WS}]+$`);
const RE_WS_RUN = new RegExp(`[${PY_WS}]+`, 'g');
const RE_COMMA_WS = new RegExp(`[${PY_WS}]*,[${PY_WS}]*`, 'g');

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Python str.strip() */
export function pyStrip(s) {
    return String(s).replace(RE_STRIP, '');
}

/** Python str.rstrip() */
export function pyRstrip(s) {
    return String(s).replace(RE_RSTRIP, '');
}

/** Python float repr (짧은 표기: 지수 -4 이상 16 미만은 고정 소수, 아니면 1.5e+16 꼴) */
export function pyFloatRepr(x) {
    if (Number.isNaN(x)) return 'nan';
    if (x === Infinity) return 'inf';
    if (x === -Infinity) return '-inf';
    if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
    const [mant, expS] = x.toExponential().split('e');   // 고유하게 되돌릴 수 있는 가장 짧은 자릿수
    const exp = Number(expS);
    const neg = mant[0] === '-';
    const digits = mant.replace('-', '').replace('.', '');
    let s;
    if (exp >= -4 && exp < 16) {
        if (exp >= 0) {
            s = digits.length <= exp + 1
                ? digits + '0'.repeat(exp + 1 - digits.length) + '.0'
                : digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
        } else {
            s = '0.' + '0'.repeat(-exp - 1) + digits;
        }
    } else {
        const m = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
        s = m + 'e' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
    }
    return (neg ? '-' : '') + s;
}

/**
 * Python str(v). 칸 값은 ship-read 가 Python 판(openpyxl·bs4)과 같은 모양으로 넘긴다.
 * 정수인 숫자는 형식 상관없이 int 로 본다 — .xls(xlrd) · .xlsx '1.2345E+5'·'1.0' · HTML '3.0' 모두 '12345'·'1'·'3'
 * (Python 판은 '12345.0' 이 되어 코드·정렬이 틀리는 버그, 웹판에서 고침 — 2026-11-10 사용자 결정의 취지).
 */
export function pyStr(v) {
    if (v === null || v === undefined) return 'None';
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (typeof v === 'number') {
        if (Number.isInteger(v)) return Math.abs(v) < 1e21 ? String(v === 0 ? 0 : v) : BigInt(v).toString();
        return pyFloatRepr(v);
    }
    if (typeof v === 'string') return v;
    if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    return String(v);
}

/** Python bool(v) */
export function pyTruthy(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
}

/** str(v).strip() */
export const strip = (v) => pyStrip(pyStr(v));

/** Python `v or ""` */
export const orEmpty = (v) => (pyTruthy(v) ? v : '');

// Python Decimal 이 받는 글자(밑줄 자릿수 구분 포함). Infinity·NaN 은 quantize 에서 실패 → 기본값.
const RE_DECIMAL = /^([+-]?)((?:\d(?:_?\d)*)?)(?:\.((?:\d(?:_?\d)*)?))?(?:[eE]([+-]?\d(?:_?\d)*))?$/;

/**
 * to_int — 정수로. 소수점은 버림(2.75 → 2). 쉼표 제거. bool·빈칸·못 읽음은 기본값.
 * (Python: int(Decimal(s).quantize(1, ROUND_DOWN)), 28자리 넘으면 InvalidOperation → 기본값)
 */
export function toInt(v, def = 0) {
    if (v === null || v === undefined || v === '') return def;
    if (typeof v === 'boolean') return def;
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return def;
        const t = Math.trunc(v);
        return t === 0 ? 0 : t;
    }
    const s = pyStrip(pyStr(v)).replace(/,/g, '');
    if (!s) return def;
    const m = RE_DECIMAL.exec(s);
    if (!m || (!m[2] && !m[3])) return def;
    const sign = m[1] === '-' ? -1 : 1;
    let intPart = (m[2] || '').replace(/_/g, '');
    const frac = (m[3] || '').replace(/_/g, '');
    if (m[4] !== undefined) {
        const exp = Number(m[4].replace(/_/g, ''));
        const digits = intPart + frac;
        const point = intPart.length + exp;
        intPart = point <= 0 ? '' : (digits + '0'.repeat(Math.max(0, point - digits.length))).slice(0, point);
    }
    intPart = intPart.replace(/^0+/, '');
    if (intPart.length > 28) return def;
    const n = Number(intPart || '0') * sign;
    return n === 0 ? 0 : n;
}

/** Python float(v) — 못 읽으면 null (Python 은 ValueError/TypeError) */
export function pyFloat(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v !== 'string') return null;
    let s = pyStrip(v);
    if (s.includes('_')) {
        if (/(^|\D)_|_(\D|$)/.test(s)) return null;   // 밑줄은 숫자 사이에만
        s = s.replace(/_/g, '');
    }
    if (/^[+-]?(inf|infinity)$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity;
    if (/^[+-]?nan$/i.test(s)) return NaN;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
    return Number(s);
}

/** 소수점 수량인가 — Python `float(q) != int(float(q))` (못 읽으면 false) */
export function isFraction(v) {
    const f = pyFloat(v);
    return f !== null && Number.isFinite(f) && f !== Math.trunc(f);
}

/** 정렬용 비교 — 글자는 코드 단위(UTF-16) 비교, 배열은 앞에서부터 */
export function pyCmp(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) {
            const c = pyCmp(a[i], b[i]);
            if (c) return c;
        }
        return a.length - b.length;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Python sorted(arr, key=, reverse=) — 안정 정렬, 새 배열 */
export function sortedBy(arr, key, reverse = false) {
    const k = arr.map((x, i) => [key(x), i, x]);
    k.sort((p, q) => (reverse ? pyCmp(q[0], p[0]) : pyCmp(p[0], q[0])) || p[1] - q[1]);
    return k.map(p => p[2]);
}

function removeRepeated(s, re) {
    let m;
    while ((m = re.exec(s))) s = s.slice(0, m.index) + s.slice(m.index + m[0].length);
    return s;
}

/** clean_product_name — [] 안, 그다음 () 안을 (반복해서) 지운다 */
export function cleanProductName(name) {
    if (!pyTruthy(name)) return '';
    let s = pyStr(name);
    s = removeRepeated(s, /\[[^\]]*\]/);
    s = removeRepeated(s, /\([^)]*\)/);
    return pyStrip(s);
}

/** clean_pick_name — 피킹지시서 상품명: [] () 제거 → '#' 뒤 자름 → 공백 정리 */
export function cleanPickName(name) {
    let s = cleanProductName(name);
    const p = s.indexOf('#');
    if (p > 0) s = s.slice(0, p);
    return pyStrip(s.replace(RE_WS_RUN, ' '));
}

const PICK_PREFIX = ['색상-', '사이즈-', '기장별-'];

/** clean_pick_option — 직진 형식('색상-…, 사이즈-…')일 때만 괄호·접두어를 지운다 */
export function cleanPickOption(opt) {
    let s = pyStrip(pyStr(orEmpty(opt)));
    if (PICK_PREFIX.some(k => s.includes(k))) {
        s = s.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
        for (const p of PICK_PREFIX) s = s.split(p).join('');
        s = pyStrip(s.replace(RE_WS_RUN, ' '));
        s = s.replace(RE_COMMA_WS, ', ').replace(/^[ ,]+|[ ,]+$/g, '');
    }
    return s;
}

/** detect_target_area — 파일 이름에 '즉시출고' 가 있으면 'fast' */
export function targetArea(fileName) {
    const name = String(fileName || '').split(/[\\/]/).pop();
    return name.includes('즉시출고') ? 'fast' : 'general';
}

/** 직진 2단계 소스 — 출고요청 파일이 없으면 null(봉 수·로케이션 전송 안 함) */
export function zikjinSource(requestName) {
    if (requestName === null || requestName === undefined || !pyStrip(String(requestName))) return null;
    return targetArea(requestName) === 'fast' ? 'ZGF' : 'ZG';
}

/** 에이블리 2단계 소스 */
export function ablySource(requestName) {
    return targetArea(requestName) === 'fast' ? 'ABF' : 'AB';
}

const p2 = (n) => String(n).padStart(2, '0');

/** 한국시간 날짜 조각 { y, m, d, yymmdd, ymd8, ymd10, ms } */
export function kstDay(now = new Date()) {
    const t = (now instanceof Date ? now.getTime() : Number(now)) + KST_OFFSET_MS;
    const d = new Date(t);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return {
        y, m, d: day,
        yymmdd: `${p2(y % 100)}${p2(m)}${p2(day)}`,
        ymd8: `${y}${p2(m)}${p2(day)}`,
        ymd10: `${y}-${p2(m)}-${p2(day)}`,
        ms: Date.UTC(y, m - 1, day),
    };
}

/** datetime.now(KST).isoformat(timespec='seconds') → '2026-10-19T14:03:00+09:00' */
export function kstIso(now = new Date()) {
    const d = new Date((now instanceof Date ? now.getTime() : Number(now)) + KST_OFFSET_MS);
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}+09:00`;
}

export const PACK_BASE_MAX_DIFF = 7;   // 패키지명 베이스가 오늘과 이보다 멀면 오타로 보고 오늘을 쓴다

/** pack_day — 출고 기준일 'YYYY-MM-DD'(KST). 베이스(YYMMDD)가 오늘 7일 안이면 그날, 아니면 오늘 */
export function packDay(packageBase, now = new Date()) {
    const today = kstDay(now);
    const base = pyStrip(pyStr(orEmpty(packageBase)));
    if (/^\d{6}$/.test(base)) {
        const yy = Number(base.slice(0, 2)), mm = Number(base.slice(2, 4)), dd = Number(base.slice(4, 6));
        const y = yy <= 68 ? 2000 + yy : 1900 + yy;   // strptime %y
        const ms = Date.UTC(y, mm - 1, dd);
        const back = new Date(ms);
        if (mm >= 1 && mm <= 12 && back.getUTCMonth() === mm - 1 && back.getUTCDate() === dd) {
            if (Math.abs(Math.round((ms - today.ms) / 86400000)) <= PACK_BASE_MAX_DIFF) {
                return `${y}-${p2(mm)}-${p2(dd)}`;
            }
        }
    }
    return today.ymd10;
}

/** count_packs — 봉 수 = 서로 다른 패키지명 개수 */
export function countPacks(rows) {
    const set = new Set();
    for (const r of rows || []) if (r && pyTruthy(r.package)) set.add(pyStr(r.package));
    return set.size;
}

/** 패키지명 날짜가 오늘과 다를 때 안내(로케이션에는 오늘 출고로 들어간다). 같으면 '' */
export function baseDateWarning(packageBase, now = new Date()) {
    const today = kstDay(now).yymmdd;
    if (pyStrip(pyStr(orEmpty(packageBase))) === today) return '';
    return `⚠ 패키지명 날짜(${pyStr(packageBase)})가 오늘(${today})과 다릅니다. 로케이션에는 오늘 출고로 들어갑니다.`;
}

// 1단계 결과(재고출고용 .xls — 시트 '재고출고용', 머리글 상품코드·수량 두 칸뿐)를 2단계 출고전표 칸에 잘못 넣은 경우(2026-11-10 리뷰).
//   상품코드·수량만 있어도 에이블리 2단계는 돌아가 '요청 수량'이 실제 출고처럼 나간다 → 웹판은 멈춘다(Python 판은 멈추지 않음 — 일부러 다름).
export const STOCK_OUT_SHEET = '재고출고용';
export const STOCK_OUT_MSG = '1단계 결과 파일(재고출고용)입니다 — 이지어드민에서 받은 출고전표를 넣으세요.';

/** 시트 이름이 '재고출고용' 이고 1행 머리글(빈칸 뺀)이 정확히 [상품코드, 수량] 인가 */
export function looksLikeStockOut(sheetName, headerNames) {
    const h = [...(headerNames || [])].filter(x => x !== '');
    return String(sheetName) === STOCK_OUT_SHEET && h.length === 2 && h[0] === '상품코드' && h[1] === '수량';
}

/** 출력 파일 이름(Python 판과 같음) */
export function fileNames(yymmdd) {
    return {
        zikjinStock: `재고출고용_${yymmdd}.xls`,
        zikjinList: `직진배송출고리스트_${yymmdd}.xlsx`,
        zikjinPick: `ZG_피킹작업지시서_${yymmdd}.xlsx`,
        ablyStock: `에이블리_재고출고용_${yymmdd}.xls`,
        ablyBulk: `에이블리_대량입고_${yymmdd}.xlsx`,
        ablyPick: `AB_피킹작업지시서_${yymmdd}.xlsx`,
    };
}

/** 봉투당 한도 검사 — Python 판은 0 이하면 끝나지 않는다(화면에서 막음). 웹판은 여기서 멈춘다 */
export function checkLimit(limit) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n <= 0) throw new Error('봉투당 최대 수량은 양의 정수여야 합니다.');
    return n;
}

/**
 * 봉투 한도 분할 + 패키지명(YYMMDD-NN, 누적합 기준) — 직진·에이블리 같은 규칙.
 * rows 는 이미 로케이션순. 새 배열(행 복사)을 돌려준다.
 */
export function splitAndName(rows, packageBase, limit) {
    const split = [];
    let bigSplit = 0;
    for (const row of rows) {
        const qty = toInt(row.qty);
        if (qty > limit) {
            let remaining = qty;
            while (remaining > 0) {
                const chunk = Math.min(remaining, limit);
                split.push({ ...row, qty: chunk });
                remaining -= chunk;
            }
            bigSplit++;
        } else {
            split.push(row);
        }
    }
    let counter = 1, cur = 0;
    for (const row of split) {
        if (cur + row.qty > limit && cur > 0) { counter++; cur = 0; }
        row.package = `${pyStr(packageBase)}-${p2(counter)}`;
        cur += row.qty;
    }
    return { rows: split, bigSplit, counter };
}

/** 봉별 수량 합 — 한도 넘는 봉 [[패키지, 수량]] (정렬) */
export function overBags(rows, limit) {
    const bag = new Map();
    for (const r of rows) bag.set(r.package, (bag.get(r.package) || 0) + r.qty);
    return sortedBy([...bag].filter(([, q]) => q > limit), x => [x[0], x[1]]);
}
