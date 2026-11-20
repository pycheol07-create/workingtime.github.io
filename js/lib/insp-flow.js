// === js/lib/insp-flow.js ===
// 샘플검수 창의 순수 함수 — DOM·Firestore 없음(node --test 대상).
// 판정·저장 규칙은 js/inspection-logic.js 의 saveInspectionAndNext 를 그대로 옮겼다(동작을 바꾸지 않는 것이 원칙).
// 화면 카드 HTML 은 모든 값을 escapeHtml 로 통과시킨다.
import { escapeHtml } from '../utils.js?v=202611201643';
import { isManualOnly, inspTypeLabel } from './insp-manual.js?v=202611201643';

/** 체크리스트 키 — 화면(components/modals-form-inspection.html) 순서. 두께(thickness)는 판정에서 빠진다. */
export const CHECK_KEYS = ['fabric', 'color', 'distortion', 'unraveling', 'finishing', 'zipper', 'button', 'lining', 'pilling', 'dye'];

/** 불량 문자열에 쓰는 이름(원본 labelMap). */
export const LABELS = {
    fabric: '원단', color: '컬러', distortion: '뒤틀림',
    unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
    lining: '안감', pilling: '보풀', dye: '이염', brushed: '기모'
};

/** 기모 — 상품명에 '기모'가 들어간 상품에만 붙는 추가 항목(2026-11-20). CHECK_KEYS 에는 넣지 않는다(다른 상품·옛 기록은 그대로). */
export const BRUSHED_KEY = 'brushed';
/** 상품명에 '기모'가 있나 — '노기모'·'무기모'·'노 기모'(기모 없음)와 '기모노'(옷 이름)는 빼고 본다.
 *  '노기모/기모' 처럼 따로 기모가 또 있으면 기모. */
export function hasBrushed(name) {
    return String(name || '').replace(/[노무]\s*기모|기모노/g, '').includes('기모');
}
/** 이 상품에서 검수할 항목 키(화면 순서) — 기모 상품이면 끝에 brushed. */
export function checkKeysFor(name) {
    return hasBrushed(name) ? [...CHECK_KEYS, BRUSHED_KEY] : CHECK_KEYS;
}

/** 이 값이면 정상(원본 NORMAL_VALUES). 그 밖의 값은 전부 불량으로 센다. */
export const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];

/** '모두 정상' 한 번에 채우기용 — 각 값은 #insp-check-<키> select 의 option value 와 같아야 한다(테스트로 확인). */
export const ALL_NORMAL = {
    fabric: '정상', color: '동일', distortion: '없음', unraveling: '없음', finishing: '양호',
    zipper: '양호', button: '양호', lining: '양호', pilling: '없음', dye: '없음', brushed: '양호'
};

const DONE = '완료';
const str = (v) => (v == null ? '' : String(v));
const isBlank = (v) => v === '' || v == null;

/** 체크리스트 → { defects: ['원단(변경됨)', …], status: '불량'|'정상' }.
 *  원본처럼 객체에 들어 있는 키를 순서대로 보고 thickness 만 건너뛴다. */
export function judge(checklist) {
    const defects = [];
    Object.entries(checklist || {}).forEach(([key, value]) => {
        if (key === 'thickness') return;
        if (!NORMAL_VALUES.includes(value)) {
            defects.push(`${LABELS[key] || key}(${value})`);
        }
    });
    return { defects, status: defects.length > 0 ? '불량' : '정상' };
}

/** 비어 있는 입력 → ['thickness', 'fabric', …] (화면 순서). 원본은 '' 또는 null 을 빈 값으로 봤다. */
export function missingFields({ thickness, checklist, keys = CHECK_KEYS } = {}) {
    const cl = checklist || {};
    const out = [];
    if (isBlank(thickness)) out.push('thickness');
    keys.forEach(k => { if (isBlank(cl[k])) out.push(k); });
    return out;
}

/** from 다음부터 끝까지 → 처음부터 from 까지 한 바퀴 돌며 '완료' 가 아닌 첫 칸. 없으면 -1. */
export function nextPendingIndex(list, from) {
    const arr = Array.isArray(list) ? list : [];
    const n = arr.length;
    if (n === 0) return -1;
    const start = Number.isInteger(from) ? from : -1;
    for (let step = 1; step <= n; step++) {
        const i = (((start + step) % n) + n) % n;
        if (arr[i] && arr[i].status !== DONE) return i;
    }
    return -1;
}

