// === js/inspection-logic.js ===
// 설명: 검수 이력 조회, 저장, 리스트 관리 등 핵심 로직을 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getCurrentTime, getTodayDateString } from './utils.js';

import { 
    doc, getDoc, setDoc, updateDoc, arrayUnion, increment, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 금일 검수 세션 동안의 로컬 기록 저장소 (모달 닫기 전까지 유지)
let todayInspectionList = [];

/**
 * 1. 상품명으로 과거 검수 이력 조회
 */
export const searchProductHistory = async () => {
    const productNameInput = DOM.inspProductNameInput.value.trim();
    if (!productNameInput) {
        showToast('상품명을 입력해주세요.', true);
        return;
    }

    // UI 초기화
    DOM.inspHistoryReport.classList.remove('hidden');
    DOM.inspCurrentInputArea.classList.remove('hidden');
    DOM.inspAlertBox.classList.add('hidden');
    DOM.inspReportTitle.textContent = productNameInput;
    DOM.inspReportCount.textContent = '0';
    DOM.inspReportDate.textContent = '-';
    
    // 입력 폼 초기화 (새로운 상품 조회를 위해)
    resetInspectionForm(false); // 상품명은 유지

    try {
        const docRef = doc(State.db, 'product_history', productNameInput);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // 기본 정보 표시
            DOM.inspReportCount.textContent = data.totalInbound || 0;
            DOM.inspReportDate.textContent = data.lastInspectionDate || '-';

            // 특이사항/불량 이력 분석 및 경고
            if (data.defectSummary && data.defectSummary.length > 0) {
                DOM.inspAlertBox.classList.remove('hidden');
                // 최근 5개 불량 내역만 표시
                const recentDefects = data.defectSummary.slice(-5).join(', ');
                DOM.inspAlertMsg.textContent = `과거 불량 이력: ${recentDefects}`;
            }
        } else {
            // 신규 상품인 경우
            DOM.inspReportCount.textContent = '0 (신규)';
            showToast('신규 상품입니다. 첫 검수 기록을 시작합니다.');
        }

        // 패킹번호 입력칸으로 포커스 이동 (편의성)
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
    
    // 필수값 체크 (패킹번호, 수량 등은 정책에 따라 선택사항일 수도 있음. 여기서는 경고만)
    if (!packingNo || !inboundQty) {
        // showToast('패킹번호와 수량을 입력하면 관리가 더 정확해집니다.', false);
    }

    // 13가지 체크리스트 값 수집
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

    // 불량 여부 판단 (체크리스트 중 하나라도 '정상/양호/동일/없음/해당없음'이 아니면 불량 의심)
    const defectsFound = [];
    const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];

    Object.entries(checklist).forEach(([key, value]) => {
        if (!NORMAL_VALUES.includes(value)) {
            // 한글 라벨 매핑
            const labelMap = {
                thickness: '두께', fabric: '원단', color: '컬러', distortion: '뒤틀림',
                unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
                lining: '안감', pilling: '보풀', dye: '이염'
            };
            defectsFound.push(`${labelMap[key] || key}(${value})`);
        }
    });

    const note = DOM.inspNotesInput.value.trim();
    const status = defectsFound.length > 0 ? '불량' : '정상';
    const today = getTodayDateString();
    const nowTime = getCurrentTime();

    // 저장할 데이터 객체
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

    // 버튼 비활성화 (중복 클릭 방지)
    const btn = document.getElementById('insp-save-next-btn');
    if(btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    try {
        const docRef = doc(State.db, 'product_history', productName);

        // Firestore 저장 (없으면 생성, 있으면 업데이트)
        // 1. 로그 추가
        // 2. 누적 카운트 증가
        // 3. 불량 이력이 있다면 defectSummary 배열에 추가
        
        const updates = {
            lastInspectionDate: today,
            totalInbound: increment(1),
            logs: arrayUnion(inspectionRecord),
            updatedAt: serverTimestamp()
        };

        if (defectsFound.length > 0) {
            // 불량 내용 요약 문자열 (예: "2023-10-25: 지퍼(불량), 이염(있음)")
            const defectSummaryStr = `${today}: ${defectsFound.join(', ')}`;
            updates.defectSummary = arrayUnion(defectSummaryStr);
        }

        // setDoc with merge를 사용하여 문서가 없으면 자동 생성
        await setDoc(docRef, updates, { merge: true });

        // 로컬 리스트 업데이트 (UI용)
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
        
        // 폼 초기화 및 포커스 이동 (다음 상품 준비)
        resetInspectionForm(true); // 상품명까지 초기화
        DOM.inspProductNameInput.focus();
        
        // 과거 이력 패널 숨김 (다음 상품 조회 시 다시 뜸)
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

/**
 * 4. 폼 초기화 헬퍼
 */
const resetInspectionForm = (clearProductName = false) => {
    if (clearProductName) DOM.inspProductNameInput.value = '';
    DOM.inspPackingNoInput.value = '';
    DOM.inspInboundQtyInput.value = '';
    DOM.inspNotesInput.value = '';

    // 체크리스트 초기화 (첫 번째 옵션 '정상/양호/없음' 등)
    const selects = [
        DOM.inspCheckThickness, DOM.inspCheckFabric, DOM.inspCheckColor,
        DOM.inspCheckDistortion, DOM.inspCheckUnraveling, DOM.inspCheckFinishing,
        DOM.inspCheckZipper, DOM.inspCheckButton, DOM.inspCheckLining,
        DOM.inspCheckPilling, DOM.inspCheckDye
    ];
    selects.forEach(sel => { if(sel) sel.selectedIndex = 0; });
};

/**
 * 5. 리스트 초기화 (모달 닫거나 할 때 호출 가능)
 */
export const clearTodayList = () => {
    todayInspectionList = [];
    renderTodayInspectionList();
};