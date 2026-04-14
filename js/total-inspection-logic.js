// === js/total-inspection-logic.js ===
// 설명: 전량 검수(여러 날에 걸쳐 진행되는 검수)의 누적 데이터 관리 로직

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 현재 조회된 상품의 누적 상태를 저장할 내부 변수
let currentTotalInspData = null;
let pendingDataFromSample = null; // 샘플 검수에서 넘어온 데이터를 임시 저장하는 변수

// 남은 수량 실시간 계산 함수
export function updateTotalInspRemaining() {
    const totalStock = parseInt(DOM.totalInspTotalStock.value) || 0;
    const accumulated = currentTotalInspData ? currentTotalInspData.accumulatedTotal : 0;
    const todayNormal = parseInt(DOM.totalInspTodayNormal.value) || 0;
    const todayDefective = parseInt(DOM.totalInspTodayDefective.value) || 0;
    
    const totalDone = accumulated + todayNormal + todayDefective;
    const remaining = totalStock - totalDone;
    
    DOM.totalInspRemaining.textContent = remaining >= 0 ? remaining : 0;
    if (remaining < 0) {
        DOM.totalInspRemaining.classList.add('text-red-500');
    } else {
        DOM.totalInspRemaining.classList.remove('text-red-500');
    }
}

// ✅ [신규] 샘플 검수에서 전량 검수로 원클릭 전환
export async function triggerTotalInspectionFromSample() {
    const productName = DOM.inspProductNameInput.value.trim();
    if (!productName) {
        showToast('샘플 검수 중인 상품명이 없습니다.', true);
        return;
    }
    
    // 샘플 검수 UI에 있는 데이터 가져오기
    const code = DOM.inspCodeDisplay.textContent.replace('코드: ', '').trim();
    const option = DOM.inspOptionDisplay.textContent.replace('옵션: ', '').trim();
    const supplier = DOM.inspSupplierDisplay.textContent.replace('공급처: ', '').trim();
    const inboundDate = DOM.inspInboundDateInput.value;

    // 전량검수 모달 띄우기 (z-index가 더 높으므로 겹쳐서 열림)
    DOM.totalInspModal.classList.remove('hidden');
    DOM.totalInspProductName.value = productName;
    
    // 임시 변수에 데이터 저장
    pendingDataFromSample = {
        code: code && code !== '-' ? code : '',
        option: option && option !== '-' ? option : '',
        supplier: supplier && supplier !== '-' ? supplier : '',
        inboundDate: inboundDate || '',
        location: '' // 로케이션은 전량 검수 창에서 수동 입력
    };

    // 데이터 자동 조회 실행
    await searchTotalInspection();
}

// 상품명 기반 누적 데이터 조회
export async function searchTotalInspection() {
    const productName = DOM.totalInspProductName.value.trim();
    if (!productName) {
        showToast('상품명을 입력해주세요.', true);
        return;
    }

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'total_inspections_accumulated', productName);
        const docSnap = await getDoc(docRef);

        DOM.totalInspContentArea.classList.remove('hidden');

        if (docSnap.exists()) {
            // 기존 기록이 있는 경우 (이어서 진행)
            currentTotalInspData = docSnap.data();
            
            DOM.totalInspReason.value = currentTotalInspData.reason || '';
            DOM.totalInspTotalStock.value = currentTotalInspData.totalStock || 0;
            DOM.totalInspAccumulated.textContent = currentTotalInspData.accumulatedTotal || 0;
            
            // 기존 DB 데이터 렌더링 (없으면 방금 넘어온 pendingData 사용)
            DOM.totalInspCode.textContent = currentTotalInspData.code || (pendingDataFromSample?.code || '-');
            DOM.totalInspOption.textContent = currentTotalInspData.option || (pendingDataFromSample?.option || '-');
            DOM.totalInspSupplier.textContent = currentTotalInspData.supplier || (pendingDataFromSample?.supplier || '-');
            DOM.totalInspLocation.value = currentTotalInspData.location || (pendingDataFromSample?.location || '');
            DOM.totalInspInboundDate.value = currentTotalInspData.inboundDate || (pendingDataFromSample?.inboundDate || '');
            
            showToast('기존 검수 내역을 불러왔습니다. 이어서 입력하세요.');
        } else {
            // 처음 검수하는 경우
            currentTotalInspData = { accumulatedTotal: 0, accumulatedNormal: 0, accumulatedDefective: 0 };
            
            DOM.totalInspReason.value = '';
            DOM.totalInspTotalStock.value = '';
            DOM.totalInspAccumulated.textContent = '0';
            
            // 넘어온 pendingData 사용
            DOM.totalInspCode.textContent = pendingDataFromSample?.code || '-';
            DOM.totalInspOption.textContent = pendingDataFromSample?.option || '-';
            DOM.totalInspSupplier.textContent = pendingDataFromSample?.supplier || '-';
            DOM.totalInspLocation.value = pendingDataFromSample?.location || '';
            DOM.totalInspInboundDate.value = pendingDataFromSample?.inboundDate || '';
            
            showToast('새로운 전량 검수 건입니다. 총 재고와 사유를 입력하세요.');
        }

        // 금일 입력창 초기화
        DOM.totalInspTodayNormal.value = '';
        DOM.totalInspTodayDefective.value = '';
        updateTotalInspRemaining();
        
        pendingDataFromSample = null; // 초기화

    } catch (error) {
        console.error("Error searching total inspection:", error);
        showToast("데이터 조회 중 오류가 발생했습니다.", true);
    }
}

