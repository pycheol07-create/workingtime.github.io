// === js/manual.js ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc, serverTimestamp, query, orderBy, where, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig, loadAppConfig } from './config.js?v=202610291113';
import { connectEmulatorsIfEnabled } from './firebase-emulator.js?v=202610291113';
import { setShellContext, goHome, onBeforeLeave, leaveAlreadyConfirmed } from './app-shell-bridge.js?v=202610291113';
import { memberNameFor } from './app-shell-data.js?v=202610291113';
import { menuConfigOf } from './lib/perm.js?v=202610291113';
import { escapeHtml, friendlyFirebaseError } from './utils.js?v=202610291113';
import { checkAttachment, checkInlineImage, accessFieldsFor, backfillPatchFor, canViewManual as canViewManualFor, mergeManualLists } from './lib/manual-access.js?v=202610291113';

let app, db, auth, storage;
let appConfig = {};
let quillEditor;
let manualList = [];
let currentEditingId = null;
let selectedFile = null;
let currentZoom = window.matchMedia('(max-width: 768px)').matches ? 100 : 80;

let currentUserName = '';
let isAdmin = false;
let removeExistingFile = false;   // 편집 중 [첨부 빼기] — 저장 때 기존 첨부를 뗀다(저장소 파일은 지우지 않는다)

const myEmailLower = () => String((auth && auth.currentUser && auth.currentUser.email) || '').toLowerCase();
// 수정·삭제 가능 — firestore.rules manuals 의 update·delete 와 같은 조건(isAdmin() || author.lower() == 내 이메일)
const canEditManual = (item) => !!item && (isAdmin || (myEmailLower() !== '' && String(item.author || '').toLowerCase() === myEmailLower()));
const EDIT_DENIED_MSG = '매뉴얼은 작성자·관리자만 수정할 수 있습니다.';

// 열람 가능 — 목록 필터와 같은 기준(주소 #id= 로 바로 열 때도 이 검사를 거친다)
//   firestore.rules manuals 읽기와 같은 판정(관리자·공개·작성자·지정 이메일) + 옛 문서용 이름 판정(js/lib/manual-access.js)
const canViewManual = (item) => canViewManualFor(item, { isAdmin, email: myEmailLower(), name: currentUserName });

// 검색용 본문 글자(태그 제거). DOMParser 문서는 스크립트를 실행하지 않는다. 매뉴얼마다 한 번만 만든다.
const plainTextOf = (item) => {
    if (item._plain === undefined) {
        try { item._plain = new DOMParser().parseFromString(String(item.content || ''), 'text/html').body.textContent || ''; }
        catch (e) { item._plain = ''; }
        item._plain = item._plain.replace(/\s+/g, ' ').toLowerCase();
    }
    return item._plain;
};

// 매뉴얼 주소 — manual.html#id=<문서 id>. 열면 고치고(기록 안 쌓임), 지우면 뺀다. 문서 id 모양만 받는다.
const MANUAL_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const readManualHash = () => {
    const m = /^#id=([^&]*)$/.exec(location.hash || '');
    let id = '';
    try { id = m ? decodeURIComponent(m[1]) : ''; } catch (e) { id = ''; }
    return MANUAL_ID_RE.test(id) ? id : '';
};
const writeManualHash = (id) => {
    try {
        const hash = id && MANUAL_ID_RE.test(id) ? '#id=' + encodeURIComponent(id) : '';
        if (hash === (location.hash || '')) return;
        history.replaceState(history.state, '', location.pathname + location.search + hash);
    } catch (e) { /* 주소를 못 고쳐도 화면은 그대로 */ }
};

// 저장 안 한 편집 경고(UI 1b, 2026-10-16) — 편집 영역(Quill)이 열려 있으면 '편집 중'으로 본다.
// 저장·취소하면 편집 영역이 닫히므로 따로 내릴 것이 없다.
const isEditingManual = () => {
    const area = document.getElementById('manual-edit-area');
    return !!(area && !area.classList.contains('hidden'));
};
window.addEventListener('beforeunload', (e) => {
    if (!isEditingManual() || leaveAlreadyConfirmed()) return;
    e.preventDefault();
    e.returnValue = '';
});
// 공통 상단바 메뉴·홈('홈으로' 버튼 포함) — 동기 confirm 만
onBeforeLeave(() => !isEditingManual() || confirm('작성 중인 매뉴얼이 저장되지 않았습니다.\n저장하지 않고 이 화면을 떠날까요?'));

