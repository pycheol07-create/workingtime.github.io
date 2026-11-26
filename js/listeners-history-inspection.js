// === js/listeners-history-inspection.js ===
import * as DOM from './dom-elements.js?v=2b9f19ecbde2-82fbef91';
import * as State from './state.js?v=c7f5fc984ef9-a2ce38c0';
import { showToast, getTodayDateString, showConfirm } from './utils.js?v=65bb3512764f-e315797c';
import { dayInspItems } from './lib/insp-day.js?v=d859a7e39527-456c14c8';
import { hasBrushed } from './lib/insp-flow.js?v=5447d8e8a137-43ce67d4';
import { TASK, tName } from './task-names.js?v=33eb5ccd69bc-26ab8ff7';

import { 
    renderInspectionHistoryTable, 
    renderInspectionLayout,
    renderInspectionListMode
} from './ui-history.js?v=8975ac4ffa03-b575143a'; 
import { clearInspResultCache, seedInspResultCache, fetchTotalInspLogs, totalInspLogsTruncated, TOTAL_LOG_LIMIT } from './ui-history-inspection.js?v=d90d33878f7c-92ecfe05';   // 정상여부 캐시 · 전량 기록
import { mergeIntoProductHistory, nameKey, totalHistoryLogsOf, bulkSummary, bulkMessage } from './lib/total-insp.js?v=d83d978fa87f-5334595d';
import { editTotalLog, deleteTotalLog, listDayLogs, listProductLogs, deleteTotalDay, deleteTotalProduct, askTotalLogEdit, fetchAccDocs, removeOrRevertOne, setAccStatus, deleteAccDocIfEmpty } from './total-insp-edit.js?v=00825b3b7e9c-892af557';
import { historyRangeStart } from './lib/history-window.js?v=2641998b437e-d3102a84';

import { 
    setSortState, 
    renderQCStatsMode, 
    currentInspTypeFilter, 
    setInspTypeFilter 
} from './ui-history-inspection.js?v=d90d33878f7c-92ecfe05';

import {
    loadInspectionLogs,
    prepareEditInspectionLog,
    updateInspectionLog,
    deleteInspectionLog,
    deleteProductHistory,
    deleteHistoryInspectionList,
    savePreInspectionNote,
    handleManualImageSelect, 
    clearManualImageState    
} from './inspection-logic.js?v=d8811172578b-e4d6f36f';

