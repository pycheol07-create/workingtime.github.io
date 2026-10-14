// === js/lib/product-price-text.js ===
// 상품 관리 — 이지어드민 상품 엑셀의 '글로 적힌 단가' → 옵션별 단가. 2026-10-14. 설계: 이지어드민상품엑셀_설계.md 4장
//
// 이지어드민 '추가항목2'(위안 단가)·'비축창고재고'(달러 단가) 칸에는 숫자만 있지 않다.
//   예) '블랙¥50, 기타¥40' · '롱$9/숏$8' · '￥40 - 진청'
// 라벨(색·길이 등)을 옵션명에 맞춰 옵션마다 단가를 고른다. **확정 못 하면 숫자를 추측하지 않고** 'check'(확인 필요)로 돌려준다.
//   · 기호 없는 숫자의 화폐 = 그 칸의 화폐(colCur). ¥·위안·元 = 위안, $ = 달러.
//   · 라벨 없는 가격·'나머지/기타' 라벨 = 기본값(라벨에 안 맞는 옵션에 씀). 둘 이상이면 확인 필요.
//   · 라벨은 옵션명 조각([ ] - _ / 공백, 필요하면 ( ) . 로 나눔)을 이어 붙인 연속 구간과 **정확히** 같을 때만 맞음
//     ('L' 은 '[블랙-1-XL]' 에 안 맞고, '블랙' 은 '[블랙그레이-1-M]' 에 안 맞는다).
//   · 한 옵션에 맞는 라벨이 여럿이면 가장 긴 라벨('빈티지 중청' > '중청').
//   · 기호 없는 숫자와 **칸 화폐와 다른** 기호 가격이 한 셀에 섞이면 확정하지 않는다(MIXED_TOKEN).
//     같은 화폐 기호와 섞인 것('¥9,블랙9' 위안 칸)은 기호 없는 숫자를 칸 화폐로 읽는다.
//
// 순수 모듈(DOM/Firebase 의존 없음). ⚠️ 원문·숫자를 console 에 찍지 말 것 — 사유 코드(REASON_LABEL)만 밖으로 낸다.

export const REASON_LABEL = {
    TYPO: '숫자 오타', CUR_MIX: '한 가격에 두 화폐', MULTI_DEFAULT: '라벨 없는 가격이 둘 이상',
    TWO_LEVEL: '두 단계 표기', DUP_LABEL: '같은 라벨이 두 번', LABEL_NO_MATCH: '어느 옵션에도 안 맞는 라벨',
    NO_DEFAULT: '라벨에 안 맞는 옵션이 남고 기본값 없음', TIE: '한 옵션에 같은 길이 라벨 둘(값 다름)',
    TRAILING: '마지막 가격 뒤에 해석 못 한 글자', NO_NUMBER: '숫자 없음', MIXED_TOKEN: '기호 있는 가격과 없는 가격이 섞임',
    ZERO_PRICE: '0 단가',
    // 품목 단위 결합(product-ezadmin.js buildEzCost)
    COL_CONFLICT: '위안·달러 칸 값이 서로 다름', PARTIAL_BLANK: '일부 옵션만 단가가 비어 있음',
    RATE: '환율 계산 불가', UNIT_SUSPECT: '원화와 단위가 안 맞음(달러를 위안 칸에 적은 듯)',
};

/** 라벨·옵션명 비교용 — 전각→반각, 공백·대괄호 제거, 소문자 */
export const normLabel = (s) => String(s ?? '').normalize('NFKC').replace(/[\s\[\]]/g, '').toLowerCase();

/** 이 라벨은 '나머지 옵션' 기본값 (normLabel 기준) */
export const DEFAULT_WORDS = new Set(['나머지', '나머진', '기타', '나머지컬러', '나머지색상', '그외']);
/** 옵션명 어디에도 안 들어 있을 때만 기본값으로 보는 라벨('일반￥40,융기모￥45') */
const SOFT_DEFAULT_WORDS = new Set(['기본', '일반']);