// 매뉴얼 본문 HTML 정화(XSS, 2026-10-22) — manual.html 이 고정 버전 DOMPurify 를 먼저 읽는다.
// DOMPurify 가 없으면(CDN 실패) 태그를 그대로 실행하지 않고 글자로 보여 준다(fail-closed).
// iframe 은 Quill 동영상(class ql-video, https, 아래 호스트)만 남긴다.
let purifyHookAdded = false;
const VIDEO_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com', 'player.vimeo.com']);
const isAllowedVideoSrc = (src) => {
    try {
        const u = new URL(src);
        return u.protocol === 'https:' && VIDEO_HOSTS.has(u.hostname.toLowerCase());
    } catch (e) { return false; }
};
const hasPurify = () => !!(window.DOMPurify && typeof window.DOMPurify.sanitize === 'function');
function sanitizeManualHtml(html) {
    if (!hasPurify()) return escapeHtml(html);
    const P = window.DOMPurify;
    if (!purifyHookAdded) {
        P.addHook('uponSanitizeElement', (node, data) => {
            if (data.tagName !== 'iframe') return;
            const cls = (node.getAttribute && node.getAttribute('class')) || '';
            const src = ((node.getAttribute && node.getAttribute('src')) || '').trim();
            if (!/(^|\s)ql-video(\s|$)/.test(cls) || !isAllowedVideoSrc(src)) {
                if (node.parentNode) node.parentNode.removeChild(node);
            }
        });
        purifyHookAdded = true;
    }
    return P.sanitize(String(html == null ? '' : html), {
        USE_PROFILES: { html: true },
        ADD_TAGS: ['iframe'],
        ADD_ATTR: ['allowfullscreen', 'frameborder', 'target'],
    });
}

// ✨ 대분류 Header2(h2), 단계 Header3(h3), 구분선(hr)이 적용된 템플릿
const MANUAL_TEMPLATE = `
    <h2 style="color: #1d4ed8;"><strong>1. 📝 업무 설명</strong></h2>
    <ul>
        <li><strong>이 업무는 무엇인가:</strong> </li>
        <li><strong>왜 해야 하는가 (목적·중요성):</strong> </li>
    </ul>
    <p><br></p>
    <hr>
    <p><br></p>

    <h2 style="color: #1d4ed8;"><strong>2. 🔑 사전 준비 & 참고사항</strong></h2>
    <ul>
        <li><strong>필요 권한/계정:</strong> </li>
        <li><strong>접속 링크:</strong> </li>
        <li><strong>기타 참고사항:</strong> </li>
    </ul>
    <p><br></p>
    <hr>
    <p><br></p>

    <h2 style="color: #1d4ed8;"><strong>3. 🏃‍♂️ 업무 진행 절차</strong></h2>
    <p><strong style="color: #ef4444;">※ 이미지는 화면 캡처 후 여기에 바로 붙여넣기(Ctrl+V) 하세요.</strong></p>
    <h3><strong>▶ 1단계</strong></h3>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
    <h3><strong>▶ 2단계</strong></h3>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
    <h3><strong>▶ 3단계</strong></h3>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
    <h3><strong>▶ 4단계</strong></h3>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
    <h3><strong>▶ 5단계</strong></h3>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
    <p><br></p>
    <hr>
    <p><br></p>

    <h2 style="color: #1d4ed8;"><strong>4. 🚨 필수 주의사항 및 예외</strong></h2>
    <ul>
        <li>업무 진행 시 주의해야 할 점이나 빈번한 실수 등을 적어주세요.</li>
        <li><strong>문제 발생 시 대처:</strong> </li>
    </ul>
    <p><br></p>
    <hr>
    <p><br></p>

    <h2 style="color: #1d4ed8;"><strong>5. 📎 참고 파일</strong></h2>
    <p>※ 하단의 <strong>'파일 찾기'</strong> 버튼을 눌러 참고할 파일을 첨부해 주세요.</p>
`;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        connectEmulatorsIfEnabled(db, auth);
        storage = getStorage(app);
    } catch (error) {
        console.error("Firebase 초기화 실패:", error);
        alert("시스템을 초기화할 수 없습니다.");
        return;
    }

    const BlockEmbed = Quill.import('blots/block/embed');
    class DividerBlot extends BlockEmbed {}
    DividerBlot.blotName = 'divider';
    DividerBlot.tagName = 'hr';
    Quill.register(DividerBlot);

    const imageHandler = () => {
        const input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('accept', 'image/png,image/jpeg,image/gif,image/webp,image/bmp');
        input.click();

        input.onchange = async () => {
            const file = input.files[0];
            if (file) await uploadInlineImageToStorage(file);
        };
    };

    quillEditor = new Quill('#quill-editor', {
        theme: 'snow',
        placeholder: '여기에 업무 매뉴얼 내용을 자세히 작성하세요. (이미지는 화면 캡처 후 Ctrl+V로 바로 붙여넣을 수 있습니다)',
        modules: {
            imageResize: { 
                displaySize: true 
            },
            keyboard: {
                bindings: {
                    disableAutoList: {
                        key: ' ',
                        collapsed: true,
                        prefix: /^\s*?(\d+\.|-|\*)$/,
                        handler: function(range, context) {
                            this.quill.insertText(range.index, ' ', 'user');
                            this.quill.setSelection(range.index + 1, 'silent');
                            return false; 
                        }
                    }
                }
            },
            toolbar: {
                container: [
                    [{ 'header': [1, 2, 3, 4, false] }, { 'size': ['small', false, 'large', 'huge'] }], 
                    ['bold', 'italic', 'underline', 'strike', 'blockquote'], 
                    [{ 'color': [] }, { 'background': [] }], 
                    [{ 'align': [] }], 
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }, { 'indent': '-1'}, { 'indent': '+1' }], 
                    ['link', 'image', 'video'], 
                    ['clean'] 
                ],
                handlers: {
                    image: imageHandler
                }
            }
        }
    });

    applyZoom();

    quillEditor.root.addEventListener('paste', async (e) => {
        if (e.clipboardData && e.clipboardData.items && e.clipboardData.items.length) {
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    e.preventDefault(); 
                    const file = items[i].getAsFile();
                    if(file) await uploadInlineImageToStorage(file);
                }
            }
        }
    });

    quillEditor.root.addEventListener('drop', async (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
            let hasImage = false;
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                if (e.dataTransfer.files[i].type.indexOf('image') !== -1) {
                    hasImage = true;
                }
            }
            if (hasImage) {
                e.preventDefault(); 
                for (let i = 0; i < e.dataTransfer.files.length; i++) {
                    const file = e.dataTransfer.files[i];
                    if (file.type.indexOf('image') !== -1) {
                        await uploadInlineImageToStorage(file);
                    }
                }
            }
        }
    });

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            appConfig = await loadAppConfig(db);
            const userEmailLower = (user.email || '').toLowerCase();
            
            isAdmin = (appConfig.memberRoles && appConfig.memberRoles[userEmailLower] === 'admin');
            // 공통 상단바 — role 은 memberRoles 에 있을 때만(설정을 못 읽어 기본값이면 셸이 캐시 메뉴를 쓴다)
            const shellRole = appConfig.memberRoles ? appConfig.memberRoles[userEmailLower] : undefined;
            // memberName 은 셸 개인 알림 구독용 — 메모리에만(캐시·로그에 남기지 않는다)
            setShellContext({ signedIn: true, uid: user.uid, email: userEmailLower, role: shellRole,
                memberName: memberNameFor(appConfig.memberEmails, userEmailLower) || undefined,
                menuConfig: shellRole ? menuConfigOf(appConfig) : undefined });

            const emails = appConfig.memberEmails || {};
            currentUserName = Object.keys(emails).find(name => (emails[name] || '').toLowerCase() === userEmailLower);
            if (!currentUserName) currentUserName = userEmailLower; 
            
            document.getElementById('btn-new-manual').classList.remove('hidden');

            populateCategories();
            populateManagers();
            populateAccessMembers();
            setupEventListeners();
            loadManuals();
        } else {
            setShellContext({ signedIn: false });
            alert("로그인이 필요합니다.");
            window.location.href = 'index.html';
        }
    });
});

