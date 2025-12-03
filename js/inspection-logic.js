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

// 검수 세션 초기화 함수 (업무 시작 시 호출)
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
    
    // 입고 일자 필드 초기화 (잠금 상태로 복구)
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

    // 5. 완료된 엑셀 리스트 자동 삭제 확인
    const list = State.appState.inspectionList || [];
    if (list.length > 0) {
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

// 엑셀 리스트 전체 삭제 (초기화)
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

// 이력(History)에서 특정 날짜의 검수 리스트 삭제
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
// 1. 엑셀 리스트 업로드 및 처리 (수정됨: 시트2 E열 기준 매칭)
// ======================================================
export const handleExcelUpload = (file) => {
    // 1. 패킹출고일(입고일) 추출
    let packingDate = getTodayDateString(); // 기본값: 오늘
    
    // (YYMMDD) 형태 찾기
    const parentMatch = file.name.match(/\((\d{6})\)/);
    // 20YYMMDD 형태 찾기
    const fullDateMatch = file.name.match(/20(\d{2})(\d{2})(\d{2})/);
    // YYMMDD 형태 찾기 (괄호 없이)
    const shortDateMatch = file.name.match(/(\d{2})(\d{2})(\d{2})/);

    if (parentMatch) {
        const y = parentMatch[1].substring(0, 2);
        const m = parentMatch[1].substring(2, 4);
        const d = parentMatch[1].substring(4, 6);
        packingDate = `20${y}-${m}-${d}`;
    } else if (fullDateMatch) {
        packingDate = `20${fullDateMatch[1]}-${fullDateMatch[2]}-${fullDateMatch[3]}`;
    } else if (shortDateMatch) {
        packingDate = `20${shortDateMatch[1]}-${shortDateMatch[2]}-${shortDateMatch[3]}`;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // --- [Step 1] 시트 2 읽기 (샘플 위치 정보) ---
            const sampleMap = new Map(); // Key: 공급처상품명(E열), Value: 로케이션(G열)
            
            if (workbook.SheetNames.length > 1) {
                const sheet2Name = workbook.SheetNames[1];
                const sheet2 = workbook.Sheets[sheet2Name];
                const json2 = XLSX.utils.sheet_to_json(sheet2, { header: 1 });
                
                // 시트2 데이터 파싱
                for (let i = 1; i < json2.length; i++) {
                    const row = json2[i];
                    if (row) {
                        // ✅ [수정] 두 번째 시트: E열(Index 4) 공급처상품명, G열(Index 6) 샘플위치
                        const supplierName = String(row[4] || '').trim(); // E열
                        const location = String(row[6] || '').trim();     // G열
                        
                        if (supplierName && location) {
                            // 공백/대소문자 제거하여 키 생성
                            const key = supplierName.replace(/\s/g, '').toLowerCase();
                            sampleMap.set(key, location);
                        }
                    }
                }
            }

            // --- [Step 2] 시트 1 읽기 (검수 리스트) ---
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
                        const location = String(row[6] || '').trim(); // G열 (검수 로케이션)
                        
                        if (code || name) {
                            // 1. 중복 제거 로직
                            let color = option.replace(/\[|\]/g, '').split('-')[0].trim();
                            if (!color) color = 'N/A';
                            
                            const keyColor = color.replace(/\s/g, '').toLowerCase();
                            const keySupplierName = supplierName.replace(/\s/g, '').toLowerCase();
                            const uniqueKey = `${keySupplierName}::${keyColor}`; 

                            // 2. 시트2와 매칭 확인 (샘플 위치 확인)
                            let sampleLocation = null;
                            if (keySupplierName && sampleMap.has(keySupplierName)) {
                                sampleLocation = sampleMap.get(keySupplierName);
                            }

                            if (!uniqueKeyMap.has(uniqueKey)) {
                                uniqueKeyMap.set(uniqueKey, true); 
                                
                                processedList.push({
                                    code: code,
                                    name: name,
                                    option: option,
                                    qty: qty,
                                    thickness: thickness,
                                    supplierName: supplierName,
                                    location: location, 
                                    sampleLocation: sampleLocation, // 시트2에서 매칭된 위치
                                    status: '대기',
                                    inboundDate: packingDate,
                                    packingDate: packingDate
                                });
                            }
                        }
                    }
                }
            }
            // --- Deduplication Logic End ---

            if (processedList.length > 0) {
                await updateDailyData({ inspectionList: processedList });
                // 로컬 상태 업데이트
                State.appState.inspectionList = processedList;
                
                showToast(`${processedList.length}개의 리스트가 업로드되었습니다. (패킹일: ${packingDate})`);
                renderTodoList(); 
                
                // 업로드 후 자동으로 리스트 팝업창 열기
                openInspectionListWindow();

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

// ======================================================
// 2. 리스트 팝업창 로직 (수정됨)
// ======================================================

// 별도 창으로 리스트 열기 함수 (로케이션, 상품명, 수량, 샘플위치 포함)
export const openInspectionListWindow = () => {
    const list = State.appState.inspectionList || [];
    if (list.length === 0) {
        showToast("리스트 데이터가 없습니다.", true);
        return;
    }

    // 패킹출고일 가져오기
    const packingDate = list[0].packingDate || getTodayDateString();
    
    // 새 창 열기
    const popup = window.open('', 'InspectionListWindow', 'width=800,height=900,scrollbars=yes,resizable=yes');
    if (!popup) {
        showToast("팝업 차단을 해제해주세요.", true);
        return;
    }

    const rowsHtml = list.map((item, idx) => {
        const isCompleted = item.status === '완료';
        const trClass = isCompleted ? 'bg-gray-100 text-gray-500' : 'hover:bg-blue-50 cursor-pointer';
        const statusBadge = isCompleted 
            ? '<span class="text-green-600 font-bold text-xs">완료</span>' 
            : '<span class="text-gray-400 text-xs">대기</span>';
        
        // 클릭 시 부모 창의 함수 호출 (window.opener)
        const onClickScript = isCompleted ? '' : `onclick="selectItemInParent(${idx})"`;
        
        // 샘플 위치 강조 표시
        const sampleHtml = item.sampleLocation 
            ? `<span class="text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-100">${item.sampleLocation}</span>` 
            : '-';

        return `
            <tr class="border-b last:border-0 transition ${trClass}" ${onClickScript}>
                <td class="px-3 py-2 text-center text-sm font-bold text-blue-700">${item.location || '-'}</td>
                <td class="px-3 py-2 text-sm font-medium">
                    ${item.name}
                    <div class="text-xs text-gray-500 font-normal">${item.option || '-'}</div>
                </td>
                <td class="px-3 py-2 text-center text-sm font-bold text-gray-800">${item.qty}</td>
                <td class="px-3 py-2 text-center text-sm">${sampleHtml}</td>
                <td class="px-3 py-2 text-center">${statusBadge}</td>
            </tr>
        `;
    }).join('');

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <title>패킹출고일: ${packingDate}</title>
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
                <div>
                    <h2 class="text-xl font-bold text-gray-800">📋 검수 대기 리스트</h2>
                    <p class="text-sm text-gray-500 mt-1">📅 패킹출고일: <span class="font-bold text-indigo-600">${packingDate}</span></p>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-xs font-medium bg-gray-100 px-3 py-1 rounded-full text-gray-600">총 ${list.length}건</span>
                    <button onclick="window.close()" class="text-gray-400 hover:text-gray-700 text-2xl font-bold px-2 leading-none">
                        &times;
                    </button>
                </div>
            </div>
            <div class="overflow-y-auto">
                <table class="w-full text-left border-collapse">
                    <thead class="bg-gray-100 text-xs uppercase text-gray-500 sticky top-0">
                        <tr>
                            <th class="px-3 py-2 font-semibold border-b text-center w-1/6">로케이션</th>
                            <th class="px-3 py-2 font-semibold border-b w-1/3">상품명 (옵션)</th>
                            <th class="px-3 py-2 font-semibold border-b text-center w-1/6">입고수량</th>
                            <th class="px-3 py-2 font-semibold border-b text-center w-1/6 text-red-700">샘플위치</th>
                            <th class="px-3 py-2 font-semibold border-b text-center w-1/6">상태</th>
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
        
        const locationInfo = item.location ? `<span class="text-indigo-600 font-bold bg-indigo-50 px-1 rounded">📦 ${item.location}</span>` : '';
        const sampleInfo = item.sampleLocation ? `<span class="text-red-600 font-bold bg-red-50 px-1 rounded ml-1">📌 샘플: ${item.sampleLocation}</span>` : '';
        const dateInfo = item.packingDate ? `<span class="text-gray-500 ml-1">📅 ${item.packingDate.slice(2)}</span>` : '';
        
        tr.innerHTML = `
            <td class="px-3 py-2 font-mono text-gray-600 text-xs align-top">${item.code}</td>
            <td class="px-3 py-2 font-medium text-gray-800 align-top">
                <div class="truncate max-w-[150px]" title="${item.name}">${item.name}</div>
                <div class="text-[10px] mt-0.5 flex flex-wrap gap-1">
                    ${locationInfo}
                    ${sampleInfo}
                    ${dateInfo}
                </div>
            </td>
            <td class="px-3 py-2 text-gray-500 text-xs align-top">${item.option}</td>
            <td class="px-3 py-2 text-right text-xs ${statusColor} align-top">${item.status}</td>
        `;
        
        tr.addEventListener('click', () => {
            selectTodoItem(idx);
        });
        DOM.inspTodoListBody.appendChild(tr);
    });
};