const EDGE_RE = /^[\s,/.·:;\-~]+|[\s,/.·:;\-~]+$/g;
const SINGLE_RE = /^([¥$])?\s*(\d+(?:\.\d+)?)\s*(위안|元)?$/;
const TOKEN_RE = /([¥$])?\s*(\d+(?:\.\d+)?)(\s*(?:위안|元))?/g;

/** 기호·'위안' → 화폐. '$9위안'(두 화폐) → null */
function curOf(sym, wi, colCur) {
    if (sym === '$') return wi ? null : 'usd';
    if (sym === '¥' || wi) return 'cny';
    return colCur;
}

/** 매칭 키 — normLabel 에서 조각 구분 글자(- _ / ( ) .)까지 뺀 것 */
const matchKey = (s) => normLabel(s).replace(/[\-_/().]/g, '');
const SEG_COARSE = /[\[\]\-_/\s]+/, SEG_FINE = /[\[\]\-_/\s().]+/;
/** 옵션명 → 조각 연속 구간들의 매칭 키 집합('[빈티지 중청-1-L]' → 빈티지·중청·빈티지중청·1·l·…) */
function optKeys(name) {
    const keys = new Set();
    const s = String(name ?? '').normalize('NFKC').toLowerCase();
    for (const re of [SEG_COARSE, SEG_FINE]) {
        const seg = s.split(re).filter(Boolean);
        for (let i = 0; i < seg.length; i++) {
            let acc = '';
            for (let j = i; j < seg.length; j++) { acc += seg[j]; const k = matchKey(acc); if (k) keys.add(k); }
        }
    }
    return keys;
}

/** 라벨 글자 → 라벨 조각들(쉼표·슬래시로 나눔). 매칭 키가 빈 것은 버린다 */
function labelPieces(txt) {
    return txt.replace(EDGE_RE, '').split(/[,/]/).map(x => x.replace(EDGE_RE, '')).filter(x => matchKey(x) !== '');
}

/**
 * parsePriceText(raw, colCur, optNames)
 *  raw      : 셀 글자
 *  colCur   : 'cny' | 'usd' — 기호 없는 숫자의 화폐
 *  optNames : 이 원문을 가진 옵션들의 옵션명(파일 순서)
 * → { kind: 'blank'|'single'|'labeled'|'check', def: {cur,val}|null, perOpt: Array<{cur,val}>|null (optNames 길이), reasons: string[] (사유 코드만) }
 */
