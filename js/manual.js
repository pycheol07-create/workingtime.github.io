// === js/manual.js ===
import { initializeFirebase, loadAppConfig } from './config.js';
import { getTodayDateString, showToast } from './utils.js';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const { app, db } = initializeFirebase();
const storage = getStorage(app);

let appConfig = {};
let manuals = [];
let currentGroupFilter = '전체';
let editingId = null;
let currentUploadedFileData = null; 

const DOM = {
    groupList: document.getElementById('manual-group-list'),
    manualGrid: document.getElementById('manual-grid'),
    emptyState: document.getElementById('empty-state'),
    searchInput: document.getElementById('manual-search-input'),
    currentGroupTitle: document.getElementById('current-group-title'),
    
    viewContainer: document.getElementById('view-mode-container'),
    editContainer: document.getElementById('edit-mode-container'),
    
    btnShowAdd: document.getElementById('btn-show-add'),
    btnShowAddMobile: document.getElementById('btn-show-add-mobile'),
    btnCancelEdit: document.getElementById('btn-cancel-edit'),
    btnSave: document.getElementById('btn-save-manual'),
    
    inputTitle: document.getElementById('manual-title'),
    selectGroup: document.getElementById('manual-group'),
    selectTask: document.getElementById('manual-task'),
    radioTypes: document.getElementsByName('manual-type'),
    typeTextContainer: document.getElementById('type-text-container'),
    typeFileContainer: document.getElementById('type-file-container'),
    inputContent: document.getElementById('manual-content'),
    fileInput: document.getElementById('manual-file-input'),
    fileNameDisplay: document.getElementById('file-name-display'),

    detailModal: document.getElementById('manual-detail-modal'),
    detailTitle: document.getElementById('detail-title'),
    detailGroup: document.getElementById('detail-group'),
    detailTask: document.getElementById('detail-task'),
    detailContentArea: document.getElementById('detail-content-area'),
    btnCloseDetail: document.getElementById('btn-close-detail'),
    btnEdit: document.getElementById('btn-edit-manual'),
    btnDelete: document.getElementById('btn-delete-manual')
};

async function init() {
    appConfig = await loadAppConfig(db);
    renderSidebarGroups();
    renderFormSelects();
    setupListeners();
    fetchManuals();
}

function fetchManuals() {
    const colRef = collection(db, 'artifacts', 'team-work-logger-v2', 'manuals');
    onSnapshot(colRef, (snapshot) => {
        manuals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        manuals.sort((a, b) => b.updatedAt - a.updatedAt);
        renderManuals();
    });
}

function renderSidebarGroups() {
    DOM.groupList.innerHTML = `<button class="group-filter-btn w-full text-left px-4 py-2 rounded-lg text-sm transition-colors active bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-bold" data-group="전체">전체 보기</button>`;
    
    const groups = ['공통파트', '담당파트', '관리', '제작파트', '기타'];
    groups.forEach(g => {
        DOM.groupList.innerHTML += `<button class="group-filter-btn w-full text-left px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" data-group="${g}">${g}</button>`;
    });

    document.querySelectorAll('.group-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.group-filter-btn').forEach(b => {
                b.classList.remove('bg-blue-50', 'text-blue-700', 'font-bold', 'dark:bg-blue-900/30', 'dark:text-blue-400');
                b.classList.add('text-gray-600', 'dark:text-gray-400');
            });
            const target = e.target;
            target.classList.remove('text-gray-600', 'dark:text-gray-400');
            target.classList.add('bg-blue-50', 'text-blue-700', 'font-bold', 'dark:bg-blue-900/30', 'dark:text-blue-400');
            
            currentGroupFilter = target.dataset.group;
            DOM.currentGroupTitle.textContent = currentGroupFilter === '전체' ? '전체 매뉴얼' : `${currentGroupFilter} 매뉴얼`;
            renderManuals();
        });
    });
}

function renderFormSelects() {
    DOM.selectGroup.innerHTML = '<option value="">소속 파트를 선택하세요</option>';
    const groups = ['공통파트', '담당파트', '관리', '제작파트', '기타'];
    groups.forEach(g => DOM.selectGroup.innerHTML += `<option value="${g}">${g}</option>`);

    DOM.selectTask.innerHTML = '<option value="">관련 업무 선택 (선택사항)</option>';
    const allTasks = [...new Set((appConfig.taskGroups || []).flatMap(g => g.tasks))].sort();
    allTasks.forEach(t => DOM.selectTask.innerHTML += `<option value="${t}">${t}</option>`);
}

