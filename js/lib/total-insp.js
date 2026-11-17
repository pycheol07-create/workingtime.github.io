// === js/lib/total-insp.js ===
// 전량검수 '진행 목록'의 순수 함수 — import 없음(node --test 대상). 화면·저장은 js/total-inspection-logic.js, 검수이력은 js/ui-history-inspection.js.
//   진행 목록 = artifacts/team-work-logger-v2/total_inspections_accumulated 의 status '진행중' 문서(2026-11-17 사용자 결정).
//   문서 id = totalKey(상품명, 옵션). 상품명 규칙은 샘플검수 개별 추가와 같다(js/lib/insp-manual.js historyId: `/` → `-`).
//   저장 기록 = artifacts/team-work-logger-v2/total_inspection_logs/{saveId} — 검수이력 일자별·상품별·품질 통계·엑셀이 읽는다.
//   완료 = 누적이 총 재고에 닿으면 자동, 또는 사람이 [완료 처리]. [다시 진행]은 같은 회차로 되돌리고, 완료 상품을 다시 넣으면 회차 +1(누적 0).
//   공급처는 코드(supplierCode)만 — 이름 칸은 만들지 않는다(CLAUDE.md 3절).

const str = (v) => (v == null ? '' : String(v));
const int = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
};

export const ON = '진행중';
export const DONE = '완료';
export const ORIGINS = Object.freeze(['manual', 'typed', 'sample']);