async function uploadInlineImageToStorage(file) {
    // 형식·크기 검사(storage.rules manuals/images 와 같은 기준) — 어긋나면 올리지 않고 알린다
    const chk = checkInlineImage(file);
    if (!chk.ok) { alert(chk.reason); return; }
    const btn = document.getElementById('btn-save-manual');
    const originalText = btn.textContent;
    btn.textContent = '이미지 업로드 중...';
    btn.disabled = true;

    try {
        const safeName = `manual_inline_${Date.now()}_${Math.floor(Math.random()*1000)}.${chk.ext}`;
        const storageRef = ref(storage, `manuals/images/${safeName}`);

        await uploadBytes(storageRef, file, { contentType: chk.contentType });
        const url = await getDownloadURL(storageRef);

        const range = quillEditor.getSelection(true); 
        quillEditor.insertEmbed(range.index, 'image', url);
        quillEditor.setSelection(range.index + 1);
    } catch (e) {
        console.error("본문 이미지 업로드 실패:", e);
        alert("이미지를 서버에 업로드하는데 실패했습니다.\n- 용량이 너무 큰 이미지이거나 네트워크 연결이 끊겼습니다.\n- 계속되면 관리자에게 알려 주세요.");
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

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

function populateAccessMembers() {
    const container = document.getElementById('edit-access-members-container');
    container.innerHTML = '';
    const groups = appConfig.teamGroups || [];
    
    groups.forEach(g => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'flex flex-col gap-1 w-full md:w-auto min-w-[120px]';
        groupDiv.innerHTML = `<span class="text-[10px] font-extrabold text-indigo-500 mb-0.5">${escapeHtml(g.name)}</span>`;
        
        const membersDiv = document.createElement('div');
        membersDiv.className = 'flex flex-wrap gap-2';
        
        (g.members || []).forEach(m => {
            const label = document.createElement('label');
            label.className = 'flex items-center gap-1.5 text-[11px] font-bold text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 px-1.5 py-1 rounded transition select-none';
            label.innerHTML = `<input type="checkbox" value="${escapeHtml(m)}" class="access-member-cb w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"> <span>${escapeHtml(m)}</span>`;
            membersDiv.appendChild(label);
        });
        groupDiv.appendChild(membersDiv);
        container.appendChild(groupDiv);
    });
}

const applyZoom = () => {
    const zoomLevelEl = document.getElementById('zoom-level');
    if(zoomLevelEl) zoomLevelEl.textContent = `${currentZoom}%`;
    const viewBody = document.getElementById('view-body');
    const editorBody = document.querySelector('.ql-editor');
    if(viewBody) viewBody.style.zoom = `${currentZoom}%`;
    if(editorBody) editorBody.style.zoom = `${currentZoom}%`;
};

function setupEventListeners() {
    // '창 닫기' → '홈으로'(2026-10-16): 같은 탭에서 대시보드로 간다(공통 상단바와 같은 이동)
    document.getElementById('btn-close-window').addEventListener('click', () => {
        goHome();
    });

    document.getElementById('manual-search-input').addEventListener('input', renderList);

    document.getElementById('edit-access-level').addEventListener('change', (e) => {
        const container = document.getElementById('edit-access-members-container');
        if (e.target.value === 'private') {
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
            document.querySelectorAll('.access-member-cb').forEach(cb => cb.checked = false);
        }
    });

    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
        if (currentZoom < 200) { currentZoom += 10; applyZoom(); }
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
        if (currentZoom > 50) { currentZoom -= 10; applyZoom(); }
    });

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
            // 실행 파일·압축 파일·20MB 초과는 고르는 순간 돌려보낸다(저장 때 한 번 더 본다)
            const chk = checkAttachment(e.target.files[0]);
            if (!chk.ok) {
                alert(chk.reason);
                e.target.value = '';
                return;
            }
            selectedFile = e.target.files[0];
            updateFileUI();
        }
    });

    document.getElementById('btn-save-manual').addEventListener('click', saveManual);
    document.getElementById('btn-delete-manual').addEventListener('click', deleteManual);
    document.getElementById('btn-edit-manual').addEventListener('click', () => {
        const item = manualList.find(m => m.id === currentEditingId);
        if (!item) return;
        if (!canEditManual(item)) { alert(EDIT_DENIED_MSG); return; }
        openEditor(item);
    });

    // [첨부 빼기] — 방금 고른 파일이 있으면 그것만 취소, 없으면 기존 첨부를 저장 때 뗀다
    document.getElementById('btn-remove-file')?.addEventListener('click', () => {
        if (selectedFile) {
            selectedFile = null;
            document.getElementById('edit-file-upload').value = '';
        } else {
            removeExistingFile = true;
        }
        updateFileUI();
    });

    // 주소의 #id= 가 바뀌면(링크를 붙여 넣기·뒤로가기) 그 매뉴얼을 연다. 편집 중이면 먼저 묻는다.
    // '#id=' 가 아닌 해시(첨부 '#' 링크·본문 '#목차' 같은 앵커)는 무시한다 — 보던 매뉴얼을 닫는 것은 #id= 가 빠져 해시가 비었을 때만.
    window.addEventListener('hashchange', (e) => {
        let prev = '';
        try { prev = new URL(e.oldURL).hash; } catch (err) { prev = ''; }
        const nowId = /^#id=/.test(location.hash || '');
        const idRemoved = /^#id=/.test(prev) && !location.hash;
        if (!nowId && !idRemoved) return;
        if (isEditingManual()) {
            if (!confirm('작성 중인 매뉴얼이 저장되지 않았습니다.\n저장하지 않고 다른 매뉴얼을 열까요?')) {
                // 남으면 주소만 되돌린다(replaceState 는 hashchange 를 다시 내지 않는다)
                try { history.replaceState(history.state, '', location.pathname + location.search + prev); } catch (err) {}
                return;
            }
            document.getElementById('manual-edit-area').classList.add('hidden');
            selectedFile = null;
        }
        if (readManualHash()) openManualFromHash();
        else if (currentEditingId) closeManualView();
    });

    document.querySelectorAll('.symbol-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const symbol = e.target.textContent;
            const range = quillEditor.getSelection(true); 
            quillEditor.insertText(range.index, symbol); 
            quillEditor.setSelection(range.index + symbol.length); 
        });
    });

    document.getElementById('btn-divider')?.addEventListener('click', () => {
        const range = quillEditor.getSelection(true);
        quillEditor.insertText(range.index, '\n', 'user');
        quillEditor.insertEmbed(range.index + 1, 'divider', true, 'user');
        quillEditor.insertText(range.index + 2, '\n', 'user');
        quillEditor.setSelection(range.index + 3, 'silent');
    });

    document.getElementById('btn-load-template')?.addEventListener('click', () => {
        const currentContent = quillEditor.root.innerHTML.trim();
        if (currentContent !== '' && currentContent !== '<p><br></p>') {
            if (!confirm("현재 작성된 내용이 지워지고 기본 양식으로 덮어씌워집니다. 계속하시겠습니까?")) {
                return;
            }
        }
        quillEditor.root.innerHTML = MANUAL_TEMPLATE;
    });

    document.getElementById('btn-add-step')?.addEventListener('click', () => {
        let range = quillEditor.getSelection(true);
        let index = range ? range.index : quillEditor.getLength();
        
        const stepHtml = `
            <h3><strong>▶ 추가 단계</strong></h3>
            <p>&nbsp;&nbsp;&nbsp;&nbsp;내용을 입력하세요</p>
            <p><br></p>
        `;
        
        quillEditor.clipboard.dangerouslyPasteHTML(index, stepHtml);
    });
}