function renderManuals() {
    const searchTerm = DOM.searchInput.value.toLowerCase();
    
    const filtered = manuals.filter(m => {
        const matchGroup = currentGroupFilter === '전체' || m.group === currentGroupFilter;
        const matchSearch = m.title.toLowerCase().includes(searchTerm) || (m.task && m.task.toLowerCase().includes(searchTerm));
        return matchGroup && matchSearch;
    });

    DOM.manualGrid.innerHTML = '';

    if (filtered.length === 0) {
        DOM.emptyState.classList.remove('hidden');
    } else {
        DOM.emptyState.classList.add('hidden');
        filtered.forEach(m => {
            const dateStr = new Date(m.updatedAt).toLocaleDateString('ko-KR');
            const typeIcon = m.type === 'file' ? (m.fileType?.includes('pdf') ? '📕' : (m.fileType?.includes('sheet') || m.fileType?.includes('excel') ? '📗' : '🖼️')) : '📝';
            
            const card = document.createElement('div');
            card.className = "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 hover:shadow-lg transition-all cursor-pointer flex flex-col group h-40";
            card.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <span class="text-xs font-bold px-2 py-1 rounded bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">${m.group}</span>
                    <span class="text-2xl opacity-70 group-hover:scale-110 transition-transform">${typeIcon}</span>
                </div>
                <h3 class="text-md font-bold text-gray-900 dark:text-white line-clamp-2 mb-1">${m.title}</h3>
                ${m.task ? `<p class="text-xs text-gray-500 dark:text-gray-400 mt-auto truncate flex items-center gap-1"><span>🔗</span> ${m.task}</p>` : '<div class="mt-auto"></div>'}
                <div class="text-[10px] text-gray-400 dark:text-gray-500 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">마지막 수정: ${dateStr}</div>
            `;
            card.onclick = () => openDetail(m);
            DOM.manualGrid.appendChild(card);
        });
    }
}

function showEditMode(manual = null) {
    DOM.viewContainer.classList.add('hidden');
    DOM.editContainer.classList.remove('hidden');
    currentUploadedFileData = null;
    DOM.fileInput.value = '';
    DOM.fileNameDisplay.classList.add('hidden');

    if (manual) {
        editingId = manual.id;
        document.getElementById('edit-mode-title').textContent = '매뉴얼 수정';
        DOM.inputTitle.value = manual.title;
        DOM.selectGroup.value = manual.group;
        DOM.selectTask.value = manual.task || '';
        
        if (manual.type === 'file') {
            DOM.radioTypes[1].checked = true;
            DOM.typeTextContainer.classList.add('hidden');
            DOM.typeFileContainer.classList.remove('hidden');
            if (manual.fileName) {
                DOM.fileNameDisplay.textContent = `현재 첨부됨: ${manual.fileName}`;
                DOM.fileNameDisplay.classList.remove('hidden');
                currentUploadedFileData = { url: manual.fileUrl, name: manual.fileName, type: manual.fileType };
            }
        } else {
            DOM.radioTypes[0].checked = true;
            DOM.typeTextContainer.classList.remove('hidden');
            DOM.typeFileContainer.classList.add('hidden');
            DOM.inputContent.value = manual.content || '';
        }
    } else {
        editingId = null;
        document.getElementById('edit-mode-title').textContent = '새 매뉴얼 등록';
        DOM.inputTitle.value = '';
        DOM.selectGroup.value = '';
        DOM.selectTask.value = '';
        DOM.inputContent.value = '';
        DOM.radioTypes[0].checked = true;
        DOM.typeTextContainer.classList.remove('hidden');
        DOM.typeFileContainer.classList.add('hidden');
    }
}

function hideEditMode() {
    DOM.viewContainer.classList.remove('hidden');
    DOM.editContainer.classList.add('hidden');
}

async function uploadFile(file) {
    return new Promise((resolve, reject) => {
        const fileRef = ref(storage, `manuals/${Date.now()}_${file.name}`);
        const uploadTask = uploadBytesResumable(fileRef, file);

        showToast('파일 업로드 중...', false);

        uploadTask.on('state_changed', 
            null, 
            (error) => {
                console.error("업로드 실패:", error);
                showToast('파일 업로드에 실패했습니다.', true);
                reject(error);
            }, 
            async () => {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                resolve({ url: downloadURL, name: file.name, type: file.type });
            }
        );
    });
}

async function saveManual() {
    const title = DOM.inputTitle.value.trim();
    const group = DOM.selectGroup.value;
    const task = DOM.selectTask.value;
    const type = document.querySelector('input[name="manual-type"]:checked').value;
    const content = DOM.inputContent.value.trim();
    const file = DOM.fileInput.files[0];

    if (!title || !group) return showToast('제목과 파트를 모두 입력해주세요.', true);
    if (type === 'text' && !content) return showToast('내용을 입력해주세요.', true);
    if (type === 'file' && !file && !currentUploadedFileData) return showToast('파일을 첨부해주세요.', true);

    DOM.btnSave.disabled = true;
    DOM.btnSave.textContent = '저장 중...';

    try {
        let fileData = currentUploadedFileData;
        
        if (type === 'file' && file) {
            fileData = await uploadFile(file);
        }

        const data = {
            title, group, task, type,
            content: type === 'text' ? content : '',
            fileUrl: type === 'file' && fileData ? fileData.url : '',
            fileName: type === 'file' && fileData ? fileData.name : '',
            fileType: type === 'file' && fileData ? fileData.type : '',
            updatedAt: Date.now()
        };

        if (editingId) {
            await updateDoc(doc(db, 'artifacts', 'team-work-logger-v2', 'manuals', editingId), data);
            showToast('매뉴얼이 수정되었습니다.');
        } else {
            await addDoc(collection(db, 'artifacts', 'team-work-logger-v2', 'manuals'), data);
            showToast('새 매뉴얼이 등록되었습니다.');
        }
        
        hideEditMode();
        DOM.detailModal.classList.add('hidden');
    } catch (e) {
        console.error(e);
        showToast('저장 중 오류가 발생했습니다.', true);
    } finally {
        DOM.btnSave.disabled = false;
        DOM.btnSave.textContent = '저장하기';
    }
}

function openDetail(manual) {
    DOM.detailTitle.textContent = manual.title;
    DOM.detailGroup.textContent = manual.group;
    if (manual.task) {
        DOM.detailTask.textContent = manual.task;
        DOM.detailTask.classList.remove('hidden');
    } else {
        DOM.detailTask.classList.add('hidden');
    }

    DOM.btnEdit.onclick = () => showEditMode(manual);
    DOM.btnDelete.onclick = async () => {
        if(confirm('이 매뉴얼을 정말 삭제하시겠습니까?')) {
            await deleteDoc(doc(db, 'artifacts', 'team-work-logger-v2', 'manuals', manual.id));
            if (manual.fileUrl) {
                 try {
                     const fileRef = ref(storage, manual.fileUrl);
                     await deleteObject(fileRef);
                 } catch(e) {}
            }
            showToast('삭제되었습니다.');
            DOM.detailModal.classList.add('hidden');
        }
    };

    const area = DOM.detailContentArea;
    area.innerHTML = '';

    if (manual.type === 'text') {
        // 링크 자동 변환
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        let htmlContent = manual.content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        htmlContent = htmlContent.replace(urlRegex, '<a href="$1" target="_blank" class="text-blue-500 hover:underline break-all">$1</a>');
        
        area.innerHTML = `<div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm text-sm text-gray-800 dark:text-gray-200 leading-relaxed border border-gray-200 dark:border-gray-700 min-h-full">${htmlContent}</div>`;
    } else if (manual.type === 'file') {
        const isPdf = manual.fileType?.includes('pdf');
        const isImage = manual.fileType?.includes('image');
        
        if (isPdf) {
            area.innerHTML = `<iframe src="${manual.fileUrl}" class="w-full h-full rounded-xl border border-gray-300 dark:border-gray-600 min-h-[70vh]"></iframe>`;
        } else if (isImage) {
            area.innerHTML = `<img src="${manual.fileUrl}" class="max-w-full rounded-xl mx-auto border border-gray-200 dark:border-gray-700 shadow-sm" alt="${manual.fileName}">`;
        } else {
            area.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-center">
                    <span class="text-6xl mb-4">📗</span>
                    <h3 class="text-lg font-bold mb-2 dark:text-white">이 파일은 브라우저에서 바로 볼 수 없습니다.</h3>
                    <p class="text-sm text-gray-500 mb-6">${manual.fileName}</p>
                    <a href="${manual.fileUrl}" target="_blank" download class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg shadow-md transition">파일 다운로드 하기</a>
                </div>
            `;
        }
    }

    DOM.detailModal.classList.remove('hidden');
}

function setupListeners() {
    DOM.btnShowAdd.addEventListener('click', () => showEditMode());
    DOM.btnShowAddMobile.addEventListener('click', () => showEditMode());
    DOM.btnCancelEdit.addEventListener('click', hideEditMode);
    DOM.btnSave.addEventListener('click', saveManual);
    DOM.btnCloseDetail.addEventListener('click', () => DOM.detailModal.classList.add('hidden'));

    DOM.searchInput.addEventListener('input', renderManuals);

    DOM.radioTypes.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'text') {
                DOM.typeTextContainer.classList.remove('hidden');
                DOM.typeFileContainer.classList.add('hidden');
            } else {
                DOM.typeTextContainer.classList.add('hidden');
                DOM.typeFileContainer.classList.remove('hidden');
            }
        });
    });

    DOM.fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            DOM.fileNameDisplay.textContent = `선택된 파일: ${file.name}`;
            DOM.fileNameDisplay.classList.remove('hidden');
            currentUploadedFileData = null; // 새 파일 선택 시 기존 url 해제
        }
    });
}

document.addEventListener('DOMContentLoaded', init);