export function parsePriceText(raw, colCur, optNames = []) {
    const out = (kind, def, perOpt, reasons = []) => ({ kind, def, perOpt, reasons });
    const check = (reasons) => out('check', null, null, [...new Set(reasons)]);
    let s = String(raw ?? '').normalize('NFKC').trim();          // ￥→¥, ＄→$, 전각 쉼표·콜론→반각
    s = s.replace(/CN¥|CNY|RMB/gi, '¥').replace(/USD/gi, '$');
    if (!s) return out('blank', null, null);
    if (/[¥$]\s*\.\d/.test(s) || /\d\.\./.test(s)) return check(['TYPO']);

    const m = s.match(SINGLE_RE);
    if (m) {
        const cur = curOf(m[1], m[3], colCur);
        if (!cur) return check(['CUR_MIX']);
        const def = { cur, val: Number(m[2]) };
        return out('single', def, optNames.map(() => ({ ...def })));
    }

    // 가격 토큰
    const reasons = [];
    const toks = [];
    TOKEN_RE.lastIndex = 0;
    let mm;
    while ((mm = TOKEN_RE.exec(s))) {
        const end = mm.index + mm[0].length;
        const bare = !mm[1] && !mm[3];
        if (bare) {
            // 기호 없는 숫자가 라벨의 일부인 경우: 바로 뒤에 글자('2XL'), 또는 바로 앞이 글자·'-' 이고 곧이어 기호 붙은 가격('블랙-1¥50')
            const ds = mm.index + mm[0].indexOf(mm[2]);
            if (/[A-Za-z가-힣]/.test(s[end] || '')) continue;
            if (/[A-Za-z가-힣\-]/.test(s[ds - 1] || '') && /^\s*[¥$]/.test(s.slice(end))) continue;
        }
        const cur = curOf(mm[1], mm[3], colCur);
        if (!cur) reasons.push('CUR_MIX');
        toks.push({ start: mm.index, end, cur, val: Number(mm[2]), labels: [], group: 0, bare });
    }
    if (!toks.length) return check(['NO_NUMBER']);
    if (toks.some(t => t.bare) && toks.some(t => !t.bare && t.cur && t.cur !== colCur)) reasons.push('MIXED_TOKEN');
    if (toks.some(t => t.val === 0)) reasons.push('ZERO_PRICE');      // '블랙¥0,기타¥40' — 셀 전체가 0 인 것(single)은 호출 쪽이 빈칸으로 본다

    // 라벨 = 앞 토큰 끝 ~ 이 토큰 시작. 앞이 '/' 로 시작하면 새 그룹
    let prevEnd = 0, group = 0;
    toks.forEach((t, i) => {
        const txt = s.slice(prevEnd, t.start);
        if (i > 0 && /^\s*\//.test(txt)) group++;
        t.group = group;
        t.labels = labelPieces(txt);
        prevEnd = t.end;
    });
    const rest = s.slice(prevEnd).replace(EDGE_RE, '');
    if (rest) {
        if (toks.length === 1 && !toks[0].labels.length) toks[0].labels = labelPieces(rest);   // '¥9 연청'
        else reasons.push('TRAILING');
    }

    // 기본값 후보 · 일반 라벨
    const optSets = optNames.map(optKeys);
    const defs = new Set();
    const labeled = [];                                  // { norm: 매칭 키, t }
    for (const t of toks) {
        if (!t.labels.length) { defs.add(t); continue; }
        for (const l of t.labels) {
            const n = matchKey(l);
            if (DEFAULT_WORDS.has(n) || (SOFT_DEFAULT_WORDS.has(n) && !optSets.some(o => o.has(n)))) defs.add(t);
            else labeled.push({ norm: n, t });
        }
    }
    if (defs.size >= 2) reasons.push('MULTI_DEFAULT');

    // 두 단계 표기('화이트-롱¥30,숏¥25/블랙-…') · 같은 라벨 두 번
    const groups = new Map();
    for (const t of toks) { if (!groups.has(t.group)) groups.set(t.group, []); groups.get(t.group).push(t); }
    for (const g of groups.values()) {
        if (g.length < 2) continue;
        const first = g[0].labels[0] || '';
        // 뒤 라벨이 '기타·나머지' 같은 기본값 라벨뿐이면 두 단계로 보지 않는다('블랙-1¥50,기타¥40')
        const later = g.slice(1).filter(t => t.labels.length && !t.labels.every(l => DEFAULT_WORDS.has(matchKey(l))));
        if (first.includes('-') && later.some(t => !t.labels.some(l => l.includes('-')))) { reasons.push('TWO_LEVEL'); break; }
    }
    const seen = new Set();
    for (const L of labeled) { if (seen.has(L.norm)) { reasons.push('DUP_LABEL'); break; } seen.add(L.norm); }

    // 옵션 매칭 — 라벨 = 옵션명 조각 연속 구간일 때만 맞음, 가장 긴 라벨 우선
    for (const L of labeled) if (!optSets.some(o => o.has(L.norm))) { reasons.push('LABEL_NO_MATCH'); break; }
    const defTok = defs.size === 1 ? [...defs][0] : null;
    const def = defTok ? { cur: defTok.cur, val: defTok.val } : null;
    const perOpt = optSets.map(o => {
        let best = null, bestLen = -1, tie = false;
        for (const L of labeled) {
            if (!o.has(L.norm)) continue;
            if (L.norm.length > bestLen) { best = L.t; bestLen = L.norm.length; tie = false; }
            else if (L.norm.length === bestLen && (best.cur !== L.t.cur || best.val !== L.t.val)) tie = true;
        }
        if (tie) reasons.push('TIE');
        return best ? { cur: best.cur, val: best.val } : (def ? { ...def } : null);
    });
    if (perOpt.some(p => p === null)) reasons.push('NO_DEFAULT');
    if (reasons.length) return check(reasons);
    return out('labeled', def, perOpt);
}
