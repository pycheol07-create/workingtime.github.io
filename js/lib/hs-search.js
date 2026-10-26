// === js/lib/hs-search.js ===
// 통합계산기 [HS코드로 찾기] — 검색·묶기·세율 판정. 순수 함수(브라우저·Firebase 없음). tests/hs-search.test.js 가 본다.
// calculator/index.html 의 모듈이 window.HsSearch 에 붙이고 calculator/HsLookup.js(Babel)·CustomsCalculator.js 가 쓴다.
//
// 자료(index) = { [류 2자리]: 류 문서 } — 앱\HS관세율\실행.py 가 Firestore hsTariff/{류} 에 쓴 모양 그대로:
//   { version, n2, n4{4자리: 품명}, n6{6자리: 품명}, nm{7~9자리: 중간 품명},
//     it{10자리: { n, e, A, C, FCN1, FRCCN1, uA.., use, x, end, multi }} }
// 흐름: 1단계 hsSearchGroups — 소호(6자리) 묶음 최대 30개(점수순) → 2단계 hsGroupItems — 그 소호의 10자리 전부.
//       세율 버튼은 hsRateView(일반 = min(A,C) · 한중FTA · RCEP), 고른 값은 { code, kind, rate, ver } 로 저장(hsParseSaved 로 읽기).

/** 1단계 결과 최대 개수 · 이보다 많이 맞으면 '더 자세히' 안내 */
export const HS_GROUP_LIMIT = 30;
export const HS_TOO_MANY = 200;

// 점수 — 10자리 품명(한글·영문) 3 · 중간 품명·소호 2 · 호 1 · 류 0.5. 칸 전체가 검색어와 같으면 +2
const W = { item: 3, mid: 2, sub: 2, head: 1, ch: 0.5 };
const EXACT_BONUS = 2;

export const HS_KINDS = ['general', 'FCN1', 'FRCCN1'];
const KIND_LABEL = { general: '일반', FCN1: '한중FTA', FRCCN1: 'RCEP' };
const SRC_LABEL = { A: '기본세율', C: 'WTO협정세율' };

