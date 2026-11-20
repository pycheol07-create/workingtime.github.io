// === js/ui-history-inspection.js ===
import * as DOM from './dom-elements.js?v=202611201643';
import * as State from './state.js?v=202611201643';
import { getWeekOfYear, escapeHtml, getTodayDateString } from './utils.js?v=202611201643';
import { dayInspItems, packDatesLabel } from './lib/insp-day.js?v=202611201643';
import { inspTypeLabel } from './lib/insp-manual.js?v=202611201643';
import { doc, getDoc, runTransaction, collection, getDocs, query, where, orderBy, limit as fsLimit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { itemKey, patchItemsByKey } from './lib/insp-flow.js?v=202611201643';
import { dayRows, inspectorLabel, logDefectQty, periodLabel, accDocRow, DONE } from './lib/total-insp.js?v=202611201643';

// 전량검수 저장 기록(2026-11-17) — artifacts/team-work-logger-v2/total_inspection_logs where date >= fromDate(보기 기간 시작일),
//   최근 날짜부터 최대 TOTAL_LOG_LIMIT 건. 검수이력 탭(js/listeners-history-inspection.js)이 탭에 들어올 때·[새로고침] 때 force 로 읽고,
//   엑셀(js/history-excel-inspection.js)은 같은 캐시를 쓴다(같은 fromDate 면 다시 읽지 않음). 실패하면 던진다(부르는 쪽이 안내).
export const TOTAL_LOG_LIMIT = 3000;
let totalLogCache = null;    // { from, logs, truncated }
export async function fetchTotalInspLogs(fromDate, { force = false } = {}) {
    if (!State.db) return [];
    const from = String(fromDate || '');
    if (!force && totalLogCache && totalLogCache.from === from) return totalLogCache.logs;
    const ref = collection(State.db, 'artifacts', 'team-work-logger-v2', 'total_inspection_logs');
    const snap = await getDocs(query(ref, where('date', '>=', from), orderBy('date', 'desc'), fsLimit(TOTAL_LOG_LIMIT)));
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    const truncated = out.length >= TOTAL_LOG_LIMIT;
    if (truncated) console.warn(`[검수이력] 전량검수 기록이 ${TOTAL_LOG_LIMIT}건을 넘어 최근 것만 보입니다(시작일 ${from})`);
    totalLogCache = { from, logs: out, truncated };
    return out;
}
/** 마지막으로 읽은 전량 기록이 상한에 걸려 잘렸나(안내용). */
export const totalInspLogsTruncated = () => !!(totalLogCache && totalLogCache.truncated);

/** 상품별 보기 목록 줄 — 전량검수 요약 한 줄(옵션 수·진행/완료 수). 옵션별 줄과 버튼은 [상세보기] 안 전량검수 칸에(2026-11-19 — 옵션이 많으면 줄이 넘쳐 보기 어려웠다). 없으면 ''. */
function accSummaryHtml(item) {
    const docs = Array.isArray(item.totalDocs) ? item.totalDocs : [];
    const nLog = (item.logs || []).filter(l => l && l.fromTotalLog).length;
    if (!docs.length && !nLog) return '';
    const run = docs.filter(a => a && a.status !== DONE).length;
    const parts = [docs.length ? `${docs.length}옵션` : '', run ? `진행 ${run}` : '', docs.length - run ? `완료 ${docs.length - run}` : ''].filter(Boolean);
    return `<div class="mt-1"><span class="inline-block text-[11px] font-bold px-1.5 py-0.5 rounded border bg-purple-50 text-purple-800 border-purple-200">전량검수${parts.length ? ' · ' + escapeHtml(parts.join(' · ')) : ''}</span></div>`;
}

/** [상세보기] 전량검수 칸 — 옵션별 진행 문서 표(회차·상태·누적/검수수량·검수일자·기록 수 + 버튼). 없으면 ''.
 *  버튼: data-ta-revert(2회차↑·누적 0) · data-ta-done · data-ta-reopen · data-ta-del(기록 없는 진행 문서만) — js/listeners-history-inspection.js */
function accDocsTableHtml(docsIn, rawLogs) {
    const docs = (Array.isArray(docsIn) ? docsIn : []).slice().sort((a, b) => String(a.option || '').localeCompare(String(b.option || '')));
    if (!docs.length) return '';
    const logs = Array.isArray(rawLogs) ? rawLogs : [];
    const STATE_CLS = { '진행중': 'bg-purple-50 text-purple-800 border-purple-200', '완료': 'bg-sky-50 text-sky-800 border-sky-200', '중단': 'bg-gray-100 text-gray-600 border-gray-200' };
    const btn = (attr, id, label, cls) => `<button type="button" ${attr}="${escapeHtml(id)}" class="text-[11px] font-bold px-2 py-0.5 rounded border ${cls}">${escapeHtml(label)}</button>`;
    return `<table class="w-full text-left border-collapse">
        <thead class="bg-white text-[11px] text-gray-500"><tr>
            <th class="px-3 py-2 font-bold bg-gray-50">옵션</th><th class="px-3 py-2 font-bold bg-gray-50 text-center">회차</th>
            <th class="px-3 py-2 font-bold bg-gray-50 text-center">상태</th><th class="px-3 py-2 font-bold bg-gray-50 text-center">누적/검수수량</th>
            <th class="px-3 py-2 font-bold bg-gray-50">검수일자</th><th class="px-3 py-2 font-bold bg-gray-50 text-center">기록</th>
            <th class="px-3 py-2 font-bold bg-gray-50 text-right">관리</th></tr></thead>
        <tbody class="bg-white divide-y divide-gray-100">${docs.map(a => {
        const r = accDocRow(a, logs);
        const btns = [
            r.canRevert ? btn('data-ta-revert', r.id, '회차 되돌리기', 'border-amber-300 text-amber-800 hover:bg-amber-50') : '',
            r.canDone ? btn('data-ta-done', r.id, '완료로', 'border-sky-300 text-sky-800 hover:bg-sky-50') : '',
            r.canReopen ? btn('data-ta-reopen', r.id, '다시 진행', 'border-purple-300 text-purple-800 hover:bg-purple-50') : '',
            r.canDelete ? btn('data-ta-del', r.id, '진행 문서 삭제', 'border-red-200 text-red-600 hover:bg-red-50') : '',
        ].filter(Boolean).join(' ');
        return `<tr class="text-xs text-gray-700">
            <td class="px-3 py-2">${escapeHtml(r.option || '옵션 없음')}</td>
            <td class="px-3 py-2 text-center font-bold">${escapeHtml(r.round)}</td>
            <td class="px-3 py-2 text-center"><span class="px-1.5 py-0.5 rounded border text-[11px] font-bold ${STATE_CLS[r.state] || ''}">${escapeHtml(r.state)}</span></td>
            <td class="px-3 py-2 text-center whitespace-nowrap">${escapeHtml(r.acc.toLocaleString())} / ${escapeHtml(r.stock ? r.stock.toLocaleString() : '-')}</td>
            <td class="px-3 py-2 text-[11px] font-mono whitespace-nowrap">${escapeHtml(r.period)}</td>
            <td class="px-3 py-2 text-center text-gray-500">${escapeHtml(r.logCount)}건</td>
            <td class="px-3 py-2 text-right whitespace-nowrap space-x-1">${btns}</td>
        </tr>`;
    }).join('')}</tbody></table>`;
}

/** 전량 기록 한 줄의 [수정]·[삭제] — js/listeners-history-inspection.js 가 data-tl-edit·data-tl-del 을 받는다(js/total-insp-edit.js). */
function totalLogBtns(saveId) {
    if (!saveId) return '';
    const id = escapeHtml(saveId);
    return `<button type="button" data-tl-edit="${id}" class="text-blue-600 hover:text-blue-800 text-[11px] font-bold px-2 py-1 rounded border border-blue-200 hover:bg-blue-50">수정</button>`
        + ` <button type="button" data-tl-del="${id}" class="text-red-600 hover:text-red-700 text-[11px] font-bold px-2 py-1 rounded border border-red-200 hover:bg-red-50">삭제</button>`;
}

/** 일자별 보기 — 그날 전량검수 기록 표(상품명·옵션·코드·사유·검수일자(시작~종료)·정상·불량·누적/검수수량·회차·작업자). 없으면 ''. */
function totalLogsTableHtml(rows, { dayDel = true, title = '' } = {}) {
    if (!rows || !rows.length) return '';
    const emails = (State.appConfig && State.appConfig.memberEmails) || {};
    const n = (v) => (Number(v) || 0).toLocaleString();
    const body = rows.map(l => `
        <tr class="border-b last:border-0">
            <td class="px-3 py-2 text-[11px] font-mono text-gray-500 whitespace-nowrap">${dayDel ? '' : `${escapeHtml(l.date || '-')}<br>`}${escapeHtml(l.time || '-')}</td>
            ${dayDel ? `<td class="px-3 py-2 text-sm font-medium text-gray-900">${escapeHtml(l.name || '-')}</td>` : ''}
            <td class="px-3 py-2 text-xs text-gray-600">${escapeHtml(l.option || '-')}</td>
            <td class="px-3 py-2 text-xs font-mono text-gray-500">${escapeHtml(l.code || '-')}</td>
            <td class="px-3 py-2 text-xs text-gray-700 break-words max-w-[220px]">${escapeHtml(l.reason || '-')}</td>
            <td class="px-3 py-2 text-[11px] font-mono text-gray-600 whitespace-nowrap">${escapeHtml(periodLabel(l.startDate, l.endDate))}</td>
            <td class="px-3 py-2 text-center text-xs font-bold text-green-700">${escapeHtml(n(l.normal))}</td>
            <td class="px-3 py-2 text-center text-xs font-bold ${Number(l.defective) > 0 ? 'text-red-600' : 'text-gray-400'}">${escapeHtml(n(l.defective))}</td>
            <td class="px-3 py-2 text-center text-xs text-gray-700 whitespace-nowrap">${escapeHtml(n(l.accumAfter))} / ${escapeHtml(n(l.totalStock))}</td>
            <td class="px-3 py-2 text-center text-xs text-gray-600">${escapeHtml(Math.max(1, Number(l.round) || 1))}</td>
            <td class="px-3 py-2 text-xs text-gray-700">${escapeHtml(inspectorLabel(l.inspector, emails))}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">${totalLogBtns(l.id || l.saveId)}</td>
        </tr>`).join('');
    return `
        <div class="mt-4 border-t-2 border-purple-200">
            <div class="px-4 py-2 bg-purple-50 text-sm font-bold text-purple-900 flex justify-between items-center gap-2">
                <span>${escapeHtml(title || `전량검수 기록 ${rows.length}건`)}</span>
                ${dayDel ? `<button type="button" data-tl-day-del="${escapeHtml(rows[0] && rows[0].date)}" class="text-xs bg-white border border-red-200 hover:bg-red-50 text-red-600 font-bold py-1 px-2 rounded shadow-sm" title="이 날짜의 전량검수 기록을 모두 지우고 누적·처리량에서 뺍니다">이 날 전량검수 삭제</button>` : ''}
            </div>
            <table class="w-full text-left border-collapse">
                <thead class="bg-white text-[11px] text-gray-500">
                    <tr>
                        <th class="px-3 py-2 font-bold bg-gray-50">${dayDel ? '시각' : '날짜·시각'}</th>
                        ${dayDel ? '<th class="px-3 py-2 font-bold bg-gray-50">상품명</th>' : ''}
                        <th class="px-3 py-2 font-bold bg-gray-50">옵션</th>
                        <th class="px-3 py-2 font-bold bg-gray-50">코드</th>
                        <th class="px-3 py-2 font-bold bg-gray-50">사유</th>
                        <th class="px-3 py-2 font-bold bg-gray-50">검수일자</th>
                        <th class="px-3 py-2 font-bold bg-gray-50 text-center">정상</th>
                        <th class="px-3 py-2 font-bold bg-gray-50 text-center">불량</th>
                        <th class="px-3 py-2 font-bold bg-gray-50 text-center">누적/검수수량</th>
                        <th class="px-3 py-2 font-bold bg-gray-50 text-center">회차</th>
                        <th class="px-3 py-2 font-bold bg-gray-50">작업자</th>
                        <th class="px-3 py-2 font-bold bg-gray-50 text-right">관리</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-100">${body}</tbody>
            </table>
        </div>`;
}

// 정렬 상태 관리 (로컬)
let sortState = { key: 'lastInspectionDate', dir: 'desc' };

export const setSortState = (key) => {
    if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.key = key;
        sortState.dir = 'desc';
    }
};

