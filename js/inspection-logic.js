// === js/inspection-logic.js ===
// 설명: 검수 이력 조회, 저장, 리스트 관리, 수정/삭제(상세/전체), 스캔, 엑셀, 이미지 처리 등 핵심 로직

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { updateDailyData } from './app-data.js'; 
import { showToast, getCurrentTime, getTodayDateString } from './utils.js';
import { 
    doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, increment, serverTimestamp, collection, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ✅ UI 렌더러 함수 임포트
import { renderInspectionHistoryTable, renderInspectionLogTable, renderExpandedInspectionLog } from './ui-history-inspection.js';

// 로컬 상태 변수
let todayInspectionList = [];
let html5QrCode = null;
let currentImageBase64 = null;
let currentProductLogs = []; 
let currentTodoIndex = -1;
let editingLogIndex = -1; 

// 고유 입고(검수)일자 계산 헬퍼 함수 (사전등록 제외) - 검수일(date) 기준
const getUniqueInboundCount = (logsArray) => {
    const validDates = logsArray
        .map(l => l.date) // 기존 l.inboundDate(출고일)가 아닌 검수 수행일(date)을 기준으로 산정
        .filter(d => d && !d.includes('사전등록'));
    return new Set(validDates).size;
};

const resetEditingState = () => {
    editingLogIndex = -1;
    const btn = document.getElementById('insp-save-next-btn');
    if (btn) {
        btn.innerHTML = `<span>검수 완료 및 저장</span><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0 1 18 0Z" /></svg>`;
        btn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        btn.classList.add('bg-green-600', 'hover:bg-green-700');
    }
    clearImageState();
};

export const initializeInspectionSession = async () => {
    todayInspectionList = [];
    currentTodoIndex = -1;
    currentImageBase64 = null;
    resetEditingState(); 
    
    if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = '';
    const qtyInput = document.getElementById('insp-inbound-qty');
    if (qtyInput) qtyInput.value = '';
    const notesInput = document.getElementById('insp-notes');
    if (notesInput) notesInput.value = '';
    const thickInput = document.getElementById('insp-check-thickness');
    if (thickInput) thickInput.value = '';
    
    const dateInput = document.getElementById('insp-inbound-date');
    if (dateInput) {
        dateInput.value = '';
        dateInput.readOnly = true;
        dateInput.classList.add('bg-gray-100');
        dateInput.classList.remove('bg-white');
    }

    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
    
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); 
    
    if (DOM.inspImagePreviewBox) DOM.inspImagePreviewBox.classList.add('hidden');
    if (DOM.inspImageInput) DOM.inspImageInput.value = '';

    if (DOM.inspHistoryReport) DOM.inspHistoryReport.classList.add('hidden');
    if (DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.add('hidden');
    if (DOM.inspAlertBox) DOM.inspAlertBox.classList.add('hidden');
    
    renderTodayInspectionList();

    const list = State.appState.inspectionList || [];
    if (list.length > 0) {
        const isAllCompleted = list.every(item => item.status === '완료');
        if (isAllCompleted) {
            State.appState.inspectionList = [];
            await updateDailyData({ inspectionList: [] });
            renderTodoList();
            showToast("이전 검수 리스트가 모두 완료되어 초기화되었습니다.");
        } else {
            renderTodoList();
        }
    } else {
        renderTodoList();
    }
};

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
        await updateDailyData({ inspectionList: [] });
        State.appState.inspectionList = [];
        renderTodoList();
        
        if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = '';
        const qtyInput = document.getElementById('insp-inbound-qty');
        if (qtyInput) qtyInput.value = '';
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
        
        currentTodoIndex = -1;
        resetEditingState(); 

        showToast("검수 리스트가 초기화되었습니다.");
    } catch (e) {
        console.error("Error deleting list:", e);
        showToast("리스트 삭제 중 오류가 발생했습니다.", true);
    }
};

