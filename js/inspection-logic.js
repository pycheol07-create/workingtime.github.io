// === js/inspection-logic.js ===
// 설명: 검수 이력 조회, 저장, 리스트 관리, 수정/삭제(상세/전체), 스캔, 엑셀, 이미지 처리 등 핵심 로직

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { updateDailyData } from './app-data.js'; 
import { showToast, getCurrentTime, getTodayDateString } from './utils.js';
import { 
    doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, increment, serverTimestamp, collection, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderInspectionHistoryTable, renderInspectionLogTable } from './ui-history-inspection.js';

// 로컬 상태 변수
let todayInspectionList = [];
let html5QrCode = null;
let currentImageBase64 = null;
let currentProductLogs = []; 
let currentTodoIndex = -1;

// ✅ [신규] 검수 세션 초기화 함수 (업무 시작 시 호출)
export const initializeInspectionSession = async () => {
    // 1. 내부 상태 초기화
    todayInspectionList = [];
    currentTodoIndex = -1;
    currentImageBase64 = null;
    
    // 2. 입력 폼 UI 초기화
    if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = '';
    if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = '';
    if (DOM.inspNotesInput) DOM.inspNotesInput.value = '';
    if (DOM.inspCheckThickness) DOM.inspCheckThickness.value = '';
    
    // [추가] 입고 일자 필드 초기화 (잠금 상태로 복구)
    if (DOM.inspInboundDateInput) {
        DOM.inspInboundDateInput.value = '';
        DOM.inspInboundDateInput.readOnly = true;
        DOM.inspInboundDateInput.classList.add('bg-gray-100');
        DOM.inspInboundDateInput.classList.remove('bg-white');
    }

    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
    
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); 
    
    if (DOM.inspImagePreviewBox) DOM.inspImagePreviewBox.classList.add('hidden');
    if (DOM.inspImageInput) DOM.inspImageInput.value = '';

    // 3. 섹션 숨김
    if (DOM.inspHistoryReport) DOM.inspHistoryReport.classList.add('hidden');
    if (DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.add('hidden');
    if (DOM.inspAlertBox) DOM.inspAlertBox.classList.add('hidden');
    
    // 4. "오늘 검수 완료 목록" UI 초기화
    renderTodayInspectionList();

    // 5. [핵심] 완료된 엑셀 리스트 자동 삭제 확인
    const list = State.appState.inspectionList || [];
    if (list.length > 0) {
        // 모든 항목이 '완료' 상태인지 확인
        const isAllCompleted = list.every(item => item.status === '완료');
        
        if (isAllCompleted) {
            // 로컬 및 DB 초기화
            State.appState.inspectionList = [];
            await updateDailyData({ inspectionList: [] });
            
            // 투두 리스트 UI 갱신 (빈 상태로)
            renderTodoList();
            showToast("이전 검수 리스트가 모두 완료되어 초기화되었습니다.");
        } else {
            // 완료되지 않았으면 리스트 유지 (UI만 갱신)
            renderTodoList();
        }
    } else {
        renderTodoList();
    }
};

// ✅ [신규] 엑셀 리스트 전체 삭제 (초기화)
export const deleteInspectionList = async () => {
    const list = State.appState.inspectionList || [];
    if (list.length === 0) {
        showToast("삭제할 리스트가 없습니다.", true);
        return;
    }

    if (!confirm("현재 검수 대기 리스트를 모두 삭제하시겠습니까?\n(검수 완료된 이력 데이터는 유지됩니다)")) {
        return;
    }

    try {
        // DB에서 리스트 비우기
        await updateDailyData({ inspectionList: [] });
        State.appState.inspectionList = [];
        
        // UI 갱신
        renderTodoList();
        
        // 입력 폼 초기화
        DOM.inspProductNameInput.value = '';
        if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = '';
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
        
        currentTodoIndex = -1;

        showToast("검수 리스트가 초기화되었습니다.");
    } catch (e) {
        console.error("Error deleting list:", e);
        showToast("리스트 삭제 중 오류가 발생했습니다.", true);
    }
};

