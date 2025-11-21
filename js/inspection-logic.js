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
// [신규] 현재 작업 중인 리스트 인덱스 (다음 상품 자동 선택용)
let currentTodoIndex = -1;

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

            // 엑셀 파싱 규칙:
            // A열(0): 상품코드
            // B열(1): 상품명
            // C열(2): 옵션
            // D열(3): 입고수량 (숫자)
            // E열(4): 기준 두께 (숫자/텍스트)
            const newList = [];
            if (jsonData.length > 1) {
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (row && row.length > 0) {
                        const code = String(row[0] || '').trim();
                        const name = String(row[1] || '').trim();
                        
                        if (code || name) { // 코드나 이름이 있으면 유효한 행으로 간주
                            newList.push({
                                code: code,
                                name: name,
                                option: String(row[2] || '').trim(),
                                qty: Number(row[3]) || 0,        // 입고수량
                                thickness: String(row[4] || ''), // 기준 두께
                                status: '대기',
                                inboundDate: inboundDate         // 파일명에서 추출한 날짜
                            });
                        }
                    }
                }
            }

            if (newList.length > 0) {
                await updateDailyData({ inspectionList: newList });
                showToast(`${newList.length}개의 리스트가 업로드되었습니다. (입고일: ${inboundDate})`);
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
        // [수정] 완료된 항목도 클릭 가능하도록 조건 제거, 스타일만 변경
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

const selectTodoItem = (index) => {
    const item = State.appState.inspectionList[index];
    if (!item) return;

    currentTodoIndex = index; // 현재 인덱스 저장 (다음 이동용)

    // 1. 기본 정보 자동 입력
    DOM.inspProductNameInput.value = item.name; 
    if (DOM.inspInboundDateInput) DOM.inspInboundDateInput.value = item.inboundDate || getTodayDateString();
    if (DOM.inspInboundQtyInput) DOM.inspInboundQtyInput.value = item.qty > 0 ? item.qty : '';
    
    // 2. 옵션/코드/기준두께 표시
    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${item.option || '-'}`;
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${item.code || '-'}`;
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${item.thickness || '-'}`;

    // 3. 이력 조회 실행
    searchProductHistory(); 
    
    // 4. 비고란 초기화 (옵션/코드는 이제 별도 표시되므로 비고에 안 넣음)
    DOM.inspNotesInput.value = '';
    
    showToast(`'${item.name}' 선택됨`);
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

    const list = State.appState.inspectionList || [];
    // 코드 매칭
    const foundIdx = list.findIndex(item => item.code === decodedText || decodedText.includes(item.code));
    
    if (foundIdx > -1) {
        selectTodoItem(foundIdx);
    } else {
        DOM.inspProductNameInput.value = decodedText;
        searchProductHistory();
        DOM.inspNotesInput.value = `[스캔됨: ${decodedText}]`;
    }
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
    const productNameInput = DOM.inspProductNameInput.value.trim();
    if (!productNameInput) {
        showToast('상품명을 입력해주세요.', true);
        return;
    }

    DOM.inspHistoryReport.classList.remove('hidden');
    DOM.inspCurrentInputArea.classList.remove('hidden');
    DOM.inspAlertBox.classList.add('hidden');
    DOM.inspReportTitle.textContent = productNameInput;
    
    // 조회 시에는 이미지를 초기화하지 않음 (입력 중일 수 있으므로)
    // 단, 폼의 체크리스트는 초기화 (이전 상품 값 잔류 방지)
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); // [수정] 빈 값으로 초기화

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
                DOM.inspAlertMsg.textContent = `과거 불량: ${recentDefects}`;
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

    // 1. 체크리스트 유효성 검사 (필수 선택)
    const checklist = {
        thickness: DOM.inspCheckThickness.value, // 숫자 입력
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

    // 두께는 숫자이므로 빈 값 체크, 나머지는 select
    if (checklist.thickness === '' || Object.values(checklist).some(v => v === "" || v === null)) {
        alert("⚠️ 모든 품질 체크리스트 항목을 확인하고 선택해주세요.");
        return;
    }

    const inboundDate = DOM.inspInboundDateInput.value.trim() || getTodayDateString();
    const inboundQty = DOM.inspInboundQtyInput.value.trim();
    const note = DOM.inspNotesInput.value.trim();

    // 리스트에 있는 정보 가져오기 (옵션/코드 저장용)
    let currentItem = null;
    if (currentTodoIndex >= 0 && State.appState.inspectionList[currentTodoIndex]) {
        currentItem = State.appState.inspectionList[currentTodoIndex];
    }

    const defectsFound = [];
    const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];
    
    // 두께 제외하고 나머지 불량 체크
    const labelMap = {
        fabric: '원단', color: '컬러', distortion: '뒤틀림',
        unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
        lining: '안감', pilling: '보풀', dye: '이염'
    };

    Object.entries(checklist).forEach(([key, value]) => {
        if (key === 'thickness') return; // 두께는 별도 처리 안함 (수치 기록만 함)
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
        inboundDate: inboundDate, // 패킹번호 대신 입고일자
        inboundQty: Number(inboundQty) || 0,
        
        // [신규] 옵션, 코드 저장
        option: currentItem ? currentItem.option : '-',
        code: currentItem ? currentItem.code : '-',
        
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

        if (defectsFound.length > 0) {
            const defectSummaryStr = `${today}: ${defectsFound.join(', ')}`;
            updates.defectSummary = arrayUnion(defectSummaryStr);
        }

        await setDoc(docRef, updates, { merge: true });

        // [수정] 리스트 상태 업데이트 (현재 선택된 항목 완료 처리)
        const list = [...State.appState.inspectionList]; // 복사본
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
        
        // 폼 및 이미지 초기화
        resetInspectionForm(true);
        clearImageState();
        
        // [신규] 다음 상품 자동 선택
        if (currentTodoIndex >= 0 && currentTodoIndex < list.length - 1) {
            selectTodoItem(currentTodoIndex + 1);
        } else {
            showToast("리스트의 마지막 상품입니다.");
            DOM.inspHistoryReport.classList.add('hidden');
            DOM.inspCurrentInputArea.classList.add('hidden');
            currentTodoIndex = -1; // 리셋
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
    // 패킹번호 대신 입고일자지만, 입고일자는 보통 유지하거나 자동입력이므로 둠.
    DOM.inspInboundQtyInput.value = '';
    DOM.inspNotesInput.value = '';
    DOM.inspCheckThickness.value = ''; // 숫자 입력창 초기화
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); // 빈 값으로 초기화 (유효성 검사 걸리게)
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

// (이하 updateInspectionLog, deleteInspectionLog, prepareEditInspectionLog, deleteProductHistory 함수들은 기존 로직 유지하되, 필요한 경우 inboundDate 등으로 필드명 업데이트 필요. 일단 핵심 로직인 저장 부분 위주로 수정함)
export const prepareEditInspectionLog = (productName, index) => {
    // ... (기존 로직 유지, 필요시 패킹번호 -> 입고일자로 라벨 변경 등 대응)
    // 여기서는 일단 생략하고 저장 로직 위주로 변경함.
    // 실제 구현 시 수정 모달(inspectionLogEditorModal)의 DOM ID도 packingNo -> inboundDate 등으로 맞춰줘야 함.
    // (이번 요청 범위인 logic.js에서는 저장 로직에 집중)
    const log = currentProductLogs[index];
    if (!log) return;

    if (DOM.editInspProductName) DOM.editInspProductName.value = productName;
    if (DOM.editInspDateTime) DOM.editInspDateTime.value = `${log.date} ${log.time}`;
    
    // 패킹번호 필드를 입고일자 필드로 재사용 (ID는 그대로 두고 값만 바꿈)
    if (DOM.editInspPackingNo) DOM.editInspPackingNo.value = log.inboundDate || log.packingNo || '';
    
    if (DOM.editInspInboundQty) DOM.editInspInboundQty.value = log.inboundQty || 0;
    if (DOM.editInspNotes) DOM.editInspNotes.value = log.note || '';
    if (DOM.editInspLogIndex) DOM.editInspLogIndex.value = index;
    
    const checklist = log.checklist || {};
    const setSelect = (dom, val) => { if (dom) dom.value = val || (dom.options[0]?.value || ''); };
    
    // 두께는 input type=number
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
    // ... (기존 updateInspectionLog 로직에서 checklist.thickness 처리 및 packingNo -> inboundDate 매핑 주의)
    const productName = DOM.editInspProductName.value;
    const index = parseInt(DOM.editInspLogIndex.value, 10);
    
    if (!productName || isNaN(index) || !currentProductLogs[index]) return;

    const checklist = {
        thickness: DOM.editInspCheckThickness.value, // 숫자
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

    // 불량 판정 로직 (두께 제외)
    const defectsFound = [];
    const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];
    const labelMap = {
        fabric: '원단', color: '컬러', distortion: '뒤틀림',
        unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
        lining: '안감', pilling: '보풀', dye: '이염'
    };
    Object.entries(checklist).forEach(([key, value]) => {
        if (key === 'thickness') return;
        if (!NORMAL_VALUES.includes(value) && value !== '') {
            defectsFound.push(`${labelMap[key] || key}(${value})`);
        }
    });

    const updatedLog = {
        ...currentProductLogs[index], 
        inboundDate: DOM.editInspPackingNo.value, // ID 재사용
        inboundQty: Number(DOM.editInspInboundQty.value) || 0,
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

        await updateDoc(docRef, {
            logs: currentProductLogs,
            defectSummary: newDefectSummary
        });

        showToast("기록이 수정되었습니다.");
        DOM.inspectionLogEditorModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);

    } catch (e) {
        console.error("Error updating log:", e);
        showToast("수정 중 오류가 발생했습니다.", true);
    }
};

export const deleteInspectionLog = async () => {
    // ... (기존 로직 동일)
    const productName = DOM.editInspProductName.value;
    const index = parseInt(DOM.editInspLogIndex.value, 10);

    if (!productName || isNaN(index)) return;
    if (!confirm("정말 이 상세 기록을 삭제하시겠습니까?")) return;

    currentProductLogs.splice(index, 1);

    try {
        const docRef = doc(State.db, 'product_history', productName);
        // 결함 요약 재생성
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);

        await updateDoc(docRef, {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
            totalInbound: increment(-1) 
        });

        showToast("기록이 삭제되었습니다.");
        DOM.inspectionLogEditorModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);

    } catch (e) {
        console.error("Error deleting log:", e);
        showToast("삭제 중 오류가 발생했습니다.", true);
    }
};

export const deleteProductHistory = async (productName) => {
    // ... (기존 로직 동일)
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