export const deleteHistoryInspectionList = async (dateKey) => {
    if (!dateKey) return false;
    if (!confirm(`${dateKey} 출고일자 리스트를 삭제하시겠습니까?\n(이미 완료된 검수 이력 데이터는 삭제되지 않습니다)`)) {
        return false;
    }
    const todayKey = getTodayDateString();
    try {
        const dayData = State.allHistoryData.find(d => d.id === dateKey);
        if (dayData) {
            dayData.inspectionList = []; 
        }
        if (dateKey === todayKey) {
            State.appState.inspectionList = [];
            await updateDailyData({ inspectionList: [] });
        } else {
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

export const handleExcelUpload = (file) => {
    let packingDate = getTodayDateString();
    const parentMatch = file.name.match(/\((\d{6})\)/);
    const fullDateMatch = file.name.match(/20(\d{2})(\d{2})(\d{2})/);
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
            
            const getCleanKey = (name, option) => {
                const cleanName = String(name || '').replace(/\(매칭금지-제작샘플\)/g, '').replace(/\s/g, '').trim().toLowerCase();
                const cleanOption = String(option || '').replace(/촬샘-/g, '').replace(/\s/g, '').trim().toLowerCase();
                return cleanName + cleanOption;
            };

            const sampleMap = new Map();
            if (workbook.SheetNames.length > 1) {
                const sheet2Name = workbook.SheetNames[1];
                const sheet2 = workbook.Sheets[sheet2Name];
                const json2 = XLSX.utils.sheet_to_json(sheet2, { header: 1 });
                for (let i = 1; i < json2.length; i++) {
                    const row = json2[i];
                    if (row) {
                        const name = row[1]; 
                        const option = row[2];
                        const location = String(row[6] || '').trim();
                        if (name && location) {
                            const key = getCleanKey(name, option);
                            sampleMap.set(key, location);
                        }
                    }
                }
            }

            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            const processedList = [];
            const uniqueKeyMap = new Map(); 

            if (jsonData.length > 1) {
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (row && row.length > 1) { 
                        const code = String(row[0] || '').trim();
                        const name = String(row[1] || '').trim();
                        const option = String(row[2] || '').trim(); 
                        const qty = Number(row[3]) || 0;
                        const thickness = String(row[4] || '');
                        const supplierName = String(row[5] || '').trim();
                        const location = String(row[6] || '').trim();
                        
                        if (code || name) {
                            let color = option.replace(/\[|\]/g, '').split('-')[0].trim();
                            if (!color) color = 'N/A';
                            const keyColor = color.replace(/\s/g, '').toLowerCase();
                            const keySupplierName = supplierName.replace(/\s/g, '').toLowerCase();
                            const uniqueKey = `${keySupplierName}::${keyColor}`; 

                            let sampleLocation = null;
                            const matchKey = getCleanKey(name, option);
                            if (sampleMap.has(matchKey)) {
                                sampleLocation = sampleMap.get(matchKey);
                            }

                            if (!uniqueKeyMap.has(uniqueKey)) {
                                uniqueKeyMap.set(uniqueKey, true); 
                                processedList.push({
                                    code, name, option, qty, thickness, supplierName, location,
                                    sampleLocation: sampleLocation,
                                    status: '대기',
                                    inboundDate: packingDate,
                                    packingDate: packingDate
                                });
                            }
                        }
                    }
                }
            }

            if (processedList.length > 0) {
                const existingList = State.appState.inspectionList || [];
                const mergedList = [...existingList];
                let addedCount = 0;

                processedList.forEach(newItem => {
                    const isDuplicate = existingList.some(ex => ex.name === newItem.name && ex.option === newItem.option);
                    if (!isDuplicate) {
                        mergedList.push(newItem);
                        addedCount++;
                    }
                });

                await updateDailyData({ inspectionList: mergedList });
                State.appState.inspectionList = mergedList;
                
                showToast(`기존 리스트에 ${addedCount}개의 새 항목이 추가되었습니다. (총 ${mergedList.length}개)`);
                renderTodoList(); 
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

export const openInspectionListWindow = () => {
    const list = State.appState.inspectionList || [];
    if (list.length === 0) {
        showToast("리스트 데이터가 없습니다.", true);
        return;
    }

    const packingDate = list[0].packingDate || getTodayDateString();
    const existingModal = document.getElementById('dynamic-inspection-list-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'dynamic-inspection-list-modal';
    modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center z-[200] p-2';

    const rowsHtml = list.map((item, idx) => {
        const isCompleted = item.status === '완료';
        const trClass = isCompleted ? 'bg-gray-100 text-gray-400' : 'bg-white hover:bg-blue-50 cursor-pointer border-b border-gray-100';
        const statusBadge = isCompleted ? '<span class="text-green-600 font-bold text-xs">완료</span>' : '<span class="text-gray-500 text-xs">대기</span>';
        const onClickAttr = `data-index="${idx}"`;
        const locInfo = item.location ? `<div class="text-xs font-bold text-indigo-600">📦 ${item.location}</div>` : '';
        const sampleInfo = item.sampleLocation ? `<div class="text-xs font-bold text-red-600 mt-0.5">📌 샘플: ${item.sampleLocation}</div>` : '';

        return `
            <tr class="${trClass} transition" ${onClickAttr}>
                <td class="px-2 py-3 align-top w-16 text-center">${locInfo}${sampleInfo}</td>
                <td class="px-2 py-3 align-top">
                    <div class="text-base font-medium text-gray-800 leading-tight">${item.name}</div>
                    <div class="text-sm text-gray-500 mt-1">${item.option || '-'}</div>
                    <div class="text-xs text-gray-400 mt-0.5 font-mono">${item.code || ''}</div>
                </td>
                <td class="px-2 py-3 align-top text-center w-12"><div class="text-base font-bold text-gray-700">${item.qty}</div></td>
                <td class="px-2 py-3 align-top text-center w-12">${statusBadge}</td>
            </tr>
        `;
    }).join('');

    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden animate-fade-in-up">
            <div class="p-4 bg-indigo-600 text-white flex justify-between items-center shadow-md shrink-0">
                <div>
                    <h2 class="text-lg font-bold flex items-center gap-2">
                        📋 검수 대기 리스트
                        <span class="bg-white text-indigo-600 text-xs px-2 py-0.5 rounded-full font-extrabold">${list.length}</span>
                    </h2>
                    <p class="text-xs text-indigo-200 mt-1">📅 출고일자: <span class="font-bold text-white">${packingDate}</span></p>
                </div>
                <button id="close-dynamic-modal-btn" class="text-white hover:text-gray-200 bg-white/20 hover:bg-white/30 rounded-full p-2 transition">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div class="flex-grow overflow-y-auto overflow-x-auto bg-gray-50 p-2">
                <table class="w-full text-left border-collapse min-w-[350px]">
                    <thead class="bg-gray-200 text-gray-600 text-xs uppercase sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th class="px-2 py-2 text-center w-16">위치</th>
                            <th class="px-2 py-2">상품 정보</th>
                            <th class="px-2 py-2 text-center w-12">수량</th>
                            <th class="px-2 py-2 text-center w-12">상태</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200 bg-white">${rowsHtml}</tbody>
                </table>
            </div>
            <div class="p-3 bg-gray-100 text-center border-t border-gray-200 text-xs text-gray-500 shrink-0">
                항목을 클릭하면 입력창에 자동 선택됩니다.
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('close-dynamic-modal-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('tbody').addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-index]');
        if (tr) {
            const index = parseInt(tr.dataset.index, 10);
            selectTodoItem(index);
            modal.remove();
        }
    });
};

export const renderTodoList = () => {
    const list = State.appState.inspectionList || [];
    const todoArea = document.getElementById('insp-todo-list-area');
    const todoBody = document.getElementById('insp-todo-list-body');
    if (!todoArea || !todoBody) return;
    
    if (list.length > 0) {
        todoArea.classList.remove('hidden');
    } else {
        todoArea.classList.add('hidden');
        return;
    }

    todoBody.innerHTML = '';
    list.forEach((item, idx) => {
        const tr = document.createElement('tr');
        const isCompleted = item.status === '완료';
        tr.className = `transition border-b last:border-0 cursor-pointer ${isCompleted ? 'bg-gray-50 hover:bg-gray-100' : 'hover:bg-blue-50'}`;
        
        const statusColor = isCompleted ? 'text-green-600 font-bold' : 'text-gray-400';
        const locationInfo = item.location ? `<span class="text-indigo-600 font-bold bg-indigo-50 px-1 rounded">📦 ${item.location}</span>` : '';
        const sampleInfo = item.sampleLocation ? `<span class="text-red-600 font-bold bg-red-50 px-1 rounded ml-1">📌 샘플: ${item.sampleLocation}</span>` : '';
        const dateInfo = item.packingDate ? `<span class="text-gray-500 ml-1">📅 출고: ${item.packingDate.slice(2)}</span>` : '';
        
        tr.innerHTML = `
            <td class="px-3 py-2 font-mono text-gray-600 text-xs align-top">${item.code}</td>
            <td class="px-3 py-2 font-medium text-gray-800 align-top">
                <div class="truncate max-w-[150px]" title="${item.name}">${item.name}</div>
                <div class="text-[10px] mt-0.5 flex flex-wrap gap-1">
                    ${locationInfo}${sampleInfo}${dateInfo}
                </div>
            </td>
            <td class="px-3 py-2 text-gray-500 text-xs align-top">${item.option}</td>
            <td class="px-3 py-2 text-right text-xs ${statusColor} align-top">${item.status}</td>
        `;
        
        tr.addEventListener('click', () => { selectTodoItem(idx); });
        todoBody.appendChild(tr);
    });
};

export const selectTodoItem = async (index) => {
    const item = State.appState.inspectionList[index];
    if (!item) return;

    currentTodoIndex = index; 

    if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = item.name; 
    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${item.option || '-'}`;
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${item.code || '-'}`;
    
    let supplierText = `공급처: ${item.supplierName || '-'}`;
    if (item.location) supplierText += ` / 📦 Loc: ${item.location}`;
    if (item.sampleLocation) supplierText += ` / 📌 샘플: ${item.sampleLocation}`; 
    if (item.packingDate) supplierText += ` / 📅 출고: ${item.packingDate}`;
    
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = supplierText; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${item.thickness || '-'}`;

    await searchProductHistory(); 

    if (item.status === '완료') {
        await loadCompletedInspectionData(item);
    } else {
        resetEditingState();
        const dateInput = document.getElementById('insp-inbound-date');
        if (dateInput) dateInput.value = item.inboundDate || getTodayDateString();
        const qtyInput = document.getElementById('insp-inbound-qty');
        if (qtyInput) qtyInput.value = item.qty > 0 ? item.qty : '';
        const notesInput = document.getElementById('insp-notes');
        if (notesInput) notesInput.value = '';
    }
    showToast(`'${item.name}' 선택됨`);
};

window.selectInspectionTodoItem = selectTodoItem;

const loadCompletedInspectionData = async (item) => {
    try {
        const docRef = doc(State.db, 'product_history', item.name);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const logs = data.logs || [];
            
            const targetLogIndex = logs.map((log, idx) => ({ ...log, originalIndex: idx }))
                                     .reverse()
                                     .findIndex(log => log.inboundDate === item.inboundDate);

            if (targetLogIndex !== -1) {
                const realIndex = logs.length - 1 - targetLogIndex;
                const log = logs[realIndex];

                const qtyInput = document.getElementById('insp-inbound-qty');
                if (qtyInput) qtyInput.value = log.inboundQty || 0;
                const notesInput = document.getElementById('insp-notes');
                if (notesInput) notesInput.value = log.note || '';
                const dateInput = document.getElementById('insp-inbound-date');
                if (dateInput) dateInput.value = log.inboundDate || '';

                const cl = log.checklist || {};
                const setSelect = (id, val) => { 
                    const el = document.getElementById(id);
                    if (el) el.value = val || (el.options && el.options.length > 0 ? el.options[0].value : ''); 
                };

                const thickEl = document.getElementById('insp-check-thickness');
                if (thickEl) thickEl.value = cl.thickness || '';

                setSelect('insp-check-fabric', cl.fabric);
                setSelect('insp-check-color', cl.color);
                setSelect('insp-check-distortion', cl.distortion);
                setSelect('insp-check-unraveling', cl.unraveling);
                setSelect('insp-check-finishing', cl.finishing);
                setSelect('insp-check-zipper', cl.zipper);
                setSelect('insp-check-button', cl.button);
                setSelect('insp-check-lining', cl.lining);
                setSelect('insp-check-pilling', cl.pilling);
                setSelect('insp-check-dye', cl.dye);

                if (log.image) {
                    currentImageBase64 = log.image;
                    if (DOM.inspImagePreviewBox) {
                        DOM.inspImagePreviewBox.classList.remove('hidden');
                        if (DOM.inspImagePreviewImg) DOM.inspImagePreviewImg.src = log.image;
                    }
                } else {
                    clearImageState();
                }

                editingLogIndex = realIndex;
                const btn = document.getElementById('insp-save-next-btn');
                if (btn) {
                    btn.innerHTML = `<span>수정 저장</span><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>`;
                    btn.classList.remove('bg-green-600', 'hover:bg-green-700');
                    btn.classList.add('bg-blue-600', 'hover:bg-blue-700');
                }
                showToast("이전 검수 기록을 불러왔습니다. 수정 가능합니다.");
                return;
            }
        }
        showToast("이전 상세 기록을 찾을 수 없습니다. (새로 입력하세요)", true);
        resetEditingState();
    } catch (e) {
        console.error("Error loading completed item details:", e);
        resetEditingState();
    }
};

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
        showToast("카메라를 시작할 수 없습니다.", true);
        if(DOM.inspScannerContainer) DOM.inspScannerContainer.classList.add('hidden');
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
    showToast(`바코드 인식: ${decodedText}`);
    stopScanner(); 
    if(DOM.inspScannerContainer) DOM.inspScannerContainer.classList.add('hidden');
    if(DOM.inspProductNameInput) DOM.inspProductNameInput.value = decodedText;
    searchProductHistory();
};

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
                if (DOM.inspImagePreviewImg) DOM.inspImagePreviewImg.src = currentImageBase64;
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

export const searchProductHistory = async () => {
    let searchTerm = DOM.inspProductNameInput ? DOM.inspProductNameInput.value.trim() : document.getElementById('insp-product-name').value.trim();
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

        if(DOM.inspProductNameInput) DOM.inspProductNameInput.value = targetProductName;
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${matchedItem.option || '-'}`;
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${matchedItem.code || '-'}`;
        
        let supplierText = `공급처: ${matchedItem.supplierName || '-'}`;
        if (matchedItem.location) supplierText += ` / 📦 Loc: ${matchedItem.location}`;
        if (matchedItem.sampleLocation) supplierText += ` / 📌 샘플: ${matchedItem.sampleLocation}`;
        if (matchedItem.packingDate) supplierText += ` / 📅 출고: ${matchedItem.packingDate}`;
        
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = supplierText; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${matchedItem.thickness || '-'}`;
        
        const dateInput = document.getElementById('insp-inbound-date');
        if (dateInput) {
            dateInput.value = matchedItem.inboundDate || getTodayDateString();
            dateInput.readOnly = true;
            dateInput.classList.add('bg-gray-100');
            dateInput.classList.remove('bg-white');
        }
        
        const qtyInput = document.getElementById('insp-inbound-qty');
        if (matchedItem.status !== '완료' && qtyInput) {
             qtyInput.value = matchedItem.qty > 0 ? matchedItem.qty : '';
        }
    } else {
        currentTodoIndex = -1; 
        resetEditingState(); 
        
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';

        const dateInput = document.getElementById('insp-inbound-date');
        if (dateInput) {
            dateInput.readOnly = false;
            dateInput.classList.remove('bg-gray-100');
            dateInput.classList.add('bg-white');
            if (!dateInput.value) {
                dateInput.value = getTodayDateString();
            }
        }
        const qtyInput = document.getElementById('insp-inbound-qty');
        if (qtyInput) qtyInput.value = '';
    }

    if(DOM.inspHistoryReport) DOM.inspHistoryReport.classList.remove('hidden');
    if(DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.remove('hidden');
    if(DOM.inspAlertBox) DOM.inspAlertBox.classList.add('hidden');
    if(DOM.inspReportTitle) DOM.inspReportTitle.textContent = targetProductName;
    
    if (editingLogIndex === -1) {
        const selects = document.querySelectorAll('#insp-current-input-area select');
        selects.forEach(sel => sel.value = ""); 
    }

    try {
        const docRef = doc(State.db, 'product_history', targetProductName);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            if(DOM.inspReportCount) DOM.inspReportCount.textContent = data.totalInbound || 0;
            if(DOM.inspReportDate) DOM.inspReportDate.textContent = data.lastInspectionDate || '-';

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
                if(DOM.inspAlertBox) DOM.inspAlertBox.classList.remove('hidden');
                const recentIssues = specialIssues.slice(-5).reverse();
                if(DOM.inspAlertMsg) DOM.inspAlertMsg.textContent = `최근 특이사항: ${recentIssues[0]}`;
                
                if (editingLogIndex === -1) {
                    setTimeout(() => {
                        alert(`🚨 [특이사항 알림] 🚨\n\n이 상품은 ${specialIssues.length}건의 특이사항(불량/메모) 기록이 있습니다.\n검수 시 아래 내용을 확인해주세요.\n\n[최근 기록]\n- ${recentIssues.join('\n- ')}`);
                    }, 200);
                }
            }
        } else {
            if(DOM.inspReportCount) DOM.inspReportCount.textContent = '0 (신규)';
            if (editingLogIndex === -1) showToast('신규 상품입니다.');
        }
    } catch (e) {
        console.error("Error searching product history:", e);
        showToast("이력 조회 중 오류가 발생했습니다.", true);
    }
};

export const saveInspectionAndNext = async () => {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    };

    let productName = DOM.inspProductNameInput ? DOM.inspProductNameInput.value.trim() : getVal('insp-product-name').trim();
    if (!productName) {
        showToast('상품 조회를 먼저 진행해주세요.', true);
        return;
    }
    productName = productName.replace(/\//g, '-'); 

    const checklist = {
        thickness: getVal('insp-check-thickness'),
        fabric: getVal('insp-check-fabric'),
        color: getVal('insp-check-color'),
        distortion: getVal('insp-check-distortion'),
        unraveling: getVal('insp-check-unraveling'),
        finishing: getVal('insp-check-finishing'),
        zipper: getVal('insp-check-zipper'),
        button: getVal('insp-check-button'),
        lining: getVal('insp-check-lining'),
        pilling: getVal('insp-check-pilling'),
        dye: getVal('insp-check-dye')
    };

    if (checklist.thickness === '' || Object.values(checklist).some(v => v === "" || v === null)) {
        alert("⚠️ 모든 품질 체크리스트 항목을 확인하고 선택해주세요.");
        return;
    }

    const inboundDate = getVal('insp-inbound-date') || getTodayDateString();
    const inboundQty = getVal('insp-inbound-qty');
    const note = getVal('insp-notes');

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
    if(btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

    try {
        const docRef = doc(State.db, 'product_history', productName);
        const docSnap = await getDoc(docRef);
        let existingLogs = [];
        if (docSnap.exists()) {
            existingLogs = docSnap.data().logs || [];
        }
        
        if (editingLogIndex !== -1) {
            if (docSnap.exists() && editingLogIndex >= 0 && editingLogIndex < existingLogs.length) {
                existingLogs[editingLogIndex] = {
                    ...existingLogs[editingLogIndex],
                    ...inspectionRecord
                };
                
                const newDefectSummary = existingLogs
                    .filter(l => l.defects && l.defects.length > 0)
                    .map(l => `${l.date}: ${l.defects.join(', ')}`);

                await updateDoc(docRef, { 
                    logs: existingLogs,
                    defectSummary: newDefectSummary,
                    totalInbound: getUniqueInboundCount(existingLogs), // 수정된 로직 반영
                    updatedAt: serverTimestamp()
                });
                
                showToast(`'${productName}' 검수 기록이 수정되었습니다.`);
            }
        } else {
            const tempLogs = [...existingLogs, inspectionRecord];
            
            const updates = {
                lastInspectionDate: today,
                totalInbound: getUniqueInboundCount(tempLogs), // 수정된 로직 반영 (검수일 기준)
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
            
            todayInspectionList.unshift({
                productName,
                inboundDate,
                status,
                defects: defectsFound,
                note,
                time: nowTime
            });
            showToast(`'${productName}' 저장 완료!`);
        }

        let pastListUpdated = false;
        for (let i = 0; i < State.allHistoryData.length; i++) {
            const dayData = State.allHistoryData[i];
            if (dayData.inspectionList && dayData.inspectionList.length > 0) {
                let dayUpdated = false;
                dayData.inspectionList.forEach(pastItem => {
                    if ((pastItem.name === productName || pastItem.code === productName) && pastItem.status !== '완료') {
                        pastItem.status = '완료';
                        dayUpdated = true;
                    }
                });
                if (dayUpdated) {
                    const pastDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dayData.id);
                    updateDoc(pastDocRef, { inspectionList: dayData.inspectionList }).catch(e => console.error("과거 리스트 갱신 실패", e));
                    pastListUpdated = true;
                }
            }
        }

        const list = [...State.appState.inspectionList];
        let isTodayListUpdated = false;
        if (currentTodoIndex >= 0 && list[currentTodoIndex]) {
            list[currentTodoIndex].status = '완료';
            isTodayListUpdated = true;
            await updateDailyData({ inspectionList: list });
        }

        renderTodayInspectionList();
        
        resetInspectionForm(true);
        resetEditingState();
        
        if (editingLogIndex === -1 && currentTodoIndex >= 0 && currentTodoIndex < list.length - 1) {
            selectTodoItem(currentTodoIndex + 1);
        } else {
            if (editingLogIndex === -1) {
                showToast("리스트의 마지막 상품입니다.");
                if(DOM.inspHistoryReport) DOM.inspHistoryReport.classList.add('hidden');
                if(DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.add('hidden');
                currentTodoIndex = -1;
            }
        }
    } catch (e) {
        console.error("Error saving inspection:", e);
        showToast("저장 중 오류가 발생했습니다.", true);
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = `<span>검수 완료 및 저장</span>`; }
    }
};

const resetInspectionForm = (clearProductName = false) => {
    const pNameInput = document.getElementById('insp-product-name');
    if (clearProductName && pNameInput) pNameInput.value = '';
    
    const qtyInput = document.getElementById('insp-inbound-qty');
    if (qtyInput) qtyInput.value = '';
    
    const notesInput = document.getElementById('insp-notes');
    if (notesInput) notesInput.value = '';
    
    const thickInput = document.getElementById('insp-check-thickness');
    if (thickInput) thickInput.value = '';

    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -'; 
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';
    
    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = ""); 
};

export const renderTodayInspectionList = () => {
    const tbody = document.getElementById('insp-today-list-body');
    const countEl = document.getElementById('insp-today-count');
    if (!tbody) return;
    if (countEl) countEl.textContent = todayInspectionList.length;
    tbody.innerHTML = '';

    if (todayInspectionList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400 text-xs">아직 검수된 상품이 없습니다.</td></tr>';
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
        tbody.appendChild(tr);
    });
};

