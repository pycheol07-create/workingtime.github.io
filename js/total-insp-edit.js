// === js/total-insp-edit.js ===
// 데이터관리(검수이력) 전량검수 기록 [수정]·[삭제]·리스트 삭제(2026-11-17 사용자 요청 "전량검수 건은 수정이나 삭제가 안 된다").
//   기록 = artifacts/team-work-logger-v2/total_inspection_logs/{saveId}, 누적 = total_inspections_accumulated/{key}.
//   모두 runTransaction — 기록·누적·그날 처리량 문서를 서버 값으로 읽고 차이만 반영한다(다른 기기 저장과 겹쳐도 서버 값 기준).
//   · 같은 회차(round) 기록만 누적에 반영, 다른 회차면 기록만 고친다. 누적 문서가 없으면(목록에서 지워짐) 기록만.
//     수정하면 같은 누적·같은 회차의 뒤 기록들 accumAfter 도 같은 트랜잭션에서 차이만큼 고친다(리뷰 4).
//   · 처리량 '전량검수'(tName(TASK.full)): 지난 날은 history/{날짜}, 오늘은 history/{오늘} 이 있으면(마감됨) history, 없으면 daily_data/{오늘}.
//     history 에 마감 시각(closedAt)이 있고 기록 저장 시각(at)이 그보다 늦으면 마감 뒤 저장이라 daily_data(lib/total-insp.js qtyTarget, 리뷰 1).
//     마감은 처리량을 history 문서 맨 위 taskQuantities 맵에 옮긴다(js/history-data-manager.js). 0 밑으로 안 내려가게 읽고 쓴다. 문서가 없으면 건너뛰고 알린다.
//   · 리스트 삭제(날짜·상품)는 누적 문서별로, 한 트랜잭션 150건씩(문서 한도 500) 나눠 처리하고 실패하면 몇 건 반영됐는지 돌려준다.
//     상품 삭제의 누적 문서는 목록을 읽은 뒤 lastUpdated 가 바뀌었으면(그사이 저장됨) 지우지 않는다(리뷰 3).
//   권한은 데이터관리 화면 그대로(규칙: artifacts/{colId} 직원 쓰기). 순수 규칙은 js/lib/total-insp.js.
// ⚠️ history.html 에 붙는다 — role="dialog"·data-act·end-shift-* 를 쓰지 않는다. 고객 이름·연락처·주문번호를 적을 칸을 만들지 않는다(사유는 안내 표시).
import * as State from './state.js?v=202611201435';
import { getTodayDateString, escapeHtml } from './utils.js?v=202611201435';
import {
    doc, getDoc, collection, query, where, getDocs, runTransaction, serverTimestamp, limit as fsLimit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { TASK, tName } from './task-names.js?v=202611201435';
import {
    editLogPlan, deleteLogsPlan, clampQty, chunkByKey, nameKey, ymd, bulkSummary, qtyGroups, laterLogsPatch, accChangedSince,
    removePlan, revertCheck, markDone, markReopen
} from './lib/total-insp.js?v=202611201435';

const APP = ['artifacts', 'team-work-logger-v2'];
const CHUNK = 150;
const LATER_MAX = 300;   // 수정 때 함께 고칠 뒤 기록 수 상한(트랜잭션 문서 한도)
const logsCol = () => collection(State.db, ...APP, 'total_inspection_logs');
const accCol = () => collection(State.db, ...APP, 'total_inspections_accumulated');
const logRef = (id) => doc(State.db, ...APP, 'total_inspection_logs', id);
const accRef = (key) => doc(State.db, ...APP, 'total_inspections_accumulated', key);
const dayRef = (kind, date) => doc(State.db, ...APP, kind, date);
const me = () => String((State.appState && State.appState.currentUser) || '');
const keyOf = (l) => String((l && (l.key || l.docId)) || '');
const msOf = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);

/** 데이터관리 화면이 들고 있는 이력(State.allHistoryData)의 그날 처리량도 맞춘다(다시 읽기 전까지 표가 옛 숫자를 보이지 않게).
 *  daily_data(오늘, 마감 전)는 오늘 문서 구독이 바꾼다. */
function patchLocalQty(kind, date, task, value) {
    if (kind !== 'history') return;
    const day = (State.allHistoryData || []).find(d => d && d.id === date);
    if (!day) return;
    if (!day.taskQuantities || typeof day.taskQuantities !== 'object') day.taskQuantities = {};
    day.taskQuantities[task] = value;
}