/** 검색용 글자 — 소문자, 띄어쓰기·문장부호(- . , ㆍ · ( ) / 등) 없앰. 'T-shirt' → 'tshirt'. ㆍ 는 NFKC 뒤 U+119E 가 된다 */
export function hsNormalize(s) {
    if (s === null || s === undefined) return '';
    let t = String(s);
    try { t = t.normalize('NFKC'); } catch (e) { /* 그대로 */ }
    return t.toLowerCase().replace(/[\s\-.,·ㆍᆞ・()[\]{}\/\\'"`~!@#$%^&*+=:;<>?|_]+/g, '');
}

/**
 * 검색어 → { kind: 'empty' | 'code' | 'text', digits, tokens }
 *   숫자와 구분 기호(. - 공백)만 있으면 코드 검색(digits = 숫자만, 최대 10자리).
 *   그 밖은 글자 검색 — 띄어쓰기로 나눈 낱말(각각 hsNormalize, 빈 것 버림). 모든 낱말이 맞아야 한다.
 */
export function hsParseQuery(q) {
    const raw = String(q ?? '').trim();
    if (!raw) return { kind: 'empty', digits: '', tokens: [] };
    if (/^[\d.\-\s]+$/.test(raw)) {
        const digits = raw.replace(/\D/g, '').slice(0, 10);
        if (digits) return { kind: 'code', digits, tokens: [] };
    }
    const tokens = raw.split(/\s+/).map(hsNormalize).filter(Boolean);
    if (!tokens.length) return { kind: 'empty', digits: '', tokens: [] };
    return { kind: 'text', digits: '', tokens };
}

/** 10자리 → '6109.10-1000' · 6자리 → '6109.10' · 4자리 → '6109' · 그 밖은 그대로 */
export function hsFormatCode(code) {
    const c = String(code ?? '');
    if (/^\d{10}$/.test(c)) return `${c.slice(0, 4)}.${c.slice(4, 6)}-${c.slice(6)}`;
    if (/^\d{6}$/.test(c)) return `${c.slice(0, 4)}.${c.slice(4)}`;
    if (/^\d{7,9}$/.test(c)) return `${c.slice(0, 4)}.${c.slice(4, 6)}-${c.slice(6)}`;
    return c;
}

/** '기타' 만 있는 품명은 '기타 (위 항목 외)' — 같은 묶음 안 다른 항목에 해당하지 않는 것 */
export function hsDisplayName(name) {
    const s = String(name ?? '').trim();
    return s === '기타' ? '기타 (위 항목 외)' : s;
}

const docOf = (index, code) => (index && typeof index === 'object' ? index[String(code).slice(0, 2)] : null) || null;
const itemsOf = (doc) => (doc && doc.it && typeof doc.it === 'object' ? doc.it : {});

// 한 칸이 낱말 하나를 담는가 → 점수(담지 않으면 0)
const fieldScore = (norm, token, w, whole) => {
    if (!norm || !norm.includes(token)) return 0;
    return w + (norm === whole ? EXACT_BONUS : 0);
};

// 자료(index) 하나당 한 번만 만드는 검색 준비물 — 정규화한 칸 글자·소호별 10자리 수.
//   index 객체가 같으면 다시 쓴다(WeakMap — index 를 버리면 같이 사라진다). 자료를 바꾸려면 새 index 객체를 넘긴다.
const PREP = new WeakMap();
function prepare(index) {
    let p = PREP.get(index);
    if (p) return p;
    const rows = [];                 // [{ code, ch, fields: [[정규화 글자, 점수], ...] }] — 코드순
    const count = new Map();         // code6 → 10자리 수
    for (const ch of Object.keys(index).sort()) {
        const doc = index[ch] || {};
        const n2 = hsNormalize(doc.n2);
        const n4m = doc.n4 || {}, n6m = doc.n6 || {}, nmm = doc.nm || {};
        const cache = new Map();
        const norm = (k, v) => { if (!cache.has(k)) cache.set(k, hsNormalize(v)); return cache.get(k); };
        const items = itemsOf(doc);
        for (const code of Object.keys(items).sort()) {
            const it = items[code] || {};
            const c6 = code.slice(0, 6), c4 = code.slice(0, 4);
            const fields = [
                [hsNormalize(it.n), W.item],
                [hsNormalize(it.e), W.item],
                [norm('6:' + c6, n6m[c6]), W.sub],
                [norm('4:' + c4, n4m[c4]), W.head],
                [n2, W.ch],
            ];
            for (const L of [7, 8, 9]) {
                const px = code.slice(0, L);
                if (nmm[px]) fields.push([norm('m:' + px, nmm[px]), W.mid]);
            }
            rows.push({ code, ch, fields: fields.filter(f => f[0]) });
            count.set(c6, (count.get(c6) || 0) + 1);
        }
    }
    p = { rows, count };
    PREP.set(index, p);
    return p;
}

/**
 * 1단계 — 소호(6자리) 묶음 찾기.
 * → { direct: 6자리 | null, groups: [{ code6, score, n2, n4, n6, count, sample }], total, tooMany }
 *   direct: 코드로 6자리 이상 친 경우(그 소호가 자료에 있으면) — 바로 2단계로 간다.
 *   groups: 점수 높은 순(같으면 코드순) 최대 HS_GROUP_LIMIT 개. count = 그 소호의 10자리 수, sample = 가장 점수 높은 10자리.
 *   total: 맞은 묶음 수 전체. tooMany: total > HS_TOO_MANY.
 *   정규화한 글자는 index 마다 한 번만 만든다(prepare) — 처음 한 번 뒤로는 낱말 비교만 한다.
 */
export function hsSearchGroups(index, query) {
    const q = typeof query === 'string' ? hsParseQuery(query) : (query || hsParseQuery(''));
    const empty = { direct: null, groups: [], total: 0, tooMany: false };
    if (!index || typeof index !== 'object' || q.kind === 'empty') return empty;
    const p = prepare(index);
    if (q.kind === 'code' && q.digits.length >= 6) {
        const code6 = q.digits.slice(0, 6);
        return { ...empty, direct: p.count.has(code6) ? code6 : null };
    }
    const groups = new Map();       // code6 → group
    const add = (row, score) => {
        const code6 = row.code.slice(0, 6);
        let g = groups.get(code6);
        if (!g) {
            const doc = index[row.ch] || {};
            g = { code6, score: 0, n2: doc.n2 || '', n4: (doc.n4 || {})[code6.slice(0, 4)] || '', n6: (doc.n6 || {})[code6] || '',
                count: p.count.get(code6) || 0, sample: row.code };
            groups.set(code6, g);
        }
        if (score > g.score) { g.score = score; g.sample = row.code; }
    };
    if (q.kind === 'code') {
        const d = q.digits;
        for (const row of p.rows) if (row.code.startsWith(d)) add(row, 1);
    } else {
        const whole = q.tokens.join('');
        for (const row of p.rows) {
            let total = 0;
            let ok = true;
            for (const t of q.tokens) {
                let best = 0;
                for (const [f, w] of row.fields) { const sc = fieldScore(f, t, w, whole); if (sc > best) best = sc; }
                if (!best) { ok = false; break; }
                total += best;
            }
            if (ok) add(row, total);
        }
    }
    const all = [...groups.values()].sort((a, b) => (b.score - a.score) || (a.code6 < b.code6 ? -1 : a.code6 > b.code6 ? 1 : 0));
    return { direct: null, groups: all.slice(0, HS_GROUP_LIMIT), total: all.length, tooMany: all.length > HS_TOO_MANY };
}

/**
 * 2단계 — 소호 하나의 10자리 전부. 중간 품명(7~9자리)은 머리줄로 넣는다.
 * → { code6, n2, n4, n6, rows: [{ type: 'head', code, name, depth } | { type: 'item', code, name, nameEn, item, depth }] } | null
 *   depth = 위에 있는 머리줄 수(들여쓰기용). '기타' 는 '기타 (위 항목 외)'.
 */
export function hsGroupItems(index, code6) {
    const c6 = String(code6 ?? '').replace(/\D/g, '').slice(0, 6);
    if (c6.length !== 6) return null;
    const doc = docOf(index, c6);
    const codes = Object.keys(itemsOf(doc)).filter(c => c.startsWith(c6)).sort();
    if (!codes.length) return null;
    const nm = doc.nm || {};
    const rows = [];
    const shown = new Set();
    for (const code of codes) {
        let depth = 0;
        for (const L of [7, 8, 9]) {
            const p = code.slice(0, L);
            if (!nm[p]) continue;
            if (!shown.has(p)) { shown.add(p); rows.push({ type: 'head', code: p, name: hsDisplayName(nm[p]), depth }); }
            depth++;
        }
        const it = doc.it[code] || {};
        rows.push({ type: 'item', code, name: hsDisplayName(it.n), nameEn: it.e || '', item: it, depth });
    }
    return { code6: c6, n2: doc.n2 || '', n4: (doc.n4 || {})[c6.slice(0, 4)] || '', n6: (doc.n6 || {})[c6] || '', rows };
}

const isRate = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const fmt = (v) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 }).format(v);