// 볼 수 있는 매뉴얼만 받는다(2026-10-22 '지정 인원만 열람' 서버 규칙).
//   규칙은 필터가 아니어서, 직원이 컬렉션 전체를 요청하면 통째로 거부된다 → 볼 수 있는 조건별로 나눠 받아 합친다:
//   공개(isPublic) · 내가 작성(author — 원본 이메일로 저장되므로 원본·소문자 둘 다) · 지정(allowedEmails 에 내 이메일).
//   관리자는 전체. 정렬은 합친 뒤 화면에서(조건 + orderBy 를 섞으면 복합 색인이 필요하다).
//   새 규칙 게시 전(옛 규칙)에는 전체 요청이 그대로 되므로 먼저 시도하고, 거부되면 나눠 받는다 — 게시 순서와 무관하게 돈다.
let splitQueryMode = false;
async function fetchVisibleManuals() {
    const manualCol = collection(db, 'artifacts', 'team-work-logger-v2', 'manuals');
    const rows = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (isAdmin || !splitQueryMode) {
        try {
            return rows(await getDocs(query(manualCol, orderBy('createdAt', 'desc'))));
        } catch (e) {
            if (isAdmin || !e || e.code !== 'permission-denied') throw e;
            splitQueryMode = true;
        }
    }
    const rawEmail = String((auth.currentUser && auth.currentUser.email) || '');
    const me = myEmailLower();
    const qs = [query(manualCol, where('isPublic', '==', true))];
    if (me) {
        qs.push(query(manualCol, where('allowedEmails', 'array-contains', me)));
        qs.push(query(manualCol, where('author', '==', rawEmail)));
        if (rawEmail !== me) qs.push(query(manualCol, where('author', '==', me)));
    }
    // 하나가 실패해도 나머지는 보여 준다 — 전부 실패했을 때만 오류(loadManuals 가 '불러오지 못했습니다')
    const settled = await Promise.allSettled(qs.map(q => getDocs(q)));
    const ok = settled.filter(r => r.status === 'fulfilled');
    settled.forEach((r, i) => { if (r.status === 'rejected') console.warn(`매뉴얼 목록 일부(${i + 1}/${qs.length}) 실패:`, r.reason && r.reason.code); });
    if (ok.length === 0) throw settled[0].reason;
    return mergeManualLists(ok.map(r => rows(r.value)));
}

