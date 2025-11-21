// === js/inspection-logic.js ===
// 설명: 검수 이력 조회, 저장, 리스트 관리, 수정/삭제 등 핵심 로직을 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getCurrentTime, getTodayDateString } from './utils.js';

import { 
    doc, getDoc, setDoc, updateDoc, arrayUnion, increment, serverTimestamp, collection, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 렌더링 함수 임포트
import { renderInspectionHistoryTable, renderInspectionLogTable } from './ui-history-inspection.js';

// 로컬 상태 변수
let todayInspectionList = [];
let currentProductLogs = []; // 상세보기를 위한 임시 저장소

/**
 * 1. 상품명으로 과거 검수 이력 조회 (입력 모달용)
 */
export const searchProductHistory = async () => {
    const productNameInput = DOM.inspProductNameInput.value.trim();
    if (!productNameInput) {
        showToast('상품명을 입력해주세요.', true);
        return;
    }

    DOM.inspHistoryReport.classList.remove('hidden');
    DOM.inspCurrentInputArea.classList.remove('hidden');
    DOM.inspAlertBox.classList.add('hidden');
    DOM.inspReportTitle.textContent = productNameInput;
    DOM.inspReportCount.textContent = '0';
    DOM.inspReportDate.textContent = '-';
    
    resetInspectionForm(false); 

    try {
        const docRef = doc(State.db, 'product_history', productNameInput);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            DOM.inspReportCount.textContent = data.totalInbound || 0;
            DOM.inspReportDate.textContent = data.lastInspectionDate || '-';

            if (data.defectSummary && data.defectSummary.length > 0) {
                DOM.inspAlertBox.classList.remove('hidden');
                const recentDefects = data.defectSummary.slice(-5).join(', ');
                DOM.inspAlertMsg.textContent = `과거 불량 이력: ${recentDefects}`;
            }
        } else {
            DOM.inspReportCount.textContent = '0 (신규)';
            showToast('신규 상품입니다. 첫 검수 기록을 시작합니다.');
        }
        DOM.inspPackingNoInput.focus();

    } catch (e) {
        console.error("Error searching product history:", e);
        showToast("이력 조회 중 오류가 발생했습니다.", true);
    }
};

/**
 * 2. 검수 데이터 저장 및 다음 상품 준비
 */
export const saveInspectionAndNext = async () => {
    const productName = DOM.inspProductNameInput.value.trim();
    if (!productName) {
        showToast('상품 조회를 먼저 진행해주세요.', true);
        return;
    }

    const packingNo = DOM.inspPackingNoInput.value.trim();
    const inboundQty = DOM.inspInboundQtyInput.value.trim();

    const checklist = {
        thickness: DOM.inspCheckThickness.value,
        fabric: DOM.inspCheckFabric.value,
        color: DOM.inspCheckColor.value,
        distortion: DOM.inspCheckDistortion.value,
        unraveling: DOM.inspCheckUnraveling.value,
        finishing: DOM.inspCheckFinishing.value,
        zipper: DOM.inspCheckZipper.value,
        button: DOM.inspCheckButton.value,
        lining: DOM.inspCheckLining.value,
        pilling: DOM.inspCheckPilling.value,
        dye: DOM.inspCheckDye.value
    };

    const defectsFound = [];
    const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];
    const labelMap = {
        thickness: '두께', fabric: '원단', color: '컬러', distortion: '뒤틀림',
        unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
        lining: '안감', pilling: '보풀', dye: '이염'
    };

    Object.entries(checklist).forEach(([key, value]) => {
        if (!NORMAL_VALUES.includes(value)) {
            defectsFound.push(`${labelMap[key] || key}(${value})`);
        }
    });

    const note = DOM.inspNotesInput.value.trim();
    const status = defectsFound.length > 0 ? '불량' : '정상';
    const today = getTodayDateString();
    const nowTime = getCurrentTime();

    const inspectionRecord = {
        date: today,
        time: nowTime,
        inspector: State.appState.currentUser || 'Unknown',
        packingNo,
        inboundQty: Number(inboundQty) || 0,
        checklist,
        defects: defectsFound,
        note,
        status
    };

    const btn = document.getElementById('insp-save-next-btn');
    if(btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    try {
        const docRef = doc(State.db, 'product_history', productName);
        
        const updates = {
            lastInspectionDate: today,
            totalInbound: increment(1),
            logs: arrayUnion(inspectionRecord),
            updatedAt: serverTimestamp()
        };

        if (defectsFound.length > 0) {
            const defectSummaryStr = `${today}: ${defectsFound.join(', ')}`;
            updates.defectSummary = arrayUnion(defectSummaryStr);
        }

        await setDoc(docRef, updates, { merge: true });

        todayInspectionList.unshift({
            productName,
            packingNo,
            status,
            defects: defectsFound,
            note,
            time: nowTime
        });

        renderTodayInspectionList();
        showToast(`'${productName}' 검수 기록 저장 완료!`);
        
        resetInspectionForm(true);
        DOM.inspProductNameInput.focus();
        DOM.inspHistoryReport.classList.add('hidden');
        DOM.inspCurrentInputArea.classList.add('hidden');

    } catch (e) {
        console.error("Error saving inspection:", e);
        showToast("저장 중 오류가 발생했습니다.", true);
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = `<span>검수 완료 및 저장</span><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`; }
    }
};

