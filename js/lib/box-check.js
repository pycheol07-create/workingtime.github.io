// === js/lib/box-check.js — 부족수량관리(신규) [박스 확인]: 박스 라벨을 찍으면 그 박스에 미발 상품이 있는지(2026-11-26 사용자 요청) ===
// 순수 함수만(시험 tests/box-check.test.js). 화면은 js/scan-boxcheck.js(입고 스캐너).
//   · 박스 번호 원본은 표 '박스' 열과 같은 integrations/packBoxes(js/lib/pack-boxes.js packsOn — 고른 출고일의 패킹들).
//   · 라벨 바코드에 무엇이 들었는지 아직 모른다(사용자 '잘 모름') — 찍힌 글자에서 박스 번호 후보('A5'·'12')를 여러 개 뽑아
//     그 출고일 패킹에 실제로 있는 번호만 고른다. 하나면 그 박스, 여럿이면 사람이 고르고, 없으면 '이 출고일 패킹에 없는 번호'.
//   · 미발 = 표의 '미발수량(추가 출고)'(행 mibal) > 0.
import { expandText } from './pack-boxes.js?v=3043c07f5de0-7d49b72c';

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
 * 표에 없는 코드는 미발 0 으로 본다(그 출고일 부족수량 계산에 없음). 긴급 → 미발 큰 순 → 코드 순.
 * urgent = 긴급 상품코드 Set(scanUrgentSet — 꺼져 있으면 빈 Set). 미발 판정과 따로 센다(긴급인데 미발 0 도 있음).
 * @returns {{ packs:{tag,key,items:{code,name,option,mibal,inTable,urgent}[] , mibalCodes:number, mibalQty:number, urgentCodes:number}[], mibalCodes:number, mibalQty:number, urgentCodes:number, total:number, unknown:number }}
 *   unknown = 표에 없는 상품 수(미발을 판정하지 못함 — 화면은 이게 있으면 '미발 없음'(초록)을 쓰지 않는다)
 */
export function boxReport(packs, rowsByCode, urgent) {
    const rows = rowsByCode || {};
    const isUrgent = (c) => !!(urgent && typeof urgent.has === 'function' && urgent.has(c));
    let mc = 0, mq = 0, uc = 0, total = 0, unknown = 0;
    const out = (packs || []).map(p => {
        const items = (p.codes || []).map(code => {
            const r = rows[code];
            const mibal = r && Number(r.mibal) > 0 ? Number(r.mibal) : 0;
            return { code, name: r ? (r.name || '') : '', option: r ? (r.option || '') : '', mibal, inTable: !!r, noDoc: !!(r && r.noDoc), urgent: isUrgent(code) };
        }).sort((a, b) => (b.urgent - a.urgent) || (b.mibal - a.mibal) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
        const pc = items.filter(x => x.mibal > 0).length;
        const pu = items.filter(x => x.urgent).length;
        unknown += items.filter(x => !x.inTable).length;
        const pq = items.reduce((s, x) => s + x.mibal, 0);
        mc += pc; mq += pq; uc += pu; total += items.length;
        return { tag: p.tag || '', key: p.key, items, mibalCodes: pc, mibalQty: pq, urgentCodes: pu };
    });
    return { packs: out, mibalCodes: mc, mibalQty: mq, urgentCodes: uc, total, unknown };
}

/**
 * 부족수량관리 '긴급' 문서(artifacts/team-work-logger-v2/mibal2/urgent — 화면 china-mibal2 쪽이 씀, 스캐너는 읽기만) → 긴급 상품코드 Set.
 *   계약: { v:1, enabled:boolean, codes:{ [코드]:{ at, byEmail } }, enabledAt, enabledBy, updatedAt }
 *   필요할 때만 켜는 기능 — enabled === true 일 때만 코드를 돌려준다. 꺼짐·문서 없음·모양이 틀림 = 빈 Set(긴급 표시 없음).
 *   byEmail 등 다른 칸은 읽지 않는다.
 */
export function scanUrgentSet(doc) {
    const out = new Set();
    if (!doc || typeof doc !== 'object' || doc.enabled !== true) return out;
    const c = doc.codes;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return out;
    Object.keys(c).forEach(k => { const t = String(k).trim(); if (t && c[k]) out.add(t); });
    return out;
}

// ── 입고 스캐너(scan.html) '박스 확인' 모드(2026-11-27 사용자 결정) — 화면은 js/scan-boxcheck.js ──
//   · 출고일이 아니라 패킹 하나를 고른다(기본 = 가장 최근, 고른 것은 폰에 기억). 그 패킹 하나로 boxIndex.
//   · 미발 = ChinaStockGoods_ScanDB/{코드}.mibalQty > 0(스캐너가 입고 때 보는 값). 못 읽음·문서 없음은 '확인 못 함'.

/** 'YYYY-MM-DD' → 'MM/DD'(모양이 다르면 그대로) */
const mmdd = (sd) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(sd || '')); return m ? `${m[1]}/${m[2]}` : String(sd || ''); };