// 관리자가 매뉴얼 화면을 열면 isPublic·allowedEmails 를 allowedMembers(이름)로 다시 맞추고, author 를 소문자로 맞춘다.
//   옛 매뉴얼(필드 없음)과 직원 이메일이 바뀐 경우를 고친다. 다른 것과 수정일(updatedAt)은 건드리지 않는다.
//   트랜잭션으로 서버의 최신 문서를 읽어 계산한다 — 목록을 받은 뒤 누가 지정 인원을 바꿨어도 옛 값으로 덮지 않는다.
//   설정의 이메일 목록을 못 읽었으면(비어 있으면) 하지 않는다 — 지정 인원이 전부 빠지는 것을 막는다.
let backfillRunning = false;
async function backfillAccessFields() {
    const emails = appConfig.memberEmails;
    if (backfillRunning || !emails || Object.keys(emails).length === 0) return;
    backfillRunning = true;
    let done = 0, failed = 0;
    try {
        for (const item of manualList) {
            if (!backfillPatchFor(item, emails)) continue;   // 받은 목록 기준으로 고칠 것 없으면 읽지 않는다
            try {
                const ref_ = doc(db, 'artifacts', 'team-work-logger-v2', 'manuals', item.id);
                const fix = await runTransaction(db, async (tx) => {
                    const snap = await tx.get(ref_);
                    if (!snap.exists()) return null;
                    const patch = backfillPatchFor(snap.data(), emails);
                    if (patch) tx.update(ref_, patch);
                    return { data: { ...snap.data(), ...(patch || {}) }, patched: !!patch };
                });
                if (fix) { Object.assign(item, fix.data); if (fix.patched) done++; }
            } catch (e) {
                failed++;
            }
        }
        if (done || failed) console.info(`매뉴얼 열람 필드 맞춤: ${done}건 저장, ${failed}건 실패`);
    } finally {
        backfillRunning = false;
    }
}

let hashOpened = false;
// 주소의 #id= 매뉴얼을 연다. 없거나 볼 수 없는 매뉴얼이면 주소에서 뺀다(비공개 매뉴얼 여부를 알리지 않는다).
function openManualFromHash() {
    const id = readManualHash();
    if (!id) return;
    const item = manualList.find(m => m.id === id);
    if (!canViewManual(item)) { writeManualHash(''); return; }
    viewManual(id);
}

async function loadManuals() {
    const listContainer = document.getElementById('manual-list-container');
    listContainer.innerHTML = '<div class="flex justify-center p-5 text-gray-400 text-sm">데이터를 불러오는 중...</div>';
    
    try {
        manualList = await fetchVisibleManuals();

        renderList();
        if (isAdmin) backfillAccessFields();   // 기다리지 않는다(실패해도 목록은 그대로)
        // 처음 불러왔을 때 주소(#id=)의 매뉴얼을 바로 연다(새로고침·공유 링크)
        if (!hashOpened) { hashOpened = true; openManualFromHash(); }
    } catch (e) {
        console.error("매뉴얼 로드 실패:", e);
        listContainer.innerHTML = '<div class="text-center p-5 text-red-500 text-sm font-bold">데이터를 불러오지 못했습니다. 새로고침 해주세요.</div>';
    }
}