/** 상품 이력 문서 id 규칙(js/lib/insp-manual.js historyId 와 같다 — 이 파일은 import 를 쓰지 않아 한 줄을 옮겨 둔다). */
export const nameKey = (name) => str(name).trim().replace(/\//g, '-');

/** 상품명·옵션 사이 구분자 — U+241F(␟). 키를 만들 때 상품명·옵션에서 이 글자를 지우므로 상품명에 나올 수 없다
 *  (리뷰 8, 2026-11-17 — 예전 '__' 는 상품명에 들어갈 수 있어 'A__B'+옵션없음 과 'A'+옵션 'B' 가 같은 키였다). */
export const KEY_SEP = '␟';
const keyPart = (v) => str(v).split(KEY_SEP).join('').trim().replace(/\//g, '-');

/** 진행 목록 문서 id — 상품명(`/`→`-`) + 옵션이 있으면 `␟옵션`(옵션의 `/` 도 `-`). 옵션이 없으면 상품명 그대로. 상품명이 비면 ''.
 *  `/`→`-` 때문에 'S/M' 과 'S-M' 은 같은 키가 된다 — 열 때 문서의 원문과 맞춰 본다(sameProduct). */
export function totalKey(name, option) {
    const n = keyPart(name);
    if (!n) return '';
    const o = keyPart(option);
    return o ? `${n}${KEY_SEP}${o}` : n;
}

/** 문서가 정말 이 상품인가 — 상품명(nameKey 규칙, 옛 문서는 productName)과 옵션 원문(앞뒤 공백 무시)이 같아야 한다.
 *  옛 문서(status 없음)가 옵션 칸을 비워 두었으면 옵션은 보지 않는다. */
export function sameProduct(cur, item) {
    if (!cur || !item) return false;
    const cn = nameKey(cur.name != null && str(cur.name) !== '' ? cur.name : cur.productName);
    if (cn !== nameKey(item.name)) return false;
    const co = str(cur.option).trim();
    if (!co && !cur.status) return true;
    return co === str(item.option).trim();
}

/** 옛 문서(status 없음 — 진행 목록 전) — 진행중으로 보고 빠진 칸만 채운다(누적·총 재고는 그대로). 공급처 이름 칸 supplier 는 지울 대상으로 알려 준다.
 *  @returns {{ patch: object, dropSupplier: boolean }} */
export function fillMissing(cur, item, { reason = '', by = '', now = '' } = {}) {
    const c = cur || {};
    const fresh = newTotalDoc({ ...(item || {}), name: (item && item.name) || c.name || c.productName }, { reason, by, now });
    const patch = {};
    Object.keys(fresh).forEach(k => {
        if (k === 'status') return;
        if (c[k] === undefined || c[k] === null) patch[k] = fresh[k];
    });
    if (c.status !== ON && c.status !== DONE) patch.status = ON;
    if (!str(c.reason).trim() && fresh.reason) patch.reason = fresh.reason;
    if (c.supplierCode != null) { const sc = supplierCodeOnly(c.supplierCode); if (sc !== c.supplierCode) patch.supplierCode = sc; }
    ['accumulatedNormal', 'accumulatedDefective', 'accumulatedTotal', 'totalStock', 'round'].forEach(k => {
        if (c[k] != null && !Number.isFinite(Number(c[k]))) patch[k] = fresh[k];
    });
    if (c.round != null && int(c.round) < 1) patch.round = 1;
    // 누적 합계가 정상+불량과 어긋난 옛 문서는 합으로 맞춘다(그 둘이 있을 때만)
    if (c.accumulatedNormal != null && c.accumulatedDefective != null && c.accumulatedTotal != null
        && int(c.accumulatedNormal) + int(c.accumulatedDefective) !== int(c.accumulatedTotal)) {
        patch.accumulatedTotal = int(c.accumulatedNormal) + int(c.accumulatedDefective);
    }
    return { patch, dropSupplier: Object.prototype.hasOwnProperty.call(c, 'supplier') };
}

/** 공급처는 코드 모양(영문·숫자·-·_ 만, 20자 이하)만 남긴다 — 이름이 섞여 들어오면 빈칸. */
export const supplierCodeOnly = (v) => {
    const s = str(v).trim();
    return /^[A-Za-z0-9_-]{1,20}$/.test(s) ? s : '';
};

/** 새 진행 문서. by = 직원 이름, now = ISO 시각. undefined 칸을 두지 않는다(Firestore 가 거부). */
export function newTotalDoc(item, { reason = '', by = '', now = '' } = {}) {
    const it = item || {};
    return {
        name: nameKey(it.name),
        option: str(it.option).trim(),
        code: str(it.code).trim(),
        location: str(it.location).trim(),
        inboundDate: str(it.inboundDate).trim(),
        supplierCode: supplierCodeOnly(it.supplierCode),
        reason: str(reason).trim(),
        totalStock: 0,
        accumulatedNormal: 0,
        accumulatedDefective: 0,
        accumulatedTotal: 0,
        status: ON,
        round: 1,
        origin: ORIGINS.includes(it.origin) ? it.origin : 'manual',
        createdAt: str(now),
        createdBy: str(by),
        lastDate: '',
        lastDayQty: 0,
        doneAt: '',
        doneBy: '',
    };
}

/** 완료 문서를 다시 넣었다 → 회차 +1, 누적 0, 진행중. 총 재고는 다시 입력(0). 사유가 비면 앞 회차 사유를 그대로 둔다. */
export function reopenRound(cur, item, { reason = '', by = '', now = '' } = {}) {
    const c = cur || {};
    const fresh = newTotalDoc({ ...c, ...(item || {}), name: c.name || (item && item.name) }, { reason: str(reason).trim() || c.reason, by, now });
    ['location', 'inboundDate', 'code', 'supplierCode'].forEach(k => { if (!fresh[k] && c[k]) fresh[k] = k === 'supplierCode' ? supplierCodeOnly(c[k]) : str(c[k]); });
    fresh.round = Math.max(1, int(c.round) || 1) + 1;
    return fresh;
}

/** 목록에 넣기 판정 — 없으면 새로(create), 진행중이면 그 줄 열기(open), 완료면 회차 +1(reopen),
 *  옛 문서(status 없음)는 진행중으로 보고 빠진 칸만 채워 연다(upgrade — merge 로 쓴다), 같은 키의 다른 상품이면 conflict(쓰지 않음).
 *  @returns {{ action: 'create'|'open'|'reopen'|'upgrade'|'conflict', doc: object|null, merge?: boolean, dropSupplier?: boolean }}
 *    doc = 쓸 값(open·conflict 면 null). merge true 면 set(..., { merge: true }). */
export function startOrReopen(cur, item, opts = {}) {
    if (!cur) return { action: 'create', doc: newTotalDoc(item, opts) };
    if (!sameProduct(cur, item)) return { action: 'conflict', doc: null };
    if (cur.status === DONE) return { action: 'reopen', doc: reopenRound(cur, item, opts) };
    if (cur.status !== ON) {
        const f = fillMissing(cur, item, opts);
        return { action: 'upgrade', doc: f.patch, merge: true, dropSupplier: f.dropSupplier };
    }
    return { action: 'open', doc: null };
}

/** 오늘 저장 하나를 서버 값(cur)에 더한다. input: { normal, defective, totalStock, reason, location, inboundDate, date, by, now }
 *  @returns {{ ok: true, patch, accumAfter, done, qty } | { ok: false, error, message }}
 *   error: missing(문서 없음) · done(이미 완료) · reason · stock · qty · over */
export function applySave(cur, input = {}) {
    if (!cur) return { ok: false, error: 'missing', message: '진행 목록에 없는 상품입니다. 목록을 새로 열어 주세요.' };
    if (cur.status === DONE) return { ok: false, error: 'done', message: '이미 완료된 상품입니다. [다시 진행]을 누른 뒤 저장하세요.' };
    const reason = str(input.reason).trim() || str(cur.reason).trim();
    if (!reason) return { ok: false, error: 'reason', message: '검수 사유를 입력해 주세요.' };
    const normal = int(input.normal), defective = int(input.defective);
    if (normal < 0 || defective < 0) return { ok: false, error: 'qty', message: '수량은 0 이상으로 입력해 주세요.' };
    const qty = normal + defective;
    if (qty <= 0) return { ok: false, error: 'qty', message: '오늘 검수 수량을 입력해 주세요.' };
    const totalStock = input.totalStock == null || input.totalStock === '' ? int(cur.totalStock) : int(input.totalStock);
    if (totalStock <= 0) return { ok: false, error: 'stock', message: '총 재고(검수 대상 수량)를 먼저 입력해 주세요.' };
    const accN = int(cur.accumulatedNormal) + normal;
    const accD = int(cur.accumulatedDefective) + defective;
    const accumAfter = accN + accD;
    if (accumAfter > totalStock) {
        return { ok: false, error: 'over', message: `누적(${accumAfter})이 총 재고(${totalStock})를 넘습니다. 총 재고를 먼저 고치세요.` };
    }
    const date = str(input.date);
    const done = accumAfter === totalStock;
    const patch = {
        reason,
        totalStock,
        accumulatedNormal: accN,
        accumulatedDefective: accD,
        accumulatedTotal: accumAfter,
        lastDate: date,
        lastDayQty: (str(cur.lastDate) === date ? int(cur.lastDayQty) : 0) + qty,
        status: done ? DONE : ON,
        doneAt: done ? str(input.now) : '',
        doneBy: done ? str(input.by) : '',
    };
    if (input.location != null) patch.location = str(input.location).trim();
    if (input.inboundDate != null) patch.inboundDate = str(input.inboundDate).trim();
    return { ok: true, patch, accumAfter, done, qty, normal, defective };
}

/** [완료 처리] — 진행중만. */
export function markDone(cur, { by = '', now = '' } = {}) {
    if (!cur) return { ok: false, message: '진행 목록에 없는 상품입니다.' };
    if (cur.status === DONE) return { ok: false, message: '이미 완료된 상품입니다.' };
    return { ok: true, patch: { status: DONE, doneAt: str(now), doneBy: str(by) } };
}

/** [다시 진행] — 완료를 같은 회차·같은 누적으로 되돌린다. */
export function markReopen(cur) {
    if (!cur) return { ok: false, message: '진행 목록에 없는 상품입니다.' };
    if (cur.status !== DONE) return { ok: false, message: '진행 중인 상품입니다.' };
    return { ok: true, patch: { status: ON, doneAt: '', doneBy: '' } };
}

/** [목록에서 빼기] — 1회차이고 누적 0 인 줄만. 2회차 이상은 앞 회차 기록이 있으므로 빼지 않고 [완료 처리]로 닫는다(리뷰 7). */
export const canRemove = (cur) => !!cur && int(cur.accumulatedTotal) === 0 && Math.max(1, int(cur.round) || 1) === 1;

/** 전량 기록 중 이 상품 것만 상품 이력 log 모양으로(검수이력 [상세보기] — 수정 버튼 없음, fromTotalLog). */
export function totalHistoryLogsOf(logs, productName) {
    const id = nameKey(productName);
    return (Array.isArray(logs) ? logs : []).filter(l => l && nameKey(l.name) === id).map(logToHistoryLog);
}

/** 남은 수량(0 아래로 가지 않음)·진행률(%, 총 재고 0 이면 null). extra = 아직 저장 안 한 오늘 입력. */
export function progressOf(cur, extra = 0) {
    const total = int(cur && cur.totalStock);
    const acc = int(cur && cur.accumulatedTotal) + int(extra);
    return {
        total, acc,
        remaining: total > 0 ? Math.max(0, total - acc) : null,
        over: total > 0 && acc > total,
        pct: total > 0 ? Math.min(100, Math.round((acc / total) * 100)) : null,
    };
}

/** 오늘 한 수량 — 문서의 lastDate 가 오늘일 때만. */
export const todayQtyOf = (cur, today) => (cur && str(cur.lastDate) === str(today) ? int(cur.lastDayQty) : 0);

/** 목록 순서 — 진행중 먼저(넣은 순서: createdAt → 이름), 완료는 뒤(최근 완료 먼저). 원본 불변.
 *  rows: [{ id, ...문서 }] */
export function sortList(rows) {
    const arr = (Array.isArray(rows) ? rows : []).filter(Boolean).slice();
    return arr.sort((a, b) => {
        const da = a.status === DONE ? 1 : 0, db = b.status === DONE ? 1 : 0;
        if (da !== db) return da - db;
        if (da) return str(b.doneAt).localeCompare(str(a.doneAt)) || str(a.name).localeCompare(str(b.name), 'ko');
        return str(a.createdAt).localeCompare(str(b.createdAt)) || str(a.name).localeCompare(str(b.name), 'ko') || str(a.option).localeCompare(str(b.option), 'ko');
    });
}

/** 저장한 줄 다음의 진행중 줄 id — 목록 끝이면 처음부터, 자기 말고 없으면 ''. */
export function nextOnKey(sorted, curId) {
    const on = (Array.isArray(sorted) ? sorted : []).filter(r => r && r.status !== DONE);
    if (!on.length) return '';
    const i = on.findIndex(r => r.id === curId);
    if (i === -1) return on[0].id;
    for (let k = 1; k <= on.length; k++) {
        const r = on[(i + k) % on.length];
        if (r.id !== curId) return r.id;
    }
    return '';
}

/** 화면 위 검색칸 — 이름·옵션·코드 부분일치(공백 무시, 대소문자 무시). */
export function filterRows(rows, term) {
    const q = str(term).replace(/\s/g, '').toLowerCase();
    const arr = Array.isArray(rows) ? rows : [];
    if (!q) return arr.slice();
    return arr.filter(r => [r.name, r.option, r.code].some(v => str(v).replace(/\s/g, '').toLowerCase().includes(q)));
}

/** 검색칸 Enter — 딱 맞는 줄(이름·코드가 같음, 또는 후보가 하나) id. 없으면 ''(→ 개별 추가 창). */
export function exactRow(rows, term) {
    const t = str(term).trim();
    if (!t) return '';
    const arr = Array.isArray(rows) ? rows : [];
    const tk = nameKey(t);
    const hit = arr.filter(r => nameKey(r.name) === tk || (str(r.code).trim() && str(r.code).trim() === t));
    if (hit.length >= 1) return hit[0].id;
    const part = filterRows(arr, t);
    return part.length === 1 ? part[0].id : '';
}

/** 저장 기록 한 줄(total_inspection_logs/{saveId}). */
export function logOf({ saveId, date, time, key, cur, res, inspector, at }) {
    const c = cur || {};
    const r = res || {};
    return {
        saveId: str(saveId),
        date: str(date),
        time: str(time),
        key: str(key),
        docId: str(key),
        round: Math.max(1, int(c.round) || 1),
        name: str(c.name),
        option: str(c.option),
        code: str(c.code),
        reason: str(r.patch ? r.patch.reason : c.reason),
        normal: int(r.normal),
        defective: int(r.defective),
        accumAfter: int(r.accumAfter),
        totalStock: int(r.patch ? r.patch.totalStock : c.totalStock),
        inspector: str(inspector),
        at: str(at),
    };
}

/** 기록 → 상품 이력 log 모양(검수이력 화면용 복사본 — product_history 에는 쓰지 않는다). */
export function logToHistoryLog(log) {
    const l = log || {};
    const n = int(l.normal), d = int(l.defective);
    return {
        date: str(l.date),
        time: str(l.time),
        inspectionType: 'total',
        code: str(l.code),
        option: str(l.option),
        inboundQty: n + d,
        sampleQty: n + d,
        defectQty: d,
        status: d > 0 ? '불량' : '정상',
        defects: d > 0 ? ['전량검수 불량'] : [],   // 개수는 defectQty — 품질 통계 '주요 불량'이 같은 글자로 묶이게
        note: str(l.reason),
        inspector: str(l.inspector),
        round: Math.max(1, int(l.round) || 1),
        accumAfter: int(l.accumAfter),
        totalStock: int(l.totalStock),
        fromTotalLog: true,
    };
}

/** 품질 통계 불량 수량 — 전량이면 불량 개수(defectQty), 샘플이면 지금처럼 입고 수량. */
export function logDefectQty(log) {
    const l = log || {};
    if (l.inspectionType === 'total' && l.defectQty != null) return int(l.defectQty);
    return Number(l.inboundQty) || Number(l.qty) || 0;
}

/** product_history 문서들(화면용) + 전량 기록 → 새 배열(원본 불변). 같은 이름(nameKey)의 문서 logs 끝에 붙이고,
 *  문서가 없는 상품은 전량 기록만 가진 화면용 칸(totalOnly: true — 삭제 버튼을 보이지 않는다)을 만든다.
 *  lastInspectionDate 는 더 늦은 날짜로. totalInbound(검수 횟수)는 바꾸지 않는다. */
export function mergeIntoProductHistory(productDocs, logs) {
    const docs = (Array.isArray(productDocs) ? productDocs : []).map(d => ({ ...d }));
    const byId = new Map(docs.map((d, i) => [nameKey(d.id), i]));
    const sorted = (Array.isArray(logs) ? logs : []).filter(l => l && nameKey(l.name))
        .slice().sort((a, b) => (str(a.date) + str(a.time)).localeCompare(str(b.date) + str(b.time)));
    sorted.forEach(l => {
        const id = nameKey(l.name);
        const hl = logToHistoryLog(l);
        let i = byId.get(id);
        if (i === undefined) {
            docs.push({ id, logs: [], totalInbound: 0, lastInspectionDate: '', lastCode: str(l.code), lastOption: str(l.option), totalOnly: true });
            i = docs.length - 1;
            byId.set(id, i);
        }
        const d = docs[i];
        d.logs = [...(Array.isArray(d.logs) ? d.logs : []), hl];
        if (str(hl.date) > str(d.lastInspectionDate)) d.lastInspectionDate = hl.date;
        if (d.totalOnly) { d.lastCode = str(l.code) || d.lastCode; d.lastOption = str(l.option); }
    });
    return docs;
}

/** 작업자 표시 — 이름만. 옛 기록이 이메일이면 memberEmails({이름: 이메일})로 이름을 찾고, 못 찾으면 '-'. */
export function inspectorLabel(v, memberEmails) {
    const s = str(v).trim();
    if (!s || s === 'unknown' || s === 'Unknown') return '-';
    if (!s.includes('@')) return s;
    const low = s.toLowerCase();
    const hit = Object.entries(memberEmails || {}).find(([, e]) => str(e).trim().toLowerCase() === low);
    return hit ? str(hit[0]) : '-';
}

/** 그날 전량 기록(시각 순). */
export function dayRows(logs, date) {
    return (Array.isArray(logs) ? logs : []).filter(l => l && str(l.date) === str(date))
        .slice().sort((a, b) => str(a.time).localeCompare(str(b.time)) || str(a.at).localeCompare(str(b.at)));
}

/** 기록이 있는 날짜 → 건수 Map. */
export function logDates(logs) {
    const m = new Map();
    (Array.isArray(logs) ? logs : []).forEach(l => {
        const d = str(l && l.date);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) m.set(d, (m.get(d) || 0) + 1);
    });
    return m;
}

export const EXCEL_HEADERS = Object.freeze(['날짜', '시각', '유형', '상품코드', '상품명', '옵션', '사유', '정상', '불량', '합계', '누적', '총재고', '남은', '회차', '상태', '작업자']);

/** 엑셀 '전량검수_기록' 한 줄. 상태 = 그 저장 뒤 누적이 총 재고에 닿았으면 완료. */
export function excelRow(log, memberEmails) {
    const l = log || {};
    const n = int(l.normal), d = int(l.defective), acc = int(l.accumAfter), tot = int(l.totalStock);
    return {
        '날짜': str(l.date), '시각': str(l.time), '유형': '전량', '상품코드': str(l.code) || '-', '상품명': str(l.name),
        '옵션': str(l.option) || '-', '사유': str(l.reason) || '-', '정상': n, '불량': d, '합계': n + d, '누적': acc, '총재고': tot,
        '남은': Math.max(0, tot - acc), '회차': Math.max(1, int(l.round) || 1), '상태': tot > 0 && acc >= tot ? DONE : ON,
        '작업자': inspectorLabel(l.inspector, memberEmails),
    };
}

/** 샘플검수에서 고른 줄 → 진행 목록에 넣을 상품(origin 'sample'). 공급처는 코드만. */
export function fromSampleItem(it) {
    const x = it || {};
    const name = nameKey(x.name);
    if (!name) return null;
    return {
        name, option: str(x.option).trim(), code: str(x.code).trim(), location: str(x.location).trim(),
        inboundDate: str(x.inboundDate).trim(), supplierCode: supplierCodeOnly(x.supplierCode), origin: 'sample',
    };
}