// 검수 유형 필터 상태 (all / sample / total)
export let currentInspTypeFilter = 'all';
export const setInspTypeFilter = (val) => { currentInspTypeFilter = val; };

// 일자별 보기의 검수 결과(정상/불량) — 리스트 항목에는 결과가 없고 상품 이력(product_history)에만 있다.
//   선택한 날짜의 완료 상품만 한 번 읽고 기억한다(이름 → logs, 사진 제외). 저장·수정(product-history-changed)·탭 새로 읽기 때 비운다.
//   키 = 문서 id(저장할 때처럼 상품명의 '/' 를 '-' 로 — inspection-logic.js). 상품별 보기에서 이미 전체를 읽었으면 그걸 쓴다(seed).
const histLogsCache = new Map();
const histDocId = (name) => String(name ?? '').replace(/\//g, '-');
const stripImages = (logs) => (Array.isArray(logs) ? logs : []).map(({ image, ...rest }) => rest);
export const clearInspResultCache = () => histLogsCache.clear();
export const seedInspResultCache = (rows) => {   // rows = product_history 전체({id, logs, …})
    (rows || []).forEach(r => { if (r && r.id) histLogsCache.set(r.id, stripImages(r.logs)); });
};
document.addEventListener('product-history-changed', clearInspResultCache);

async function loadHistLogs(names) {
    const need = [...new Set(names.map(histDocId))].filter(id => id && !histLogsCache.has(id));
    if (!State.db || need.length === 0) return;
    await Promise.all(need.map(async (id) => {
        try {
            const snap = await getDoc(doc(State.db, 'product_history', id));
            histLogsCache.set(id, stripImages(snap.exists() ? snap.data().logs : []));
        } catch (e) { console.warn('검수 결과 읽기 실패', e); }   // 캐시에 안 넣음 → 다음에 다시 시도
    }));
}

// 그 날짜·패킹일·옵션(·둘 다 있으면 코드)이 맞는 마지막 기록 — 같은 상품의 다른 색상 결과를 잡지 않게 옵션을 꼭 본다(lib/insp-flow.js findLogForItem 과 같은 생각)
const optKey = (v) => { const s = String(v ?? '').trim(); return s === '-' ? '' : s; };
const codeKey = (v) => { const s = String(v ?? '').trim(); return s === '-' ? '' : s; };
function dayLogOf(item, date) {
    const logs = histLogsCache.get(histDocId(item.name));
    if (!logs) return undefined;   // 아직 못 읽음
    const ic = codeKey(item.code);
    const hits = logs.filter(l => {
        if (!l || l.date !== date) return false;
        if (item.packingDate && l.packingDate !== item.packingDate) return false;
        if (l.option !== undefined && optKey(l.option) !== optKey(item.option)) return false;   // 옵션 칸이 없는 옛 기록은 옵션을 안 본다
        const lc = codeKey(l.code);
        return !(ic && lc && ic !== lc);
    });
    return hits.length ? hits[hits.length - 1] : null;
}

// 상품별 보기·QC 통계와 같은 불량 판정(status·defects·체크리스트 값)
const RESULT_NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];
function logDefects(log) {
    const out = Array.isArray(log.defects) ? log.defects.filter(Boolean).map(String) : [];
    let bad = log.status === '불량' || out.length > 0;
    if (log.checklist) {
        Object.entries(log.checklist).forEach(([key, val]) => {
            if (key === 'thickness' || !val) return;
            if (!RESULT_NORMAL_VALUES.includes(String(val).trim())) bad = true;
        });
    }
    return { bad, defects: out };
}

function resultBadge(item, isCompleted, date) {
    if (!isCompleted) return '<span class="text-gray-300 text-xs">-</span>';
    const log = dayLogOf(item, date);
    if (log === undefined) return '<span class="text-gray-300 text-xs" title="불러오지 못함">?</span>';
    if (log === null) return '<span class="text-gray-400 text-[11px]" title="이 날짜의 검수 기록을 찾지 못함">기록 없음</span>';
    const { bad, defects } = logDefects(log);
    if (!bad) return '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800">정상</span>';
    const txt = defects.join(', ') || (log.note ? String(log.note) : '');
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700" title="${escapeHtml(txt || '불량')}">불량</span>`
        + (txt ? `<div class="text-[11px] text-red-600 mt-0.5 truncate max-w-[140px] mx-auto" title="${escapeHtml(txt)}">${escapeHtml(txt)}</div>` : '');
}