/** 트랜잭션 안(쓰기 전에): 날짜마다 history 문서, 오늘이면 daily_data 문서도 읽는다.
 *  @returns {{ hist: Object<date,{exists,closedAt}>, snaps: Map<'kind|date', snap> }} */
async function readQtyDocs(tx, dates, today) {
    const list = [];
    [...new Set(dates)].forEach(d => {
        list.push(['history', d]);
        if (d === today) list.push(['daily_data', d]);
    });
    const got = await Promise.all(list.map(([k, d]) => tx.get(dayRef(k, d))));
    const snaps = new Map(), hist = {};
    list.forEach(([k, d], i) => {
        snaps.set(`${k}|${d}`, got[i]);
        if (k === 'history') hist[d] = { exists: got[i].exists(), closedAt: got[i].exists() ? String((got[i].data() || {}).closedAt || '') : '' };
    });
    return { hist, snaps };
}

/** 트랜잭션 안: 묶인 차이(qtyGroups 결과)를 처리량에 쓴다. @returns {{ applied: Array<[kind, date, value]>, missing: string[] }} */
function writeQty(tx, snaps, groups, task) {
    const applied = [], missing = [];
    Object.keys(groups).forEach(k => {
        const [kind, date] = k.split('|');
        const sn = snaps.get(k);
        if (!sn || !sn.exists()) { missing.push(date); return; }
        const value = clampQty(((sn.data() || {}).taskQuantities || {})[task], groups[k]);
        // set+merge 중첩 맵 — 업무 이름의 점이 경로로 쪼개지지 않는다(tests/task-qty-fieldpath.test.js)
        tx.set(dayRef(kind, date), { taskQuantities: { [task]: value } }, { merge: true });
        applied.push([kind, date, value]);
    });
    return { applied, missing };
}

/** 기록 하나 [수정] — input { normal, defective, reason }.
 *  트랜잭션 전에 같은 누적(key)의 기록 id 를 모으고(뒤 기록 accumAfter 용), 트랜잭션 안에서 tx.get 으로 다시 읽는다(읽기 → 쓰기).
 *  @returns {{ ok: true, accMissing, otherRound, qtyMissing: string[] } | { ok: false, message }} */
export async function editTotalLog(saveId, input) {
    const today = getTodayDateString();
    const task = tName(TASK.full);
    const by = me(), now = new Date().toISOString();
    const first = await getDoc(logRef(saveId));
    if (!first.exists()) return { ok: false, message: '기록이 없습니다(이미 지워졌을 수 있습니다).' };
    const k0 = keyOf(first.data());
    const siblingIds = [];
    if (k0) {
        const qs = await getDocs(query(logsCol(), where('key', '==', k0)));
        qs.forEach(d => { if (d.id !== saveId && siblingIds.length < LATER_MAX) siblingIds.push(d.id); });
    }
    const out = await runTransaction(State.db, async (tx) => {
        const lsnap = await tx.get(logRef(saveId));
        if (!lsnap.exists()) return { ok: false, message: '기록이 없습니다(이미 지워졌을 수 있습니다).' };
        const log = { id: saveId, ...lsnap.data() };
        const key = keyOf(log);
        const asnap = key ? await tx.get(accRef(key)) : null;
        const sibSnaps = await Promise.all(siblingIds.map(id => tx.get(logRef(id))));
        const date = ymd(log.date);
        const q = await readQtyDocs(tx, date ? [date] : [], today);
        const cur = asnap && asnap.exists() ? asnap.data() : null;
        const plan = editLogPlan(log, cur, input, { date: today, by, now });
        if (!plan.ok) return { ok: false, message: plan.message };
        // ── 쓰기 ──
        tx.update(logRef(saveId), plan.logPatch);
        const sibs = [];
        sibSnaps.forEach((sn, i) => { if (sn.exists()) sibs.push({ id: siblingIds[i], ...sn.data() }); });
        laterLogsPatch(log, sibs, plan.qtyDelta).forEach(p => tx.update(logRef(p.id), { accumAfter: p.accumAfter }));
        if (plan.accPatch) tx.update(accRef(key), { ...plan.accPatch, lastUpdated: serverTimestamp() });
        const groups = qtyGroups(date ? [{ date, at: log.at, delta: plan.qtyDelta }] : [], today, q.hist);
        const w = writeQty(tx, q.snaps, groups, task);
        return { ok: true, accMissing: !cur, otherRound: !!cur && !plan.affectsAcc, qty: w };
    });
    if (out.ok) out.qty.applied.forEach(([k, d, v]) => patchLocalQty(k, d, task, v));
    return out.ok ? { ok: true, accMissing: out.accMissing, otherRound: out.otherRound, qtyMissing: out.qty.missing } : out;
}