/**
 * 3. 금일 검수 리스트 렌더링
 */
export const renderTodayInspectionList = () => {
    if (!DOM.inspTodayListBody) return;
    DOM.inspTodayCount.textContent = todayInspectionList.length;
    DOM.inspTodayListBody.innerHTML = '';

    if (todayInspectionList.length === 0) {
        DOM.inspTodayListBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400 text-xs">아직 검수된 상품이 없습니다.</td></tr>';
        return;
    }

    todayInspectionList.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'bg-white border-b hover:bg-gray-50';
        
        const statusBadge = item.status === '정상' 
            ? `<span class="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold">정상</span>`
            : `<span class="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-bold">불량</span>`;

        let detailText = item.note || '';
        if (item.defects.length > 0) {
            detailText = `<span class="text-red-600 font-bold">${item.defects.join(', ')}</span> ` + detailText;
        }
        if (!detailText) detailText = '<span class="text-gray-300">-</span>';

        tr.innerHTML = `
            <td class="px-4 py-2 font-medium text-gray-900">${item.productName}</td>
            <td class="px-4 py-2 text-gray-600 font-mono text-xs">${item.packingNo || '-'}</td>
            <td class="px-4 py-2 text-sm">${statusBadge} <span class="ml-1 text-xs">${detailText}</span></td>
            <td class="px-4 py-2 text-right text-gray-500 text-xs font-mono">${item.time}</td>
        `;
        DOM.inspTodayListBody.appendChild(tr);
    });
};

const resetInspectionForm = (clearProductName = false) => {
    if (clearProductName) DOM.inspProductNameInput.value = '';
    DOM.inspPackingNoInput.value = '';
    DOM.inspInboundQtyInput.value = '';
    DOM.inspNotesInput.value = '';
    const selects = [
        DOM.inspCheckThickness, DOM.inspCheckFabric, DOM.inspCheckColor,
        DOM.inspCheckDistortion, DOM.inspCheckUnraveling, DOM.inspCheckFinishing,
        DOM.inspCheckZipper, DOM.inspCheckButton, DOM.inspCheckLining,
        DOM.inspCheckPilling, DOM.inspCheckDye
    ];
    selects.forEach(sel => { if(sel) sel.selectedIndex = 0; });
};

export const clearTodayList = () => {
    todayInspectionList = [];
    renderTodayInspectionList();
};

/**
 * 4. 전체 검수 이력 불러오기 (데이터 관리 탭용)
 */
