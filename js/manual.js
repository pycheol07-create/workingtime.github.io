// === js/manual.js ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig, loadAppConfig } from './config.js';

let app, db, auth, storage;
let appConfig = {};
let quillEditor;
let manualList = [];
let currentEditingId = null;
let selectedFile = null;
let isAdmin = false;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        storage = getStorage(app);
    } catch (error) {
        console.error("Firebase 초기화 실패:", error);
        alert("시스템을 초기화할 수 없습니다.");
        return;
    }

    // ✨ Quill 에디터 초기화 (ImageResize 모듈 활성화 추가)
    quillEditor = new Quill('#quill-editor', {
        theme: 'snow',
        placeholder: '여기에 업무 매뉴얼 내용을 자세히 작성하세요. (이미지는 화면 캡처 후 Ctrl+V로 바로 붙여넣을 수 있습니다)',
        modules: {
            imageResize: { 
                displaySize: true // 이미지 리사이징 박스 및 크기 툴팁 활성화
            },
            toolbar: [
                [{ 'header': [1, 2, 3, false] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'color': [] }, { 'background': [] }],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['image', 'link'],
                ['clean']
            ]
        }
    });

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            appConfig = await loadAppConfig(db);
            const userEmailLower = (user.email || '').toLowerCase();
            const role = (appConfig.memberRoles || {})[userEmailLower] || 'user';
            
            isAdmin = (role === 'admin');
            
            if (isAdmin) {
                document.getElementById('btn-new-manual').classList.remove('hidden');
            }

            populateCategories(); 
            populateManagers(); 
            setupEventListeners();
            loadManuals();
        } else {
            alert("로그인이 필요합니다.");
            window.location.href = 'index.html';
        }
    });
});

function populateCategories() {
    const select = document.getElementById('edit-category');
    select.innerHTML = '';
    
    const groups = appConfig.teamGroups || [];
    
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '공통 지침';
    defaultOpt.textContent = '공통 지침';
    select.appendChild(defaultOpt);

    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.name; 
        opt.textContent = `${g.name} 매뉴얼`;
        select.appendChild(opt);
    });
}

function populateManagers() {
    const select = document.getElementById('edit-manager');
    select.innerHTML = '<option value="">선택 안함</option>';
    
    const members = new Set();
    (appConfig.teamGroups || []).forEach(g => {
        (g.members || []).forEach(m => members.add(m));
    });
    
    Array.from(members).sort().forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        select.appendChild(opt);
    });
}

function setupEventListeners() {
    document.getElementById('btn-close-window').addEventListener('click', () => {
        window.close(); 
    });

    document.getElementById('manual-search-input').addEventListener('input', renderList);

    document.getElementById('btn-new-manual').addEventListener('click', () => {
        openEditor();
    });

    document.getElementById('btn-cancel-edit').addEventListener('click', () => {
        document.getElementById('manual-edit-area').classList.add('hidden');
        selectedFile = null;
    });

    document.getElementById('btn-trigger-upload').addEventListener('click', () => {
        document.getElementById('edit-file-upload').click();
    });

    document.getElementById('edit-file-upload').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            selectedFile = e.target.files[0];
            document.getElementById('upload-file-name').innerHTML = `<span class="text-indigo-600 font-bold">✓ ${selectedFile.name}</span>`;
        }
    });

    document.getElementById('btn-save-manual').addEventListener('click', saveManual);
    
    document.getElementById('btn-delete-manual').addEventListener('click', deleteManual);
    document.getElementById('btn-edit-manual').addEventListener('click', () => {
        const item = manualList.find(m => m.id === currentEditingId);
        if (item) openEditor(item);
    });
}