/**
 * parsePackBoxes 결과 → 패킹 고르기 목록. 출고일 최근 순 → 패킹No 큰 순.
 * @returns {{key:string, sd:string, err:boolean, label:string}[]}  label = 'MM/DD 출고 · 패킹No'(읽기 실패면 ' · 읽기 실패')
 */
export function packChoices(parsed, workShips) {
    const work = new Set(Array.isArray(workShips) ? workShips.map(String) : []);
    const ps = ((parsed && parsed.packs) || []).slice();
    // 같은 출고일이면 패킹No 꼬리번호를 숫자로(-10 이 -9 보다 최근, 2026-11-27 리뷰)
    ps.sort((a, b) => (a.sd < b.sd ? 1 : a.sd > b.sd ? -1 : String(b.key).localeCompare(String(a.key), undefined, { numeric: true })));
    return ps.map(p => ({ key: p.key, sd: p.sd, err: !!p.err, work: work.has(p.sd),
        label: `${mmdd(p.sd)} 출고 · ${p.key}${work.has(p.sd) ? ' · 스캐너 반영 작업' : ''}${p.err ? ' · 읽기 실패' : ''}` }));
}

/**
 * 고를 패킹 — 기억한 패킹이 목록에 있으면 그것, 없으면 읽기 실패가 아닌 가장 최근(모두 실패면 맨 앞). 목록이 비면 null.
 * newer = 고른 것보다 출고일이 늦은(읽기 실패 아닌) 패킹이 있음(화면이 '더 최근 패킹 있음' 을 같이 보인다)
 */
export function pickPack(choices, savedKey, preferWork = false) {
    const cs = choices || [];
    if (!cs.length) return null;
    // preferWork = 스캐너 반영 작업(부족수량관리 [스캐너에 반영] — mibal2/settings.batch.ships) 출고일의 패킹을 먼저(2026-11-27 사용자 요청)
    const work = preferWork ? cs.find(x => x.work && !x.err) : null;
    const saved = savedKey ? cs.find(c => c.key === savedKey) : null;
    const c = work || saved || cs.find(x => !x.err) || cs[0];
    return { key: c.key, newer: !c.work && cs.some(x => !x.err && x.sd > c.sd) };   // 작업 패킹이면 '더 최근 있음' 안내 안 함
}

/**
 * ScanDB 읽은 결과 → boxReport 의 rowsByCode. results = [{ code, ok, exists, data }].
 * 읽기 실패(ok false)만 행을 만들지 않는다 → boxReport 가 unknown(확인 못 함)으로 센다.
 * 문서 없음 = 미발 0 행(noDoc: true — 화면은 '스캐너 목록에 없음'). ScanDB 에는 미발 대상 상품만 들어 있다(2026-11-27 실제 자료 확인:
 *   최근 패킹 표본 40코드 중 문서 있음 18).
 * mibal = mibalQty(음수·숫자 아님은 0 — 스캐너 표시와 같음), name = 문서 name(없으면 '').
 */
export function scanDbRows(results) {
    const rows = {};
    (results || []).forEach(r => {
        if (!r || !r.code || !r.ok) return;
        if (!r.exists) { rows[r.code] = { code: r.code, name: '', option: '', mibal: 0, noDoc: true }; return; }
        const d = r.data || {};
        rows[r.code] = { code: r.code, name: typeof d.name === 'string' ? d.name : '', option: '', mibal: Math.max(parseInt(d.mibalQty) || 0, 0) };
    });
    return rows;
}

/** items 를 동시에 limit 개까지만 fn 으로 돌린다(순서 유지). fn 이 던지면 그 자리는 undefined — 부르는 쪽이 잡아서 돌려줄 것 */
export async function mapLimit(items, limit, fn) {
    const list = items || [];
    const out = new Array(list.length);
    let next = 0;
    const n = Math.max(1, Math.min(limit || 1, list.length));
    const worker = async () => {
        while (next < list.length) {
            const i = next++;
            try { out[i] = await fn(list[i], i); } catch (e) { out[i] = undefined; }
        }
    };
    await Promise.all(Array.from({ length: n }, worker));
    return out;
}

// ── 라벨에 바코드가 없다(2026-11-27 사용자 사실: 박스 번호가 인쇄 글자·손글씨로 섞여 있음) — 번호 자판 · 사진 글자 인식 ──
//   · 둘 다 '지금 고른 패킹에 실제로 있는 번호'(boxIndex 의 키)만 후보로 보인다. 사진 후보는 하나여도 사람이 눌러야 확인.