// ✅ [신규] 이력(History)에서 특정 날짜의 검수 리스트 삭제
export const deleteHistoryInspectionList = async (dateKey) => {
    if (!dateKey) return false;

    if (!confirm(`${dateKey}일자의 입고 리스트를 삭제하시겠습니까?\n(이미 완료된 검수 이력 데이터는 삭제되지 않습니다)`)) {
        return false;
    }

    const todayKey = getTodayDateString();
    
    try {
        // 1. 로컬 상태(allHistoryData) 업데이트
        const dayData = State.allHistoryData.find(d => d.id === dateKey);
        if (dayData) {
            dayData.inspectionList = []; // 빈 배열로 초기화
        }

        // 2. Firestore 업데이트
        if (dateKey === todayKey) {
            // 오늘 날짜라면 daily_data 업데이트 (실시간성)
            // 또한 메인 앱 상태(appState)도 업데이트 필요
            State.appState.inspectionList = [];
            await updateDailyData({ inspectionList: [] });
        } else {
            // 과거 날짜라면 history 컬렉션 업데이트
            const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
            await updateDoc(docRef, { inspectionList: [] });
        }

        showToast(`${dateKey} 리스트가 삭제되었습니다.`);
        return true;

    } catch (e) {
        console.error("Error deleting history list:", e);
        showToast("리스트 삭제 중 오류가 발생했습니다.", true);
        return false;
    }
};

// ======================================================
// 1. 엑셀 리스트 업로드 및 처리
// ======================================================
export const handleExcelUpload = (file) => {
    // 1. 파일명에서 입고일자 추출 (예: "입고리스트_241121.xlsx" -> "2024-11-21")
    let inboundDate = getTodayDateString(); // 기본값: 오늘
    const dateMatch = file.name.match(/20(\d{2})(\d{2})(\d{2})/) || file.name.match(/(\d{2})(\d{2})(\d{2})/);
    
    if (dateMatch) {
        // YYMMDD 형식 매칭
        const year = '20' + dateMatch[1];
        const month = dateMatch[2];
        const day = dateMatch[3];
        inboundDate = `${year}-${month}-${day}`;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            // --- Deduplication Logic Start ---
            const processedList = [];
            // Key: supplierName (F열) :: color (C열에서 추출)
            const uniqueKeyMap = new Map(); 

            if (jsonData.length > 1) {
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (row && row.length > 1) { 
                        const code = String(row[0] || '').trim();
                        const name = String(row[1] || '').trim();
                        const option = String(row[2] || '').trim(); // C열
                        const qty = Number(row[3]) || 0;
                        const thickness = String(row[4] || '');
                        const supplierName = String(row[5] || '').trim(); // F열
                        
                        if (code || name) {
                            // 1. 옵션에서 색상만 추출 (예: [블랙-160-L] -> 블랙)
                            let color = option.replace(/\[|\]/g, '').split('-')[0].trim();
                            if (!color) color = 'N/A';
                            
                            // 2. 대소문자 및 모든 공백을 제거하여 강력한 중복 체크 키 생성
                            const keyColor = color.replace(/\s/g, '').toLowerCase();
                            const keySupplierName = supplierName.replace(/\s/g, '').toLowerCase();
                            
                            const uniqueKey = `${keySupplierName}::${keyColor}`; // <-- 중복 제거 기준

                            if (!uniqueKeyMap.has(uniqueKey)) {
                                uniqueKeyMap.set(uniqueKey, true); 
                                
                                processedList.push({
                                    code: code,
                                    name: name,
                                    option: option,
                                    qty: qty,
                                    thickness: thickness,
                                    supplierName: supplierName, 
                                    status: '대기',
                                    inboundDate: inboundDate
                                });
                            }
                        }
                    }
                }
            }
            // --- Deduplication Logic End ---

            if (processedList.length > 0) {
                await updateDailyData({ inspectionList: processedList });
                showToast(`${processedList.length}개의 리스트가 업로드되었습니다. (입고일: ${inboundDate})`);
                renderTodoList(); // 업로드 후 즉시 렌더링
            } else {
                showToast("유효한 데이터가 엑셀에 없습니다.", true);
            }

        } catch (err) {
            console.error("Excel parse error:", err);
            showToast("엑셀 파일 처리 중 오류가 발생했습니다.", true);
        }
    };
    reader.readAsArrayBuffer(file);
};

