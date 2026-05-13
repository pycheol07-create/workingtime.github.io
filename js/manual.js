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

    // Quill 에디터 초기화
    quillEditor = new Quill('#quill-editor', {
        theme: 'snow',
        placeholder: '여기에 매뉴얼 내용을 작성하세요. 이미지는 캡처 후 붙여넣기(Ctrl+V) 하거나 끌어다 놓으세요.',
        modules: {
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
            
            // 관리자면 버튼 노출
            if (isAdmin) {
                document.getElementById('btn-new-manual').classList.remove('hidden');
            }

            setupEventListeners();
            loadManuals();
        } else {
            alert("로그인이 필요합니다.");
            window.location.href = 'index.html';
        }
    });
});

function setupEventListeners() {
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
            document.getElementById('upload-file-name').textContent = selectedFile.name;
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
    listContainer.innerHTML = '<div class="flex justify-center p-5 text-gray-400 text-sm">불러오는 중...</div>';
    
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
        listContainer.innerHTML = '<div class="text-center p-5 text-red-500 text-sm">데이터를 불러오지 못했습니다.</div>';
    }
}

function renderList() {
    const listContainer = document.getElementById('manual-list-container');
    listContainer.innerHTML = '';

    if (manualList.length === 0) {
        listContainer.innerHTML = '<div class="p-4 text-center text-sm text-gray-400">등록된 매뉴얼이 없습니다.</div>';
        return;
    }

    manualList.forEach(item => {
        const div = document.createElement('div');
        div.className = 'p-3 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:border-blue-400 hover:shadow-md transition-all group';
        
        const dateStr = item.createdAt ? new Date(item.createdAt.toMillis()).toISOString().split('T')[0] : '방금 전';
        const hasFile = item.fileUrl ? '📎' : '📝';

        div.innerHTML = `
            <div class="flex items-center gap-2 mb-1">
                <span class="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded font-bold">${item.category || '일반'}</span>
                <span class="text-[10px] text-gray-400 font-mono">${dateStr}</span>
            </div>
            <div class="text-sm font-bold text-gray-800 dark:text-gray-200 group-hover:text-blue-600 transition flex items-center gap-1">
                <span>${hasFile}</span> <span class="truncate">${item.title}</span>
            </div>
        `;

        div.addEventListener('click', () => viewManual(item.id));
        listContainer.appendChild(div);
    });
}

function openEditor(item = null) {
    currentEditingId = item ? item.id : null;
    selectedFile = null;

    document.getElementById('edit-title').value = item ? item.title : '';
    document.getElementById('edit-category').value = item ? item.category : '일반';
    
    // 에디터 내용 세팅
    quillEditor.root.innerHTML = item ? (item.content || '') : '';
    
    // 첨부파일 세팅
    const fileNameDisplay = document.getElementById('upload-file-name');
    document.getElementById('edit-file-upload').value = '';
    
    if (item && item.fileUrl) {
        fileNameDisplay.innerHTML = `<span class="text-blue-600 font-bold">기존 파일 유지됨 (클릭 시 변경)</span>`;
    } else {
        fileNameDisplay.textContent = '선택된 파일 없음';
    }

    document.getElementById('manual-edit-area').classList.remove('hidden');
}

async function saveManual() {
    const title = document.getElementById('edit-title').value.trim();
    const category = document.getElementById('edit-category').value;
    const content = quillEditor.root.innerHTML;
    
    if (!title) {
        alert("제목을 입력해주세요.");
        return;
    }

    const btn = document.getElementById('btn-save-manual');
    btn.disabled = true;
    btn.textContent = '저장 중...';

    try {
        let fileUrl = null;
        let fileName = null;

        // 기존 데이터 유지용
        const existingItem = manualList.find(m => m.id === currentEditingId);
        if (existingItem) {
            fileUrl = existingItem.fileUrl;
            fileName = existingItem.fileName;
        }

        // 새 파일이 선택된 경우 Storage에 업로드
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
            await setDoc(doc(manualCol, `doc_${Date.now()}`), manualData);
        }

        document.getElementById('manual-edit-area').classList.add('hidden');
        await loadManuals(); // 목록 새로고침
        
        // 새로 저장한 문서 열기
        if(currentEditingId) viewManual(currentEditingId);

    } catch (e) {
        console.error("저장 오류:", e);
        alert("저장에 실패했습니다. 용량이 너무 크거나 네트워크 오류일 수 있습니다.");
    } finally {
        btn.disabled = false;
        btn.textContent = '저장하기';
    }
}

function viewManual(id) {
    const item = manualList.find(m => m.id === id);
    if (!item) return;

    currentEditingId = id;
    document.getElementById('viewer-empty').classList.add('hidden');
    document.getElementById('viewer-content').classList.remove('hidden');
    document.getElementById('view-title').textContent = item.title;
    document.getElementById('view-type-badge').textContent = item.category || '일반';
    
    const dateStr = item.createdAt ? new Date(item.createdAt.toMillis()).toISOString().split('T')[0] : '';
    document.getElementById('view-date').textContent = dateStr;

    // 본문 (Quill로 작성된 HTML 그대로 렌더링)
    document.getElementById('view-body').innerHTML = item.content || '';

    // 첨부파일
    const attachArea = document.getElementById('view-attachment');
    if (item.fileUrl) {
        attachArea.classList.remove('hidden');
        document.getElementById('view-file-name').textContent = item.fileName || '첨부문서 확인하기';
        document.getElementById('view-file-link').href = item.fileUrl;
    } else {
        attachArea.classList.add('hidden');
    }

    // 관리자 버튼
    if (isAdmin) {
        document.getElementById('btn-edit-manual').classList.remove('hidden');
        document.getElementById('btn-delete-manual').classList.remove('hidden');
    }
}

async function deleteManual() {
    if (!confirm("이 매뉴얼을 정말 삭제하시겠습니까?")) return;
    
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