/** 바로 앞 칸(완료 여부와 상관없이, 돌지 않음). 앞이 없으면 -1. */
export function prevIndex(list, from) {
    const n = Array.isArray(list) ? list.length : 0;
    if (n === 0) return -1;
    const f = Number.isInteger(from) ? Math.min(from, n) : 0;
    return f - 1 >= 0 ? f - 1 : -1;
}

/** { done, total, text: '12/30 완료' } */
export function progress(list) {
    const arr = Array.isArray(list) ? list : [];
    const done = arr.filter(it => it && it.status === DONE).length;
    return { done, total: arr.length, text: `${done}/${arr.length} 완료` };
}

/** 같은 검수 기록인지 가르는 열쇠 — 날짜·시각·검수자·출고일·코드·옵션. */
export function logIdentity(log) {
    const l = log || {};
    return [l.date, l.time, l.inspector, l.packingDate, l.code, l.option].map(str).join('|');
}

function lastIndexWhere(arr, pred) {
    for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
    return -1;
}

/** 완료 카드 다시 열기 — 그 항목(출고일·옵션, 둘 다 코드가 있으면 코드까지)과 맞는 마지막 기록의 칸. 없으면 -1.
 *  같은 상품명·출고일의 다른 색상 기록을 수정 대상으로 잡지 않게 옵션을 꼭 본다. */
export function findLogForItem(logs, item) {
    const arr = Array.isArray(logs) ? logs : [];
    const it = item || {};
    const realCode = (c) => { const s = str(c).trim(); return s && s !== '-' ? s : ''; };
    const itemCode = realCode(it.code);
    return lastIndexWhere(arr, l => {
        if (!l || l.packingDate !== it.packingDate) return false;
        if (str(l.option) !== str(it.option)) return false;
        const logCode = realCode(l.code);
        if (itemCode && logCode && itemCode !== logCode) return false;
        return true;
    });
}

/** identity 를 이루는 필드 — 수정 저장 때 옛 값을 그대로 둔다(logIdentity 가 바뀌지 않게). */
const IDENTITY_KEYS = ['date', 'time', 'inspector', 'packingDate', 'code', 'option'];

/** 기록 넣기/바꾸기(원본 배열은 건드리지 않는다).
 *  - editIdentity 가 있으면 그 기록을 { ...옛, ...새 } 로 바꾸되 identity 필드(날짜·시각·검수자·출고일·코드·옵션)와
 *    saveId 는 옛 값을 지킨다. 고친 시각·사람은 editedAt('날짜 시각')·editedBy 로 남긴다. 처리량 차이는 원본 수정 저장 규칙대로
 *    옛 기록의 date 가 today 일 때만(새 sampleQty - 옛), 아니면 0. 못 찾으면 mode 'missing'(배열 그대로).
 *  - 아니면 새 저장: record.saveId 가 있으면 같은 saveId 기록이 있을 때 교체하고 차이만 센다(재시도로 두 번 쌓이지 않게).
 *    saveId 가 없는 호출은 예전처럼 identity 로 본다.
 *  - 둘 다 아니면 끝에 붙이고 qtyDelta = sampleQty.
 *  sampleQty 는 원본처럼 Number(x) || 1. */
export function upsertLog(logs, record, { editIdentity, today } = {}) {
    const arr = Array.isArray(logs) ? [...logs] : [];
    const rec = record || {};
    const qty = (v) => Number(v) || 1;
    const newQty = qty(rec.sampleQty);

    if (editIdentity) {
        const index = lastIndexWhere(arr, l => logIdentity(l) === editIdentity);
        if (index === -1) return { mode: 'missing', logs: arr, index: -1, qtyDelta: 0 };
        const old = arr[index];
        const next = { ...old, ...rec };
        IDENTITY_KEYS.forEach(k => {
            if (k in old) next[k] = old[k]; else delete next[k];
        });
        if ('saveId' in old) next.saveId = old.saveId; else delete next.saveId;
        if (rec.date || rec.time) next.editedAt = [rec.date, rec.time].filter(Boolean).join(' ');
        if (rec.inspector) next.editedBy = rec.inspector;
        arr[index] = next;
        const qtyDelta = old.date === today ? newQty - qty(old.sampleQty) : 0;
        return { mode: 'replace', logs: arr, index, qtyDelta };
    }

    const index = rec.saveId
        ? lastIndexWhere(arr, l => l && l.saveId === rec.saveId)
        : lastIndexWhere(arr, l => logIdentity(l) === logIdentity(rec));
    if (index !== -1) {
        const old = arr[index];
        arr[index] = { ...old, ...record };
        return { mode: 'replace', logs: arr, index, qtyDelta: newQty - qty(old.sampleQty) };
    }
    arr.push(record);
    return { mode: 'append', logs: arr, index: arr.length - 1, qtyDelta: newQty };
}