export const selectTodoItem = (index) => {
    const item = State.appState.inspectionList[index];
    if (!item) return;

    currentTodoIndex = index; 

    DOM.inspProductNameInput.value = item.name; 
    if (DOM.inspInboundDateInput) DOM.inspInboundDateInput.value = item.inboundDate || getTodayDateString();
    if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = item.qty > 0 ? item.qty : '';
    
    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${item.option || '-'}`;
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${item.code || '-'}`;
    
    let supplierText = `공급처: ${item.supplierName || '-'}`;
    if (item.location) supplierText += ` / 📦 Loc: ${item.location}`;
    if (item.sampleLocation) supplierText += ` / 📌 샘플: ${item.sampleLocation}`; 
    if (item.packingDate) supplierText += ` / 📅 패킹: ${item.packingDate}`;
    
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = supplierText; 
    
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${item.thickness || '-'}`;

    searchProductHistory(); 
    
    DOM.inspNotesInput.value = '';
    
    showToast(`'${item.name}' 선택됨`);
};

window.selectInspectionTodoItem = selectTodoItem;

// ... (이후 toggleScanner 등 나머지 기존 함수들 유지)
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
    let matchedIndex = -1;

    if (currentTodoIndex >= 0 && list[currentTodoIndex] && list[currentTodoIndex].name === searchTerm) {
        matchedIndex = currentTodoIndex;
    } else {
        matchedIndex = list.findIndex(item => 
            (item.code && item.code.trim() === searchTerm) || 
            (item.name && item.name.trim() === searchTerm)
        );
    }

    let targetProductName = searchTerm;

    if (matchedIndex > -1) {
        const matchedItem = list[matchedIndex];
        targetProductName = matchedItem.name;
        currentTodoIndex = matchedIndex; 

        DOM.inspProductNameInput.value = targetProductName;
        
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${matchedItem.option || '-'}`;
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${matchedItem.code || '-'}`;
        
        let supplierText = `공급처: ${matchedItem.supplierName || '-'}`;
        if (matchedItem.location) supplierText += ` / 📦 Loc: ${matchedItem.location}`;
        if (matchedItem.sampleLocation) supplierText += ` / 📌 샘플: ${matchedItem.sampleLocation}`;
        if (matchedItem.packingDate) supplierText += ` / 📅 패킹: ${matchedItem.packingDate}`;
        
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = supplierText; 
        
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${matchedItem.thickness || '-'}`;
        
        if (DOM.inspInboundDateInput) {
            DOM.inspInboundDateInput.value = matchedItem.inboundDate || getTodayDateString();
            DOM.inspInboundDateInput.readOnly = true;
            DOM.inspInboundDateInput.classList.add('bg-gray-100');
            DOM.inspInboundDateInput.classList.remove('bg-white');
        }
        if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = matchedItem.qty > 0 ? matchedItem.qty : '';

    } else {
        currentTodoIndex = -1; 
        
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';

        if (DOM.inspInboundDateInput) {
            DOM.inspInboundDateInput.readOnly = false;
            DOM.inspInboundDateInput.classList.remove('bg-gray-100');
            DOM.inspInboundDateInput.classList.add('bg-white');
            if (!DOM.inspInboundDateInput.value) {
                DOM.inspInboundDateInput.value = getTodayDateString();
            }
        }
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
        
        location: currentItem ? currentItem.location : '-',
        packingDate: currentItem ? currentItem.packingDate : '-',

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
    
    if (DOM.editInspSupplierName) DOM.editInspSupplierName.value = log.supplierName || '';

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
        supplierName: DOM.editInspSupplierName.value, 
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

        const updates = {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
        };
        
        if (index === currentProductLogs.length - 1) {
            updates.lastSupplierName = updatedLog.supplierName;
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
        
        if (currentProductLogs.length > 0) {
            const lastLog = currentProductLogs[currentProductLogs.length - 1];
            updates.lastSupplierName = lastLog.supplierName || '-'; 
            updates.lastCode = lastLog.code || '-';
            updates.lastOption = lastLog.option || '-';
        } else {
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