const BOX_PARTS = /^([0-9]*[A-Z]+)?(\d+)$/;
/** 박스 번호 정렬(앞글자 → 숫자): 'A2' < 'A10' < 'B1', 숫자만인 번호가 먼저 */
export function cmpBox(a, b) {
    const ma = BOX_PARTS.exec(String(a)), mb = BOX_PARTS.exec(String(b));
    const pa = ma ? ma[1] || '' : String(a), pb = mb ? mb[1] || '' : String(b);
    if (pa !== pb) return pa < pb ? -1 : 1;
    return (ma ? Number(ma[2]) : 0) - (mb ? Number(mb[2]) : 0);
}

/** 자판 앞글자 단추 — 이 패킹 박스 번호에 쓰인 앞글자('A'·'B' …)만, 가나다순. 숫자만 쓰는 패킹이면 [] */
export function padLetters(idx) {
    const set = new Set();
    (idx ? [...idx.keys()] : []).forEach(b => { const m = BOX_PARTS.exec(b); if (m && m[1]) set.add(m[1]); });
    return [...set].sort();
}

/**
 * 자판으로 친 글자 → 이 패킹에서 그 글자로 시작하는 박스 번호(정렬, 최대 max개).
 * @returns {{ list:string[], more:number, exact:string, one:string }}
 *   exact = 친 글자 그대로인 번호(있으면 — 'A1' 을 치면 A10 이 있어도 A1), one = 후보가 딱 하나로 좁혀졌을 때 그 번호
 */
export function padMatches(typed, idx, max = 8) {
    const t = String(typed == null ? '' : typed).normalize('NFKC').toUpperCase().replace(/\s+/g, '');
    const none = { list: [], more: 0, exact: '', one: '' };
    if (!t || !idx || !idx.size) return none;
    const exact = normBox(t) && idx.has(normBox(t)) ? normBox(t) : '';
    const all = [...idx.keys()].filter(b => b.startsWith(t) || b === exact).sort(cmpBox);
    return { list: all.slice(0, max), more: Math.max(all.length - max, 0), exact, one: all.length === 1 ? all[0] : '' };
}

// 글자 인식이 흔히 헷갈리는 글자(사진 후보용). 사용자 지정 O↔0 · I/l↔1 · S↔5 · B↔8 에 Z↔2 · G↔6 · A↔4(손글씨)를 더했다.
// 인식 문자를 대문자로 제한하므로 소문자 l 은 I·L 로 나온다.
const OCR_ALT = { O: ['0'], Q: ['0'], I: ['1'], L: ['1'], S: ['5'], B: ['8'], Z: ['2'], G: ['6'], A: ['4'],
    0: ['O'], 1: ['I', 'L'], 5: ['S'], 8: ['B'], 2: ['Z'], 6: ['G'], 4: ['A'] };
const OCR_MAX_SUBS = 2;      // 한 조각에서 바꿔 보는 글자 수 상한
const OCR_MAX_LEN = 8;       // 이보다 긴 조각(패킹No·날짜 등)은 바꿔 보지 않는다

/** 조각 하나 → 헷갈리는 글자를 OCR_MAX_SUBS 개까지 바꾼 모양들 [{ v, subs }] (원래 모양 포함) */
function ocrVariants(tok) {
    const out = [];
    if (tok.length > OCR_MAX_LEN) return [{ v: tok, subs: 0 }];
    const walk = (i, cur, subs) => {
        if (i === tok.length) { out.push({ v: cur, subs }); return; }
        walk(i + 1, cur + tok[i], subs);
        if (subs < OCR_MAX_SUBS) (OCR_ALT[tok[i]] || []).forEach(a => walk(i + 1, cur + a, subs + 1));
    };
    walk(0, '', 0);
    return out;
}

/**
 * 사진에서 읽은 글자 → 지금 패킹에 있는 박스 번호 후보(점수 높은 순, 최대 max개 — 기본 8).
 *   조각 = 줄·공백·기호(, - / 등)로 나눈 영문+숫자. 'BOX'·'NO' 같은 말 뒤 조각과 글자 전체가 조각 하나인 경우 가산,
 *   헷갈리는 글자를 바꿀 때마다 감점, 'A1~3' 은 양쪽 끝과 펼친 번호, 떨어진 'A' '5' 는 붙여서도, 붙은 'BOXA3' 은 떼어서도 본다.
 * 점수가 같으면 근거가 나은 것 — BOX·NO 말 뒤 > 그 줄에 조각 하나 > 글자 전체가 조각 하나 — 를 앞에(2026-11-27 리뷰).
 * @returns {{ box:string, score:number, fixed:boolean }[]}  fixed = 글자를 바꿔서 맞춘 번호
 */