/** 새 저장 때 defectSummary 에 '오늘: 불량, 불량' 한 줄을 더한다(원본 arrayUnion 처럼 이미 있으면 안 넣음). */
export function addDefectSummary(prev, today, defects) {
    const arr = Array.isArray(prev) ? [...prev] : [];
    if (!Array.isArray(defects) || defects.length === 0) return arr;
    const s = `${today}: ${defects.join(', ')}`;
    if (!arr.includes(s)) arr.push(s);
    return arr;
}

/** 기록 전체로 defectSummary 다시 만들기(원본 수정 저장). */
export function defectSummaryOf(logs) {
    return (Array.isArray(logs) ? logs : [])
        .filter(l => l && l.defects && l.defects.length > 0)
        .map(l => `${l.date}: ${l.defects.join(', ')}`);
}

/** 입고 횟수 = 기록 날짜 종류 수('사전등록' 제외). 원본 getUniqueInboundCount 그대로. */
export function uniqueInboundCount(logs) {
    const validDates = logs.map(l => l.date).filter(d => d && !d.includes('사전등록'));
    return new Set(validDates).size;
}

/** 고른 줄의 열쇠 — 리스트가 바뀌어 칸 번호가 밀려도 같은 줄을 다시 찾는다(relocateIndex). */
export function itemKey(item) {
    if (!item) return null;
    return { name: str(item.name), option: str(item.option), packingDate: str(item.packingDate) };
}

/** 리스트가 바뀐 뒤(패킹 카드가 끼어듦·다른 기기 추가 등) 고른 줄의 지금 칸 번호. 원본 불변, 못 찾으면 -1.
 *  ① index 칸이 열쇠(상품명+옵션+출고일)와 같으면 그대로 ② 같은 열쇠의 첫 칸
 *  ③ 상품명+옵션만 같은 첫 칸 — 개별 추가 줄이 패킹 카드로 바뀌며 출고일이 생긴 경우(js/lib/insp-manual.js mergePackCards).
 *  열쇠가 없으면(예전 호출) index 를 그대로 돌려준다(범위 밖이면 -1). */
export function relocateIndex(list, index, key) {
    const arr = Array.isArray(list) ? list : [];
    const inRange = Number.isInteger(index) && index >= 0 && index < arr.length;
    if (!key) return inRange ? index : -1;
    const same = (it) => it && str(it.name) === key.name && str(it.option) === key.option;
    const exact = (it) => same(it) && str(it.packingDate) === key.packingDate;
    if (inRange && exact(arr[index])) return index;
    const i = arr.findIndex(exact);
    if (i !== -1) return i;
    // ③ 은 출고일이 비어 있던 줄(개별 추가)에만 — 출고일이 있는 줄을 다른 출고분 줄로 옮기면 검수 안 한 줄이 완료로 찍힌다
    if (key.packingDate !== '') return -1;
    if (inRange && same(arr[index])) return index;
    return arr.findIndex(same);
}

/** 저장 트랜잭션용 — 서버 리스트에서 고른 줄을 열쇠로 다시 찾아(relocateIndex) 그 칸에 완료·수량을 반영한다.
 *  화면 칸 번호(args.index)는 힌트로만 쓴다(서버 리스트는 패킹 카드가 끼어들어 번호가 다를 수 있다).
 *  못 찾으면 missing: true(부르는 쪽이 저장을 막는다). 원본 불변.
 *  @returns {{ list, changed, index, missing }} */
export function applyDoneByKey(list, key, args = {}) {
    const at = relocateIndex(list, args.index, key);
    if (at === -1) return { list: Array.isArray(list) ? [...list] : [], changed: false, index: -1, missing: true };
    return { ...applyDoneToList(list, { ...args, index: at }), missing: false };
}

/** 줄 열쇠(상품명+옵션+출고일, itemKey)가 같은 칸에만 set 을 덮는다(원본 불변) — 서버 값을 읽은 트랜잭션 안에서
 *  '내가 바꾼 칸'만 다시 적용할 때 쓴다(검수이력 샘플 수량 맞추기 등). 값이 이미 같으면 건드리지 않는다.
 *  @param patches [{ key: itemKey(...), set: { 칸: 값 } }]  @returns {{ list, changed: number }} */