/** 같은 누적 문서(key)의 기록 묶음(최대 CHUNK 건) 삭제 — 기록을 서버에서 다시 읽고(없는 건 건너뜀) 누적·처리량에서 뺀다.
 *  key 가 '' 이면 첫 기록의 key(한 건 삭제용). 트랜잭션은 다시 돌 수 있으므로 key 는 그때마다 새로 정한다. */
async function deleteChunk(givenKey, ids, { skipAcc = false } = {}) {
    const today = getTodayDateString();
    const task = tName(TASK.full);
    const by = me(), now = new Date().toISOString();
    const out = await runTransaction(State.db, async (tx) => {
        let key = givenKey;
        const lsnaps = await Promise.all(ids.map(id => tx.get(logRef(id))));
        const logs = [];
        lsnaps.forEach((sn, i) => { if (sn.exists()) logs.push({ id: ids[i], ...sn.data() }); });
        if (!logs.length) return { deleted: 0, qty: { applied: [], missing: [] }, accMissing: false };
        key = key || keyOf(logs[0]);   // 화면이 key 를 모르면(기록 하나 삭제) 서버 값의 key
        // skipAcc — 상품 삭제는 누적 문서를 곧 지우므로 고치지 않는다(lastUpdated 를 건드리지 않아 '그사이 저장됨' 비교가 맞다)
        const asnap = key && !skipAcc ? await tx.get(accRef(key)) : null;
        const cur = asnap && asnap.exists() ? asnap.data() : null;
        const plan = deleteLogsPlan(cur, logs, { date: today, by, now });
        const q = await readQtyDocs(tx, logs.map(l => ymd(l.date)).filter(Boolean), today);
        // ── 쓰기 ──
        logs.forEach(l => tx.delete(logRef(l.id)));
        if (cur && plan.accPatch) tx.update(accRef(key), { ...plan.accPatch, lastUpdated: serverTimestamp() });
        // 처리량 — 기록마다 저장 시각으로 문서를 고른다(오늘 마감 전·후가 섞일 수 있다)
        const groups = qtyGroups(logs.map(l => ({ date: l.date, at: l.at, delta: -((Number(l.normal) || 0) + (Number(l.defective) || 0)) })), today, q.hist);
        const w = writeQty(tx, q.snaps, groups, task);
        return { deleted: logs.length, qty: w, accMissing: !skipAcc && !cur };
    });
    out.qty.applied.forEach(([k, d, v]) => patchLocalQty(k, d, task, v));
    return out;
}

/** 기록 묶음 삭제(누적 문서별로 나눠서). @returns {{ ok, deleted, total, qtyMissing: string[], accMissing: number, message? }} */
async function deleteLogs(logs, opts = {}) {
    const chunks = chunkByKey(logs, CHUNK);
    const noKey = (Array.isArray(logs) ? logs : []).filter(l => l && !keyOf(l));
    if (noKey.length) chunks.push(...[...Array(Math.ceil(noKey.length / CHUNK)).keys()].map(i => ({ key: '', logs: noKey.slice(i * CHUNK, (i + 1) * CHUNK) })));
    const total = chunks.reduce((a, c) => a + c.logs.length, 0);
    let deleted = 0, accMissing = 0;
    const qtyMissing = new Set();
    for (const c of chunks) {
        try {
            const r = await deleteChunk(c.key, c.logs.map(l => l.id || l.saveId).filter(Boolean), opts);
            deleted += r.deleted;
            if (r.accMissing && r.deleted) accMissing++;
            r.qty.missing.forEach(d => qtyMissing.add(d));
        } catch (e) {
            console.error('[전량검수 기록] 삭제 실패:', e && e.code ? e.code : e);
            return { ok: false, deleted, total, qtyMissing: [...qtyMissing], accMissing,
                message: e && e.code === 'permission-denied' ? '삭제할 권한이 없습니다.' : `삭제하다 멈췄습니다 — ${deleted}건 반영, ${total - deleted}건 남음. 다시 눌러 주세요.` };
        }
    }
    return { ok: true, deleted, total, qtyMissing: [...qtyMissing], accMissing };
}