export const renderTodoList = () => {
    const list = State.appState.inspectionList || [];

    if (!DOM.inspTodoListArea || !DOM.inspTodoListBody) return;
    
    if (list.length > 0) {
        DOM.inspTodoListArea.classList.remove('hidden');
    } else {
        DOM.inspTodoListArea.classList.add('hidden');
        return;
    }

    DOM.inspTodoListBody.innerHTML = '';
    list.forEach((item, idx) => {
        const tr = document.createElement('tr');
        const isCompleted = item.status === '완료';
        tr.className = `transition border-b last:border-0 cursor-pointer ${isCompleted ? 'bg-gray-50 hover:bg-gray-100' : 'hover:bg-blue-50'}`;
        
        const statusColor = isCompleted ? 'text-green-600 font-bold' : 'text-gray-400';
        
        tr.innerHTML = `
            <td class="px-3 py-2 font-mono text-gray-600 text-xs">${item.code}</td>
            <td class="px-3 py-2 font-medium text-gray-800 truncate max-w-[150px]" title="${item.name}">${item.name}</td>
            <td class="px-3 py-2 text-gray-500 text-xs">${item.option}</td>
            <td class="px-3 py-2 text-right text-xs ${statusColor}">${item.status}</td>
        `;
        
        tr.addEventListener('click', () => {
            selectTodoItem(idx);
        });
        DOM.inspTodoListBody.appendChild(tr);
    });
};