export const clearTodayList = () => {
    todayInspectionList = [];
    renderTodayInspectionList();
};

export const loadAllInspectionHistory = async () => {
    const container = document.getElementById('inspection-history-view-container');
    if (!container) return;
    
    container.innerHTML = '<div class="text-center text-gray-500 py-10 flex flex-col items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>검수 이력을 불러오는 중입니다...</div>';

    try {
        const colRef = collection(State.db, 'product_history');
        const snapshot = await getDocs(colRef);
        
        const historyData = [];
        snapshot.forEach(doc => {
            historyData.push({ id: doc.id, ...doc.data() });
        });

        renderInspectionHistoryTable(historyData);
    } catch (e) {
        console.error("Error loading all inspection history:", e);
        container.innerHTML = '<div class="text-center text-red-500 py-10">데이터를 불러오는 중 오류가 발생했습니다.</div>';
        showToast("검수 이력 로딩 실패", true);
    }
};

export const loadInspectionLogs = async (productName, targetTr = null) => {
    if (!productName) return;
    
    const managerModal = document.getElementById('inspection-log-manager-modal');
    if (!targetTr && managerModal) {
         managerModal.classList.remove('hidden');
         const title = document.getElementById('inspection-log-product-name');
         if (title) title.textContent = productName;
         const tbody = document.getElementById('inspection-log-table-body');
         if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-500">로딩 중...</td></tr>';
    }

    try {
        const safeProductName = productName.replace(/\//g, '-');
        const docRef = doc(State.db, 'product_history', safeProductName);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            currentProductLogs = data.logs || [];
        } else {
            currentProductLogs = [];
        }

        if (targetTr) {
            renderExpandedInspectionLog(targetTr, currentProductLogs, productName);
        } else {
            renderInspectionLogTable(currentProductLogs, productName);
        }

    } catch (e) {
        console.error("Error loading inspection logs:", e);
        showToast("상세 이력을 불러오는 중 오류가 발생했습니다.", true);
    }
};