/** 기록 하나 [삭제] — key 는 트랜잭션 안에서 서버 기록으로 정한다. */
export async function deleteTotalLog(saveId) {
    return deleteLogs([{ id: String(saveId) }]);
}

/** 그 날짜 전량 기록(서버에서 다시 읽음) — 확인창 요약과 삭제가 같은 목록을 쓴다. */
export async function listDayLogs(date) {
    const sn = await getDocs(query(logsCol(), where('date', '==', String(date))));
    const logs = [];
    sn.forEach(d => logs.push({ id: d.id, ...d.data() }));
    return { logs, summary: bulkSummary(logs) };
}

/** 그 상품(상품명 규칙 nameKey)의 전량 기록 전부 + 누적 문서(서버에서 다시 읽음).
 *  accStamps = 누적 문서의 lastUpdated(ms) — 지울 때 그사이 저장됐는지 본다(리뷰 3). */
export async function listProductLogs(name) {
    const nk = nameKey(name);
    const [ls, as] = await Promise.all([
        getDocs(query(logsCol(), where('name', '==', nk))),
        getDocs(query(accCol(), where('name', '==', nk))),
    ]);
    const logs = [], accKeys = [], accStamps = {};
    ls.forEach(d => logs.push({ id: d.id, ...d.data() }));
    as.forEach(d => { accKeys.push(d.id); accStamps[d.id] = msOf((d.data() || {}).lastUpdated); });
    return { logs, accKeys, accStamps, summary: bulkSummary(logs) };
}

/** [이 날 전량검수 삭제]. */
export async function deleteTotalDay(logs) {
    return deleteLogs(logs);
}

/** [전량검수 기록 삭제](상품) — 기록 전부를 지운 뒤(누적은 고치지 않음) 누적 문서도 지운다. 그사이 새 기록이 생겼으면 그것도(최대 2번 더).
 *  누적 문서는 목록을 읽을 때의 lastUpdated(accStamps)와 지금 값이 다르면(다른 기기가 그사이 저장 — 총 재고만 저장 포함) 지우지 않고 알린다(리뷰 3).
 *  @returns {{ ok, deleted, total, accDeleted, accSkipped, qtyMissing, message? }} */
export async function deleteTotalProduct(name, logs, accKeys, accStamps = {}) {
    let res = await deleteLogs(logs, { skipAcc: true });
    if (!res.ok) return res;
    const stamps = { ...(accStamps || {}) };
    const keys = [...(accKeys || [])];
    for (let i = 0; i < 2; i++) {
        const again = await listProductLogs(name);
        again.accKeys.forEach(k => { if (!keys.includes(k)) { keys.push(k); stamps[k] = again.accStamps[k]; } });
        if (!again.logs.length) break;
        // 새 기록이 생겼다 = 그 누적에 다른 기기가 저장했다 — 기록은 지우되 누적 비교는 처음 값 그대로(지우지 않고 알림)
        const r = await deleteLogs(again.logs, { skipAcc: true });
        res = { ...r, deleted: res.deleted + r.deleted, total: res.total + r.total, qtyMissing: [...new Set([...res.qtyMissing, ...r.qtyMissing])] };
        if (!r.ok) return res;
    }
    let accDeleted = 0, accSkipped = 0;
    for (const key of keys) {
        try {
            const r = await runTransaction(State.db, async (tx) => {
                const sn = await tx.get(accRef(key));
                if (!sn.exists()) return 'gone';
                if (accChangedSince(stamps[key], msOf((sn.data() || {}).lastUpdated))) return 'changed';
                tx.delete(accRef(key));
                return 'deleted';
            });
            if (r === 'deleted') accDeleted++;
            else if (r === 'changed') accSkipped++;
        } catch (e) {
            console.error('[전량검수 기록] 누적 문서 삭제 실패:', e && e.code ? e.code : e);
            return { ...res, ok: false, accDeleted, accSkipped, message: `기록 ${res.deleted}건은 지웠지만 누적 문서를 지우지 못했습니다. 다시 눌러 주세요.` };
        }
    }
    if (accSkipped) {
        return { ...res, ok: false, accDeleted, accSkipped, message: `기록 ${res.deleted}건은 지웠습니다. 진행 목록 ${accSkipped}건은 그사이 저장됨 — 다시 눌러 주세요.` };
    }
    return { ...res, accDeleted, accSkipped };
}

