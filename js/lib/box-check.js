// === js/lib/box-check.js — 부족수량관리(신규) [박스 확인]: 박스 라벨을 찍으면 그 박스에 미발 상품이 있는지(2026-11-26 사용자 요청) ===
// 순수 함수만(시험 tests/box-check.test.js). 화면은 js/mibal2-boxcheck.js.
//   · 박스 번호 원본은 표 '박스' 열과 같은 integrations/packBoxes(js/lib/pack-boxes.js packsOn — 고른 출고일의 패킹들).
//   · 라벨 바코드에 무엇이 들었는지 아직 모른다(사용자 '잘 모름') — 찍힌 글자에서 박스 번호 후보('A5'·'12')를 여러 개 뽑아
//     그 출고일 패킹에 실제로 있는 번호만 고른다. 하나면 그 박스, 여럿이면 사람이 고르고, 없으면 '이 출고일 패킹에 없는 번호'.
//   · 미발 = 표의 '미발수량(추가 출고)'(행 mibal) > 0.
import { expandText } from './pack-boxes.js?v=ff567fa413e9-8c6a9912';

const ONE = /^([0-9]*[A-Z]+)?0*(\d+)$/;

/** 박스 표기 하나를 packBoxes 와 같은 모양으로('a05' → 'A5', '007' → '7'). 박스 모양이 아니면 '' */
export function normBox(s) {
    const t = String(s == null ? '' : s).normalize('NFKC').toUpperCase().replace(/\s+/g, '');
    const m = ONE.exec(t);
    return m ? `${m[1] || ''}${Number(m[2])}` : '';
}

/**
 * 찍힌 글자 → 박스 번호 후보(앞쪽이 더 그럴듯한 것).
 *   ① 통째로 ② 'BOX'·'C/NO' 같은 말 뒤 ③ 기호(-, /, 공백 등)로 나눈 조각 중 뒤쪽부터 ④ 끝에 붙은 영문+숫자
 */
export function scanCandidates(raw) { return scanParts(raw).list; }

/** 후보 + 근거가 강한 것(① 통째로 ② BOX 같은 말 뒤) — 나머지는 글자를 쪼개 얻은 것이라 사람이 한 번 확인해야 한다 */
export function scanParts(raw) {
    const t = String(raw == null ? '' : raw).normalize('NFKC').toUpperCase().trim();
    const out = [], strong = new Set();
    if (!t) return { list: out, strong };
    const add = (s, isStrong) => { const b = normBox(s); if (!b) return; if (!out.includes(b)) out.push(b); if (isStrong) strong.add(b); };
    add(t, true);
    const kw = /(?:BOX|CTN|C\/NO|CARTON|NO)\.?\s*[:#-]?\s*([0-9]*[A-Z]?\d+)/g;
    let m;
    while ((m = kw.exec(t))) add(m[1], true);
    const parts = t.split(/[^0-9A-Z]+/).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) add(parts[i]);
    const tail = /([A-Z]*\d+)$/.exec(t.replace(/[^0-9A-Z]+$/, ''));
    if (tail) add(tail[1]);
    return { list: out, strong };
}

/**
 * packsOn 결과 → 박스 번호 → [{ tag, key, codes[] }] (패킹이 둘 이상이면 같은 번호가 패킹마다 있을 수 있다)
 * @param {{key:string, tag:string, b:Object<string,string>}[]} on
 */
export function boxIndex(on) {
    const idx = new Map();
    (on || []).forEach(p => {
        const per = new Map();
        Object.keys(p.b || {}).forEach(code => {
            expandText(p.b[code]).forEach(l => {
                const b = normBox(l);
                if (!b) return;
                if (!per.has(b)) per.set(b, []);
                if (!per.get(b).includes(code)) per.get(b).push(code);
            });
        });
        per.forEach((codes, b) => {
            if (!idx.has(b)) idx.set(b, []);
            idx.get(b).push({ tag: p.tag || '', key: p.key, codes });
        });
    });
    return idx;
}

/**
 * 찍은 글자 → 결과.
 *   { status:'hit', box, packs } · { status:'many', choices:[박스…] } · { status:'none', candidates } · { status:'empty' }(박스 자료 없음)
 */
export function findBox(raw, idx) {
    const { list: candidates, strong } = scanParts(raw);
    if (!idx || !idx.size) return { status: 'empty', candidates };
    const hits = candidates.filter(b => idx.has(b));
    if (!hits.length) return { status: 'none', candidates };
    if (hits.length > 1) return { status: 'many', choices: hits, candidates };
    // weak = 라벨 글자를 쪼개서 얻은 번호(패킹번호 끝 숫자 등일 수 있음) — 화면이 '라벨과 맞는지 확인'을 같이 보인다
    return { status: 'hit', box: hits[0], packs: idx.get(hits[0]), weak: !strong.has(hits[0]) };
}

/**
 * 박스에 든 상품 → 미발 여부. rowsByCode = { code: 표 행 } (행 = { code, name, option, mibal, short, arr }).
 * 표에 없는 코드는 미발 0 으로 본다(그 출고일 부족수량 계산에 없음). 미발 큰 순 → 코드 순.
 * @returns {{ packs:{tag,key,items:{code,name,option,mibal,inTable}[] , mibalCodes:number, mibalQty:number}[], mibalCodes:number, mibalQty:number, total:number, unknown:number }}
 *   unknown = 표에 없는 상품 수(미발을 판정하지 못함 — 화면은 이게 있으면 '미발 없음'(초록)을 쓰지 않는다)
 */
export function boxReport(packs, rowsByCode) {
    const rows = rowsByCode || {};
    let mc = 0, mq = 0, total = 0, unknown = 0;
    const out = (packs || []).map(p => {
        const items = (p.codes || []).map(code => {
            const r = rows[code];
            const mibal = r && Number(r.mibal) > 0 ? Number(r.mibal) : 0;
            return { code, name: r ? (r.name || '') : '', option: r ? (r.option || '') : '', mibal, inTable: !!r };
        }).sort((a, b) => (b.mibal - a.mibal) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
        const pc = items.filter(x => x.mibal > 0).length;
        unknown += items.filter(x => !x.inTable).length;
        const pq = items.reduce((s, x) => s + x.mibal, 0);
        mc += pc; mq += pq; total += items.length;
        return { tag: p.tag || '', key: p.key, items, mibalCodes: pc, mibalQty: pq };
    });
    return { packs: out, mibalCodes: mc, mibalQty: mq, total, unknown };
}