// 제작/사입 구분 — 리스트 항목의 source(패킹에서 만든 리스트). 없고 packNo 만 있는 예전 항목은 패킹 목록(integrations/inspPacks)의 src 로(1번 읽고 기억)
let packSrcMap = null, packSrcLoading = null;   // packSrcLoading = 읽는 중인 Promise(겹친 렌더도 같은 읽기를 기다린다)
async function loadPackSrc(items) {
    if (packSrcMap || !State.db || !items.some(it => it && !it.source && it.packNo)) return;
    if (!packSrcLoading) {
        packSrcLoading = (async () => {
            try {
                const snap = await getDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'integrations', 'inspPacks'));
                const obj = JSON.parse((snap.exists() && snap.data().packsJson) || '{}');
                const m = {};
                Object.keys(obj || {}).forEach(no => { const v = obj[no] && obj[no].src; if (v) m[no] = String(v); });
                packSrcMap = m;
            } catch (e) { console.warn('패킹 구분 읽기 실패 — 구분 없이 보입니다'); }
            finally { packSrcLoading = null; }   // 실패면 packSrcMap 이 비어 있어 다음 렌더에서 다시 읽는다
        })();
    }
    await packSrcLoading;
}
const SRC_BADGE_CLS = { '제작': 'bg-indigo-50 text-indigo-700 border-indigo-200', '사입': 'bg-amber-50 text-amber-800 border-amber-200', '혼합': 'bg-gray-50 text-gray-700 border-gray-200' };
function sourceBadge(item) {
    const src = String(item.source || (item.packNo && packSrcMap && packSrcMap[item.packNo]) || '');
    if (!Object.prototype.hasOwnProperty.call(SRC_BADGE_CLS, src)) return '<span class="text-gray-300 text-xs">-</span>';
    return `<span class="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${escapeHtml(SRC_BADGE_CLS[src])}">${escapeHtml(src)}</span>`;
}

// '유형' 칸 배지 — 리스트 줄·검수 기록 둘 다. 이름은 lib/insp-manual.js inspTypeLabel(전량 / 샘플 / 샘플(개별) / 요청확인, 2026-11-17)
const TYPE_BADGE_CLS = {
    '전량': 'bg-purple-100 text-purple-800 border-purple-200',
    '샘플(개별)': 'bg-teal-50 text-teal-800 border-teal-200',
    '요청확인': 'bg-orange-50 text-orange-800 border-orange-200',
};
function typeBadgeOf(x, extraCls = 'inline-flex items-center') {
    const label = inspTypeLabel(x);
    const cls = TYPE_BADGE_CLS[label] || 'bg-gray-100 text-gray-600 border-gray-200';
    return `<span class="${extraCls} px-1.5 py-0.5 rounded text-[11px] font-bold border shadow-sm whitespace-nowrap ${cls}">${escapeHtml(label)}</span>`;
}

// 빈 함수 내보내기 (이전 에러 해결용)
export const renderInspectionLogTable = (logs, productName) => {};

const getSortIcon = (key) => {
    if (sortState.key !== key) return '<span class="text-gray-300 text-[11px] ml-1 opacity-50">↕</span>';
    return sortState.dir === 'asc' 
        ? '<span class="text-blue-600 text-[11px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[11px] ml-1">▼</span>';
};

const formatDefectSummary = (defectSummary) => {
    if (!defectSummary || defectSummary.length === 0) {
        return '<span class="text-gray-400">-</span>';
    }
    const lastDefect = defectSummary[defectSummary.length - 1];
    return `<span class="text-red-600 font-medium text-xs truncate block max-w-[200px]" title="${escapeHtml(lastDefect)}">${escapeHtml(lastDefect)}</span>`;
};

export const renderInspectionLayout = (container) => {
    if (!container) return;
    const activeTab = State.context.inspectionViewMode || 'product';

    container.innerHTML = `
        <div class="flex flex-col h-full relative">
            <div class="flex justify-between items-end border-b border-gray-200 mb-4 shrink-0">
                <div class="flex">
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'product' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="product">
                        상품별 보기
                    </button>
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'list' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="list">
                        검수 일자별 보기
                    </button>
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'qc' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="qc">
                        QC 통계 리포트
                    </button>
                </div>
                <div class="pb-1 pr-1 flex gap-2 items-center">
                    <select id="insp-type-filter" class="text-xs border border-gray-300 rounded p-1.5 focus:ring-indigo-500 bg-white font-bold text-gray-700 outline-none cursor-pointer shadow-sm">
                        <option value="all" ${currentInspTypeFilter === 'all' ? 'selected' : ''}>전체 (샘플+전량)</option>
                        <option value="sample" ${currentInspTypeFilter === 'sample' ? 'selected' : ''}>샘플 검수만</option>
                        <option value="total" ${currentInspTypeFilter === 'total' ? 'selected' : ''}>전량 검수만</option>
                    </select>
                    
                    <button id="btn-add-pre-inspection" class="text-xs bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-1.5 px-3 rounded shadow-sm transition flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
                        수동 상품 추가
                    </button>
                    <button id="inspection-tab-download-btn" class="text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-1.5 px-3 rounded shadow-sm transition flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        엑셀 받기
                    </button>
                </div>
            </div>
            <div id="inspection-content-area" class="flex-grow relative overflow-hidden"></div>
        </div>
    `;
};