const formatDateTimeShort = (timestamp) => {
    if (!timestamp) return '-';
    const d = new Date(timestamp.toMillis ? timestamp.toMillis() : timestamp);
    if (isNaN(d)) return '-';
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}.${mm}.${dd}`;
};

// ✨ 폴더형 매뉴얼 목록 렌더링 (파트 뱃지 부활 + 공개/비공개 라인 추가)
function renderList() {
    const searchTerm = document.getElementById('manual-search-input').value.trim().toLowerCase();
    const listContainer = document.getElementById('manual-list-container');
    listContainer.innerHTML = '';

    let filteredList = manualList.filter(item => {
        const titleMatch = (item.title || '').toLowerCase().includes(searchTerm);
        const catMatch = (item.category || '').toLowerCase().includes(searchTerm);
        const managerMatch = (item.manager || '').toLowerCase().includes(searchTerm);
        if (titleMatch || catMatch || managerMatch) return true;
        return searchTerm !== '' && plainTextOf(item).includes(searchTerm);   // 본문(태그 뺀 글자)
    });

    filteredList = filteredList.filter(canViewManual);

    if (filteredList.length === 0) {
        listContainer.innerHTML = `<div class="p-6 text-center text-sm text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl mt-4">접근할 수 있는 검색 결과가 없습니다.</div>`;
        return;
    }

    const grouped = {};
    filteredList.forEach(item => {
        const cat = item.category || '공통 지침';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(item);
    });

    Object.keys(grouped).sort().forEach((cat, index) => {
        // 기본은 모두 닫힘. 검색어가 있을 때만 자동으로 펼침.
        const isExpanded = searchTerm !== '';

        const folderHeader = document.createElement('div');
        folderHeader.className = 'flex items-center justify-between p-2 mt-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition select-none group';
        folderHeader.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="d-folder-ico" aria-hidden="true"></span>
                <span class="text-xs font-bold text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                    ${escapeHtml(cat)} <span class="text-gray-400 font-normal">(${grouped[cat].length})</span>
                </span>
            </div>
            <svg class="w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        `;

        const itemsContainer = document.createElement('div');
        itemsContainer.className = `flex flex-col gap-1.5 pl-2 border-l-2 border-gray-100 dark:border-gray-800 ml-3 mt-1.5 mb-3 overflow-hidden transition-all duration-300 ${isExpanded ? '' : 'hidden'}`;

        folderHeader.addEventListener('click', () => {
            const svg = folderHeader.querySelector('svg');
            if (itemsContainer.classList.contains('hidden')) {
                itemsContainer.classList.remove('hidden');
                svg.classList.add('rotate-180');
            } else {
                itemsContainer.classList.add('hidden');
                svg.classList.remove('rotate-180');
            }
        });

        listContainer.appendChild(folderHeader);

        grouped[cat].forEach(item => {
            const div = document.createElement('div');
            div.className = 'p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all group flex flex-col gap-1 relative overflow-hidden';
            
            const dateStr = formatDateTimeShort(item.updatedAt || item.createdAt);
            const hasFile = item.fileUrl ? '<span class="text-[10px] bg-indigo-50 text-indigo-600 px-1 rounded font-bold border border-indigo-100 shadow-sm ml-1">첨부</span>' : '';
            
            const isPrivate = item.allowedMembers && item.allowedMembers.length > 0;
            const privateBadge = isPrivate ? '<span class="text-[10px] bg-red-50 text-red-600 px-1 rounded font-bold border border-red-100 shadow-sm ml-1">비공개</span>' : '';
            
            // ✨ 공개/비공개 여부에 따른 우측 색상 라인 (비공개: 빨간색, 공개: 녹색)
            const sideBar = isPrivate 
                ? '<div class="absolute top-0 right-0 w-1.5 h-full bg-red-400 dark:bg-red-500"></div>' 
                : '<div class="absolute top-0 right-0 w-1.5 h-full bg-emerald-400 dark:bg-emerald-500"></div>';

            div.innerHTML = `
                ${sideBar}
                <div class="flex items-center justify-between mb-1 pr-2">
                    <span class="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800 px-1.5 py-0.5 rounded font-bold shadow-sm truncate max-w-[150px]">${escapeHtml(item.category || '공통 지침')}</span>
                </div>
                <div class="text-sm font-extrabold text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition leading-snug break-all pr-3">
                    ${escapeHtml(item.title)} ${privateBadge} ${hasFile}
                </div>
                <div class="flex items-center justify-between mt-1.5 pr-2">
                    <span class="text-[10px] text-gray-500 font-medium">담당: ${item.manager ? escapeHtml(item.manager) : '<span class="text-gray-300">미지정</span>'}</span>
                    <span class="text-[10px] text-gray-400 font-mono tracking-tighter">수정: ${dateStr}</span>
                </div>
            `;

            div.addEventListener('click', () => {
                viewManual(item.id);
                // 모바일: 매뉴얼을 고르면 열린 사이드바를 닫아 본문이 보이게 함(manual.html 의 toggleSidebar 재사용)
                const sb = document.getElementById('sidebar');
                if (window.matchMedia('(max-width: 768px)').matches && sb && !sb.classList.contains('-translate-x-full') && typeof window.toggleSidebar === 'function') {
                    window.toggleSidebar();
                }
            });
            itemsContainer.appendChild(div);
        });

        listContainer.appendChild(itemsContainer);
    });
}