export const prepareEditInspectionLog = (productName, index) => {
    const log = currentProductLogs[index];
    if (!log) return;

    const getEl = (id) => document.getElementById(id);
    
    if (getEl('edit-insp-product-name')) getEl('edit-insp-product-name').value = productName;
    if (getEl('edit-insp-date-time')) getEl('edit-insp-date-time').value = `${log.date} ${log.time}`;
    if (getEl('edit-insp-packing-no')) getEl('edit-insp-packing-no').value = log.inboundDate || log.packingNo || '';
    if (getEl('edit-insp-inbound-qty')) getEl('edit-insp-inbound-qty').value = log.inboundQty || 0;
    if (getEl('edit-insp-notes')) getEl('edit-insp-notes').value = log.note || '';
    if (getEl('edit-insp-log-index')) getEl('edit-insp-log-index').value = index;
    if (getEl('edit-insp-supplier-name')) getEl('edit-insp-supplier-name').value = log.supplierName || '';

    const checklist = log.checklist || {};
    const setEditSelect = (id, val) => { 
        const el = getEl(id);
        if (el) el.value = val || (el.options && el.options.length > 0 ? el.options[0].value : ''); 
    };
    
    if (getEl('edit-insp-check-thickness')) getEl('edit-insp-check-thickness').value = checklist.thickness || ''; 
    setEditSelect('edit-insp-check-fabric', checklist.fabric);
    setEditSelect('edit-insp-check-color', checklist.color);
    setEditSelect('edit-insp-check-distortion', checklist.distortion);
    setEditSelect('edit-insp-check-unraveling', checklist.unraveling);
    setEditSelect('edit-insp-check-finishing', checklist.finishing);
    setEditSelect('edit-insp-check-zipper', checklist.zipper);
    setEditSelect('edit-insp-check-button', checklist.button);
    setEditSelect('edit-insp-check-lining', checklist.lining);
    setEditSelect('edit-insp-check-pilling', checklist.pilling);
    setEditSelect('edit-insp-check-dye', checklist.dye);

    const editModal = document.getElementById('inspection-log-editor-modal');
    if (editModal) editModal.classList.remove('hidden');
};