// ✨ [수정됨] 일자별 검수 리스트 렌더링 (대기 상태 항목은 샘플 수량 0개로 철저히 계산)
// totalLogs = 전량검수 저장 기록(fetchTotalInspLogs) — 그날 기록이 있으면 날짜 목록에 넣고 표 아래 '전량검수 n건' 표(2026-11-17).
//   '전량 검수만'이면 그 표만(리스트 줄은 inspectionType 'total' 인 것만 — 보통 없음), '샘플 검수만'이면 전량 표를 숨긴다.
let dateListScrollTop = 0;   // 일자별 보기 날짜 목록의 마지막 스크롤 위치(페이지를 새로 열 때까지)
export const renderInspectionListMode = async (dateList, selectedDateData, totalLogs = []) => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    if (!container.querySelector('.insp-list-loaded')) {
        container.innerHTML = `<div class="flex h-full items-center justify-center text-indigo-500 font-bold animate-pulse">데이터 동기화 및 렌더링 중...</div>`;
    }

    const showTotal = currentInspTypeFilter !== 'sample';
    const days = (Array.isArray(dateList) ? dateList : []).slice();
    if (showTotal) {
        const have = new Set(days.map(d => d.date));
        (Array.isArray(totalLogs) ? totalLogs : []).forEach(l => {
            const dt = String((l && l.date) || '');
            if (/^\d{4}-\d{2}-\d{2}$/.test(dt) && !have.has(dt)) { have.add(dt); days.push({ date: dt, count: 0, data: [] }); }
        });
        days.sort((a, b) => b.date.localeCompare(a.date));
    }

    let filteredDateList = [];
    days.forEach(d => {
        const fList = d.data.filter(item => {
            const type = item.inspectionType === 'total' ? 'total' : 'sample';
            return currentInspTypeFilter === 'all' || type === currentInspTypeFilter;
        });
        const tl = showTotal ? dayRows(totalLogs, d.date) : [];
        if (fList.length > 0 || tl.length > 0) {
            filteredDateList.push({
                date: d.date,
                count: fList.length + tl.length,
                data: fList,
                total: tl
            });
        }
    });

    let selectedDate = State.context.selectedInspectionDate;
    if (!filteredDateList.find(d => d.date === selectedDate) && filteredDateList.length > 0) {
        selectedDate = filteredDateList[0].date;
        State.context.selectedInspectionDate = selectedDate;
    }

    const filteredSelectedData = filteredDateList.find(d => d.date === selectedDate)?.data || [];
    const selectedTotalHtml = totalLogsTableHtml(filteredDateList.find(d => d.date === selectedDate)?.total || []);

    if (State.db && filteredSelectedData.length > 0) {
        let needsDbUpdate = false;
        const qtyPatches = [];   // 고친 샘플 수량 — 서버 문서에 이 칸만 다시 적용한다
        // 완료 상품의 이력을 한 번에 읽어 둔다(정상여부 표시 + 아래 샘플 수량 맞추기가 같이 쓴다)
        await Promise.all([
            loadHistLogs(filteredSelectedData.filter(it => it.status === '완료').map(it => it.name)),
            loadPackSrc(filteredSelectedData),
        ]);
        filteredSelectedData.forEach((item) => {
            if (item.status === '완료' && item.inspectionType !== 'total') {
                if (item.sampleQty === undefined || item.sampleQty === 1 || item.sampleQty === 0) {
                    const targetLog = dayLogOf(item, selectedDate);   // 정상여부와 같은 기록(마지막)
                    if (targetLog && targetLog.sampleQty !== undefined) {
                        const trueQty = Number(targetLog.sampleQty);
                        if (item.sampleQty !== trueQty) {
                            item.sampleQty = trueQty;
                            needsDbUpdate = true;
                            qtyPatches.push({ key: itemKey(item), set: { sampleQty: trueQty } });
                        }
                    }
                }
            }
        });

        if (needsDbUpdate) {
            try {
                // 화면 목록은 inspectionList + inspectionDone 을 합친 것 — 칸을 나눠 고친다(합친 목록을 inspectionList 에 쓰면 두 번 나온다).
                // 메모리 캐시를 통째로 쓰지 않고, 문서를 다시 읽어 고친 샘플 수량 칸만 적용한다(2026-11-17 — 다른 기기 변경을 지우지 않게).
                // 오늘이면 원본 daily_data 에 쓴다(이력 쪽 오늘 리스트는 saveProgress 가 daily_data 로 덮는다). 서버 값이 이미 맞으면 쓰지 않는다.
                const day = (State.allHistoryData || []).find(d => d.id === selectedDate);
                if (day && dayInspItems(day).length > 0 && qtyPatches.length > 0) {
                    const coll = selectedDate === getTodayDateString() ? 'daily_data' : 'history';
                    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', coll, selectedDate);
                    await runTransaction(State.db, async (tx) => {
                        const snap = await tx.get(historyDocRef);
                        if (!snap.exists()) return;
                        const d = snap.data() || {};
                        const upd = {};
                        ['inspectionList', 'inspectionDone'].forEach(f => {
                            if (!Array.isArray(d[f])) return;
                            const r = patchItemsByKey(d[f], qtyPatches);
                            if (r.changed) upd[f] = r.list;
                        });
                        if (Object.keys(upd).length) tx.update(historyDocRef, upd);
                    });
                }
            } catch(e) { console.error("Silent DB update failed", e); }
        }
    }

    let dateListHtml = '';
    if (!filteredDateList || filteredDateList.length === 0) {
        dateListHtml = `<div class="p-4 text-center text-sm text-gray-400">조건에 맞는 리스트가 없습니다.</div>`;
    } else {
        filteredDateList.forEach(d => {
            const isSelected = d.date === selectedDate;
            const activeClass = isSelected ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-transparent hover:bg-gray-50 text-gray-600';
            const packs = packDatesLabel(d.data);   // 이 날 검수한 리스트가 몇일자 패킹인지
            
            dateListHtml += `
                <button class="w-full text-left px-2.5 py-2.5 border-l-4 transition-all ${activeClass} group btn-select-insp-date" data-date="${escapeHtml(d.date)}">
                    <div class="flex justify-between items-center">
                        <span class="font-semibold text-sm">${escapeHtml(d.date)}</span>
                        <span class="text-[11px] bg-white border border-gray-200 px-1.5 py-0.5 rounded-full text-gray-500 group-hover:border-gray-300">${escapeHtml(d.count)}건</span>
                    </div>
                    ${packs ? `<div class="text-[11px] text-gray-500 mt-0.5">패킹 ${escapeHtml(packs)}</div>` : ''}
                </button>
            `;
        });
    }

    let detailHtml = '';
    if (!selectedDate) {
        detailHtml = `<div class="flex h-full items-center justify-center text-gray-400 text-sm">좌측에서 날짜를 선택해주세요.</div>`;
    } else if (!filteredSelectedData || filteredSelectedData.length === 0) {
        detailHtml = `
            <div class="flex flex-col h-full">
                <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center shrink-0">
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-gray-700 text-sm">${escapeHtml(selectedDate)} 검수 리스트 상세</h4>
                        <span class="text-xs text-gray-500">0건</span>
                    </div>
                </div>
                ${selectedTotalHtml
                    ? `<div class="flex-grow overflow-y-auto custom-scrollbar relative">${selectedTotalHtml}</div>`
                    : '<div class="flex h-full items-center justify-center text-gray-400 text-sm">해당 날짜의 필터링된 데이터가 없습니다.</div>'}
            </div>
        `;
    } else {
        let totalInboundQty = 0;
        let totalSampleQty = 0;
        const pendingCount = filteredSelectedData.filter(it => it.status !== '완료').length;

        const rows = filteredSelectedData.map((item, idx) => {
            const isCompleted = item.status === '완료';
            const statusBadge = isCompleted 
                ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-sky-100 text-sky-800">완료</span>`   // 하늘색 — 옆 '정상여부'(초록·빨강)와 다른 색
                : `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">대기</span>`;
            
            const typeBadge = typeBadgeOf(item);

            // ✨ 입고 수량 및 샘플검수 수량 계산 로직 (대기 상태는 무조건 0으로)
            const inboundQty = Number(item.inboundQty || item.qty || 0);
            
            let sampleQty = 0;
            if (isCompleted) {
                sampleQty = item.sampleQty !== undefined ? Number(item.sampleQty) : (item.inspectionType === 'total' ? inboundQty : 1);
            }
            
            totalInboundQty += inboundQty;
            totalSampleQty += sampleQty;

            return `
                <tr class="hover:bg-blue-50 transition border-b last:border-0 cursor-pointer btn-view-detail" 
                    data-product-name="${escapeHtml(item.name)}" 
                    data-product-option="${escapeHtml(item.option || '-')}" 
                    data-product-code="${escapeHtml(item.code || '-')}" 
                    data-target-date="${escapeHtml(selectedDate)}"
                    title="클릭하여 상세 이력 펼치기">
                    <td class="px-4 py-3 text-center">${typeBadge}</td>
                    <td class="px-2 py-3 text-center">${sourceBadge(item)}</td>
                    <td class="px-4 py-3 text-xs font-mono text-gray-500">${escapeHtml(item.code || '-')}</td>
                    <td class="px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(item.name)}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">${escapeHtml(item.option || '-')}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">${escapeHtml(item.supplierCode || item.supplierName || '-')}</td>
                    <td class="px-4 py-3 text-center">
                        <div class="text-xs font-bold text-gray-700">${escapeHtml(inboundQty.toLocaleString())}</div>
                        <div class="text-[11px] ${isCompleted ? 'text-blue-600' : 'text-gray-400'} font-bold">(샘플검수: ${escapeHtml(sampleQty.toLocaleString())}개)</div>
                    </td>
                    <td class="px-4 py-3 text-center">${statusBadge}</td>
                    <td class="px-3 py-3 text-center">${resultBadge(item, isCompleted, selectedDate)}</td>
                </tr>
            `;
        }).join('');

        detailHtml = `
            <div class="flex flex-col h-full">
                <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center shrink-0">
                    <div class="flex items-center gap-3">
                        <h4 class="font-bold text-gray-700 text-sm">${escapeHtml(selectedDate)} 검수 리스트 상세</h4>
                        ${packDatesLabel(filteredSelectedData, 6) ? `<span class="text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">패킹 ${escapeHtml(packDatesLabel(filteredSelectedData, 6))}</span>` : ''}
                        <span class="text-[11px] font-medium bg-white border border-gray-200 shadow-sm px-2.5 py-1 rounded text-gray-600">
                            총 입고: <strong class="text-gray-900">${escapeHtml(totalInboundQty.toLocaleString())}</strong>개 <span class="mx-1 text-gray-300">|</span> 
                            총 샘플검수: <strong class="text-blue-600">${escapeHtml(totalSampleQty.toLocaleString())}</strong>개
                        </span>
                    </div>
                    <div class="flex gap-1.5 shrink-0">
                        ${pendingCount > 0 ? `<button class="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 px-2.5 rounded shadow-sm transition btn-resume-insp" data-date="${escapeHtml(selectedDate)}" title="이 날짜의 대기 항목을 오늘 검수 대기 리스트로 불러와 이어서 진행">▶ 이어서 검수 (대기 ${escapeHtml(pendingCount)}건)</button>` : ''}
                        <button class="text-xs bg-white border border-red-200 hover:bg-red-50 text-red-600 font-bold py-1 px-2 rounded shadow-sm transition btn-delete-history-list"
                                data-date="${escapeHtml(selectedDate)}" title="이 날짜의 리스트 전체 삭제">
                            리스트 삭제
                        </button>
                    </div>
                </div>
                <div class="flex-grow overflow-y-auto custom-scrollbar relative">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-white text-[11px] uppercase text-gray-500 sticky top-0 z-10 shadow-sm outline outline-1 outline-gray-200">
                            <tr>
                                <th class="px-4 py-2 font-bold bg-gray-50 text-center w-[6%]">유형</th>
                                <th class="px-2 py-2 font-bold bg-gray-50 text-center w-[6%]">구분</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 w-[11%]">코드</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 w-[20%]">상품명</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 w-[14%]">옵션</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 w-[11%]">공급처</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 text-center w-[12%]">수량 (입고/샘플검수)</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 text-center w-[8%]">상태</th>
                                <th class="px-3 py-2 font-bold bg-gray-50 text-center w-[12%]">정상여부</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-100">
                            ${rows}
                        </tbody>
                    </table>
                    ${selectedTotalHtml}
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="absolute inset-0 flex border border-gray-200 rounded-lg overflow-hidden bg-white insp-list-loaded">
            <div class="w-40 border-r border-gray-200 bg-gray-50 overflow-y-auto custom-scrollbar shrink-0 insp-date-pane">
                ${dateListHtml}
            </div>
            <div class="flex-1 overflow-hidden bg-white relative">
                ${detailHtml}
            </div>
        </div>
    `;
    // 날짜 목록 스크롤 위치 — 날짜를 고르면 검수이력 화면을 통째로 다시 그리므로(목록도 새로 만든다) 기억해 둔 위치로 되돌린다
    //   (2026-11-19 — 늘 맨 위로 올라갔다)
    const pane = container.querySelector('.insp-date-pane');
    if (pane) {
        if (dateListScrollTop) pane.scrollTop = dateListScrollTop;
        pane.addEventListener('scroll', () => { dateListScrollTop = pane.scrollTop; }, { passive: true });
    }
};