export function patchItemsByKey(list, patches) {
    const arr = Array.isArray(list) ? [...list] : [];
    let changed = 0;
    (Array.isArray(patches) ? patches : []).forEach(p => {
        const k = p && p.key;
        if (!k || !p.set) return;
        const i = arr.findIndex(it => it && str(it.name) === k.name && str(it.option) === k.option && str(it.packingDate) === k.packingDate);
        if (i === -1) return;
        const cur = arr[i];
        if (Object.keys(p.set).every(f => cur[f] === p.set[f])) return;
        arr[i] = { ...cur, ...p.set };
        changed++;
    });
    return { list: arr, changed };
}

/** 저장 뒤 대기 리스트에 완료·수량을 반영(원본 배열 불변).
 *  index 칸이 name+option 과 맞을 때만 그 칸을 쓰고, 아니면 name+option+packingDate 로 첫 칸을 찾는다.
 *  name 비교는 원본처럼 항목의 name 또는 code. 수량 규칙은 원본 그대로:
 *  sampleQty = Number||1, inboundQty·qty = Number(inboundQty) || 항목 qty || 0. 수정(editing)이면 상태는 안 바꾼다. */
export function applyDoneToList(list, { index, name, option, packingDate, sampleQty, inboundQty, editing } = {}) {
    const arr = Array.isArray(list) ? [...list] : [];
    const nameHit = (it) => it && (it.name === name || it.code === name);
    const optHit = (it) => str(it.option) === str(option);

    let at = -1;
    if (Number.isInteger(index) && index >= 0 && index < arr.length && nameHit(arr[index]) && optHit(arr[index])) {
        at = index;
    } else {
        at = arr.findIndex(it => nameHit(it) && optHit(it) && it.packingDate === packingDate);
    }
    if (at === -1) return { list: arr, changed: false, index: -1 };

    const old = arr[at];
    const next = {
        ...old,
        sampleQty: Number(sampleQty) || 1,
        inboundQty: Number(inboundQty) || old.qty || 0,
        qty: Number(inboundQty) || old.qty || 0
    };
    if (!editing) next.status = DONE;
    arr[at] = next;
    return { list: arr, changed: true, index: at };
}

/** 대기 리스트 카드 한 장. 원본 renderTodoList 와 같은 정보 + data-index(클릭 위임용, 원본 리스트 창과 같은 속성). */
/** opts.showReserve — 비축 로케이션도 보인다('새창으로 보기' 창만. 한 상품에 여러 곳이라 기본 리스트에서는 뺀다) */
// ── 샘플 피킹 체크(새창으로 보기, 2026-11-04) ─────────────────────────────
//   daily_data/{오늘}.inspPicked = { <pickKey>: { at, by } } — 리스트(inspectionList)와 따로 저장해 검수 저장과 덮어쓰지 않는다.

/** 피킹 체크 키 — 상품명|옵션|출고일의 짧은 해시(맵 키에 특수문자가 안 들어가게). 같은 리스트 항목이면 늘 같다. */
export function pickKey(item) {
    const it = item || {};
    const s = `${str(it.name)}|${str(it.option)}|${str(it.packingDate)}`;
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
        h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return 'p' + h1.toString(36) + h2.toString(36);
}

/** 가져왔나 — picked = inspPicked 맵 */
export const isPicked = (item, picked) => !!(picked && typeof picked === 'object' && picked[pickKey(item)]);

/** { done, total } — 리스트 전체 기준 */
export function pickProgress(list, picked) {
    const l = Array.isArray(list) ? list : [];
    return { done: l.filter(it => isPicked(it, picked)).length, total: l.length };
}

/** 제작/사입 구분(패킹 목록 src — 패킹 단위) → 정렬 순위. 제작 먼저, 혼합, 사입, 모름(엑셀 업로드 등) 순 */
const SOURCE_RANK = { '제작': 0, '혼합': 1, '사입': 2 };
export const sourceRank = (src) => (Object.prototype.hasOwnProperty.call(SOURCE_RANK, str(src)) ? SOURCE_RANK[str(src)] : 3);
/** 새창 묶음 순위 — 개별 추가 줄(패킹 전, js/lib/insp-manual.js isManualOnly)은 모름 뒤 맨 마지막(2026-11-17 사용자 결정) */
const groupRank = (it) => (isManualOnly(it) ? 4 : sourceRank(it && it.source));