// ✅ [수정] selectTodoItem 함수를 외부(팝업창)에서 호출할 수 있도록 export로 변경
export const selectTodoItem = (index) => {
    const item = State.appState.inspectionList[index];
    if (!item) return;

    currentTodoIndex = index; 

    // 1. 기본 정보 자동 입력
    DOM.inspProductNameInput.value = item.name; 
    if (DOM.inspInboundDateInput) DOM.inspInboundDateInput.value = item.inboundDate || getTodayDateString();
    if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = item.qty > 0 ? item.qty : '';
    
    // 2. 옵션/코드/기준두께 표시
    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${item.option || '-'}`;
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${item.code || '-'}`;
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = `공급처: ${item.supplierName || '-'}`; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${item.thickness || '-'}`;

    // 3. 이력 조회 실행
    searchProductHistory(); 
    
    // 4. 비고란 초기화
    DOM.inspNotesInput.value = '';
    
    showToast(`'${item.name}' 선택됨`);
};

// ✅ [추가] 팝업창에서 호출하기 위해 window 객체에 함수 바인딩
window.selectInspectionTodoItem = selectTodoItem;

// ✅ [추가] 별도 창으로 리스트 열기 함수
export const openInspectionListWindow = () => {
    const list = State.appState.inspectionList || [];
    if (list.length === 0) {
        showToast("리스트 데이터가 없습니다.", true);
        return;
    }

    // 새 창 열기 (너비 600, 높이 800)
    const popup = window.open('', 'InspectionListWindow', 'width=600,height=800,scrollbars=yes,resizable=yes');
    if (!popup) {
        showToast("팝업 차단을 해제해주세요.", true);
        return;
    }

    // HTML 문서 작성
    const rowsHtml = list.map((item, idx) => {
        const isCompleted = item.status === '완료';
        const trClass = isCompleted ? 'bg-gray-100 text-gray-500' : 'hover:bg-blue-50 cursor-pointer';
        const statusBadge = isCompleted 
            ? '<span class="text-green-600 font-bold text-xs">완료</span>' 
            : '<span class="text-gray-400 text-xs">대기</span>';
        
        // 클릭 시 부모 창의 함수 호출 (window.opener)
        const onClickScript = isCompleted ? '' : `onclick="selectItemInParent(${idx})"`;

        return `
            <tr class="border-b last:border-0 transition ${trClass}" ${onClickScript}>
                <td class="px-3 py-2 font-mono text-xs">${item.code || '-'}</td>
                <td class="px-3 py-2 font-medium text-sm">${item.name}</td>
                <td class="px-3 py-2 text-xs">${item.option || '-'}</td>
                <td class="px-3 py-2 text-center">${statusBadge}</td>
            </tr>
        `;
    }).join('');

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <title>검수 대기 리스트</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                body { font-family: 'Noto Sans KR', sans-serif; }
                .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 3px; }
            </style>
            <script>
                function selectItemInParent(index) {
                    if (window.opener && !window.opener.closed) {
                        // 부모 창의 함수 호출
                        window.opener.selectInspectionTodoItem(index);
                        // 선택 효과 (배경 깜빡임)
                        document.querySelectorAll('tr').forEach(tr => tr.classList.remove('bg-blue-100'));
                        const rows = document.querySelectorAll('tbody tr');
                        if(rows[index]) rows[index].classList.add('bg-blue-100');
                    } else {
                        alert('메인 프로그램 창이 닫혀있어 연동할 수 없습니다.');
                    }
                }
            </script>
        </head>
        <body class="bg-white">
            <div class="sticky top-0 bg-white border-b border-gray-200 p-4 flex justify-between items-center shadow-sm z-10">
                <h2 class="text-lg font-bold text-gray-800">📋 검수 대기 리스트</h2>
                <div class="flex items-center gap-2">
                    <span class="text-xs font-medium bg-gray-100 px-2 py-1 rounded text-gray-600">총 ${list.length}건</span>
                    <button onclick="window.close()" class="text-gray-400 hover:text-gray-700 text-lg font-bold px-2 rounded-full leading-none">
                        &times;
                    </button>
                </div>
            </div>
            <div class="overflow-y-auto">
                <table class="w-full text-left border-collapse">
                    <thead class="bg-gray-50 text-xs uppercase text-gray-500 sticky top-0">
                        <tr>
                            <th class="px-3 py-2 font-semibold border-b">코드</th>
                            <th class="px-3 py-2 font-semibold border-b">상품명</th>
                            <th class="px-3 py-2 font-semibold border-b">옵션</th>
                            <th class="px-3 py-2 font-semibold border-b text-center">상태</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
            <div class="p-4 text-center text-xs text-gray-400 bg-gray-50 border-t border-gray-200 fixed bottom-0 w-full">
                항목을 클릭하면 메인 창에 자동 입력됩니다.
            </div>
        </body>
        </html>
    `;

    popup.document.open();
    popup.document.write(htmlContent);
    popup.document.close();
};

// ======================================================
// 2. 바코드 스캐너 로직
// ======================================================
export const toggleScanner = () => {
    if (DOM.inspScannerContainer.classList.contains('hidden')) {
        DOM.inspScannerContainer.classList.remove('hidden');
        startScanner();
    } else {
        stopScanner();
        DOM.inspScannerContainer.classList.add('hidden');
    }
};

const startScanner = () => {
    if (html5QrCode) return; 

    html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    
    html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess)
    .catch(err => {
        console.error("Error starting scanner", err);
        showToast("카메라를 시작할 수 없습니다. (권한/HTTPS 확인)", true);
        DOM.inspScannerContainer.classList.add('hidden');
    });
};

const stopScanner = () => {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            html5QrCode = null;
        }).catch(err => console.error("Failed to stop scanner", err));
    }
};

const onScanSuccess = (decodedText, decodedResult) => {
    console.log(`Scan result: ${decodedText}`);
    showToast(`바코드 인식: ${decodedText}`);
    stopScanner(); 
    DOM.inspScannerContainer.classList.add('hidden');

    DOM.inspProductNameInput.value = decodedText;
    searchProductHistory();
};

