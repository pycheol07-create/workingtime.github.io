// === js/lib/last-out.js ===
// 마지막 출고일(integrations/locLastOut) 읽기·합치기 — 순수 모듈(DOM/Firebase 없음). 2026-11-20.
//
// 서버 앱\로케이션추천\최근출고.py 가 06:40 정기 때 LocRecDaily 120일의 t·z·a(국내·직진·에이블리) 마지막 출고일을
// codesJson(JSON 문자열 {코드:"YYYYMMDD"})으로 쓴다. 화면(js/location.js)은 업로드 '마지막출고.배송일'과 더 최근 값을 쓴다
//   빈칸확보(calc2FList)·분포(__dashInferDelivery) — 표시·정렬·엑셀
//   단종 페어 정리(cleanupDeprecatedPairs) — 이 날짜가 cutoff 안이면 지우지 않는 데만(cleanupDecision 'keep-ez' — cleanupProtected 는 같은 기준의 시험용)
// ⚠️ 칸 이름·날짜 형식을 한쪽만 바꾸면 날짜가 조용히 업로드 값으로 돌아간다.
//    계약 시험 tests/last-out.test.js · 로케이션추천\tests\test_최근출고.py (같은 사례 tests/fixtures/last-out-case.json)
//
//   normDay        날짜 글자(YYYY.MM.DD·YYYY-MM-DD·YYYY/MM/DD·YYYYMMDD, 뒤 시각·한 자리 월일) → 'YYYY-MM-DD', 못 풀면 ''
//   parseLastOut   문서 data → { codes: Map(코드 → 'YYYY-MM-DD'), fromDay, toDay, ok } | null
//   laterDay       두 날짜 중 더 최근('YYYY-MM-DD', 둘 다 없으면 '')
//   ezLastOf       코드(앞뒤 빈칸만 떼고 대소문자 그대로 정확 일치) → 'YYYY-MM-DD' | ''
//   cleanupProtected  이지어드민 마지막 출고일이 있고 cutoffStr('YYYY-MM-DD') 이상이면 true
//   cleanupDecision   단종 페어 정리의 날짜 판정(업로드 날짜 정규화 + 이지어드민 보호) → 'delete' | 'keep-*'

const SEP_RE = /^(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\.?(?:[\sT].*)?$/;
const COMPACT_RE = /^(\d{4})(\d{2})(\d{2})(?:[\sT].*)?$/;

export function normDay(v) {
    if (v == null) return '';
    const s = String(v).trim();
    if (!s) return '';
    const m = SEP_RE.exec(s) || COMPACT_RE.exec(s);
    if (!m) return '';
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseLastOut(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.schema !== 1 || typeof data.codesJson !== 'string') return null;
    let obj;
    try { obj = JSON.parse(data.codesJson); } catch (e) { return null; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const codes = new Map();
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== 'string' || !/^\d{8}$/.test(v)) continue;
        const day = normDay(v);
        if (day) codes.set(k, day);
    }
    return {
        codes,
        fromDay: typeof data.fromDay === 'string' ? data.fromDay : '',
        toDay: typeof data.toDay === 'string' ? data.toDay : '',
        ok: data.ok !== false,
    };
}

export function laterDay(a, b) {
    const x = normDay(a), y = normDay(b);
    return x > y ? x : y;
}

export function ezLastOf(lastOut, code) {
    if (!lastOut || !(lastOut.codes instanceof Map) || code == null) return '';
    return lastOut.codes.get(String(code).trim()) || '';
}

export function cleanupProtected(lastOut, code, cutoffStr) {
    const ez = ezLastOf(lastOut, code);
    return !!ez && !!cutoffStr && ez >= String(cutoffStr);
}

// 단종 페어 정리(location.js cleanupDeprecatedPairs) 날짜 판정 — 2026-11-20 사용자 결정(R1: 'YYYY.MM.DD' 글자 비교로 늘 cutoff 이상이던 문제).
//   uploadRaws: 자리마다 업로드 날짜 원값(마지막배송일, 없으면 마지막입고일) — 배열 또는 값 하나. 빈 값은 건너뛴다
//   ezDay: 이지어드민 마지막 출고일(ezLastOf 값 'YYYY-MM-DD' 또는 'YYYYMMDD', 없으면 '')
//   → 'keep-empty'  업로드 날짜가 하나도 없음(신규 상품으로 보고 지우지 않음)
//     'keep-bad'    못 푸는 업로드 날짜가 하나라도 있음(숫자 일련번호 등 — 보수적으로 지우지 않음)
//     'keep-recent' 업로드 날짜(가장 최근)가 cutoff 이상
//     'keep-ez'     이지어드민 날짜가 cutoff 이상(cleanupProtected 와 같은 기준)
//     'delete'      업로드(정규화)·이지어드민 중 최근 값이 cutoff 보다 앞섬
export function cleanupDecision(uploadRaws, ezDay, cutoffStr) {
    const raws = (Array.isArray(uploadRaws) ? uploadRaws : [uploadRaws])
        .filter(v => v != null && String(v).trim() !== '');
    if (!raws.length) return 'keep-empty';
    let last = '';
    for (const v of raws) {
        const d = normDay(v);
        if (!d) return 'keep-bad';
        if (d > last) last = d;
    }
    const cut = String(cutoffStr || '');
    if (!cut || last >= cut) return 'keep-recent';
    const ez = normDay(ezDay);
    if (ez && ez >= cut) return 'keep-ez';
    return 'delete';
}