/** 새창 정렬 기준(2026-11-04) — 값 → [보기 이름, 항목 → 비교 글자]. 빈 글자는 늘 뒤로. '' = 리스트 순서 */
const noDash = (v) => { const s = str(v).trim(); return s === '-' ? '' : s; };
const firstOf = (v) => noDash(str(v).split(',')[0]);
export const WINDOW_SORTS = Object.freeze({
    '':       ['리스트 순서', null],
    loc:      ['로케이션순', (it) => firstOf(it.location)],
    reserve:  ['비축 위치순', (it) => firstOf(it.reserveLocation)],
    name:     ['상품명순', (it) => [str(it.name).trim(), noDash(it.option)].filter(Boolean).join(' ')],
    code:     ['상품코드순', (it) => noDash(it.code)],
    date:     ['출고일순', (it) => noDash(it.packingDate)],
    supplier: ['공급처순', (it) => noDash(it.supplierCode || it.supplierName)]   // 엑셀 리스트는 공급처 코드가 없다(정렬에만 씀),
});
export const windowSortOf = (v) => (Object.prototype.hasOwnProperty.call(WINDOW_SORTS, str(v)) ? str(v) : '');

/** 새창 카드 순서 — [{item, idx}] (idx = 원래 리스트 위치, 선택은 이걸로).
 *  groupSource(기본 켬)면 먼저 제작 → 혼합 → 사입 → 모름 → 개별 추가 순으로 묶는다. 그 안에서 sortBy(WINDOW_SORTS) 자연 정렬(빈 값은 뒤), 같으면 원래 순서.
 *  byLoc 은 예전 이름(= sortBy 'loc'). tab: 'todo'(피킹 전) | 'done'(피킹됨) | 없음(전부) */
export function windowOrder(list, picked, { byLoc = false, sortBy, groupSource = true, tab = null, onlyUnpicked = false } = {}) {
    let rows = (Array.isArray(list) ? list : []).map((item, idx) => ({ item, idx }));
    if (onlyUnpicked || tab === 'todo') rows = rows.filter(r => !isPicked(r.item, picked));
    else if (tab === 'done') rows = rows.filter(r => isPicked(r.item, picked));
    const key = WINDOW_SORTS[windowSortOf(sortBy === undefined ? (byLoc ? 'loc' : '') : sortBy)][1];
    rows.sort((a, b) => {
        if (groupSource) {
            const sr = groupRank(a.item) - groupRank(b.item);
            if (sr) return sr;
        }
        if (key) {
            const ka = key(a.item || {}), kb = key(b.item || {});
            if (!ka !== !kb) return ka ? -1 : 1;
            const c = ka.localeCompare(kb, 'ko', { numeric: true });
            if (c) return c;
        }
        return a.idx - b.idx;
    });
    return rows;
}