export const renderInspectionHistoryTable = (historyData) => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;
    if (historyData == null) {   // 아직 불러오지 않음
        container.innerHTML = '<div class="text-center py-10 text-gray-500">검수 기록을 불러오는 중입니다...</div>';
        return;
    }

    const searchInput = DOM.inspectionHistorySearchInput;
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let filteredData = historyData.filter(item => {
        const matchId = item.id.toLowerCase().includes(searchTerm);
        let matchLog = false;
        const matchSupplierName = (item.lastSupplierName && item.lastSupplierName.toLowerCase().includes(searchTerm))
            || (item.lastSupplierCode && item.lastSupplierCode.toLowerCase().includes(searchTerm));
        
        if (item.logs && item.logs.length > 0) {
            const lastLog = item.logs[item.logs.length - 1];
            if (lastLog.code && lastLog.code.toLowerCase().includes(searchTerm)) matchLog = true;
            if (lastLog.option && lastLog.option.toLowerCase().includes(searchTerm)) matchLog = true;
            if (lastLog.supplierName && lastLog.supplierName.toLowerCase().includes(searchTerm)) matchLog = true;
            if (lastLog.supplierCode && lastLog.supplierCode.toLowerCase().includes(searchTerm)) matchLog = true;
        }

        if (!matchId && !matchSupplierName && !matchLog) return false;

        if (currentInspTypeFilter !== 'all') {
            const hasMatchingLog = item.logs && item.logs.some(log => {
                const type = log.inspectionType === 'total' ? 'total' : 'sample';
                return type === currentInspTypeFilter;
            });
            if (!hasMatchingLog) return false;
        }

        return true;
    });

    if (DOM.inspectionTotalProductCount) {
        DOM.inspectionTotalProductCount.textContent = filteredData.length;
    }

    filteredData.sort((a, b) => {
        let valA = a[sortState.key];
        let valB = b[sortState.key];
        if (sortState.key === 'productName') { valA = a.id; valB = b.id; }
        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';
        if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
        return 0;
    });

    let html = `
        <div class="absolute inset-0 overflow-y-auto custom-scrollbar border border-gray-200 rounded-lg bg-white">
            <table class="w-full text-sm text-left text-gray-600 relative">
                <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-20 shadow-sm outline outline-1 outline-gray-200">
                    <tr>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-200 transition select-none bg-gray-100" data-sort-key="productName">
                            <div class="flex items-center">상품명 ${getSortIcon('productName')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 bg-gray-100">공급처 상품명</th>
                        <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none bg-gray-100" data-sort-key="totalInbound">
                            <div class="flex items-center justify-center">총 입고(검수) 횟수 ${getSortIcon('totalInbound')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none bg-gray-100" data-sort-key="lastInspectionDate">
                            <div class="flex items-center justify-center">최근 검수일 ${getSortIcon('lastInspectionDate')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 bg-gray-100">최근 불량/특이사항</th>
                        <th scope="col" class="px-6 py-3 text-right bg-gray-100">관리</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 bg-white">
    `;

    if (filteredData.length === 0) {
        html += `<tr><td colspan="6" class="px-6 py-8 text-center text-gray-400">
            ${escapeHtml(searchTerm ? `'${searchTerm}'에 대한 검색 결과가 없습니다.` : '선택한 유형에 해당하는 저장된 검수 이력이 없습니다.')}
        </td></tr>`;
    } else {
        filteredData.forEach(item => {
            let supplierName = '-';
            if (item.lastSupplierCode || item.lastSupplierName) supplierName = item.lastSupplierCode || item.lastSupplierName;

            if (supplierName === '-' && item.logs && item.logs.length > 0) {
                const lastLog = item.logs[item.logs.length - 1];
                supplierName = lastLog.supplierCode || lastLog.supplierName || '-';
            }

            html += `
                <tr class="hover:bg-blue-50 transition group cursor-pointer btn-view-detail" data-product-name="${escapeHtml(item.id)}" title="클릭하여 상세 이력 펼치기">
                    <td class="px-6 py-4 font-medium text-gray-900">${escapeHtml(item.id)}${accSummaryHtml(item)}</td>
                    <td class="px-6 py-4 text-xs text-gray-500 truncate max-w-[150px]" title="${escapeHtml(supplierName)}">
                        ${escapeHtml(supplierName)}
                    </td>
                    <td class="px-6 py-4 text-center">
                        ${item.totalOnly ? '' : `<span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            샘플 ${escapeHtml(item.totalInbound || 0)}회
                        </span>`}
                        ${(item.logs || []).some(l => l && l.fromTotalLog) ? `<span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 mt-1">전량 ${escapeHtml((item.logs || []).filter(l => l && l.fromTotalLog).length)}건</span>` : ''}
                    </td>
                    <td class="px-6 py-4 text-center font-mono text-xs text-gray-500">
                        ${escapeHtml(item.lastInspectionDate || '-')}
                    </td>
                    <td class="px-6 py-4">
                        ${formatDefectSummary(item.defectSummary)}
                    </td>
                    <td class="px-6 py-4 text-right space-x-1">
                        <button class="text-indigo-600 hover:text-indigo-900 font-semibold text-xs border border-indigo-200 rounded px-3 py-1.5 hover:bg-indigo-50 transition pointer-events-none shadow-sm">
                            상세보기 ▾
                        </button>
                        ${(item.logs || []).some(l => l && l.fromTotalLog) || (item.totalDocs || []).length ? `<button type="button" data-tl-prod-del="${escapeHtml(item.id)}" class="text-purple-700 hover:text-red-700 font-semibold text-xs border border-purple-200 rounded px-3 py-1.5 hover:bg-red-50 transition shadow-sm" title="이 상품의 전량검수 기록 전부와 누적(진행 목록)을 지웁니다">전량검수 기록 삭제</button>` : ''}
                        ${item.totalOnly ? '' : `<button class="text-red-500 hover:text-red-700 font-semibold text-xs border border-red-200 rounded px-3 py-1.5 hover:bg-red-50 transition btn-delete-product opacity-0 group-hover:opacity-100 m-touch-show shadow-sm"
                                data-product-name="${escapeHtml(item.id)}" title="상품 전체 삭제">
                            삭제
                        </button>`}
                    </td>
                </tr>
            `;
        });
    }

    html += `</tbody></table></div>`;
    container.innerHTML = html;
};

/** [상세보기] 전량검수 칸 — 옵션별 진행 표 + 저장 기록 표(수정·삭제). total = { logs: 원본 전량 기록[], docs: 진행 문서[] } */
function totalSectionHtml(total) {
    const raw = (total && Array.isArray(total.logs) ? total.logs : []).slice()
        .sort((a, b) => (String(b.date || '') + String(b.time || '')).localeCompare(String(a.date || '') + String(a.time || '')));
    const docs = total && Array.isArray(total.docs) ? total.docs : [];
    if (!raw.length && !docs.length) return '';
    const accHtml = accDocsTableHtml(docs, raw);
    return `
        <div class="mb-4 rounded-lg border border-purple-200 bg-white shadow-sm overflow-hidden">
            <div class="px-4 py-2 bg-purple-50 text-sm font-bold text-purple-900">전량검수 — 옵션별 진행 ${escapeHtml(docs.length)}개</div>
            ${accHtml || '<div class="px-4 py-3 text-xs text-gray-500">진행 문서 없음</div>'}
            <div class="max-h-[320px] overflow-y-auto custom-scrollbar">${totalLogsTableHtml(raw, { dayDel: false, title: `저장 기록 ${raw.length}건 (날짜별 정상·불량)` })}</div>
        </div>`;
}

export const renderExpandedInspectionLog = (targetTr, logsIn, productName, total = null) => {
    // 상품별 보기(total 있음): 전량검수는 위 칸에 따로, 아래 표는 샘플 기록만(2026-11-19 — 전량 기록이 샘플 칸 모양으로 섞여 보였다)
    const showTotal = !!total && currentInspTypeFilter !== 'sample';
    const totalHtml = showTotal ? totalSectionHtml(total) : '';
    const logs = total ? (logsIn || []).filter(l => !(l && l.fromTotalLog)) : logsIn;
    const table = targetTr.closest('table');
    if (table) {
        table.querySelectorAll('.expanded-detail-row').forEach(row => row.remove());
    }

    const colspan = targetTr.children.length; 
    const isQcReport = targetTr.dataset.isQcReport === 'true';

    let displayLogs = logs.filter(log => {
        const type = log.inspectionType === 'total' ? 'total' : 'sample';
        return currentInspTypeFilter === 'all' || type === currentInspTypeFilter;
    });
    
    if (State.context.inspectionViewMode === 'list') {
        const targetOption = targetTr.dataset.productOption;
        const targetCode = targetTr.dataset.productCode;
        const targetDate = targetTr.dataset.targetDate;

        if (targetOption !== undefined) {
            displayLogs = displayLogs.filter(log => {
                const logOption = log.option || '-';
                const logCode = log.code || '-';
                const logDate = log.date || '-';
                return logOption === targetOption && logCode === targetCode && logDate === targetDate;
            });
        }
    } 
    else if (isQcReport) {
        const pType = targetTr.dataset.qcPeriodType || 'month';
        const pVal = targetTr.dataset.qcPeriodValue || '';

        displayLogs = displayLogs.filter(log => {
            if (pVal && log.date) {
                const logYear = log.date.substring(0, 4);
                const logMonth = log.date.substring(0, 7);
                const logWeek = getWeekOfYear(new Date(log.date));
                
                const isMatch = (pType === 'year' && logYear === pVal) ||
                                (pType === 'month' && logMonth === pVal) || 
                                (pType === 'week' && logWeek === pVal);
                                
                if (!isMatch) return false; 
            }

            let isDefect = false;
            const normalValues = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];

            if (log.status === '불량') isDefect = true;
            if (log.defects && Array.isArray(log.defects) && log.defects.length > 0) isDefect = true;
            
            if (log.checklist) {
                Object.entries(log.checklist).forEach(([key, val]) => {
                    if (key !== 'thickness' && val) {
                        const cleanVal = String(val).trim();
                        if (cleanVal && !normalValues.includes(cleanVal)) {
                            isDefect = true;
                        }
                    }
                });
            }
            return isDefect;
        });
    }

    const tr = document.createElement('tr');
    tr.className = 'expanded-detail-row bg-indigo-50/50 shadow-inner relative z-0';
    
    let logsHtml = '';
    if ((!displayLogs || displayLogs.length === 0) && totalHtml) {
        logsHtml = `<div class="p-4 bg-indigo-50/50 border-y border-indigo-200">
            <div class="flex items-center justify-between mb-3">
                <h4 class="font-bold text-indigo-900 text-sm flex items-center gap-2">상세 검수 이력 <span class="text-xs font-normal text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full border border-indigo-200">${escapeHtml(productName)}</span></h4>
                <button class="text-xs text-gray-500 hover:text-gray-800 font-bold btn-close-expanded px-3 py-1 rounded hover:bg-gray-200 transition border border-gray-300 bg-white shadow-sm">닫기 ✖</button>
            </div>${totalHtml}</div>`;
    } else if (!displayLogs || displayLogs.length === 0) {
        logsHtml = '<div class="p-6 text-center text-gray-500">해당 조건에 부합하는 상세 검수 기록이 없습니다.</div>';
    } else {
        const groupedLogs = {};
        displayLogs.forEach((log, idx) => {
            const originalIdx = log.originalIndex !== undefined ? log.originalIndex : idx;
            const code = log.code || '-';
            const option = log.option || '-';
            const groupKey = `${code} / ${option}`;
            
            if (!groupedLogs[groupKey]) {
                groupedLogs[groupKey] = [];
            }
            groupedLogs[groupKey].push({ ...log, originalIndex: originalIdx });
        });

        let rowsHtml = '';

        Object.keys(groupedLogs).sort().forEach(groupKey => {
            const group = groupedLogs[groupKey];
            
            group.sort((a, b) => {
                const tA = (a.date || '') + (a.time || '');
                const tB = (b.date || '') + (b.time || '');
                return tB.localeCompare(tA); 
            });

            rowsHtml += `
                <tr class="bg-indigo-100/70 border-y border-indigo-200">
                    <td colspan="9" class="px-4 py-2 text-xs font-bold text-indigo-900">
                        분류 (코드 / 옵션) : <span class="text-indigo-700">${escapeHtml(groupKey)}</span> 
                        <span class="text-gray-500 font-normal ml-2">(${group.length}건)</span>
                    </td>
                </tr>
            `;

            rowsHtml += group.map(item => {
                let checklistStr = [];
                const cl = item.checklist || {};
                const normalValues = ['정상', '양호', '동일', '없음', '해당없음'];
                
                if (cl.thickness) {
                    checklistStr.push(`<span class="inline-block bg-white px-1.5 py-0.5 rounded text-[11px] text-gray-600 border border-gray-200 shadow-sm mr-1 mb-1">두께: <strong class="text-indigo-600">${escapeHtml(cl.thickness)}</strong></span>`);
                }
                
                const labelMap = { fabric: '원단', color: '컬러', distortion: '뒤틀림', unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추', lining: '안감', pilling: '보풀', dye: '이염', brushed: '기모' };
                
                Object.entries(cl).forEach(([key, val]) => {
                    if (key !== 'thickness' && val) {
                        const cleanVal = String(val).trim();
                        const isDefect = !normalValues.includes(cleanVal);
                        const colorClass = isDefect ? 'text-red-700 bg-red-50 border-red-200 font-bold' : 'text-gray-600 bg-white border-gray-200';
                        checklistStr.push(`<span class="inline-block ${colorClass} px-1.5 py-0.5 rounded text-[11px] border shadow-sm mb-1 mr-1">${escapeHtml(labelMap[key]||key)}: ${escapeHtml(val)}</span>`);
                    }
                });

                const statusBadge = item.status === '정상' 
                    ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-green-100 text-green-800">정상</span>`
                    : item.status === '사전메모' ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-orange-100 text-orange-800">사전메모</span>`
                    : `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800">불량</span>`;

                const typeBadge = typeBadgeOf(item, '');

                let defectText = item.defects && item.defects.length > 0 ? `<span class="text-red-600 font-bold mr-1">[${escapeHtml(item.defects.join(', '))}]</span>` : '';
                let noteText = escapeHtml(item.note || '');
                let fullNote = (defectText + noteText) || '<span class="text-gray-400">-</span>';

                let imageHtml = '<span class="text-gray-300 text-xs">-</span>';
                if (item.image) {
                    // 주소는 이스케이프해 속성에만 넣고, 클릭 때는 this.src 를 읽는다(코드 안에 값을 박지 않음).
                    // Storage 주소(https)는 새 탭으로 열고, 옛 Base64(data:image)는 브라우저가 직접 열지 못하므로 빈 창에 <img> 로 넣는다.
                    imageHtml = `
                        <div class="relative group cursor-pointer inline-block">
                            <img src="${escapeHtml(item.image)}" class="h-8 w-8 object-cover rounded border border-gray-300 hover:scale-150 transition-transform z-0 hover:z-10 bg-white" 
                                 onclick="const s=this.src; if(/^data:image[/]/i.test(s)){const w=window.open('','_blank'); if(w){const i=w.document.createElement('img'); i.src=s; i.style.width='100%'; w.document.body.appendChild(i);}} else if(/^https?:/i.test(s)){window.open(s,'_blank','noopener');}">
                        </div>`;
                }

                const inboundQtyDisplay = item.inboundQty ? item.inboundQty.toLocaleString() + '개' : '-';
                const sampleQtyDisplay = item.sampleQty !== undefined ? item.sampleQty : 1;

                return `
                    <tr class="border-b border-indigo-100/50 hover:bg-white transition bg-white/40">
                        <td class="px-4 py-3 text-center">${typeBadge}</td>
                        <td class="px-4 py-3 text-[11px] font-mono text-gray-500 whitespace-nowrap">${escapeHtml(item.date)}<br>${escapeHtml(item.time)}</td>
                        <td class="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">${escapeHtml(item.inboundDate || '-')}</td>
                        <td class="px-4 py-3 text-center">
                            <div class="text-xs font-bold text-gray-700">${escapeHtml(inboundQtyDisplay)}</div>
                            <div class="text-[11px] text-blue-600 font-bold">(샘플검수: ${escapeHtml(sampleQtyDisplay)}개)</div>
                        </td>
                        <td class="px-4 py-3 text-center">${statusBadge}</td>
                        <td class="px-4 py-3 max-w-[300px] leading-tight">${checklistStr.join('') || '-'}</td>
                        <td class="px-4 py-3 text-xs text-gray-700 break-words max-w-[250px]">${fullNote}</td>
                        <td class="px-4 py-3 text-center">${imageHtml}</td>
                        <td class="px-4 py-3 text-right whitespace-nowrap">
                            ${item.fromTotalLog
                                ? totalLogBtns(item.saveId)
                                : `<button class="text-blue-600 hover:text-blue-800 text-[11px] font-bold px-3 py-1.5 rounded border border-blue-200 hover:bg-blue-50 btn-edit-insp-log transition shadow-sm" data-index="${escapeHtml(item.originalIndex)}" data-product-name="${escapeHtml(productName)}">수정</button>`}
                        </td>
                    </tr>
                `;
            }).join('');
        });

        const headerTitle = isQcReport ? `상세 불량 내역 (해당 기간)` : `상세 검수 이력`;

        logsHtml = `
            <div class="p-4 bg-indigo-50/50 border-y border-indigo-200">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-bold text-indigo-900 text-sm flex items-center gap-2">
                        ${escapeHtml(headerTitle)} <span class="text-xs font-normal text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full border border-indigo-200">${escapeHtml(productName)}</span>
                    </h4>
                    <button class="text-xs text-gray-500 hover:text-gray-800 font-bold btn-close-expanded px-3 py-1 rounded hover:bg-gray-200 transition border border-gray-300 bg-white shadow-sm">닫기 ✖</button>
                </div>
                ${totalHtml}
                ${totalHtml ? `<div class="mb-2 text-sm font-bold text-indigo-900">샘플검수 ${escapeHtml(displayLogs.length)}건</div>` : ''}
                <div class="max-h-[400px] overflow-y-auto overflow-x-auto rounded-lg border border-indigo-200 bg-white shadow-sm custom-scrollbar relative">
                    <table class="w-full text-left relative z-0">
                        <thead class="bg-indigo-100 text-[11px] text-indigo-800 uppercase sticky top-0 z-10 shadow-sm outline outline-1 outline-indigo-200">
                            <tr>
                                <th class="px-4 py-2 font-bold whitespace-nowrap w-[6%] bg-indigo-100 text-center">유형</th>
                                <th class="px-4 py-2 font-bold whitespace-nowrap w-[10%] bg-indigo-100">입고(검수)일시</th>
                                <th class="px-4 py-2 font-bold whitespace-nowrap w-[10%] bg-indigo-100">출고일자</th>
                                <th class="px-4 py-2 font-bold text-center whitespace-nowrap w-[8%] bg-indigo-100">수량(입고/샘플검수)</th>
                                <th class="px-4 py-2 font-bold text-center whitespace-nowrap w-[8%] bg-indigo-100">상태</th>
                                <th class="px-4 py-2 font-bold w-[30%] bg-indigo-100">검수항목 (체크리스트)</th>
                                <th class="px-4 py-2 font-bold w-[20%] bg-indigo-100">특이사항/메모</th>
                                <th class="px-4 py-2 font-bold text-center whitespace-nowrap w-[7%] bg-indigo-100">사진</th>
                                <th class="px-4 py-2 font-bold text-right whitespace-nowrap w-[10%] bg-indigo-100">관리</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    tr.innerHTML = `<td colspan="${escapeHtml(colspan)}" class="p-0 border-0 cursor-default">${logsHtml}</td>`;
    targetTr.after(tr); 
};

export const renderQCStatsMode = (historyData, periodType = 'month', selectedPeriod = '') => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    // 아직 불러오지 않았으면(null) '불러오는 중', 불러왔는데 비었으면 '기록 없음' — 둘을 섞어 쓰지 않는다
    if (historyData == null) {
        container.innerHTML = '<div class="text-center py-10 text-gray-500">검수 기록을 불러오는 중입니다...</div>';
        return;
    }
    if (historyData.length === 0) {
        container.innerHTML = '<div class="text-center py-10 text-gray-500">이 기간 검수 기록 없음</div>';
        return;
    }

    const weeks = new Set();
    const months = new Set();
    const years = new Set(); 
    
    historyData.forEach(product => {
        if (product.logs && Array.isArray(product.logs)) {
            product.logs.forEach(log => {
                const type = log.inspectionType === 'total' ? 'total' : 'sample';
                if (currentInspTypeFilter !== 'all' && type !== currentInspTypeFilter) return;

                if (log.date) {
                    years.add(log.date.substring(0, 4)); 
                    months.add(log.date.substring(0, 7)); 
                    weeks.add(getWeekOfYear(new Date(log.date))); 
                }
            });
        }
    });

    const yearOptions = Array.from(years).sort().reverse(); 
    const monthOptions = Array.from(months).sort().reverse();
    const weekOptions = Array.from(weeks).sort().reverse();

    if (!selectedPeriod) {
        if (periodType === 'year') selectedPeriod = yearOptions[0];
        else if (periodType === 'month') selectedPeriod = monthOptions[0];
        else selectedPeriod = weekOptions[0];
    }

    let totalInspectedQty = 0; 
    let totalSampledQty = 0;   
    let totalDefectQty = 0;
    let totalInspectionCount = 0;
    let totalDefectCount = 0;
    const inspectedProducts = new Set();
    const productStats = {}; 

    historyData.forEach(product => {
        const pName = product.id;
        
        if (product.logs && Array.isArray(product.logs)) {
            product.logs.forEach(log => {
                if (!log.date) return;
                
                const type = log.inspectionType === 'total' ? 'total' : 'sample';
                if (currentInspTypeFilter !== 'all' && type !== currentInspTypeFilter) return;

                const logYear = log.date.substring(0, 4); 
                const logMonth = log.date.substring(0, 7);
                const logWeek = getWeekOfYear(new Date(log.date));

                const isMatch = (periodType === 'year' && logYear === selectedPeriod) || 
                                (periodType === 'month' && logMonth === selectedPeriod) || 
                                (periodType === 'week' && logWeek === selectedPeriod);

                if (isMatch) {
                    inspectedProducts.add(pName);
                    
                    if (!productStats[pName]) {
                        productStats[pName] = { totalQty: 0, sampleQty: 0, defectQty: 0, inspCount: 0, defectCount: 0, defectsList: [] };
                    }

                    const qty = Number(log.inboundQty) || Number(log.qty) || 0; 
                    const sampleQty = log.sampleQty !== undefined ? Number(log.sampleQty) : 1;
                    
                    productStats[pName].inspCount += 1;
                    totalInspectionCount += 1;
                    
                    productStats[pName].totalQty += qty;
                    productStats[pName].sampleQty += sampleQty;
                    totalInspectedQty += qty;
                    totalSampledQty += sampleQty;

                    let isDefect = false;
                    const defectReasons = [];
                    const normalValues = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];

                    if (log.status === '불량') isDefect = true;
                    
                    if (log.defects && Array.isArray(log.defects) && log.defects.length > 0) {
                        isDefect = true;
                        defectReasons.push(...log.defects);
                    }

                    if (log.checklist) {
                        const labelMap = { fabric: '원단', color: '컬러', distortion: '뒤틀림', unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추', lining: '안감', pilling: '보풀', dye: '이염', brushed: '기모' };
                        Object.entries(log.checklist).forEach(([key, val]) => {
                            if (key !== 'thickness' && val) {
                                const cleanVal = String(val).trim();
                                if (cleanVal && !normalValues.includes(cleanVal)) {
                                    isDefect = true;
                                    defectReasons.push(`${labelMap[key] || key}: ${cleanVal}`);
                                }
                            }
                        });
                    }

                    if (isDefect) {
                        productStats[pName].defectCount += 1;
                        totalDefectCount += 1;
                        
                        // 불량 수량 — 샘플은 지금처럼 입고 수량, 전량은 그 저장의 불량 개수(lib/total-insp.js logDefectQty)
                        const dq = logDefectQty(log);
                        productStats[pName].defectQty += dq;
                        totalDefectQty += dq;

                        if (defectReasons.length > 0) {
                            productStats[pName].defectsList.push(...defectReasons);
                        } else {
                            productStats[pName].defectsList.push('상태 불량/기타');
                        }
                    }
                }
            });
        }
    });

    const qtyDefectRate = totalInspectedQty > 0 ? ((totalDefectQty / totalInspectedQty) * 100).toFixed(1) : 0;
    const countDefectRate = totalInspectionCount > 0 ? ((totalDefectCount / totalInspectionCount) * 100).toFixed(1) : 0;
    const totalProductTypes = inspectedProducts.size;

    const topDefectiveProducts = Object.entries(productStats)
        .map(([name, stats]) => ({
            name,
            totalQty: stats.totalQty,
            sampleQty: stats.sampleQty, 
            defectQty: stats.defectQty,
            qtyRate: stats.totalQty > 0 ? ((stats.defectQty / stats.totalQty) * 100).toFixed(1) : 0,
            inspCount: stats.inspCount,
            defectCount: stats.defectCount,
            countRate: stats.inspCount > 0 ? ((stats.defectCount / stats.inspCount) * 100).toFixed(1) : 0,
            commonDefects: [...new Set(stats.defectsList)].join(', ') || '-'
        }))
        .filter(p => p.defectCount > 0 || p.defectQty > 0)
        .sort((a, b) => b.defectCount - a.defectCount || b.defectQty - a.defectQty) 
        .slice(0, 15);

    container.innerHTML = `
        <div class="absolute inset-0 flex flex-col bg-gray-50 p-4 rounded-lg overflow-y-auto custom-scrollbar">
            
            <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-4 flex gap-4 items-end shrink-0">
                <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">통계 기준</label>
                    <select id="qc-period-type" class="border border-gray-300 rounded p-1.5 text-sm focus:ring-indigo-500">
                        <option value="year" ${periodType === 'year' ? 'selected' : ''}>연간 (Yearly)</option> 
                        <option value="month" ${periodType === 'month' ? 'selected' : ''}>월간 (Monthly)</option>
                        <option value="week" ${periodType === 'week' ? 'selected' : ''}>주간 (Weekly)</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">조회 기간</label>
                    <select id="qc-period-value" class="border border-gray-300 rounded p-1.5 text-sm focus:ring-indigo-500 min-w-[120px]">
                        ${periodType === 'year'
                            ? yearOptions.map(y => `<option value="${escapeHtml(y)}" ${selectedPeriod === y ? 'selected' : ''}>${escapeHtml(y)}년</option>`).join('')
                            : periodType === 'month' 
                                ? monthOptions.map(m => `<option value="${escapeHtml(m)}" ${selectedPeriod === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')
                                : weekOptions.map(w => `<option value="${escapeHtml(w)}" ${selectedPeriod === w ? 'selected' : ''}>${escapeHtml(w)}</option>`).join('')
                        }
                    </select>
                </div>
                <button id="btn-refresh-qc" class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold py-1.5 px-4 rounded shadow transition">
                    조회
                </button>
            </div>

            ${!selectedPeriod ? `<div class="text-center text-gray-500 py-10">해당 유형/기간에 검수 데이터가 없습니다.</div>` : `
            
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 shrink-0">
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-indigo-500">
                    <div class="text-xs text-gray-500 mb-1">총 검수 대상(입고) / 실제(샘플검수)</div>
                    <div class="text-xl font-bold text-gray-800">
                        ${escapeHtml(totalInspectedQty.toLocaleString())}<span class="text-sm font-normal text-gray-500">개</span> <span class="text-gray-300 mx-1">/</span> <span class="text-blue-600">${escapeHtml(totalSampledQty.toLocaleString())}</span><span class="text-sm font-normal text-gray-500">개</span>
                    </div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-500">
                    <div class="text-xs text-gray-500 mb-1">검수 상품 종류</div>
                    <div class="text-2xl font-bold text-gray-800">${escapeHtml(totalProductTypes.toLocaleString())} <span class="text-sm font-normal text-gray-500">종</span></div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-red-500">
                    <div class="text-xs text-gray-500 mb-1">불량 발생 횟수 / 수량</div>
                    <div class="text-xl font-bold text-red-600">${escapeHtml(totalDefectCount.toLocaleString())}<span class="text-sm font-normal text-gray-500">회</span> <span class="text-gray-300 mx-1">/</span> ${escapeHtml(totalDefectQty.toLocaleString())}<span class="text-sm font-normal text-gray-500">개</span></div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 ${countDefectRate > 10 ? 'border-red-500' : 'border-orange-500'}">
                    <div class="text-xs text-gray-500 mb-1">평균 불량률 (횟수 / 수량)</div>
                    <div class="text-xl font-bold text-orange-600">${escapeHtml(countDefectRate)}<span class="text-sm font-normal text-gray-500">%</span> <span class="text-gray-300 mx-1">/</span> ${escapeHtml(qtyDefectRate)}<span class="text-sm font-normal text-gray-500">%</span></div>
                </div>
            </div>

            <div class="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col shrink-0 mb-8">
                <div class="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
                    <h3 class="font-bold text-gray-700">QC 집중 관리 대상 (발생 횟수 최다 상품 TOP 15)</h3>
                    <span class="text-xs text-gray-500 bg-white border border-gray-200 px-2 py-1 rounded shadow-sm">행을 클릭하면 해당 기간의 불량 상세 내역을 볼 수 있습니다.</span>
                </div>
                
                <div class="overflow-x-auto relative">
                    <table class="w-full text-sm text-left relative">
                        <thead class="text-xs text-gray-500 bg-gray-50 outline outline-1 outline-gray-200">
                            <tr class="bg-gray-50">
                                <th class="px-4 py-3 border-b">상품명</th>
                                <th class="px-4 py-3 text-center border-b border-l bg-gray-100/50" colspan="3">검수 횟수 (상품 건별) 기준</th>
                                <th class="px-4 py-3 text-center border-b border-l" colspan="3">샘플검수 수량 (개수) 기준</th>
                                <th class="px-4 py-3 border-b border-l">주요 불량 사유</th>
                            </tr>
                            <tr class="text-[11px] text-gray-400 bg-gray-50">
                                <th class="px-4 py-2 border-b"></th>
                                <th class="px-2 py-2 text-center border-b border-l bg-gray-100/50">총 횟수</th>
                                <th class="px-2 py-2 text-center border-b bg-gray-100/50">불량 횟수</th>
                                <th class="px-2 py-2 text-center border-b bg-gray-100/50">횟수 불량률</th>
                                <th class="px-2 py-2 text-center border-b border-l">입고 / 샘플검수 수량</th>
                                <th class="px-2 py-2 text-center border-b">불량 수량</th>
                                <th class="px-2 py-2 text-center border-b">수량 불량률</th>
                                <th class="px-4 py-2 border-b border-l"></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100 relative z-0">
                            ${topDefectiveProducts.length === 0 ? `
                                <tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">발견된 불량 내역이 없습니다.</td></tr>
                            ` : topDefectiveProducts.map((p, idx) => `
                                <tr class="hover:bg-indigo-50/50 transition cursor-pointer btn-view-detail group" 
                                    data-product-name="${escapeHtml(p.name)}" 
                                    data-is-qc-report="true"
                                    data-qc-period-type="${escapeHtml(periodType)}"
                                    data-qc-period-value="${escapeHtml(selectedPeriod)}"
                                    title="해당 기간의 불량 상세 이력 펼치기">
                                    <td class="px-4 py-3 font-medium text-gray-900 break-words max-w-[200px]">
                                        <span class="inline-block w-4 h-4 text-center rounded-full ${idx < 3 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'} text-[11px] mr-1 leading-4">${idx + 1}</span>
                                        <span class="group-hover:text-indigo-600 group-hover:underline transition-all">${escapeHtml(p.name)}</span>
                                    </td>
                                    
                                    <td class="px-2 py-3 text-center text-gray-600 border-l bg-gray-50/30 group-hover:bg-transparent">${escapeHtml(p.inspCount)}회</td>
                                    <td class="px-2 py-3 text-center font-bold text-red-600 bg-gray-50/30 group-hover:bg-transparent">${escapeHtml(p.defectCount)}회</td>
                                    <td class="px-2 py-3 text-center bg-gray-50/30 group-hover:bg-transparent">
                                        <span class="px-2 py-1 rounded text-[11px] font-bold ${p.countRate > 20 ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}">
                                            ${escapeHtml(p.countRate)}%
                                        </span>
                                    </td>

                                    <td class="px-2 py-3 text-center text-gray-500 border-l group-hover:bg-transparent">
                                        <div class="text-xs font-bold text-gray-700">${escapeHtml(p.totalQty.toLocaleString())}개</div>
                                        <div class="text-[11px] text-blue-600 font-bold">(샘플: ${escapeHtml(p.sampleQty.toLocaleString())}개)</div>
                                    </td>
                                    <td class="px-2 py-3 text-center text-orange-600 group-hover:bg-transparent">${escapeHtml(p.defectQty)}개</td>
                                    <td class="px-2 py-3 text-center group-hover:bg-transparent">
                                        <span class="text-[11px] text-gray-500">${escapeHtml(p.qtyRate)}%</span>
                                    </td>

                                    <td class="px-4 py-3 text-[11px] text-gray-500 break-words border-l max-w-[250px] group-hover:bg-transparent">${escapeHtml(p.commonDefects)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            `}
        </div>
    `;
};