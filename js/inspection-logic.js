// === js/inspection-logic.js ===
// 설명: 검수 관련 핵심 비즈니스 로직 (검색, 저장, 삭제, 엑셀, 스캔, 이미지)

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getCurrentTime, getTodayDateString, compressImage } from './utils.js';

import { 
    doc, getDoc, setDoc, updateDoc, arrayUnion, increment, serverTimestamp, collection, getDocs, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { renderInspectionHistoryTable, renderInspectionLogTable } from './ui-history-inspection.js';

// 로컬 상태
let todayInspectionList = [];
let currentProductLogs = [];
let plannedInspectionList = []; // [신규] 엑셀로 불러온 검수 예정 리스트
let html5QrCode = null; // [신규] 바코드 스캐너 인스턴스

// ---------------------------------------------------------
// 1. 상품 검색 및 조회
// ---------------------------------------------------------
export const searchProductHistory = async (productNameOverride = null) => {
    const productNameInput = productNameOverride || DOM.inspProductNameInput.value.trim();
    
    if (!productNameInput) {
        showToast('상품명을 입력해주세요.', true);
        return;
    }
    
    // 검색창 값 동기화 (버튼 클릭이나 스캔으로 호출된 경우)
    if (DOM.inspProductNameInput.value !== productNameInput) {
        DOM.inspProductNameInput.value = productNameInput;
    }

    DOM.inspHistoryReport.classList.remove('hidden');
    DOM.inspCurrentInputArea.classList.remove('hidden');
    DOM.inspAlertBox.classList.add('hidden');
    DOM.inspReportTitle.textContent = productNameInput;
    DOM.inspReportCount.textContent = '0';
    DOM.inspReportDate.textContent = '-';
    
    // 이미지 프리뷰 초기화
    clearImagePreview();
    
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

// ---------------------------------------------------------
// 2. 검수 저장 (이미지 포함)
// ---------------------------------------------------------
export const saveInspectionAndNext = async () => {
    const productName = DOM.inspProductNameInput.value.trim();
    if (!productName) {
        showToast('상품 조회를 먼저 진행해주세요.', true);
        return;
    }

    const packingNo = DOM.inspPackingNoInput.value.trim();
    const inboundQty = DOM.inspInboundQtyInput.value.trim();

    // 체크리스트 수집
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

    // ✅ [신규] 이미지 처리
    let imageBase64 = null;
    const imageInput = document.getElementById('insp-image-upload');
    if (imageInput && imageInput.files && imageInput.files[0]) {
        try {
            // 800px로 리사이징하여 압축 (utils.js에 추가한 함수)
            imageBase64 = await compressImage(imageInput.files[0], 800, 0.7);
        } catch (e) {
            console.error("Image compression failed", e);
            showToast("이미지 처리에 실패했습니다. 이미지 제외하고 저장합니다.", true);
        }
    }

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
        image: imageBase64 // 이미지 데이터 (Base64)
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
            time: nowTime,
            hasImage: !!imageBase64
        });

        renderTodayInspectionList();
        showToast(`'${productName}' 검수 기록 저장 완료!`);
        
        // 예정 리스트에서 해당 항목 제거 (선택사항)
        removeFromPlannedList(productName);

        resetInspectionForm(true);
        clearImagePreview();
        
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

// ---------------------------------------------------------
// 3. 엑셀 업로드 및 예정 리스트 관리
// ---------------------------------------------------------
export const handleExcelUpload = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // JSON 변환 (헤더가 있다고 가정)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // 데이터 파싱 (첫 줄은 헤더로 간주하고 스킵)
        if (jsonData.length > 1) {
            plannedInspectionList = jsonData.slice(1).map(row => {
                // 엑셀 컬럼 순서 가정: [0]상품명, [1]옵션, [2]코드, [3]수량 (필요시 수정)
                // 유연하게 텍스트가 있는 첫 번째 컬럼을 상품명으로 간주
                const name = row[0] || row[1] || '알수없음'; 
                return { name: String(name).trim(), scanned: false };
            }).filter(item => item.name !== '알수없음');
            
            renderPlannedList();
            showToast(`${plannedInspectionList.length}건의 예정 리스트를 불러왔습니다.`);
        } else {
            showToast('유효한 데이터가 없습니다.', true);
        }
    };
    reader.readAsArrayBuffer(file);
};

export const renderPlannedList = () => {
    const container = document.getElementById('insp-planned-list-container');
    if (!container) return;
    
    container.innerHTML = '';
    if (plannedInspectionList.length === 0) {
        container.innerHTML = '<span class="text-xs text-gray-400 py-2">업로드된 예정 내역이 없습니다.</span>';
        return;
    }

    plannedInspectionList.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.className = `flex-shrink-0 px-3 py-1.5 rounded-md text-xs border transition ${item.scanned ? 'bg-gray-100 text-gray-400 border-gray-200 line-through' : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50 shadow-sm'}`;
        btn.textContent = item.name;
        
        if (!item.scanned) {
            btn.addEventListener('click', () => {
                DOM.inspProductNameInput.value = item.name;
                searchProductHistory(item.name);
            });
        }
        container.appendChild(btn);
    });
};