export const updateInspectionLog = async () => {
    const getEditVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    };

    const productName = getEditVal('edit-insp-product-name');
    const index = parseInt(getEditVal('edit-insp-log-index'), 10);
    
    if (!productName || isNaN(index) || !currentProductLogs[index]) return;

    const checklist = {
        thickness: getEditVal('edit-insp-check-thickness'),
        fabric: getEditVal('edit-insp-check-fabric'),
        color: getEditVal('edit-insp-check-color'),
        distortion: getEditVal('edit-insp-check-distortion'),
        unraveling: getEditVal('edit-insp-check-unraveling'),
        finishing: getEditVal('edit-insp-check-finishing'),
        zipper: getEditVal('edit-insp-check-zipper'),
        button: getEditVal('edit-insp-check-button'),
        lining: getEditVal('edit-insp-check-lining'),
        pilling: getEditVal('edit-insp-check-pilling'),
        dye: getEditVal('edit-insp-check-dye')
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
        inboundDate: getEditVal('edit-insp-packing-no'), 
        inboundQty: Number(getEditVal('edit-insp-inbound-qty')) || 0,
        supplierName: getEditVal('edit-insp-supplier-name'), 
        checklist: checklist,
        defects: defectsFound,
        note: getEditVal('edit-insp-notes'),
        status: defectsFound.length > 0 ? '불량' : '정상'
    };

    currentProductLogs[index] = updatedLog;

    try {
        const safeProductName = productName.replace(/\//g, '-');
        const docRef = doc(State.db, 'product_history', safeProductName);
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);

        const updates = {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
            totalInbound: getUniqueInboundCount(currentProductLogs) // 수정된 로직 반영
        };
        
        if (index === currentProductLogs.length - 1) {
            updates.lastSupplierName = updatedLog.supplierName;
            updates.lastCode = updatedLog.code;
            updates.lastOption = updatedLog.option;
        }
        
        await updateDoc(docRef, updates);

        showToast("기록이 수정되었습니다.");
        const editModal = document.getElementById('inspection-log-editor-modal');
        if (editModal) editModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);

    } catch (e) {
        console.error("Error updating log:", e);
        showToast("수정 중 오류가 발생했습니다.", true);
    }
};