/**
 * 10자리 항목 → 세율 버튼 3개와 안내.
 * → { buttons: [{ kind, label, rate, disabled, src, unit, note }], notes: [글], expired }
 *   일반 = min(A, C) (같으면 A) · 출처 src 'A'|'C'. A·C 둘 다 없으면 disabled.
 *   FTA(FCN1 한중 · FRCCN1 RCEP): 없으면 disabled('세율 없음'). 일반보다 높으면 note '일반보다 높음'. 있으면 '원산지증명서 필요'.
 *   unit: 단위당세액(종량, 원)이 있으면 그 숫자 — 계산기는 % 만 계산하므로 notes 에 '종량세 병기' 경고.
 *   notes: use(용도세율 따로) · x(다른 세율 구분) · multi(여러 행 중 높은 값) · 만료 지남(today > end 또는 meta.validTo).
 */
export function hsRateView(item, meta, today) {
    const it = item && typeof item === 'object' ? item : {};
    const notes = [];
    let gen = null;
    if (isRate(it.A) || isRate(it.C)) {
        const useC = isRate(it.C) && (!isRate(it.A) || it.C < it.A);
        const src = useC ? 'C' : 'A';
        gen = { rate: it[src], src, unit: isRate(it['u' + src]) ? it['u' + src] : null };
    }
    const buttons = [{
        kind: 'general', label: KIND_LABEL.general, rate: gen ? gen.rate : null, disabled: !gen,
        src: gen ? gen.src : null, unit: gen ? gen.unit : null,
        note: gen ? `${SRC_LABEL[gen.src]}(${gen.src})` : '세율 없음',
    }];
    for (const k of ['FCN1', 'FRCCN1']) {
        const has = isRate(it[k]);
        const higher = has && gen && it[k] > gen.rate;
        buttons.push({
            kind: k, label: KIND_LABEL[k], rate: has ? it[k] : null, disabled: !has, src: k,
            unit: has && isRate(it['u' + k]) ? it['u' + k] : null,
            note: !has ? '세율 없음' : (higher ? '일반보다 높음 · 원산지증명서 필요' : '원산지증명서 필요'),
        });
    }
    const units = buttons.filter(b => b.unit !== null);
    if (units.length) {
        notes.push(`종량세가 같이 있습니다(${units.map(b => `${b.label} ${fmt(b.unit)}원/단위`).join(' · ')}) — 계산기는 % 만 계산합니다. 실제 관세는 더 클 수 있습니다`);
    }
    if (it.use) notes.push('용도에 따라 다른 세율(용도세율)이 있습니다 — 일반 용도 세율을 보여 줍니다');
    if (Array.isArray(it.x) && it.x.length) notes.push(`다른 세율 구분도 있습니다(${it.x.join(', ')}) — 해당되는지 관세사에게 확인하세요`);
    if (Array.isArray(it.multi) && it.multi.length) notes.push(`같은 구분에 세율이 여러 개라 높은 값을 보여 줍니다(${it.multi.map(k => KIND_LABEL[k] || k).join(', ')})`);
    const end = (typeof it.end === 'string' && it.end) || (meta && typeof meta.validTo === 'string' && meta.validTo) || '';
    const expired = !!(end && typeof today === 'string' && today > end);
    if (expired) notes.push(`세율 적용기간(~${end})이 지났습니다 — 새 관세율표가 올라올 때까지 참고만 하세요`);
    return { buttons, notes, expired };
}