// 금일 검수량 반영 및 누적 저장
export async function saveTotalInspection() {
    const productName = DOM.totalInspProductName.value.trim();
    const reason = DOM.totalInspReason.value.trim();
    const totalStock = parseInt(DOM.totalInspTotalStock.value) || 0;
    
    // 추가 상세 정보 가져오기
    const code = DOM.totalInspCode.textContent !== '-' ? DOM.totalInspCode.textContent : '';
    const option = DOM.totalInspOption.textContent !== '-' ? DOM.totalInspOption.textContent : '';
    const supplier = DOM.totalInspSupplier.textContent !== '-' ? DOM.totalInspSupplier.textContent : '';
    const location = DOM.totalInspLocation.value.trim();
    const inboundDate = DOM.totalInspInboundDate.value;

    const todayNormal = parseInt(DOM.totalInspTodayNormal.value) || 0;
    const todayDefective = parseInt(DOM.totalInspTodayDefective.value) || 0;
    const todayTotal = todayNormal + todayDefective;

    if (!productName || !reason || totalStock <= 0) {
        showToast('상품명, 사유, 총 재고를 정확히 입력해주세요.', true);
        return;
    }
    if (todayTotal <= 0) {
        showToast('금일 검수(정상 또는 불량) 수량을 입력해주세요.', true);
        return;
    }

    try {
        // 1. 누적 데이터 업데이트
        const newAccumulatedNormal = (currentTotalInspData.accumulatedNormal || 0) + todayNormal;
        const newAccumulatedDefective = (currentTotalInspData.accumulatedDefective || 0) + todayDefective;
        const newAccumulatedTotal = newAccumulatedNormal + newAccumulatedDefective;

        const accumulatedRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'total_inspections_accumulated', productName);
        await setDoc(accumulatedRef, {
            productName: productName,
            reason: reason,
            totalStock: totalStock,
            accumulatedNormal: newAccumulatedNormal,
            accumulatedDefective: newAccumulatedDefective,
            accumulatedTotal: newAccumulatedTotal,
            // 상세 정보 저장
            code: code,
            option: option,
            supplier: supplier,
            location: location,
            inboundDate: inboundDate,
            lastUpdated: serverTimestamp()
        }, { merge: true });

        // 2. 금일 히스토리 기록
        const historyRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'total_inspection_logs', `${productName}-${Date.now()}`);
        await setDoc(historyRef, {
            productName: productName,
            reason: reason,
            todayNormal: todayNormal,
            todayDefective: todayDefective,
            // 히스토리에도 상세 정보 기록
            code: code,
            option: option,
            supplier: supplier,
            location: location,
            inboundDate: inboundDate,
            timestamp: serverTimestamp(),
            worker: State.auth.currentUser?.email || 'unknown'
        });

        showToast(`${productName} 전량 검수 내역이 누적 저장되었습니다.`);
        
        // 저장 완료 후 창 닫기 및 초기화 (샘플 검수 창이 켜져있다면 다시 보임)
        DOM.totalInspModal.classList.add('hidden');
        DOM.totalInspContentArea.classList.add('hidden');
        DOM.totalInspProductName.value = '';

    } catch (error) {
        console.error("Error saving total inspection:", error);
        showToast("저장 중 오류가 발생했습니다.", true);
    }
}