export function todoCardHtml(item, idx, opts = {}) {
    const it = item || {};
    const isCompleted = it.status === DONE;
    const statusBadge = isCompleted
        ? '<span class="text-[11px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">완료</span>'
        : '<span class="text-[11px] font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">대기</span>';
    // 제작/사입 구분(패킹 목록 src). 모르면(엑셀 업로드 등) 표시 안 함
    const SRC_CLS = { '제작': 'text-indigo-700 bg-indigo-50', '사입': 'text-amber-800 bg-amber-50', '혼합': 'text-gray-700 bg-gray-100' };
    const srcBadge = Object.prototype.hasOwnProperty.call(SRC_CLS, str(it.source))
        ? `<span class="text-[11px] font-bold ${escapeHtml(SRC_CLS[str(it.source)])} px-1.5 py-0.5 rounded-full whitespace-nowrap">${escapeHtml(it.source)}</span>`
        : '';
    // 개별 추가 줄(origin 'manual') — 유형 이름(샘플(개별)·요청확인, 검수이력 '유형' 칸과 같은 이름). 패킹 카드로 바뀐 뒤에도 남는다
    const manualBadge = it.origin === 'manual'
        ? `<span class="text-[11px] font-bold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">${escapeHtml(inspTypeLabel(it))}</span>`
        : '';
    const locationInfo = it.location ? `<span class="text-indigo-700 font-bold bg-indigo-50 px-1 rounded">위치 ${escapeHtml(it.location)}</span>` : '';
    const reserveInfo = opts.showReserve && it.reserveLocation ? `<span class="text-amber-800 font-bold bg-amber-50 px-1 rounded">비축 ${escapeHtml(it.reserveLocation)}</span>` : '';
    const sampleInfo = it.sampleLocation ? `<span class="text-red-700 font-bold bg-red-50 px-1 rounded">샘플: ${escapeHtml(it.sampleLocation)}</span>` : '';
    const dateInfo = it.packingDate ? `<span class="text-gray-600 font-medium">출고: ${escapeHtml(String(it.packingDate).slice(2))}</span>` : '';
    const cls = `transition cursor-pointer px-3 py-2.5 min-h-[44px] ${isCompleted ? 'bg-gray-50 hover:bg-gray-100' : 'hover:bg-blue-50'}${opts.pickable ? ' flex items-stretch gap-2' : ''}`;
    // 피킹 체크 버튼(새창 — opts.pickable). 누르면 체크만 하고 상세로 가지 않는다(js/inspection-logic.js bindCardDelegation 이 data-pick-toggle 은 건너뜀)
    const pickBtn = opts.pickable
        ? `<button type="button" data-pick-toggle="${escapeHtml(idx)}" aria-pressed="${opts.picked ? 'true' : 'false'}" title="${opts.picked ? '가져옴 — 누르면 해제' : '샘플을 가져왔으면 누르세요'}"
                style="${opts.picked ? 'background-color:var(--c-ok-strong);border-color:var(--c-ok-strong);color:#fff;' : ''}"
                class="shrink-0 self-center w-16 min-h-[52px] rounded-lg border-2 flex flex-col items-center justify-center text-[11px] font-bold transition ${opts.picked ? '' : 'bg-white border-gray-300 text-gray-500'}">
                <span class="text-xl leading-none">${opts.picked ? '☑' : '☐'}</span>가져옴</button>`
        : '';
    return `<div class="${cls}" data-index="${escapeHtml(idx)}" data-status="${isCompleted ? 'done' : 'todo'}" role="button" tabindex="0">${opts.pickable ? '<div class="min-w-0 flex-1">' : ''}
            <div class="flex items-center gap-2">
                <span class="font-bold text-[13px] text-gray-800 whitespace-nowrap tabular-nums">${escapeHtml(it.code)}</span>
                ${srcBadge}${manualBadge}${statusBadge}
            </div>
            <div class="font-bold text-gray-900 text-sm mt-0.5 break-words">${escapeHtml(it.name)}</div>
            ${it.option ? `<div class="text-[11px] font-medium text-gray-600 mt-0.5 break-words">옵션: ${escapeHtml(it.option)}</div>` : ''}
            <div class="text-[12px] mt-1 flex flex-wrap gap-1 items-center">${locationInfo}${reserveInfo}${sampleInfo}${dateInfo}</div>${opts.pickable ? `</div>${pickBtn}` : ''}
        </div>`;
}

/** 오늘 검수 완료 목록 한 줄(원본 renderTodayInspectionList 의 행 정보: 상품명·입고/출고일·판정·불량·메모·시각). */
export function doneCardHtml(item) {
    const it = item || {};
    const ok = it.status === '정상';
    const statusBadge = ok
        ? '<span class="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold">정상</span>'
        : '<span class="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-bold">불량</span>';
    const defects = Array.isArray(it.defects) ? it.defects : [];
    let detail = it.note ? escapeHtml(it.note) : '';
    if (defects.length > 0) {
        detail = `<span class="text-red-600 font-bold">${escapeHtml(defects.join(', '))}</span> ` + detail;
    }
    if (!detail) detail = '<span class="text-gray-300">-</span>';
    return `<div class="bg-white border-b px-3 py-2 min-h-[44px]">
            <div class="flex items-center justify-between gap-2">
                <span class="font-medium text-gray-900 text-sm break-words">${escapeHtml(it.productName)}</span>
                <span class="text-gray-500 text-xs font-mono whitespace-nowrap">${escapeHtml(it.time)}</span>
            </div>
            <div class="text-xs text-gray-600 mt-0.5">${escapeHtml(it.inboundDate || '-')}</div>
            <div class="text-sm mt-1">${statusBadge} <span class="ml-1 text-xs">${detail}</span></div>
        </div>`;
}

/** 검수 사진 Storage 경로. */
export function inspPhotoPath(dateStr, nowMs, rand) {
    return `inspection/images/${dateStr}/${nowMs}_${rand}.jpg`;
}

/** data: URL(아직 올리지 않은 base64 사진)인지. */
export function isDataUrl(src) {
    return typeof src === 'string' && /^data:/i.test(src);
}