export const loadAllInspectionHistory = async () => {
    const container = DOM.inspectionHistoryViewContainer;
    if (!container) return;
    
    container.innerHTML = '<div class="text-center text-gray-500 py-10 flex flex-col items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>검수 이력을 불러오는 중입니다...</div>';

    try {
        const colRef = collection(State.db, 'product_history');
        const snapshot = await getDocs(colRef);
        
        const historyData = [];
        snapshot.forEach(doc => {
            historyData.push({
                id: doc.id, 
                ...doc.data()
            });
        });

        renderInspectionHistoryTable(historyData);
    } catch (e) {
        console.error("Error loading all inspection history:", e);
        container.innerHTML = '<div class="text-center text-red-500 py-10">데이터를 불러오는 중 오류가 발생했습니다.</div>';
        showToast("검수 이력 로딩 실패", true);
    }
};

/**
 * ✅ [신규] 특정 상품의 상세 로그 불러오기 (상세보기 모달용)
 */
export const loadInspectionLogs = async (productName) => {
    if (!productName) return;
    
    // 모달 띄우기
    if (DOM.inspectionLogManagerModal) DOM.inspectionLogManagerModal.classList.remove('hidden');
    if (DOM.inspectionLogProductName) DOM.inspectionLogProductName.textContent = productName;
    if (DOM.inspectionLogTableBody) DOM.inspectionLogTableBody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-500">로딩 중...</td></tr>';

    try {
        const docRef = doc(State.db, 'product_history', productName);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            currentProductLogs = data.logs || []; // 로컬 저장
            renderInspectionLogTable(currentProductLogs, productName);
        } else {
            currentProductLogs = [];
            renderInspectionLogTable([], productName);
        }
    } catch (e) {
        console.error("Error loading inspection logs:", e);
        showToast("상세 이력을 불러오는 중 오류가 발생했습니다.", true);
    }
};

/**
 * ✅ [신규] 검수 기록 수정을 위한 데이터 준비 (수정 모달 띄우기)
 */
export const prepareEditInspectionLog = (productName, index) => {
    // 현재 로드된 logs에서 데이터 찾기
    // (주의: UI는 최신순이지만 currentProductLogs 배열 순서는 DB 저장 순서(과거->최신)일 수 있음.
    //  renderInspectionLogTable에서 originalIndex를 매핑해두었으므로 index는 배열의 실제 인덱스여야 함)
    
    const log = currentProductLogs[index];
    if (!log) {
        showToast("해당 기록을 찾을 수 없습니다.", true);
        return;
    }

    // 수정 모달 DOM 채우기
    if (DOM.editInspProductName) DOM.editInspProductName.value = productName;
    if (DOM.editInspDateTime) DOM.editInspDateTime.value = `${log.date} ${log.time}`;
    if (DOM.editInspPackingNo) DOM.editInspPackingNo.value = log.packingNo || '';
    if (DOM.editInspInboundQty) DOM.editInspInboundQty.value = log.inboundQty || 0;
    if (DOM.editInspNotes) DOM.editInspNotes.value = log.note || '';
    if (DOM.editInspLogIndex) DOM.editInspLogIndex.value = index;
    
    // 체크리스트 채우기
    const checklist = log.checklist || {};
    const setSelect = (dom, val) => { if (dom) dom.value = val || (dom.options[0].value); };
    
    setSelect(DOM.editInspCheckThickness, checklist.thickness);
    setSelect(DOM.editInspCheckFabric, checklist.fabric);
    setSelect(DOM.editInspCheckColor, checklist.color);
    setSelect(DOM.editInspCheckDistortion, checklist.distortion);
    setSelect(DOM.editInspCheckUnraveling, checklist.unraveling);
    setSelect(DOM.editInspCheckFinishing, checklist.finishing);
    setSelect(DOM.editInspCheckZipper, checklist.zipper);
    setSelect(DOM.editInspCheckButton, checklist.button);
    setSelect(DOM.editInspCheckLining, checklist.lining);
    setSelect(DOM.editInspCheckPilling, checklist.pilling);
    setSelect(DOM.editInspCheckDye, checklist.dye);

    if (DOM.inspectionLogEditorModal) DOM.inspectionLogEditorModal.classList.remove('hidden');
};