function openEditor(item = null) {
    // 정화 모듈을 못 읽었으면 기존 본문이 글자로 바뀐 채 저장될 수 있어 수정을 막는다
    if (item && !hasPurify()) {
        alert('보안 모듈을 불러오지 못해 지금은 매뉴얼을 수정할 수 없습니다.\n새로고침 후 다시 시도하고, 계속되면 관리자에게 알려 주세요.');
        return;
    }
    currentEditingId = item ? item.id : null;
    selectedFile = null;

    document.getElementById('edit-title').value = item ? item.title : '';
    
    const catSelect = document.getElementById('edit-category');
    if (item && item.category) catSelect.value = item.category;
    else catSelect.selectedIndex = 0;

    const managerSelect = document.getElementById('edit-manager');
    if (item && item.manager) managerSelect.value = item.manager;
    else managerSelect.selectedIndex = 0;
    
    const accessSelect = document.getElementById('edit-access-level');
    const accessContainer = document.getElementById('edit-access-members-container');
    document.querySelectorAll('.access-member-cb').forEach(cb => cb.checked = false);

    if (item && item.allowedMembers && item.allowedMembers.length > 0) {
        accessSelect.value = 'private';
        accessContainer.classList.remove('hidden');
        document.querySelectorAll('.access-member-cb').forEach(cb => {
            if (item.allowedMembers.includes(cb.value)) cb.checked = true;
        });
    } else {
        accessSelect.value = 'public';
        accessContainer.classList.add('hidden');
    }

    quillEditor.root.innerHTML = item ? sanitizeManualHtml(item.content || '') : MANUAL_TEMPLATE;
    
    document.getElementById('edit-file-upload').value = '';
    removeExistingFile = false;
    updateFileUI();

    document.getElementById('manual-edit-area').classList.remove('hidden');
}

