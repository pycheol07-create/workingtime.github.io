// === js/inspection-logic.js ===
// 설명: 검수 이력 조회, 저장, 리스트 관리, 수정/삭제(상세/전체), 스캔, 엑셀, 이미지 처리 등 핵심 로직

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getCurrentTime, getTodayDateString } from './utils.js';
import { 
    doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, increment, serverTimestamp, collection, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderInspectionHistoryTable, renderInspectionLogTable } from './ui-history-inspection.js';

// 로컬 상태 변수
let todayInspectionList = [];
let inspectionTodoList = []; // 엑셀 업로드된 리스트
let html5QrCode = null; // 스캐너 인스턴스
let currentImageBase64 = null; // 업로드된 이미지 데이터
let currentProductLogs = []; // 상세보기를 위한 임시 저장소

// ======================================================
// 1. 엑셀 리스트 업로드 및 처리
// ======================================================
export const handleExcelUpload = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            // 엑셀 파싱: 1열(A)=코드, 2열(B)=이름, 3열(C)=옵션
            inspectionTodoList = [];
            if (jsonData.length > 1) {
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (row && row.length > 0) {
                        const code = String(row[0] || '').trim();
                        const name = String(row[1] || '').trim();
                        const option = String(row[2] || '').trim();
                        if (code) {
                            inspectionTodoList.push({ code, name, option, status: '대기' });
                        }
                    }
                }
            }
            renderTodoList();
            showToast(`${inspectionTodoList.length}개의 검수 대기 목록을 불러왔습니다.`);
        } catch (err) {
            console.error("Excel parse error:", err);
            showToast("엑셀 파일 처리 중 오류가 발생했습니다.", true);
        }
    };
    reader.readAsArrayBuffer(file);
};

const renderTodoList = () => {
    if (!DOM.inspTodoListArea || !DOM.inspTodoListBody) return;
    
    if (inspectionTodoList.length > 0) {
        DOM.inspTodoListArea.classList.remove('hidden');
    } else {
        DOM.inspTodoListArea.classList.add('hidden');
        return;
    }

    DOM.inspTodoListBody.innerHTML = '';
    inspectionTodoList.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-blue-50 transition border-b last:border-0 cursor-pointer';
        const statusColor = item.status === '완료' ? 'text-green-600 font-bold' : 'text-gray-400';
        
        tr.innerHTML = `
            <td class="px-3 py-2 font-mono text-gray-600">${item.code}</td>
            <td class="px-3 py-2 font-medium text-gray-800 truncate max-w-[150px]">${item.name}</td>
            <td class="px-3 py-2 text-gray-500 text-xs">${item.option}</td>
            <td class="px-3 py-2 text-right ${statusColor}">${item.status}</td>
        `;
        
        tr.addEventListener('click', () => {
            if (item.status !== '완료') {
                selectTodoItem(idx);
            }
        });
        DOM.inspTodoListBody.appendChild(tr);
    });
};

const selectTodoItem = (index) => {
    const item = inspectionTodoList[index];
    // 폼에 자동 입력
    DOM.inspProductNameInput.value = item.name; 
    
    // 상품명으로 이력 조회
    searchProductHistory(); 
    
    // 옵션/코드는 메모에 자동 기입
    DOM.inspNotesInput.value = `[옵션: ${item.option}] [코드: ${item.code}]`;
    
    showToast(`'${item.name}' 검수를 시작합니다.`);
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
    if (html5QrCode) return; // 이미 실행 중

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

    // 1. 업로드된 리스트에서 코드 매칭 시도
    const foundIdx = inspectionTodoList.findIndex(item => item.code === decodedText || decodedText.includes(item.code));
    
    if (foundIdx > -1) {
        selectTodoItem(foundIdx);
    } else {
        // 매칭 안되면 상품명 검색창에 코드 입력 후 조회 시도
        DOM.inspProductNameInput.value = decodedText;
        searchProductHistory();
        DOM.inspNotesInput.value = `[스캔됨: ${decodedText}]`;
    }
};