export function ocrCandidates(text, idx, max = 8) {
    const t = String(text == null ? '' : text).normalize('NFKC').toUpperCase();
    if (!t.trim() || !idx || !idx.size) return [];
    const best = new Map();   // box → { score, ev, fixed }
    let ev = 0;               // 지금 조각의 근거(점수가 같을 때만 쓴다)
    const tryTok = (tok, base) => {
        if (!tok) return;
        ocrVariants(tok).forEach(({ v, subs }) => {
            const b = normBox(v);
            if (!b || !idx.has(b)) return;
            const sc = base - 3 * subs;
            const cur = best.get(b);
            if (!cur || sc > cur.score || (sc === cur.score && ev > cur.ev)) best.set(b, { score: sc, ev, fixed: subs > 0 });
        });
    };
    const lines = t.split(/[\r\n]+/);
    const words = lines.flatMap(l => { const ws = l.split(/[^0-9A-Z~]+/).filter(Boolean); return ws.map(w => ({ w, alone: ws.length === 1 })); });
    words.forEach((x, i) => { if (i > 0 && /^(BOX|NO|CTN|CARTON|C)$/.test(words[i - 1].w)) x.kw = true; });
    const single = words.length === 1;
    words.forEach((x, i) => {
        const base = 10 + (x.kw ? 2 : 0) + (single ? 2 : 0);
        ev = (x.kw ? 4 : 0) + (x.alone ? 2 : 0) + (single ? 1 : 0);
        if (x.w.includes('~')) {
            const sides = x.w.split('~').filter(Boolean);
            sides.forEach((s, j) => tryTok(s, base - (j ? 2 : 1)));
            expandText(x.w).forEach(e => { if (!e.includes('~')) tryTok(e, base - 2); });
        } else {
            tryTok(x.w, base);
            // 붙어 읽힌 것 — 'BOXA3'·'NO12' 는 앞말을 떼고, 'PKA3' 처럼 긴 조각은 끝의 '영문 1~2자+숫자'도(근거 약함 → 감점)
            const kwm = /^(BOX|CTN|CARTON|CNO|NO)([0-9]*[A-Z]{0,2}\d{1,3})$/.exec(x.w);
            if (kwm) tryTok(kwm[2], base + 1);
            if (x.w.length > 3) {
                [/([A-Z]\d{1,3})$/, /([A-Z]{2}\d{1,3})$/].forEach(re => { const tm = re.exec(x.w); if (tm && tm[1] !== x.w) tryTok(tm[1], base - 3); });
            }
        }
        // 'A 5' 처럼 앞글자와 숫자가 떨어져 읽힌 것
        const nx = words[i + 1];
        if (nx && /^[A-Z]{1,2}$/.test(x.w) && /^\d{1,3}$/.test(nx.w)) tryTok(x.w + nx.w, base - 1);
    });
    return [...best.entries()].map(([box, s]) => ({ box, score: s.score, ev: s.ev, fixed: s.fixed }))
        .sort((a, b) => (b.score - a.score) || (b.ev - a.ev) || cmpBox(a.box, b.box)).slice(0, max)
        .map(({ box, score, fixed }) => ({ box, score, fixed }));
}

/** 글자 인식 전 사진 크기 — 긴 변을 1000~1600 px 로(작으면 키우고 크면 줄임). → 배율 */
export function ocrScale(w, h) {
    const long = Math.max(Number(w) || 0, Number(h) || 0);
    if (!long) return 1;
    return Math.min(Math.max(long, 1000), 1600) / long;
}

/**
 * RGBA 픽셀(Uint8ClampedArray, 제자리 변경) → 흑백 + 대비 늘리기(밝기 2%~98% 지점을 0~255 로).
 * 밝기 폭이 아주 좁으면(lo~hi 차 16 미만) 늘리지 않고 흑백만. → { lo, hi }
 */
export function enhanceGray(px) {
    const n = Math.floor(px.length / 4);
    const hist = new Array(256).fill(0);
    for (let i = 0; i < n; i++) {
        const g = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
        px[i * 4] = g; hist[g]++;
    }
    const at = (q) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > q) return v; } return 255; };
    const lo = n ? at(n * 0.02) : 0, hi = n ? at(n * 0.98) : 255;
    const stretch = hi - lo >= 16;
    for (let i = 0; i < n; i++) {
        let g = px[i * 4];
        if (stretch) g = Math.max(0, Math.min(255, Math.round((g - lo) * 255 / (hi - lo))));
        px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = g; px[i * 4 + 3] = 255;
    }
    return { lo, hi };
}