// ======================================================
// 3. 이미지 처리
// ======================================================
export const handleImageSelect = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            currentImageBase64 = canvas.toDataURL('image/jpeg', 0.7); 
            if (DOM.inspImagePreviewBox) {
                DOM.inspImagePreviewBox.classList.remove('hidden');
                DOM.inspImagePreviewImg.src = currentImageBase64;
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

export const clearImageState = () => {
    currentImageBase64 = null;
    if (DOM.inspImagePreviewBox) DOM.inspImagePreviewBox.classList.add('hidden');
    if (DOM.inspImageInput) DOM.inspImageInput.value = '';
};

// ======================================================
// 4. 메인 검수 로직
// ======================================================

export const searchProductHistory = async () => {
    let searchTerm = DOM.inspProductNameInput.value.trim();
    if (!searchTerm) {
        showToast('상품명 또는 상품코드를 입력해주세요.', true);
        return;
    }

    const list = State.appState.inspectionList || [];
    
    // ✅ [수정] 같은 상품명이라도 현재 선택된 항목(옵션 다름)을 유지하기 위한 로직
    let matchedIndex = -1;

    // 1. 현재 선택된 항목이 있고, 이름이 검색어와 같다면 그 항목을 유지 (예: 블랙M 완료 -> 블루S 선택됨)
    //    -> 이렇게 해야 옵션/코드가 '블루S' 것으로 표시됨
    if (currentTodoIndex >= 0 && list[currentTodoIndex] && list[currentTodoIndex].name === searchTerm) {
        matchedIndex = currentTodoIndex;
    } else {
        // 2. 그 외의 경우(직접 검색 등) 전체 리스트에서 찾기
        matchedIndex = list.findIndex(item => 
            (item.code && item.code.trim() === searchTerm) || 
            (item.name && item.name.trim() === searchTerm)
        );
    }

    let targetProductName = searchTerm;

    if (matchedIndex > -1) {
        // [케이스 1] 리스트 매칭됨 -> 해당 항목 정보로 UI 갱신
        const matchedItem = list[matchedIndex];
        targetProductName = matchedItem.name;
        currentTodoIndex = matchedIndex; 

        DOM.inspProductNameInput.value = targetProductName;
        
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${matchedItem.option || '-'}`;
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${matchedItem.code || '-'}`;
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = `공급처: ${matchedItem.supplierName || '-'}`; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${matchedItem.thickness || '-'}`;
        
        // 날짜 자동 입력 및 잠금
        if (DOM.inspInboundDateInput) {
            DOM.inspInboundDateInput.value = matchedItem.inboundDate || getTodayDateString();
            DOM.inspInboundDateInput.readOnly = true;
            DOM.inspInboundDateInput.classList.add('bg-gray-100');
            DOM.inspInboundDateInput.classList.remove('bg-white');
        }
        if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = matchedItem.qty > 0 ? matchedItem.qty : '';

    } else {
        // [케이스 2] 리스트에 없는 상품 (개별 검색) -> 수동 입력 허용
        currentTodoIndex = -1; 
        
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';

        // 날짜 수동 입력 허용 (잠금 해제)
        if (DOM.inspInboundDateInput) {
            DOM.inspInboundDateInput.readOnly = false;
            DOM.inspInboundDateInput.classList.remove('bg-gray-100');
            DOM.inspInboundDateInput.classList.add('bg-white');
            
            // 값이 비어있으면 오늘 날짜 기본 세팅
            if (!DOM.inspInboundDateInput.value) {
                DOM.inspInboundDateInput.value = getTodayDateString();
            }
        }
        // 수량 초기화
        if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = '';
    }

    DOM.inspHistoryReport.classList.remove('hidden');
    DOM.inspCurrentInputArea.classList.remove('hidden');
    DOM.inspAlertBox.classList.add('hidden');
    DOM.inspReportTitle.textContent = targetProductName;
    
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); 

    try {
        const docRef = doc(State.db, 'product_history', targetProductName);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            DOM.inspReportCount.textContent = data.totalInbound || 0;
            DOM.inspReportDate.textContent = data.lastInspectionDate || '-';

            let specialIssues = [];
            
            if (data.logs && data.logs.length > 0) {
                specialIssues = data.logs
                    .filter(log => {
                        const hasDefects = log.status === '불량' || (log.defects && log.defects.length > 0);
                        const hasNote = log.note && log.note.trim() !== '';
                        return hasDefects || hasNote;
                    })
                    .map(log => {
                        const date = log.date || log.inboundDate || '날짜미상';
                        const defectStr = (log.defects && log.defects.length > 0) ? log.defects.join(', ') : '';
                        const noteStr = log.note ? `[메모: ${log.note}]` : '';
                        const content = [defectStr, noteStr].filter(Boolean).join(' ');
                        return `${date}: ${content}`;
                    });
            } 
            else if (data.defectSummary && data.defectSummary.length > 0) {
                specialIssues = data.defectSummary;
            }

            if (specialIssues.length > 0) {
                DOM.inspAlertBox.classList.remove('hidden');
                const recentIssues = specialIssues.slice(-5).reverse();
                DOM.inspAlertMsg.textContent = `최근 특이사항: ${recentIssues[0]}`;
                
                setTimeout(() => {
                    alert(`🚨 [특이사항 알림] 🚨\n\n이 상품은 ${specialIssues.length}건의 특이사항(불량/메모) 기록이 있습니다.\n검수 시 아래 내용을 확인해주세요.\n\n[최근 기록]\n- ${recentIssues.join('\n- ')}`);
                }, 200);
            }
        } else {
            DOM.inspReportCount.textContent = '0 (신규)';
            showToast('신규 상품입니다.');
        }
    } catch (e) {
        console.error("Error searching product history:", e);
        showToast("이력 조회 중 오류가 발생했습니다.", true);
    }
};

export const saveInspectionAndNext = async () => {
    const productName = DOM.inspProductNameInput.value.trim();
    if (!productName) {
        showToast('상품 조회를 먼저 진행해주세요.', true);
        return;
    }

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

    if (checklist.thickness === '' || Object.values(checklist).some(v => v === "" || v === null)) {
        alert("⚠️ 모든 품질 체크리스트 항목을 확인하고 선택해주세요.");
        return;
    }

    const inboundDate = DOM.inspInboundDateInput.value.trim() || getTodayDateString();
    const inboundQty = DOM.inspInboundQtyInput.value.trim();
    const note = DOM.inspNotesInput.value.trim();

    let currentItem = null;
    if (currentTodoIndex >= 0 && State.appState.inspectionList[currentTodoIndex]) {
        currentItem = State.appState.inspectionList[currentTodoIndex];
    }

    const defectsFound = [];
    const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];
    
    const labelMap = {
        fabric: '원단', color: '컬러', distortion: '뒤틀림',
        unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
        lining: '안감', pilling: '보풀', dye: '이염'
    };

    Object.entries(checklist).forEach(([key, value]) => {
        if (key === 'thickness') return;
        if (!NORMAL_VALUES.includes(value)) {
            defectsFound.push(`${labelMap[key] || key}(${value})`);
        }
    });

    const status = defectsFound.length > 0 ? '불량' : '정상';
    const today = getTodayDateString();
    const nowTime = getCurrentTime();

    const inspectionRecord = {
        date: today,
        time: nowTime,
        inspector: State.appState.currentUser || 'Unknown',
        inboundDate: inboundDate, 
        inboundQty: Number(inboundQty) || 0,
        
        option: currentItem ? currentItem.option : '-',
        code: currentItem ? currentItem.code : '-',
        supplierName: currentItem ? currentItem.supplierName : '-', 
        
        checklist,
        defects: defectsFound,
        note,
        status,
        image: currentImageBase64 || null
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

        if (currentItem) {
            updates.lastCode = currentItem.code;
            updates.lastOption = currentItem.option;
            updates.lastSupplierName = currentItem.supplierName; 
        }

        if (defectsFound.length > 0) {
            const defectSummaryStr = `${today}: ${defectsFound.join(', ')}`;
            updates.defectSummary = arrayUnion(defectSummaryStr);
        }

        await setDoc(docRef, updates, { merge: true });

        const list = [...State.appState.inspectionList];
        if (currentTodoIndex >= 0 && list[currentTodoIndex]) {
            list[currentTodoIndex].status = '완료';
            await updateDailyData({ inspectionList: list });
        }

        todayInspectionList.unshift({
            productName,
            inboundDate,
            status,
            defects: defectsFound,
            note,
            time: nowTime
        });

        renderTodayInspectionList();
        showToast(`'${productName}' 저장 완료!`);
        
        resetInspectionForm(true);
        clearImageState();
        
        if (currentTodoIndex >= 0 && currentTodoIndex < list.length - 1) {
            selectTodoItem(currentTodoIndex + 1);
        } else {
            showToast("리스트의 마지막 상품입니다.");
            DOM.inspHistoryReport.classList.add('hidden');
            DOM.inspCurrentInputArea.classList.add('hidden');
            currentTodoIndex = -1;
        }

    } catch (e) {
        console.error("Error saving inspection:", e);
        showToast("저장 중 오류가 발생했습니다.", true);
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = `<span>검수 완료 및 저장</span>`; }
    }
};

const resetInspectionForm = (clearProductName = false) => {
    if (clearProductName) DOM.inspProductNameInput.value = '';
    DOM.inspInboundQtyInput.value = '';
    DOM.inspNotesInput.value = '';
    
    // ✅ 두께 필드 초기화 (기존 누락 수정)
    if (DOM.inspCheckThickness) DOM.inspCheckThickness.value = '';

    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
    
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); 
};

// 금일 목록 렌더링
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
            <td class="px-4 py-2 text-gray-600 text-xs">${item.inboundDate || '-'}</td>
            <td class="px-4 py-2 text-sm">${statusBadge} <span class="ml-1 text-xs">${detailText}</span></td>
            <td class="px-4 py-2 text-right text-gray-500 text-xs font-mono">${item.time}</td>
        `;
        DOM.inspTodayListBody.appendChild(tr);
    });
};