export const deleteInspectionLog = async () => {
    const pNameEl = document.getElementById('edit-insp-product-name');
    const idxEl = document.getElementById('edit-insp-log-index');
    const productName = pNameEl ? pNameEl.value : '';
    const index = idxEl ? parseInt(idxEl.value, 10) : NaN;

    if (!productName || isNaN(index)) return;
    if (!confirm("정말 이 상세 기록을 삭제하시겠습니까?")) return;

    currentProductLogs.splice(index, 1);

    try {
        const safeProductName = productName.replace(/\//g, '-');
        const docRef = doc(State.db, 'product_history', safeProductName);
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);
        
        const updates = {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
            totalInbound: getUniqueInboundCount(currentProductLogs) // 고유 입고일 재계산 반영
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
            updates.totalInbound = 0; 
        }

        await updateDoc(docRef, updates);

        showToast("기록이 삭제되었습니다.");
        const editModal = document.getElementById('inspection-log-editor-modal');
        if (editModal) editModal.classList.add('hidden');
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
        const safeProductName = productName.replace(/\//g, '-');
        const docRef = doc(State.db, 'product_history', safeProductName);
        await deleteDoc(docRef);
        showToast(`'${productName}' 상품 및 이력이 모두 삭제되었습니다.`);
        return true; 
    } catch (e) {
        console.error("Error deleting product:", e);
        showToast("상품 삭제 중 오류가 발생했습니다.", true);
        return false;
    }
};

export const savePreInspectionNote = async () => {
    const productNameInput = document.getElementById('pre-insp-product-name');
    const noteInput = document.getElementById('pre-insp-note');
    let productName = productNameInput ? productNameInput.value.trim() : '';
    const note = noteInput ? noteInput.value.trim() : '';

    if (!productName || !note) {
        showToast("상품명과 특이사항을 모두 입력해주세요.", true);
        return false;
    }

    productName = productName.replace(/\//g, '-'); 
    const today = getTodayDateString();
    const nowTime = getCurrentTime();
    const inspector = State.appState.currentUser || 'Unknown';

    const preRecord = {
        date: today,
        time: nowTime,
        inspector: inspector,
        inboundDate: '출고예정(사전등록)',
        inboundQty: 0,
        status: '사전메모',
        note: `[사전등록] ${note}`,
        defects: [],
        checklist: {}
    };

    const docRef = doc(State.db, 'product_history', productName);

    try {
        const docSnap = await getDoc(docRef);
        const defectStr = `${today}: [사전등록] ${note}`;

        if (docSnap.exists()) {
            await updateDoc(docRef, {
                logs: arrayUnion(preRecord),
                defectSummary: arrayUnion(defectStr),
                updatedAt: serverTimestamp()
            });
        } else {
            await setDoc(docRef, {
                id: productName,
                totalInbound: 0,
                lastInspectionDate: '-',
                logs: [preRecord],
                defectSummary: [defectStr],
                updatedAt: serverTimestamp()
            });
        }

        showToast(`'${productName}' 사전 특이사항 등록 완료`);
        const preModal = document.getElementById('pre-register-inspection-modal');
        if (preModal) preModal.classList.add('hidden');
        
        if (productNameInput) productNameInput.value = '';
        if (noteInput) noteInput.value = '';

        return true;
    } catch (e) {
        console.error("Error saving pre-note:", e);
        showToast("저장 중 오류가 발생했습니다.", true);
        return false;
    }
};