import { collection, getDocs, doc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let cachedInspectionData = null;   // null = 아직 안 불러옴('불러오는 중'), [] = 불러왔는데 기록 없음
// 이 화면(같은 탭)에서 검수를 저장하면 다음 보기 전환 때 새로 읽는다(js/inspection-logic.js 가 보냄).
//   다른 PC·다른 탭에서 저장한 것은 탭에 다시 들어오거나 [새로고침] 때 보인다.
document.addEventListener('product-history-changed', () => { cachedInspectionData = null; mergedView = null; });

// 전량검수 기록(total_inspection_logs, 2026-11-17) — 보기 기간 시작일(이력과 같은 13개월 + 이번 달) 이후를 탭에 들어올 때·[새로고침] 때 한 번 읽는다.
//   null = 아직 못 읽음(실패 포함 — 전량 없이 보이고 경고만). 상품별·품질 통계는 product_history 복사본에 합쳐 보인다(문서에는 쓰지 않는다).
let cachedTotalLogs = null;
let cachedAccDocs = null;     // 전량검수 진행 문서(상품별 보기 진행 문서 줄 — 기록이 없어도 진행 문서가 있으면 보인다)
let mergedView = null;        // mergeIntoProductHistory 결과 — 두 캐시가 바뀔 때만 다시 만든다
const productView = () => {
    if (!Array.isArray(cachedInspectionData)) return cachedInspectionData;
    if (!mergedView) mergedView = mergeIntoProductHistory(cachedInspectionData, cachedTotalLogs || [], cachedAccDocs || []);
    return mergedView;
};
async function loadTotalLogs(force) {
    if (!force && Array.isArray(cachedTotalLogs)) return;
    try {
        cachedTotalLogs = await fetchTotalInspLogs(historyRangeStart(getTodayDateString(), 13), { force: !!force });
        if (totalInspLogsTruncated()) showToast(`전량검수 기록이 많아 최근 ${TOTAL_LOG_LIMIT}건만 보입니다.`, true);
        try { cachedAccDocs = await fetchAccDocs({ force: !!force }); }
        catch (e2) { console.warn('전량검수 진행 문서 읽기 실패:', e2 && e2.code ? e2.code : e2); cachedAccDocs = null; }
    } catch (e) {
        console.warn('전량검수 기록 읽기 실패 — 전량 없이 보입니다:', e && e.code ? e.code : e);
        cachedTotalLogs = null;
        showToast('전량검수 기록을 읽지 못했습니다(샘플 기록만 보입니다).', true);
    }
    mergedView = null;
}

// 검수이력 일자별 보기 → 그 날짜의 '대기' 항목을 오늘 검수 대기 리스트에 불러와 이어서 진행.
// (검수 매니저는 메인 앱에 있으므로, 여기선 오늘 daily_data의 inspectionList에 머지 저장만 하고
//  사용자는 메인 화면 '샘플검수'에서 이어서 진행한다. 메인 탭은 onSnapshot으로 자동 반영됨.)
async function resumeInspectionFromDate(date) {
    const day = (State.allHistoryData || []).find(d => d.id === date);
    const pending = (day && Array.isArray(day.inspectionList) ? day.inspectionList : [])
        .filter(it => it.status !== '완료');
    if (pending.length === 0) { showToast('이어서 할 대기 항목이 없습니다.', true); return; }
    try {
        const today = getTodayDateString();
        const todayRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
        // 서버 리스트를 읽고 붙인다(runTransaction — 그사이 다른 기기가 넣은 줄을 지우지 않게, 2026-11-17)
        const keyOf = (it) => `${it.name || ''}|${it.code || ''}|${it.packingDate || ''}`;
        const { merged, toAdd } = await runTransaction(State.db, async (tx) => {
            const snap = await tx.get(todayRef);
            const current = (snap.exists() && Array.isArray(snap.data().inspectionList)) ? snap.data().inspectionList : [];
            const seen = new Set(current.map(keyOf));
            const add = pending.filter(it => !seen.has(keyOf(it))).map(it => ({ ...it, status: '대기' }));
            const next = [...current, ...add];
            if (add.length > 0) tx.set(todayRef, { inspectionList: next }, { merge: true });
            return { merged: next, toAdd: add };
        });
        if (toAdd.length === 0) { showToast('이미 오늘 검수 대기 리스트에 모두 들어 있습니다.'); return; }
        if (State.appState) State.appState.inspectionList = merged;
        showToast(`검수 대기 리스트에 ${toAdd.length}건을 불러왔습니다. 메인 화면 '${tName(TASK.sample)}'에서 이어서 진행하세요.`);
    } catch (err) {
        console.error('이어서 검수 불러오기 실패:', err);
        showToast('이어서 검수 불러오기에 실패했습니다.', true);
    }
}

// reuse: 이미 읽은 상품별 검수 기록(cachedInspectionData)으로 다시 그리기만 — 유형 필터·보기 전환·날짜 선택 때
//   (2026-11-04 Firestore 읽기 줄이기: 전엔 바꿀 때마다 product_history 전체를 다시 읽었다).
//   탭 진입·새로고침·저장/삭제 뒤에는 지금처럼 새로 읽는다(reuse 없이 부른다).
export const fetchAndRenderInspectionHistory = async ({ reuse = false } = {}) => {
    const container = DOM.inspectionHistoryViewContainer;
    if (!container) return;

    renderInspectionLayout(container);

    const contentArea = document.getElementById('inspection-content-area');
    contentArea.innerHTML = '<div class="text-center text-gray-500 py-10 flex flex-col items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>데이터를 불러오는 중입니다...</div>';

    const viewMode = State.context.inspectionViewMode || 'product';
    if (!reuse) clearInspResultCache();   // 탭 진입·새로고침 때는 정상여부도 새로 읽는다
    await loadTotalLogs(!reuse);          // 전량검수 기록 — reuse 면 읽어 둔 것(못 읽었으면 한 번 더)

    if (viewMode === 'product' || viewMode === 'qc') {
        try {
            if (!(reuse && Array.isArray(cachedInspectionData))) {
                const colRef = collection(State.db, 'product_history');
                const snapshot = await getDocs(colRef);

                cachedInspectionData = [];
                snapshot.forEach(doc => {
                    cachedInspectionData.push({ id: doc.id, ...doc.data() });
                });
                mergedView = null;
                seedInspResultCache(cachedInspectionData);   // 일자별 보기 정상여부가 같은 문서를 또 읽지 않게
            }

            if (viewMode === 'product') {
                renderInspectionHistoryTable(productView());
            } else if (viewMode === 'qc') {
                renderQCStatsMode(productView(), 'month', '');
            }
        } catch (e) {
            console.error("Error loading inspection history:", e);
            contentArea.innerHTML = '<div class="text-center text-red-500 py-10">데이터 로딩 실패</div>';
        }
    } else if (viewMode === 'list') {
        const dateList = [];
        State.allHistoryData.forEach(day => {
            const items = dayInspItems(day);   // 매니저에서 비운 완료(inspectionDone)도 그날 기록
            if (items.length > 0) {
                dateList.push({
                    date: day.id,
                    count: items.length,
                    data: items
                });
            }
        });

        dateList.sort((a, b) => b.date.localeCompare(a.date));

        // 전량검수 기록만 있는 날도 날짜 목록에 — renderInspectionListMode 가 totalLogs 로 넣고 표 아래 '전량검수 n건'
        const totals = cachedTotalLogs || [];
        if (dateList.length > 0 || totals.length > 0) {
            if (!State.context.selectedInspectionDate) {
                State.context.selectedInspectionDate = dateList.length ? dateList[0].date : '';
            }
            const selectedData = dateList.find(d => d.date === State.context.selectedInspectionDate);
            renderInspectionListMode(dateList, selectedData ? selectedData.data : [], totals);
        } else {
            renderInspectionListMode([], [], []);
        }
    }
};

// ── 전량검수 기록 수정·삭제(2026-11-17, js/total-insp-edit.js) ────────────────────────────────
let totalBusy = false;
/** 고친 뒤 — 전량 기록 캐시(엑셀도 같은 캐시)를 새로 읽고 지금 보기를 다시 그린다. */
async function refreshAfterTotalEdit() {
    await loadTotalLogs(true);
    await fetchAndRenderInspectionHistory({ reuse: true });
}
const missingNote = (r) => [
    r.qtyMissing && r.qtyMissing.length ? `처리량 문서가 없어 못 고친 날짜: ${r.qtyMissing.join(', ')}` : '',
    r.accMissing ? '누적(진행 목록) 문서가 없어 기록만 고쳤습니다' : '',
].filter(Boolean).join(' · ');

/** @returns {Promise<boolean>} 전량 버튼이었으면 true(다른 처리 안 함) */
async function handleTotalLogClick(e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return false;
    const editBtn = t.closest('[data-tl-edit]');
    const delBtn = t.closest('[data-tl-del]');
    const dayBtn = t.closest('[data-tl-day-del]');
    const prodBtn = t.closest('[data-tl-prod-del]');
    const accBtn = t.closest('[data-ta-revert],[data-ta-done],[data-ta-reopen],[data-ta-del]');
    if (!editBtn && !delBtn && !dayBtn && !prodBtn && !accBtn) return false;
    e.stopPropagation();
    if (e.__totalLogHandled) return true;   // 같은 클릭이 두 번 들어와도(리스너가 겹쳐 붙은 경우) 한 번만
    e.__totalLogHandled = true;
    if (totalBusy) { showToast('앞 작업을 처리하는 중입니다.', true); return true; }
    totalBusy = true;
    let needRefresh = false;
    try {
        if (accBtn) {   // 진행 문서 줄(상품별 보기) — 회차 되돌리기·완료로·다시 진행·진행 문서 삭제
            const d = accBtn.dataset;
            const key = d.taRevert || d.taDone || d.taReopen || d.taDel;
            const a = (cachedAccDocs || []).find(x => x.id === key) || {};
            const nm = `${a.name || ''}${a.option ? ` / ${a.option}` : ''}`;
            let r;
            if (d.taRevert) {
                const ok = await showConfirm(`${nm}\n${Math.max(1, Number(a.round) || 1)}회차(기록 없음)를 지우고 직전 회차 완료 상태로 되돌립니다.\n직전 회차 기록을 합쳐 누적·검수수량·종료일을 되살립니다.`,
                    { title: '회차 되돌리기', okText: '되돌리기', cancelText: '취소' });
                if (!ok) return true;
                r = await removeOrRevertOne(key, { mode: 'revert' });
                if (r.ok) showToast('직전 회차 완료 상태로 되돌렸습니다.');
            } else if (d.taDel) {
                const ok = await showConfirm(`${nm}\n기록이 없는 진행 문서를 지웁니다.`, { title: '진행 문서 삭제', okText: '삭제', cancelText: '취소', danger: true });
                if (!ok) return true;
                r = await deleteAccDocIfEmpty(key);
                if (r.ok) showToast(r.gone ? '이미 지워진 진행 문서입니다.' : '진행 문서를 지웠습니다.');
            } else {
                const toDone = !!d.taDone;
                const ok = await showConfirm(`${nm}\n${toDone ? '완료로 바꿉니다(종료일 = 오늘).' : '다시 진행으로 바꿉니다(종료일을 비움).'}`,
                    { title: toDone ? '완료로' : '다시 진행', okText: toDone ? '완료로' : '다시 진행', cancelText: '취소' });
                if (!ok) return true;
                r = await setAccStatus(key, toDone ? 'done' : 'reopen');
                if (r.ok) showToast(toDone ? '완료로 바꿨습니다.' : '다시 진행으로 바꿨습니다.');
            }
            if (!r.ok) showToast(r.message, true);
            needRefresh = true;
            return true;
        }
        if (editBtn) {
            const id = editBtn.dataset.tlEdit;
            const log = (cachedTotalLogs || []).find(l => (l.id || l.saveId) === id);
            if (!log) { showToast('기록을 찾지 못했습니다. [새로고침] 뒤 다시 눌러 주세요.', true); return true; }
            const input = await askTotalLogEdit(log);
            if (!input) return true;
            const r = await editTotalLog(id, input);
            if (!r.ok) { showToast(r.message, true); return true; }
            const note = [r.otherRound ? '다른 회차 기록이라 누적은 그대로' : '', missingNote(r)].filter(Boolean).join(' · ');
            showToast(`전량검수 기록을 고쳤습니다.${note ? ` (${note})` : ''}`, !!missingNote(r));
            needRefresh = true;
            return true;
        }
        if (delBtn) {
            const id = delBtn.dataset.tlDel;
            const log = (cachedTotalLogs || []).find(l => (l.id || l.saveId) === id) || {};
            const ok = await showConfirm(`${log.name || '전량검수 기록'}${log.option ? ` / ${log.option}` : ''} · ${log.date || ''}\n${bulkMessage(bulkSummary([log]))}`,
                { title: '전량검수 기록 삭제', okText: '삭제', cancelText: '취소', danger: true });
            if (!ok) return true;
            const r = await deleteTotalLog(id);
            if (!r.ok) { showToast(r.message, true); needRefresh = true; return true; }
            const note = missingNote({ ...r, accMissing: r.accMissing > 0 });
            showToast(r.deleted ? `삭제했습니다.${note ? ` (${note})` : ''}` : '이미 지워진 기록입니다.', !!note);
            needRefresh = true;
            return true;
        }
        if (dayBtn) {
            const date = dayBtn.dataset.tlDayDel;
            const { logs, summary } = await listDayLogs(date);
            if (!logs.length) { showToast('이 날의 전량검수 기록이 없습니다.', true); needRefresh = true; return true; }
            const ok = await showConfirm(`${date} 전량검수 기록을 모두 지웁니다.\n${bulkMessage(summary)}`,
                { title: '이 날 전량검수 삭제', okText: '삭제', cancelText: '취소', danger: true });
            if (!ok) return true;
            const r = await deleteTotalDay(logs);
            const note = missingNote({ ...r, accMissing: false });
            showToast(r.ok ? `${r.deleted}건 삭제했습니다.${note ? ` (${note})` : ''}` : r.message, !r.ok || !!note);
            needRefresh = true;
            return true;
        }
        const name = prodBtn.dataset.tlProdDel;
        const { logs, accKeys, accStamps, summary } = await listProductLogs(name);
        if (!logs.length && !accKeys.length) { showToast('이 상품의 전량검수 기록이 없습니다.', true); needRefresh = true; return true; }
        const ok = await showConfirm(`'${name}' 의 전량검수 기록 전부와 진행 목록(누적 ${accKeys.length}건)을 지웁니다.\n${bulkMessage(summary)}`,
            { title: '전량검수 기록 삭제', okText: '삭제', cancelText: '취소', danger: true });
        if (!ok) return true;
        const r = await deleteTotalProduct(name, logs, accKeys, accStamps);
        const note = missingNote({ ...r, accMissing: false });
        showToast(r.ok ? `기록 ${r.deleted}건·누적 ${r.accDeleted || 0}건 삭제했습니다.${note ? ` (${note})` : ''}` : r.message, !r.ok || !!note);
        needRefresh = true;
        return true;
    } catch (err) {
        console.error('[전량검수 기록] 처리 실패:', err && err.code ? err.code : err);
        showToast(err && err.code === 'permission-denied' ? '권한이 없습니다.' : '처리하지 못했습니다. 다시 눌러 주세요.', true);
        return true;
    } finally {
        // 처리 중 표시는 여기서 먼저 푼다 — 다시 읽기·다시 그리기는 기다리지 않는다(리뷰 0: 예전엔 [수정] 뒤 다시 그리기를
        //   기다리는 동안 표시가 남아, 바로 [삭제]를 누르면 '앞 작업을 처리하는 중'으로 막혔다)
        totalBusy = false;
        if (needRefresh) refreshAfterTotalEdit().catch(err => console.warn('[전량검수 기록] 다시 그리기 실패:', err && err.code ? err.code : err));
    }
}

export function setupHistoryInspectionListeners() {

    const preModal = document.getElementById('pre-register-inspection-modal');
    if (preModal) {
        preModal.addEventListener('click', async (e) => {
            if (e.target.closest('#close-pre-insp-modal') || e.target.closest('#cancel-pre-insp-btn')) {
                preModal.classList.add('hidden');
                clearManualImageState(); 
            }
            if (e.target.closest('#save-pre-insp-btn')) {
                const success = await savePreInspectionNote();
                if (success) {
                    fetchAndRenderInspectionHistory(); 
                }
            }
            if (e.target.closest('#manual-insp-image-clear-btn')) {
                clearManualImageState();
            }
        });

        const imageInput = document.getElementById('manual-insp-image');
        if (imageInput) {
            imageInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    handleManualImageSelect(file);
                }
            });
        }
    }

    if (DOM.inspectionHistoryViewContainer) {
        
        DOM.inspectionHistoryViewContainer.addEventListener('change', (e) => {
            // ⭐ [신규] 상단 검수 유형 필터 (전체/샘플/전량) 선택 시 다시 렌더링
            if (e.target.id === 'insp-type-filter') {
                setInspTypeFilter(e.target.value);
                fetchAndRenderInspectionHistory({ reuse: true });
                return;
            }
            if (e.target.id === 'qc-period-type') {
                renderQCStatsMode(productView(), e.target.value, '');
                return;
            }
        });

        DOM.inspectionHistoryViewContainer.addEventListener('click', async (e) => {
            // 전량검수 기록 [수정]·[삭제]·[이 날 전량검수 삭제]·[전량검수 기록 삭제](상품) — 줄 클릭(상세 펼치기)보다 먼저 본다
            if (await handleTotalLogClick(e)) return;
            
            const addPreBtn = e.target.closest('#btn-add-pre-inspection');
            if (addPreBtn) {
                const modal = document.getElementById('pre-register-inspection-modal');
                if (modal) {
                    modal.classList.remove('hidden');
                    
                    const getEl = (id) => document.getElementById(id);
                    if (getEl('manual-insp-type')) getEl('manual-insp-type').value = 'sample'; // 기본값 세팅
                    if (getEl('manual-insp-product-name')) getEl('manual-insp-product-name').value = '';
                    if (getEl('manual-insp-brushed-field')) getEl('manual-insp-brushed-field').classList.add('hidden');
                    if (getEl('manual-insp-check-brushed')) getEl('manual-insp-check-brushed').value = '양호';
                    if (getEl('manual-insp-product-name') && !getEl('manual-insp-product-name').dataset.brushedBound) {
                        getEl('manual-insp-product-name').dataset.brushedBound = '1';
                        getEl('manual-insp-product-name').addEventListener('input', (ev) => {
                            const f = document.getElementById('manual-insp-brushed-field');
                            if (f) f.classList.toggle('hidden', !hasBrushed(ev.target.value));
                        });
                    }
                    if (getEl('manual-insp-code')) getEl('manual-insp-code').value = '';
                    if (getEl('manual-insp-option')) getEl('manual-insp-option').value = '';
                    if (getEl('manual-insp-qty')) getEl('manual-insp-qty').value = '';
                    if (getEl('manual-insp-check-thickness')) getEl('manual-insp-check-thickness').value = '';
                    if (getEl('manual-insp-supplier')) getEl('manual-insp-supplier').value = '';
                    if (getEl('manual-insp-note')) getEl('manual-insp-note').value = '';
                    if (getEl('manual-insp-packing-date')) getEl('manual-insp-packing-date').value = '';
                    
                    if (getEl('manual-insp-inbound-date')) getEl('manual-insp-inbound-date').value = getTodayDateString();
                    
                    const selects = modal.querySelectorAll('select:not(#manual-insp-type)'); // 유형 셀렉트 제외 초기화
                    selects.forEach(sel => sel.value = "정상"); 
                    
                    clearManualImageState();
                }
                return;
            }

            const refreshQcBtn = e.target.closest('#btn-refresh-qc');
            if (refreshQcBtn) {
                const typeSelect = document.getElementById('qc-period-type');
                const valueSelect = document.getElementById('qc-period-value');
                if (typeSelect && valueSelect) {
                    renderQCStatsMode(productView(), typeSelect.value, valueSelect.value);
                }
                return;
            }

            const resumeBtn = e.target.closest('.btn-resume-insp');
            if (resumeBtn) {
                await resumeInspectionFromDate(resumeBtn.dataset.date);
                return;
            }

            const deleteListBtn = e.target.closest('.btn-delete-history-list');
            if (deleteListBtn) {
                const dateKey = deleteListBtn.dataset.date;
                const success = await deleteHistoryInspectionList(dateKey);
                if (success) {
                    State.context.selectedInspectionDate = null;
                    fetchAndRenderInspectionHistory();
                }
                return;
            }

            const deleteProductBtn = e.target.closest('.btn-delete-product');
            if (deleteProductBtn) {
                const productName = deleteProductBtn.dataset.productName;
                const success = await deleteProductHistory(productName);
                if (success) {
                    fetchAndRenderInspectionHistory();
                }
                return;
            }

            const closeExpandedBtn = e.target.closest('.btn-close-expanded');
            if (closeExpandedBtn) {
                closeExpandedBtn.closest('.expanded-detail-row').remove();
                return;
            }

            const editBtn = e.target.closest('.btn-edit-insp-log');
            if (editBtn) {
                const index = parseInt(editBtn.dataset.index, 10);
                const productName = editBtn.dataset.productName;
                prepareEditInspectionLog(productName, index);
                return;
            }

            const tabBtn = e.target.closest('button[data-insp-tab]');
            if (tabBtn) {
                const mode = tabBtn.dataset.inspTab;
                if (State.context.inspectionViewMode !== mode) {
                    State.context.inspectionViewMode = mode;
                    State.context.selectedInspectionDate = null; 
                    fetchAndRenderInspectionHistory({ reuse: true }); 
                }
                return;
            }

            const dateBtn = e.target.closest('.btn-select-insp-date');
            if (dateBtn) {
                const date = dateBtn.dataset.date;
                if (State.context.selectedInspectionDate !== date) {
                    State.context.selectedInspectionDate = date;
                    fetchAndRenderInspectionHistory({ reuse: true }); 
                }
                return;
            }

            const th = e.target.closest('th[data-sort-key]');
            if (th) {
                const key = th.dataset.sortKey;
                setSortState(key);
                renderInspectionHistoryTable(productView());
                return;
            }

            const detailBtn = e.target.closest('.btn-view-detail');
            if (detailBtn) {
                const tr = detailBtn.tagName === 'TR' ? detailBtn : detailBtn.closest('tr');
                const productName = tr.dataset.productName;

                const nextTr = tr.nextElementSibling;
                if (nextTr && nextTr.classList.contains('expanded-detail-row')) {
                    nextTr.remove(); 
                    return;
                }

                // 전량검수는 [상세보기] 위쪽 칸에 따로(옵션별 진행 + 저장 기록 수정·삭제), 아래 표는 샘플 기록만(2026-11-19)
                //   일자별·QC 리포트 줄은 예전처럼(전량 기록을 같은 표에 — 그 화면의 날짜·불량 거르기를 탄다, 리뷰)
                if (State.context.inspectionViewMode !== 'product' || tr.dataset.isQcReport === 'true') {
                    loadInspectionLogs(productName, tr, totalHistoryLogsOf(cachedTotalLogs || [], productName));
                    return;
                }
                const key = nameKey(productName);
                const item = (productView() || []).find(x => x && x.id === productName) || {};
                loadInspectionLogs(productName, tr, [], {
                    logs: (cachedTotalLogs || []).filter(l => l && nameKey(l.name) === key),
                    docs: Array.isArray(item.totalDocs) ? item.totalDocs : [],
                });
                return;
            }
        });
    }

    if (DOM.inspectionHistorySearchInput) {
        DOM.inspectionHistorySearchInput.addEventListener('input', () => {
            if (State.context.inspectionViewMode === 'product') {
                renderInspectionHistoryTable(productView());
            }
        });
    }

    if (DOM.inspectionHistoryRefreshBtn) {
        DOM.inspectionHistoryRefreshBtn.addEventListener('click', () => {
            fetchAndRenderInspectionHistory();
        });
    }

    if (DOM.saveInspLogBtn) {
        DOM.saveInspLogBtn.addEventListener('click', async () => {
            await updateInspectionLog();
            if (State.context.activeMainHistoryTab === 'inspection') {
                fetchAndRenderInspectionHistory(); 
            }
        });
    }

    if (DOM.deleteInspLogBtn) {
        DOM.deleteInspLogBtn.addEventListener('click', async () => {
            await deleteInspectionLog();
            if (State.context.activeMainHistoryTab === 'inspection') {
                fetchAndRenderInspectionHistory();
            }
        });
    }
}