/**
 * ✅ [신규] 검수 기록 수정 및 저장
 */
export const updateInspectionLog = async () => {
    const productName = DOM.editInspProductName.value;
    const index = parseInt(DOM.editInspLogIndex.value, 10);
    
    if (!productName || isNaN(index) || !currentProductLogs[index]) return;

    // 1. 폼 데이터 수집
    const checklist = {
        thickness: DOM.editInspCheckThickness.value,
        fabric: DOM.editInspCheckFabric.value,
        color: DOM.editInspCheckColor.value,
        distortion: DOM.editInspCheckDistortion.value,
        unraveling: DOM.editInspCheckUnraveling.value,
        finishing: DOM.editInspCheckFinishing.value,
        zipper: DOM.editInspCheckZipper.value,
        button: DOM.editInspCheckButton.value,
        lining: DOM.editInspCheckLining.value,
        pilling: DOM.editInspCheckPilling.value,
        dye: DOM.editInspCheckDye.value
    };

    const defectsFound = [];
    const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];
    const labelMap = {
        thickness: '두께', fabric: '원단', color: '컬러', distortion: '뒤틀림',
        unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
        lining: '안감', pilling: '보풀', dye: '이염'
    };
    Object.entries(checklist).forEach(([key, value]) => {
        if (!NORMAL_VALUES.includes(value)) {
            defectsFound.push(`${labelMap[key] || key}(${value})`);
        }
    });

    const updatedLog = {
        ...currentProductLogs[index], // 기존 데이터(작성자, 날짜 등) 유지
        packingNo: DOM.editInspPackingNo.value,
        inboundQty: Number(DOM.editInspInboundQty.value) || 0,
        checklist: checklist,
        defects: defectsFound,
        note: DOM.editInspNotes.value,
        status: defectsFound.length > 0 ? '불량' : '정상'
    };

    // 2. 로컬 데이터 업데이트
    currentProductLogs[index] = updatedLog;

    // 3. DB 업데이트
    try {
        const docRef = doc(State.db, 'product_history', productName);
        
        // logs 전체 덮어쓰기 (Firestore 배열 수정의 한계)
        // + defectSummary 재계산
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);

        await updateDoc(docRef, {
            logs: currentProductLogs,
            defectSummary: newDefectSummary
        });

        showToast("기록이 수정되었습니다.");
        
        // UI 갱신
        DOM.inspectionLogEditorModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);
        
        // 메인 이력 테이블도 갱신 (최근 불량 내역 등이 바뀔 수 있으므로)
        // loadAllInspectionHistory(); // 이건 너무 무거우니 생략하거나 필요시 호출

    } catch (e) {
        console.error("Error updating log:", e);
        showToast("수정 중 오류가 발생했습니다.", true);
    }
};

/**
 * ✅ [신규] 검수 기록 삭제
 */
export const deleteInspectionLog = async () => {
    const productName = DOM.editInspProductName.value;
    const index = parseInt(DOM.editInspLogIndex.value, 10);

    if (!productName || isNaN(index)) return;

    if (!confirm("정말 이 기록을 삭제하시겠습니까?")) return;

    // 1. 로컬 데이터 제거
    currentProductLogs.splice(index, 1);

    // 2. DB 업데이트
    try {
        const docRef = doc(State.db, 'product_history', productName);
        
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);

        await updateDoc(docRef, {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
            totalInbound: increment(-1) // 입고 횟수 차감
        });

        showToast("기록이 삭제되었습니다.");
        
        DOM.inspectionLogEditorModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);

    } catch (e) {
        console.error("Error deleting log:", e);
        showToast("삭제 중 오류가 발생했습니다.", true);
    }
};