export const clearTodayList = () => {
    todayInspectionList = [];
    renderTodayInspectionList();
};

// ======================================================
// 5. 이력 관리 탭 로직
// ======================================================

// 전체 검수 이력 조회
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

// 상품별 상세 로그 조회
export const loadInspectionLogs = async (productName) => {
    if (!productName) return;
    
    if (DOM.inspectionLogManagerModal) DOM.inspectionLogManagerModal.classList.remove('hidden');
    if (DOM.inspectionLogProductName) DOM.inspectionLogProductName.textContent = productName;
    if (DOM.inspectionLogTableBody) DOM.inspectionLogTableBody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-500">로딩 중...</td></tr>';

    try {
        const docRef = doc(State.db, 'product_history', productName);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            currentProductLogs = data.logs || [];
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

export const prepareEditInspectionLog = (productName, index) => {
    const log = currentProductLogs[index];
    if (!log) return;

    if (DOM.editInspProductName) DOM.editInspProductName.value = productName;
    if (DOM.editInspDateTime) DOM.editInspDateTime.value = `${log.date} ${log.time}`;
    
    if (DOM.editInspPackingNo) DOM.editInspPackingNo.value = log.inboundDate || log.packingNo || '';
    
    if (DOM.editInspInboundQty) DOM.editInspInboundQty.value = log.inboundQty || 0;
    if (DOM.editInspNotes) DOM.editInspNotes.value = log.note || '';
    if (DOM.editInspLogIndex) DOM.editInspLogIndex.value = index;
    
    if (DOM.editInspSupplierName) DOM.editInspSupplierName.value = log.supplierName || ''; // [추가]

    const checklist = log.checklist || {};
    const setSelect = (dom, val) => { if (dom) dom.value = val || (dom.options[0]?.value || ''); };
    
    if (DOM.editInspCheckThickness) DOM.editInspCheckThickness.value = checklist.thickness || ''; 
    
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

export const updateInspectionLog = async () => {
    const productName = DOM.editInspProductName.value;
    const index = parseInt(DOM.editInspLogIndex.value, 10);
    
    if (!productName || isNaN(index) || !currentProductLogs[index]) return;

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
        fabric: '원단', color: '컬러', distortion: '뒤틀림',
        unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
        lining: '안감', pilling: '보풀', dye: '이염'
    };
    Object.entries(checklist).forEach(([key, value]) => {
        if (key === 'thickness') return;
        if (!NORMAL_VALUES.includes(value)) {
            defectsFound.push(`${labelMap[key] || key}(${value})`);
        }
    });

    const updatedLog = {
        ...currentProductLogs[index], 
        inboundDate: DOM.editInspPackingNo.value, 
        inboundQty: Number(DOM.editInspInboundQty.value) || 0,
        supplierName: DOM.editInspSupplierName.value, // [추가]
        checklist: checklist,
        defects: defectsFound,
        note: DOM.editInspNotes.value,
        status: defectsFound.length > 0 ? '불량' : '정상'
    };

    currentProductLogs[index] = updatedLog;

    try {
        const docRef = doc(State.db, 'product_history', productName);
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);

        // 최종 로그와 최근 공급처 상품명을 문서 루트에 업데이트
        const updates = {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
        };
        // 현재 수정된 로그가 가장 최신 로그라면 문서 루트 필드도 업데이트
        if (index === currentProductLogs.length - 1) {
            updates.lastSupplierName = updatedLog.supplierName; // [추가]
            updates.lastCode = updatedLog.code;
            updates.lastOption = updatedLog.option;
        }
        
        await updateDoc(docRef, updates);

        showToast("기록이 수정되었습니다.");
        DOM.inspectionLogEditorModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);

    } catch (e) {
        console.error("Error updating log:", e);
        showToast("수정 중 오류가 발생했습니다.", true);
    }
};