const removeFromPlannedList = (productName) => {
    const targetIndex = plannedInspectionList.findIndex(item => item.name === productName && !item.scanned);
    if (targetIndex > -1) {
        plannedInspectionList[targetIndex].scanned = true;
        renderPlannedList();
    }
};

// ---------------------------------------------------------
// 4. 바코드/QR 스캔 (html5-qrcode)
// ---------------------------------------------------------
export const toggleScanner = () => {
    const scannerContainer = document.getElementById('insp-scanner-container');
    
    if (!scannerContainer.classList.contains('hidden')) {
        // 닫기
        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                scannerContainer.classList.add('hidden');
            }).catch(err => console.error(err));
        } else {
            scannerContainer.classList.add('hidden');
        }
        return;
    }

    // 열기
    scannerContainer.classList.remove('hidden');
    
    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
    }

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    
    html5QrCode.start(
        { facingMode: "environment" }, // 후면 카메라
        config,
        (decodedText, decodedResult) => {
            // 스캔 성공
            console.log(`Scan result: ${decodedText}`, decodedResult);
            
            // 1. 상품명 입력창에 넣기
            DOM.inspProductNameInput.value = decodedText;
            
            // 2. 스캐너 닫기
            html5QrCode.stop().then(() => {
                scannerContainer.classList.add('hidden');
                // 3. 자동 조회
                searchProductHistory(decodedText);
            });
        },
        (errorMessage) => {
            // 스캔 실패 (계속 시도중임) - 로그 너무 많이 찍히니 무시
        }
    ).catch(err => {
        console.error("Scanner start failed", err);
        showToast("카메라를 시작할 수 없습니다.", true);
        scannerContainer.classList.add('hidden');
    });
};

// ---------------------------------------------------------
// 5. 이미지 프리뷰 관리
// ---------------------------------------------------------
const clearImagePreview = () => {
    const previewDiv = document.getElementById('insp-image-preview');
    const fileInput = document.getElementById('insp-image-upload');
    if(previewDiv) previewDiv.classList.add('hidden');
    if(fileInput) fileInput.value = ''; // 파일 선택 초기화
};

// (DOM 리스너에서 호출)
export const handleImageSelect = (file) => {
    const previewDiv = document.getElementById('insp-image-preview');
    const imgEl = previewDiv.querySelector('img');
    
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            imgEl.src = e.target.result;
            previewDiv.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
};

// ---------------------------------------------------------
// 6. 기타 헬퍼 (삭제, 목록 렌더링)
// ---------------------------------------------------------

// ✅ [신규] 상품 전체 삭제 (이력 탭용)
export const deleteProductHistory = async (productId) => {
    if (!productId) return;
    if (!confirm(`'${productId}' 상품의 모든 검수 이력과 데이터를 영구 삭제하시겠습니까?\n(이 작업은 되돌릴 수 없습니다)`)) return;

    try {
        await deleteDoc(doc(State.db, 'product_history', productId));
        showToast(`'${productId}' 상품이 삭제되었습니다.`);
        return true; // 성공 리턴
    } catch (e) {
        console.error("Error deleting product:", e);
        showToast("삭제 중 오류가 발생했습니다.", true);
        return false;
    }
};

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
        if (item.hasImage) {
            detailText += ` <span class="text-blue-500 text-xs">📷 사진</span>`;
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

const resetInspectionForm = (clearProductName = false) => {
    if (clearProductName) DOM.inspProductNameInput.value = '';
    DOM.inspPackingNoInput.value = '';
    DOM.inspInboundQtyInput.value = '';
    DOM.inspNotesInput.value = '';
    
    // 체크리스트 초기화
    const selects = [
        DOM.inspCheckThickness, DOM.inspCheckFabric, DOM.inspCheckColor,
        DOM.inspCheckDistortion, DOM.inspCheckUnraveling, DOM.inspCheckFinishing,
        DOM.inspCheckZipper, DOM.inspCheckButton, DOM.inspCheckLining,
        DOM.inspCheckPilling, DOM.inspCheckDye
    ];
    selects.forEach(sel => { if(sel) sel.selectedIndex = 0; });
};

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
    if (!log) {
        showToast("해당 기록을 찾을 수 없습니다.", true);
        return;
    }

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

export const deleteInspectionLog = async () => {
    const productName = DOM.editInspProductName.value;
    const index = parseInt(DOM.editInspLogIndex.value, 10);

    if (!productName || isNaN(index)) return;

    if (!confirm("정말 이 기록을 삭제하시겠습니까?")) return;

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