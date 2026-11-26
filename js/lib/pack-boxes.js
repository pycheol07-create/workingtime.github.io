// === js/lib/pack-boxes.js — 부족수량관리(신규) 표 '박스' 열(2026-11-26 사용자 요청: 상품이 몇 번 박스에 들었는지) ===
// 순수 함수만(시험 tests/pack-boxes.test.js). 화면 연결은 js/china-mibal2.js(열 때 한 번 읽기, 구독 안 함).
//   · 원본 = Firestore integrations/packBoxes — 패킹봇 box_sync.py 가 전송 뒤 패킹 파일 detail 'Box No.' 열에서 만든다.
//     모양 { v:1, updatedAt, packs: { '<시트 표기 패킹No>': { sd:'YYYY-MM-DD', at, n, miss, b:{ 코드:'3, 5~7' }[, err:1] } } }
//     err:1 = 수정본 파일의 박스를 못 읽음(b 빈 칸) — 옛 박스를 보이지 않고 칸 title 에 '읽기 실패' 만(failedPacks).
//   · sd = 패킹봇이 보낸 출고일(오더리스트에 쓴 값). 오더리스트 출고일을 나중에 바꾼 패킹은 고른 출고일과 안 맞아 빈칸으로 보인다.
//     — 칸 이름을 한쪽만 바꾸면 박스 칸이 조용히 비어 보인다(패킹봇 tests/test_box_sync.py 와 같은 모양).
//   · 고른 출고일(sd)의 패킹이 하나면 '3, 5~7', 둘 이상이면 패킹 꼬리번호를 붙여 '-1: 3, 5~7 · -2: 12'(사용자 결정).
//     꼬리번호가 겹치면(다른 날 -1 둘) 패킹No 전체를 붙인다.
//   · 박스 표기는 숫자 또는 영문 앞글자 + 숫자('A3'). 같은 앞글자의 연속 번호만 '~' 로 묶는다(패킹봇 box_read.compress 와 같은 규칙).

const ONE = /^([0-9]*[A-Z]+)?(\d+)$/;
const RANGE = /^([0-9]*[A-Z]+)?(\d+)~(\d+)$/;
const MAX_EXPAND = 500;

/** 정렬 키 [앞글자, 번호] */
export function boxKey(label) {
    const m = ONE.exec(String(label));
    return m ? [m[1] || '', Number(m[2])] : [String(label), 0];
}
const cmpKey = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);

/** ['3','5','6','7'] → '3, 5~7' */
export function compress(labels) {
    const seen = new Set();
    const keys = (labels || []).map(boxKey).filter(k => { const s = k[0] + '|' + k[1]; if (seen.has(s)) return false; seen.add(s); return true; }).sort(cmpKey);
    const out = [];
    for (let i = 0; i < keys.length;) {
        const [pre, lo] = keys[i];
        let j = i;
        while (j + 1 < keys.length && keys[j + 1][0] === pre && keys[j + 1][1] === keys[j][1] + 1) j++;
        const hi = keys[j][1];
        out.push(hi === lo ? `${pre}${lo}` : `${pre}${lo}~${hi}`);
        i = j + 1;
    }
    return out.join(', ');
}

/** '3, 5~7, A1~2' → ['3','5','6','7','A1','A2'] (모르는 조각은 그대로 하나) */
export function expandText(text) {
    const out = [];
    String(text == null ? '' : text).split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
        const r = RANGE.exec(p);
        if (r) {
            const lo = Number(r[2]), hi = Number(r[3]);
            if (hi >= lo && hi - lo < MAX_EXPAND) { for (let n = lo; n <= hi; n++) out.push(`${r[1] || ''}${n}`); return; }
        }
        out.push(p);
    });
    return out;
}

/** 문서 → { packs: [{ key, sd, b }] } (패킹No 순). 모양이 틀린 칸은 뺀다. 문서가 없으면 빈 목록 */
export function parsePackBoxes(doc) {
    const packs = [];
    const src = doc && typeof doc === 'object' && doc.packs && typeof doc.packs === 'object' ? doc.packs : {};
    Object.keys(src).forEach(key => {
        const p = src[key];
        if (!p || typeof p !== 'object' || typeof p.sd !== 'string' || !p.b || typeof p.b !== 'object') return;
        const b = {};
        const err = !!p.err;
        if (!err) Object.keys(p.b).forEach(c => { if (typeof p.b[c] === 'string' && p.b[c].trim()) b[c] = p.b[c]; });
        packs.push(err ? { key: String(key), sd: p.sd, b, err: true } : { key: String(key), sd: p.sd, b });
    });
    packs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { packs };
}

/** 고른 출고일의 패킹들 + 이름표(하나면 '', 둘 이상이면 '-N' 또는 패킹No) */
export function packsOn(dates, parsed) {
    const ds = new Set((dates || []).map(String));
    const ps = ((parsed && parsed.packs) || []).filter(p => ds.has(p.sd));
    if (ps.length < 2) return ps.map(p => ({ ...p, tag: '' }));
    const tails = ps.map(p => { const m = /-(\d+)$/.exec(p.key); return m ? '-' + Number(m[1]) : p.key; });
    const dup = new Set(tails.filter((t, i) => tails.indexOf(t) !== i));
    return ps.map((p, i) => ({ ...p, tag: dup.has(tails[i]) ? p.key : tails[i] }));
}

/**
 * 한 상품의 박스 칸. → { text, list } — text = 칸 글자('' = 없음), list = 박스별 값(열 필터용, 패킹이 둘 이상이면 '-1: 3' 모양).
 * dates = 고른 출고일들, parsed = parsePackBoxes 결과(못 읽었으면 null).
 */
export function boxesFor(code, dates, parsed, on = null) {
    const ps = on || packsOn(dates, parsed);
    const texts = [], list = [];
    ps.forEach(p => {
        const t = p.b[code];
        if (!t) return;
        const labels = expandText(t);
        if (!labels.length) return;
        texts.push(p.tag ? `${p.tag}: ${compress(labels)}` : compress(labels));
        labels.forEach(l => list.push(p.tag ? `${p.tag}: ${l}` : l));
    });
    return { text: texts.join(' · '), list };
}

/** 고른 출고일 패킹 중 박스를 못 읽은 것(err) — 패킹No 목록(칸 title '읽기 실패' 용) */
export function failedPacks(on) {
    return (on || []).filter(p => p && p.err).map(p => p.key);
}

/**
 * 정렬 값 — 첫 박스의 [꼬리번호, 앞글자, 번호](없으면 null = 아래로). 비교는 cmpBoxSort.
 * '-2: A3' → [2, 'A', 3] · 'B2' → [0, 'B', 2](패킹 하나면 꼬리 없음) · '20261119-1: 5' → [1, '', 5]
 */
export function boxSortVal(list) {
    if (!Array.isArray(list) || !list.length) return null;
    const t = String(list[0]);
    const at = t.indexOf(': ');
    const tag = at >= 0 ? t.slice(0, at) : '';
    const tm = /-(\d+)$/.exec(tag);
    const [pre, n] = boxKey(at >= 0 ? t.slice(at + 2) : t);
    return [tm ? Number(tm[1]) : 0, pre, n];
}
/** boxSortVal 두 개 비교(오름차순) — 꼬리번호 → 앞글자 → 번호 */
export function cmpBoxSort(a, b) {
    if (a[0] !== b[0]) return a[0] - b[0];
    return cmpKey([a[1], a[2]], [b[1], b[2]]);
}