export const deleteInspectionLog = async () => {
    const productName = DOM.editInspProductName.value;
    const index = parseInt(DOM.editInspLogIndex.value, 10);

    if (!productName || isNaN(index)) return;
    if (!confirm("정말 이 상세 기록을 삭제하시겠습니까?")) return;

    currentProductLogs.splice(index, 1);

    try {
        const docRef = doc(State.db, 'product_history', productName);
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);
        
        const updates = {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
            totalInbound: increment(-1) 
        };
        // 삭제 후 마지막 로그의 정보로 문서 루트 필드 업데이트
        if (currentProductLogs.length > 0) {
            const lastLog = currentProductLogs[currentProductLogs.length - 1];
            updates.lastSupplierName = lastLog.supplierName || '-'; // [추가]
            updates.lastCode = lastLog.code || '-';
            updates.lastOption = lastLog.option || '-';
        } else {
             // 모든 로그가 삭제되면 관련 필드도 초기화
            updates.lastSupplierName = '-';
            updates.lastCode = '-';
            updates.lastOption = '-';
        }

        await updateDoc(docRef, updates);

        showToast("기록이 삭제되었습니다.");
        DOM.inspectionLogEditorModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);

    } catch (e) {
        console.error("Error deleting log:", e);
        showToast("삭제 중 오류가 발생했습니다.", true);
    }
};

export const deleteProductHistory = async (productName) => {
    if (!productName) return false;
    if (!confirm(`정말 '${productName}' 상품의 모든 검수 이력을 삭제하시겠습니까?\n(이 작업은 복구할 수 없습니다)`)) return false;

    try {
        const docRef = doc(State.db, 'product_history', productName);
        await deleteDoc(docRef);
        showToast(`'${productName}' 상품 및 이력이 모두 삭제되었습니다.`);
        return true; 
    } catch (e) {
        console.error("Error deleting product:", e);
        showToast("상품 삭제 중 오류가 발생했습니다.", true);
        return false;
    }
};