export function hsKindLabel(kind) {
    return KIND_LABEL[kind] || String(kind ?? '');
}

/** 고른 세율 글자 — 'HS 6109.10-1000 · 한중FTA 2.6%' (결과 복사·안내용) */
export function hsRateText(saved) {
    if (!saved || typeof saved !== 'object') return '';
    const r = isRate(saved.rate) ? `${fmt(saved.rate)}%` : '';
    return [`HS ${hsFormatCode(saved.code)}`, `${hsKindLabel(saved.kind)} ${r}`.trim()].join(' · ');
}

/** 저장할 글자(formData.tariffHs) — JSON { code, kind, rate, ver } */
export function hsMakeSaved(code, kind, rate, ver) {
    return JSON.stringify({ code: String(code), kind, rate, ver: String(ver ?? '') });
}

/**
 * 저장 글자 → { code, kind, rate, ver } | null(빈칸·깨짐).
 *   code 10자리 숫자 · kind 는 HS_KINDS · rate 는 0 이상 유한 숫자. 깨진 값이면 호출하는 쪽이 지운다.
 */
export function hsParseSaved(s) {
    if (typeof s !== 'string' || !s) return null;
    let o;
    try { o = JSON.parse(s); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    if (typeof o.code !== 'string' || !/^\d{10}$/.test(o.code)) return null;
    if (!HS_KINDS.includes(o.kind)) return null;
    if (!isRate(o.rate)) return null;
    return { code: o.code, kind: o.kind, rate: o.rate, ver: typeof o.ver === 'string' ? o.ver : '' };
}

/**
 * 저장한 HS 세율이 지금 자료에서도 같은가 — 관세율표가 새로 올라오면(ver 다름) 그 품목의 같은 구분 세율을 다시 본다.
 *   saved = hsParseSaved 결과 · version = 지금 _meta.version · item = 지금 자료의 그 10자리(없으면 null)
 * → null(저장 없음·자료 모름) | { status, newRate }
 *   'same'      ver 가 같다(다시 볼 것 없음)
 *   'unchanged' ver 는 다르지만 같은 구분 세율이 같다 → 호출하는 쪽이 저장 ver 만 새것으로 바꾼다
 *   'changed'   세율이 바뀌었다(newRate) → '다시 고르세요'
 *   'gone'      새 자료에 그 HS코드나 그 구분 세율이 없다 → '다시 고르세요'
 */
export function hsCheckSaved(saved, version, item) {
    if (!saved || typeof version !== 'string' || !version) return null;
    if (saved.ver && saved.ver === version) return { status: 'same', newRate: saved.rate };
    if (!item || typeof item !== 'object') return { status: 'gone', newRate: null };
    const b = hsRateView(item, null, '').buttons.find(x => x.kind === saved.kind);
    if (!b || b.rate === null) return { status: 'gone', newRate: null };
    return { status: b.rate === saved.rate ? 'unchanged' : 'changed', newRate: b.rate };
}

/** hsCheckSaved 결과 → 관세 칸 옆 경고 글(경고할 것 없으면 '') */
export function hsCheckText(saved, check) {
    if (!saved || !check) return '';
    const what = `HS ${hsFormatCode(saved.code)} ${hsKindLabel(saved.kind)}`;
    if (check.status === 'changed') return `세율이 바뀌었습니다 — 다시 고르세요 (새 관세율표: ${what} ${fmt(saved.rate)}% → ${fmt(check.newRate)}%)`;
    if (check.status === 'gone') return `새 관세율표에 ${what} 세율이 없습니다 — 다시 고르세요`;
    return '';
}