// ======================================================
// 3. 이미지 처리 (리사이징 & Base64)
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
            
            // 압축된 Base64 (JPEG, 퀄리티 0.7)
            currentImageBase64 = canvas.toDataURL('image/jpeg', 0.7); 
            
            // 미리보기 표시
            if (DOM.inspImagePreviewBox) {
                DOM.inspImagePreviewBox.classList.remove('hidden');
                DOM.inspImagePreviewImg.src = currentImageBase64;
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

// ======================================================
// 4. 메인 검수 로직 (조회, 저장, 초기화)
// ======================================================

// 상품 이력 조회
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
    
    // 이미지 및 폼 초기화
    currentImageBase64 = null;
    if (DOM.inspImagePreviewBox) DOM.inspImagePreviewBox.classList.add('hidden');
    if (DOM.inspImageInput) DOM.inspImageInput.value = '';
    
    resetInspectionForm(false); // 상품명은 유지

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
            showToast('신규 상품입니다.');
        }
    } catch (e) {
        console.error("Error searching product history:", e);
        showToast("이력 조회 중 오류가 발생했습니다.", true);
    }
};

// 검수 완료 및 저장
export const saveInspectionAndNext = async () => {
    const productName = DOM.inspProductNameInput.value.trim();
    if (!productName) {
        showToast('상품 조회를 먼저 진행해주세요.', true);
        return;
    }

    const packingNo = DOM.inspPackingNoInput.value.trim();
    const inboundQty = DOM.inspInboundQtyInput.value.trim();
    const note = DOM.inspNotesInput.value.trim();

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
        status,
        image: currentImageBase64 || null // 이미지 데이터 추가
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

        // 할 일 목록 상태 업데이트 (완료 처리)
        const todoItem = inspectionTodoList.find(item => item.name === productName || productName.includes(item.code));
        if(todoItem) {
            todoItem.status = '완료';
            renderTodoList();
        }

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
        
        // 폼 초기화
        resetInspectionForm(true);
        currentImageBase64 = null;
        if(DOM.inspImagePreviewBox) DOM.inspImagePreviewBox.classList.add('hidden');
        if(DOM.inspImageInput) DOM.inspImageInput.value = '';
        
        DOM.inspHistoryReport.classList.add('hidden');
        DOM.inspCurrentInputArea.classList.add('hidden');
        DOM.inspProductNameInput.focus();

    } catch (e) {
        console.error("Error saving inspection:", e);
        showToast("저장 중 오류가 발생했습니다.", true);
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = `<span>검수 완료 및 저장</span>`; }
    }
};

// 폼 초기화 헬퍼
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
            <td class="px-4 py-2 text-gray-600 font-mono text-xs">${item.packingNo || '-'}</td>
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
// 5. 이력 관리 탭 로직 (전체 조회, 상세, 수정, 삭제)
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

// 기록 수정을 위한 데이터 준비
export const prepareEditInspectionLog = (productName, index) => {
    const log = currentProductLogs[index];
    if (!log) {
        showToast("해당 기록을 찾을 수 없습니다.", true);
        return;
    }

    // 폼 채우기
    if (DOM.editInspProductName) DOM.editInspProductName.value = productName;
    if (DOM.editInspDateTime) DOM.editInspDateTime.value = `${log.date} ${log.time}`;
    if (DOM.editInspPackingNo) DOM.editInspPackingNo.value = log.packingNo || '';
    if (DOM.editInspInboundQty) DOM.editInspInboundQty.value = log.inboundQty || 0;
    if (DOM.editInspNotes) DOM.editInspNotes.value = log.note || '';
    if (DOM.editInspLogIndex) DOM.editInspLogIndex.value = index;
    
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

// 기록 수정 저장
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
        ...currentProductLogs[index], 
        packingNo: DOM.editInspPackingNo.value,
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

// 상세 기록 1개 삭제
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

// 상품 전체 삭제
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