/** [수정] 창 — 정상·불량·사유. 확인 = { normal, defective, reason }, 취소 = null. */
export function askTotalLogEdit(log) {
    return new Promise((resolve) => {
        const old = document.getElementById('total-log-edit');
        if (old) old.remove();
        const l = log || {};
        const root = document.createElement('div');
        root.id = 'total-log-edit';
        // modal-esc.js 후보 모양(.fixed.inset-0 + justify-center), 닫기 버튼 id 에 close — ESC 가 [취소]를 누른다
        root.className = 'fixed inset-0 bg-gray-900 bg-opacity-60 flex items-center justify-center z-[90] p-4';
        root.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
                <div class="p-4 border-b border-gray-200">
                    <h3 class="text-base font-bold text-gray-900">전량검수 기록 수정</h3>
                    <p class="text-xs text-gray-500 mt-0.5 break-words">${escapeHtml(l.name || '-')}${l.option ? ` / ${escapeHtml(l.option)}` : ''} · ${escapeHtml(l.date || '-')} ${escapeHtml(l.time || '')}</p>
                </div>
                <div class="p-4 space-y-3">
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label for="total-log-edit-normal" class="block text-xs font-bold text-green-700 mb-1">정상</label>
                            <input type="number" id="total-log-edit-normal" min="0" inputmode="numeric" class="w-full p-2 border border-gray-300 rounded text-center font-bold min-h-[44px]" value="${escapeHtml(Number(l.normal) || 0)}">
                        </div>
                        <div>
                            <label for="total-log-edit-defective" class="block text-xs font-bold text-red-600 mb-1">불량</label>
                            <input type="number" id="total-log-edit-defective" min="0" inputmode="numeric" class="w-full p-2 border border-gray-300 rounded text-center font-bold min-h-[44px]" value="${escapeHtml(Number(l.defective) || 0)}">
                        </div>
                    </div>
                    <div>
                        <label for="total-log-edit-reason" class="block text-xs font-bold text-gray-600 mb-1">사유</label>
                        <input type="text" id="total-log-edit-reason" maxlength="200" autocomplete="off" class="w-full p-2 border border-gray-300 rounded text-sm min-h-[44px]" value="${escapeHtml(l.reason || '')}">
                        <p class="text-[11px] text-red-700 mt-1">고객 이름·연락처·주문번호는 적지 마세요.</p>
                    </div>
                    <p class="text-[11px] text-gray-500">같은 회차 기록이면 누적·완료 상태와 그날 처리량도 차이만큼 같이 고쳐집니다.</p>
                </div>
                <div class="p-4 border-t border-gray-200 flex justify-end gap-2">
                    <button id="total-log-edit-close-btn" type="button" class="text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold px-4 rounded min-h-[44px]">취소</button>
                    <button id="total-log-edit-save-btn" type="button" class="text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 rounded min-h-[44px]">저장</button>
                </div>
            </div>`;
        const done = (v) => { root.remove(); resolve(v); };
        root.addEventListener('click', (e) => { if (e.target === root) done(null); });
        root.querySelector('#total-log-edit-close-btn').addEventListener('click', () => done(null));
        root.querySelector('#total-log-edit-save-btn').addEventListener('click', () => done({
            normal: Number(root.querySelector('#total-log-edit-normal').value) || 0,
            defective: Number(root.querySelector('#total-log-edit-defective').value) || 0,
            reason: root.querySelector('#total-log-edit-reason').value,
        }));
        document.body.appendChild(root);
        const n = root.querySelector('#total-log-edit-normal');
        if (n) n.focus();
    });
}

// ── 진행 문서(total_inspections_accumulated) 한 건 — 회차 되돌리기·목록에서 내리기·완료로/다시 진행·진행 문서 삭제(2026-11-17) ──
//   전량검수 창 [×]·[목록 비우기](js/total-inspection-logic.js)와 데이터관리 상품별 보기의 진행 문서 줄이 같이 쓴다.
//   기록은 트랜잭션 전에 key 로 조회해 id 를 모으고, 트랜잭션 안에서 tx.get 으로 다시 읽는다(읽기 → 쓰기).

/** 그 진행 문서(key)의 전량 기록 전부(서버에서). */
export async function listKeyLogs(key) {
    const qs = await getDocs(query(logsCol(), where('key', '==', String(key))));
    const out = [];
    qs.forEach(d => out.push({ id: d.id, ...d.data() }));
    return out;
}

/** 한 건 처리 — mode 'remove'(전량검수 창 [×]: 삭제 / 직전 회차로 되돌림 / 완료(중단)) · 'revert'(되돌리기만, 대상이 아니면 막음).
 *  logIds 를 주면 그 기록들을(트랜잭션 안에서 다시 읽어) 직전 회차 판정에 쓴다. 안 주면 여기서 조회.
 *  @returns {{ ok: true, action: 'delete'|'stop'|'revert'|'skip' } | { ok: false, message }} */
export async function removeOrRevertOne(key, { mode = 'remove', logIds = null } = {}) {
    const ids = Array.isArray(logIds) ? logIds : (await listKeyLogs(key)).map(l => l.id);
    const by = me(), now = new Date().toISOString(), date = getTodayDateString();
    return runTransaction(State.db, async (tx) => {
        const sn = await tx.get(accRef(key));
        if (!sn.exists()) return { ok: false, message: '진행 문서가 없습니다(이미 지워졌을 수 있습니다).' };
        const cur = { ...sn.data(), key };
        const ls = await Promise.all(ids.map(id => tx.get(logRef(id))));
        const logs = [];
        ls.forEach((x, i) => { if (x.exists()) logs.push({ id: ids[i], ...x.data() }); });
        if (mode === 'revert') {
            const rc = revertCheck(cur, logs);
            if (!rc.ok) return { ok: false, message: rc.message };
            tx.update(accRef(key), { ...rc.patch, lastUpdated: serverTimestamp() });
            return { ok: true, action: 'revert' };
        }
        const p = removePlan(cur, { by, now, date }, logs);
        if (p.action === 'blocked') return { ok: false, action: 'blocked', message: p.message };   // 아무것도 안 바꾼다
        if (p.action === 'delete') tx.delete(accRef(key));
        else if (p.action === 'stop' || p.action === 'revert') tx.update(accRef(key), { ...p.patch, lastUpdated: serverTimestamp() });
        return { ok: true, action: p.action };
    });
}

/** [완료로]·[다시 진행] — 서버 값으로 다시 판정. */
export async function setAccStatus(key, to) {
    const by = me(), now = new Date().toISOString(), date = getTodayDateString();
    return runTransaction(State.db, async (tx) => {
        const sn = await tx.get(accRef(key));
        if (!sn.exists()) return { ok: false, message: '진행 문서가 없습니다(이미 지워졌을 수 있습니다).' };
        const m = to === 'done' ? markDone(sn.data(), { by, now, date }) : markReopen(sn.data());
        if (!m.ok) return m;
        tx.update(accRef(key), { ...m.patch, lastUpdated: serverTimestamp() });
        return { ok: true };
    });
}

/** [진행 문서 삭제] — 그 key 의 기록이 하나도 없고 누적도 0 일 때만(서버 값, 리뷰 2). 기록이 있으면 [전량검수 기록 삭제] 안내. */
export async function deleteAccDocIfEmpty(key) {
    const logs = await listKeyLogs(key);
    if (logs.length) return { ok: false, message: `이 진행 문서에는 전량검수 기록 ${logs.length}건이 있습니다 — 상품의 [전량검수 기록 삭제]를 쓰세요.` };
    return runTransaction(State.db, async (tx) => {
        const sn = await tx.get(accRef(key));
        if (!sn.exists()) return { ok: true, gone: true };
        const acc = Number((sn.data() || {}).accumulatedTotal) || 0;
        if (acc !== 0) return { ok: false, message: `누적이 ${acc}개 남아 있어 지울 수 없습니다 — [완료로]를 쓰거나 관리자에게 알려 주세요.` };
        tx.delete(accRef(key));
        return { ok: true };
    });
}

/** 데이터관리 상품별 보기 — 진행 문서 전부(최대 ACC_LIMIT). 이름·옵션·회차·상태·누적·검수수량·검수일자만 화면에 쓴다(공급처 이름 칸 없음). */
const ACC_LIMIT = 3000;
let accCache = null;
export async function fetchAccDocs({ force = false } = {}) {
    if (!force && Array.isArray(accCache)) return accCache;
    const qs = await getDocs(query(accCol(), fsLimit(ACC_LIMIT)));
    const out = [];
    qs.forEach(d => out.push({ id: d.id, ...d.data() }));
    accCache = out;
    return out;
}