// 편집 창의 첨부 줄 — 새로 고른 파일 / 기존 첨부(유지·빼기) / 없음, [첨부 빼기] 는 뺄 것이 있을 때만
function updateFileUI() {
    const el = document.getElementById('upload-file-name');
    const existing = currentEditingId ? manualList.find(m => m.id === currentEditingId) : null;
    const hasExisting = !!(existing && existing.fileUrl);
    if (selectedFile) {
        el.innerHTML = `<span class="text-indigo-600 font-bold">✓ ${escapeHtml(selectedFile.name)}</span>`;
    } else if (hasExisting && !removeExistingFile) {
        el.innerHTML = `<span class="text-blue-600 font-bold">기존 첨부파일: ${escapeHtml(existing.fileName || '유지됨')} (선택 시 교체)</span>`;
    } else if (hasExisting) {
        el.innerHTML = '<span class="text-red-600 font-bold">첨부를 뺍니다 (저장하면 적용)</span>';
    } else {
        el.textContent = '선택된 파일 없음';
    }
    document.getElementById('btn-remove-file')?.classList.toggle('hidden', !(selectedFile || (hasExisting && !removeExistingFile)));
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

    const accessLevel = document.getElementById('edit-access-level').value;
    let allowedMembers = [];
    if (accessLevel === 'private') {
        document.querySelectorAll('.access-member-cb:checked').forEach(cb => {
            allowedMembers.push(cb.value);
        });
        if (allowedMembers.length === 0) {
            alert("비공개(특정 인원 열람) 설정 시, 열람을 허용할 인원을 최소 1명 이상 체크해야 합니다.");
            return; 
        }
    }
    // 서버 규칙은 이메일로 판정한다 — 이름을 이메일로 바꿔 같이 저장한다(js/lib/manual-access.js)
    const access = accessFieldsFor(allowedMembers, appConfig.memberEmails);
    if (!access.isPublic) {
        const noEmail = allowedMembers.filter(n => accessFieldsFor([n], appConfig.memberEmails).allowedEmails.length === 0);
        if (noEmail.length > 0 && !confirm(`이메일이 등록되지 않은 인원은 이 매뉴얼을 볼 수 없습니다: ${noEmail.join(', ')}\n(관리자 페이지에서 이메일을 등록한 뒤 다시 저장하면 볼 수 있습니다)\n\n이대로 저장할까요?`)) {
            return;
        }
    }

    // 첨부 형식·크기 — 고를 때 봤지만 한 번 더(storage.rules 와 같은 기준)
    const fileCheck = selectedFile ? checkAttachment(selectedFile) : null;
    if (fileCheck && !fileCheck.ok) {
        alert(fileCheck.reason);
        return;
    }

    // 남의 매뉴얼은 규칙이 거부한다 — 첨부를 올리기 전에 막는다(올린 파일만 남지 않게)
    const existingItem = currentEditingId ? manualList.find(m => m.id === currentEditingId) : null;
    if (existingItem && !canEditManual(existingItem)) {
        alert(`저장할 수 없습니다. ${EDIT_DENIED_MSG}`);
        return;
    }

    const btn = document.getElementById('btn-save-manual');
    btn.disabled = true;
    btn.textContent = '저장 처리 중...';

    try {
        let fileUrl = null;
        let fileName = null;

        if (existingItem && !removeExistingFile) {
            fileUrl = existingItem.fileUrl;
            fileName = existingItem.fileName;
        }

        if (selectedFile) {
            const safeName = `manual_${Date.now()}.${fileCheck.ext}`;
            const storageRef = ref(storage, `manuals/${safeName}`);
            
            await uploadBytes(storageRef, selectedFile, { contentType: fileCheck.contentType });
            fileUrl = await getDownloadURL(storageRef);
            fileName = selectedFile.name;
        }

        if (content.length > 500000) { 
            throw new Error("OVERSIZED_CONTENT");
        }

        const manualData = {
            title,
            category,
            manager,
            content: content === '<p><br></p>' ? '' : content,
            fileUrl: fileUrl || null,
            fileName: fileName || null,
            allowedMembers: allowedMembers,
            isPublic: access.isPublic,              // 규칙 읽기 판정·목록 쿼리용(firestore.rules manuals)
            allowedEmails: access.allowedEmails,    // 지정 인원 이메일(소문자)
            updatedAt: serverTimestamp()
        };

        const manualCol = collection(db, 'artifacts', 'team-work-logger-v2', 'manuals');

        if (currentEditingId) {
            // 수정 — author 는 그대로 둔다(merge). 관리자가 고쳐도 작성자가 계속 고칠 수 있게(규칙은 author 로 판단). 고친 사람은 updatedBy.
            manualData.updatedBy = auth.currentUser.email;
            await setDoc(doc(manualCol, currentEditingId), manualData, { merge: true });
        } else {
            manualData.author = auth.currentUser.email;
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
        if (e.message === "OVERSIZED_CONTENT" || e.code === "resource-exhausted") {
            alert("저장 실패: 본문 텍스트 용량이 초과되었습니다.\n\n(이미지 업로드가 실패하여 강제로 글자로 변환된 이미지가 남아있을 수 있습니다. 이미지를 지우고 다시 시도하고, 계속되면 관리자에게 알려 주세요.)");
        } else if (e && e.code === 'permission-denied') {
            alert(`저장 권한이 없습니다. ${EDIT_DENIED_MSG}`);
        } else {
            alert(`저장에 실패했습니다 — ${friendlyFirebaseError(e)}`);
        }
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
    
    const accessBadge = document.getElementById('view-access-badge');
    if (item.allowedMembers && item.allowedMembers.length > 0) {
        accessBadge.classList.remove('hidden');
    } else {
        accessBadge.classList.add('hidden');
    }
    
    document.getElementById('view-manager').innerHTML = item.manager ? `<span class="text-indigo-600">${escapeHtml(item.manager)}</span>` : '<span class="text-gray-300">미지정</span>';
    document.getElementById('view-created-date').textContent = formatDateTime(item.createdAt);
    document.getElementById('view-updated-date').textContent = formatDateTime(item.updatedAt || item.createdAt);

    document.getElementById('view-body').innerHTML = sanitizeManualHtml(item.content || '');

    const attachArea = document.getElementById('view-attachment');
    if (item.fileUrl) {
        attachArea.classList.remove('hidden');
        document.getElementById('view-file-name').textContent = item.fileName || '첨부된 파일 확인하기';
        // javascript: 같은 주소가 클릭으로 실행되지 않게 http(s) 만 링크로 건다
        // http(s) 가 아니면 링크를 아예 뗀다('#' 로 두면 눌렀을 때 주소 해시만 바뀐다)
        const fileLink = document.getElementById('view-file-link');
        if (/^https?:\/\//i.test(String(item.fileUrl).trim())) {
            fileLink.href = item.fileUrl;
            fileLink.removeAttribute('aria-disabled');
            fileLink.style.pointerEvents = '';
        } else {
            fileLink.removeAttribute('href');
            fileLink.setAttribute('aria-disabled', 'true');
            fileLink.style.pointerEvents = 'none';
        }
    } else {
        attachArea.classList.add('hidden');
    }

    // 수정·삭제는 작성자·관리자만(규칙과 같은 조건) — 못 하는 사람에게는 버튼을 보이지 않는다
    const editable = canEditManual(item);
    document.getElementById('btn-edit-manual').classList.toggle('hidden', !editable);
    document.getElementById('btn-delete-manual').classList.toggle('hidden', !editable);

    writeManualHash(id);
}

// 보던 매뉴얼을 닫는다(삭제 뒤 등) — 빈 화면으로 돌리고 주소의 #id= 를 뺀다
function closeManualView() {
    document.getElementById('viewer-content').classList.add('hidden');
    document.getElementById('viewer-empty').classList.remove('hidden');
    currentEditingId = null;
    writeManualHash('');
}

async function deleteManual() {
    const item = manualList.find(m => m.id === currentEditingId);
    if (!item) return;
    if (!canEditManual(item)) { alert(EDIT_DENIED_MSG); return; }
    if (!confirm("이 매뉴얼을 정말로 삭제하시겠습니까?\n(복구할 수 없습니다)")) return;

    try {
        await deleteDoc(doc(db, 'artifacts', 'team-work-logger-v2', 'manuals', currentEditingId));
        closeManualView();
        await loadManuals();
    } catch(e) {
        alert(e && e.code === 'permission-denied'
            ? `삭제 권한이 없습니다. ${EDIT_DENIED_MSG}`
            : `삭제에 실패했습니다 — ${friendlyFirebaseError(e)}`);
    }
}