async function loadManuals() {
    const listContainer = document.getElementById('manual-list-container');
    listContainer.innerHTML = '<div class="flex justify-center p-5 text-gray-400 text-sm">데이터를 불러오는 중...</div>';
    
    try {
        const manualCol = collection(db, 'artifacts', 'team-work-logger-v2', 'manuals');
        const q = query(manualCol, orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        
        manualList = [];
        snap.forEach(doc => {
            manualList.push({ id: doc.id, ...doc.data() });
        });

        renderList();
    } catch (e) {
        console.error("매뉴얼 로드 실패:", e);
        listContainer.innerHTML = '<div class="text-center p-5 text-red-500 text-sm font-bold">데이터를 불러오지 못했습니다. 새로고침 해주세요.</div>';
    }
}

function renderList() {
    const searchTerm = document.getElementById('manual-search-input').value.trim().toLowerCase();
    const listContainer = document.getElementById('manual-list-container');
    listContainer.innerHTML = '';

    const filteredList = manualList.filter(item => {
        const titleMatch = (item.title || '').toLowerCase().includes(searchTerm);
        const catMatch = (item.category || '').toLowerCase().includes(searchTerm);
        const managerMatch = (item.manager || '').toLowerCase().includes(searchTerm);
        return titleMatch || catMatch || managerMatch;
    });

    if (filteredList.length === 0) {
        listContainer.innerHTML = `<div class="p-6 text-center text-sm text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl mt-4">검색 결과가 없습니다.</div>`;
        return;
    }

    const grouped = {};
    filteredList.forEach(item => {
        const cat = item.category || '공통 지침';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(item);
    });

    Object.keys(grouped).sort().forEach(cat => {
        const catHeader = document.createElement('div');
        catHeader.className = 'text-xs font-bold text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700 pb-1 mt-6 mb-3 px-2 uppercase tracking-wider';
        catHeader.textContent = cat;
        listContainer.appendChild(catHeader);

        grouped[cat].forEach(item => {
            const div = document.createElement('div');
            div.className = 'p-3 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all group flex flex-col gap-1.5';
            
            const hasFile = item.fileUrl ? '<span class="text-[10px] bg-indigo-50 text-indigo-600 px-1 rounded font-bold border border-indigo-100 ml-1">첨부</span>' : '';

            div.innerHTML = `
                <div class="text-sm font-extrabold text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition leading-snug">
                    ${item.title} ${hasFile}
                </div>
                <div class="flex items-center justify-between mt-1">
                    <span class="text-[10px] text-gray-500 font-medium">담당: ${item.manager || '<span class="text-gray-300">미지정</span>'}</span>
                </div>
            `;

            div.addEventListener('click', () => viewManual(item.id));
            listContainer.appendChild(div);
        });
    });
}

function openEditor(item = null) {
    currentEditingId = item ? item.id : null;
    selectedFile = null;

    document.getElementById('edit-title').value = item ? item.title : '';
    
    const catSelect = document.getElementById('edit-category');
    if (item && item.category) {
        catSelect.value = item.category;
    } else {
        catSelect.selectedIndex = 0;
    }

    const managerSelect = document.getElementById('edit-manager');
    if (item && item.manager) {
        managerSelect.value = item.manager;
    } else {
        managerSelect.selectedIndex = 0;
    }
    
    quillEditor.root.innerHTML = item ? (item.content || '') : '';
    
    const fileNameDisplay = document.getElementById('upload-file-name');
    document.getElementById('edit-file-upload').value = '';
    
    if (item && item.fileUrl) {
        fileNameDisplay.innerHTML = `<span class="text-blue-600 font-bold">💾 기존 첨부파일: ${item.fileName || '유지됨'} (선택 시 교체)</span>`;
    } else {
        fileNameDisplay.textContent = '선택된 파일 없음';
    }

    document.getElementById('manual-edit-area').classList.remove('hidden');
}

async function saveManual() {
    const title = document.getElementById('edit-title').value.trim();
    const category = document.getElementById('edit-category').value;
    const manager = document.getElementById('edit-manager').value;
    const content = quillEditor.root.innerHTML;
    
    if (!title) {
        alert("제목을 반드시 입력해주세요.");
        return;
    }

    const btn = document.getElementById('btn-save-manual');
    btn.disabled = true;
    btn.textContent = '저장 처리 중...';

    try {
        let fileUrl = null;
        let fileName = null;

        const existingItem = manualList.find(m => m.id === currentEditingId);
        if (existingItem) {
            fileUrl = existingItem.fileUrl;
            fileName = existingItem.fileName;
        }

        if (selectedFile) {
            const ext = selectedFile.name.split('.').pop();
            const safeName = `manual_${Date.now()}.${ext}`;
            const storageRef = ref(storage, `manuals/${safeName}`);
            
            await uploadBytes(storageRef, selectedFile);
            fileUrl = await getDownloadURL(storageRef);
            fileName = selectedFile.name;
        }

        const manualData = {
            title,
            category,
            manager,
            content: content === '<p><br></p>' ? '' : content,
            fileUrl: fileUrl || null,
            fileName: fileName || null,
            author: auth.currentUser.email,
            updatedAt: serverTimestamp()
        };

        const manualCol = collection(db, 'artifacts', 'team-work-logger-v2', 'manuals');
        
        if (currentEditingId) {
            await setDoc(doc(manualCol, currentEditingId), manualData, { merge: true });
        } else {
            manualData.createdAt = serverTimestamp();
            const newDocRef = doc(manualCol, `doc_${Date.now()}`);
            await setDoc(newDocRef, manualData);
            currentEditingId = newDocRef.id; 
        }

        document.getElementById('manual-edit-area').classList.add('hidden');
        await loadManuals(); 
        
        viewManual(currentEditingId);

    } catch (e) {
        console.error("저장 오류:", e);
        alert("저장에 실패했습니다. 첨부파일의 용량이 너무 크거나 인터넷 연결이 불안정할 수 있습니다.");
    } finally {
        btn.disabled = false;
        btn.textContent = '저장하기';
    }
}

const formatDateTime = (timestamp) => {
    if (!timestamp) return '-';
    const d = new Date(timestamp.toMillis ? timestamp.toMillis() : timestamp);
    if (isNaN(d)) return '-';
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
};

function viewManual(id) {
    const item = manualList.find(m => m.id === id);
    if (!item) return;

    currentEditingId = id;
    document.getElementById('viewer-empty').classList.add('hidden');
    document.getElementById('viewer-content').classList.remove('hidden');
    document.getElementById('view-title').textContent = item.title;
    document.getElementById('view-type-badge').textContent = item.category || '공통 지침';
    
    document.getElementById('view-manager').innerHTML = item.manager ? `<span class="text-indigo-600">${item.manager}</span>` : '<span class="text-gray-300">미지정</span>';
    document.getElementById('view-created-date').textContent = formatDateTime(item.createdAt);
    document.getElementById('view-updated-date').textContent = formatDateTime(item.updatedAt || item.createdAt);

    document.getElementById('view-body').innerHTML = item.content || '';

    const attachArea = document.getElementById('view-attachment');
    if (item.fileUrl) {
        attachArea.classList.remove('hidden');
        document.getElementById('view-file-name').textContent = item.fileName || '첨부된 파일 확인하기';
        document.getElementById('view-file-link').href = item.fileUrl;
    } else {
        attachArea.classList.add('hidden');
    }

    if (isAdmin) {
        document.getElementById('btn-edit-manual').classList.remove('hidden');
        document.getElementById('btn-delete-manual').classList.remove('hidden');
    }
}

async function deleteManual() {
    if (!confirm("이 매뉴얼을 정말로 삭제하시겠습니까?\n(복구할 수 없습니다)")) return;
    
    try {
        await deleteDoc(doc(db, 'artifacts', 'team-work-logger-v2', 'manuals', currentEditingId));
        document.getElementById('viewer-content').classList.add('hidden');
        document.getElementById('viewer-empty').classList.remove('hidden');
        currentEditingId = null;
        await loadManuals();
    } catch(e) {
        alert("삭제에 실패했습니다.");
    }
}