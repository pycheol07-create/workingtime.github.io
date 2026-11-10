// === js/approval.js ===
// 기안서(approval.html) 진입점 — 로그인 게이트 · 관리자 판정 · 목록·작성·보기·결재·인쇄·양식 관리. 2026-11-05.
// 설계: 기안서 architect 확정안(2026-11-05). 순수 계산은 js/lib/approval-logic.js, 알림은 js/lib/approval-noti.js.
//
// 화면(해시): #              목록 — [내 기안] [결재할 문서](지정 결재자·관리자) [전체](관리자). 행마다 [보기][수정][회수][삭제]
//             #new           양식 고르기        #new=<formId>  새로 작성
//             #d=<id>        보기(A4 미리보기·결재·인쇄)        #e=<id>  고치기(작성자, 임시저장·반려 건)
//             #forms         양식 관리(관리자)  #forms=<formId> 양식 편집
// 관리자 판정 = mainConfig.memberRoles[소문자 이메일]==='admin' (규칙 isAdmin() 과 같음). 화면을 가리는 장치일 뿐, 읽기·결재는 firestore.rules 가 막는다.
// 도장 이름 = mainConfig.memberEmails 에서 내 이메일로 찾은 이름(규칙도 같은 표로 확인). 없으면 작성·결재를 막고 안내한다.
// 근태사유서 '발생일' → 그날 내 지각 기록을 **읽기만** 해서 빈 칸에 넣는다(daily_data/오늘 · history/지난 날). 근태 쓰기 경로 없음.
// ⚠️ role="dialog"·data-act 를 쓰지 않는다(업무마감봇·업무예상알림이 그 선택자로 확인창을 찾는다). 반려 의견은 화면 안 칸에서 받는다.
// 이름·이메일·기안 내용은 콘솔에 남기지 않는다(오류 코드만).
// 2026-11-05 추가: 결재자 지정(관리자 또는 직책 파트장·부팀장·팀장 — 제출 때 필수, 알림은 지정 결재자에게만), 관리자 대신 결재(대결),
//   파일 첨부(칸 종류 file — Storage approvals/{문서id}/…, storage.rules). 첨부는 getBlob(로그인 요청)으로만 연다 — 공개 토큰 주소(getDownloadURL)는 쓰지 않는다.
//   운영 버킷에서 getBlob 이 되려면 CORS 설정이 필요하다(tools/storage-cors.json, 적용 방법은 storage.rules approvals 주석).
// 2026-11-05 결재선: 결재자 1~3명 순서대로(approvers·step·stamps — js/lib/approval-logic.js). 차례인 결재자만 승인·반려(관리자는 대결),
//   알림은 제출 때 1차, 단계 승인 때 다음 결재자, 최종 승인·반려 때 작성자. 결재선에 있는 사람은 제출 뒤 열람(목록 쿼리 approverEmails array-contains).
import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, getDocFromServer, collection, query, where, orderBy, limit, addDoc, setDoc, deleteDoc,
    runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeFirebase } from './config.js?v=202611101659';
import { getStorage, ref as sRef, uploadBytes, getBlob, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { emulatorEnabled, connectStorageEmulatorIfEnabled } from './firebase-emulator.js?v=202611101659';
import { setShellContext, onBeforeLeave, leaveAlreadyConfirmed } from './app-shell-bridge.js?v=202611101659';
import { memberNameFor } from './app-shell-data.js?v=202611101659';
import { DEFAULT_FORMS, STATUS, FIELD_TYPES, BOX_ROLES, MAX_FIELDS, MAX_BOXES, COMMENT_MAX, mergeForms, normalizeForm, validateForm,
    validateValues, cleanValues, actionsFor, buildCreate, buildSave, buildSubmit, buildWithdraw, buildDecision,
    tardyPrefill, printFitLevel, stampTime, sortDocs, docTitle, newFormId, lower, approverCandidates, whyNot,
    checkAttach, attachPath, attachMeta, fmtBytes, ATTACH_MAX, ATTACH_ACCEPT, attachTypeOf,
    ATTACH_AFTER_TOTAL, afterAttachMeta, splitAttachments, afterPrintText,
    CC_MAX, ccsOf, inCc, checkCcs, ccCandidates,
    approversOf, stepOf, stampsOf, currentApprover, inLine, isTurn, checkApprovers, APPROVERS_MAX, buildDecisionStep, decisionNoti, sheetBoxes } from './lib/approval-logic.js?v=202611101659';
import { sendApprovalNoti, MSG_TO_APPROVER, MSG_TO_AUTHOR, MSG_TO_CC } from './lib/approval-noti.js?v=202611101659';

const $ = (id) => document.getElementById(id);
const APP_BASE = 'artifacts/team-work-logger-v2';
const DOCS = 'ApprovalDocs', FORMS = 'ApprovalForms';
const ADMIN_LIST_LIMIT = 200;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tsMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (t instanceof Date ? t.getTime() : 0));
const S = { app: null, db: null, auth: null, storage: null, email: '', name: null, nameIssue: '', printHtml: null, isAdmin: false, cfg: {}, forms: [], docs: [],
    filter: null, scope: null, dirty: false, formsDenied: false };
// Storage — 처음 쓸 때 만든다(에뮬레이터면 첫 업로드 전에 붙인다. 연결 실패면 던져서 운영으로 안 올린다)
const storage = () => {
    if (!S.storage) { const st = getStorage(S.app); connectStorageEmulatorIfEnabled(st); S.storage = st; }
    return S.storage;
};
const isAssigned = (d) => inLine(d, S.email);          // 결재선에 있나
const myTurn = (d) => isTurn(d, S.email);               // 지금 내 차례인가
const canDecideList = (d) => d.status !== 'draft' && (S.isAdmin || isAssigned(d));
// 결재선 글 — '팀장A → 관리자A' (차례인 사람은 굵게, 승인한 단계는 ✓). html
const lineHtml = (d) => {
    const line = approversOf(d);
    if (!line.length) return '-';
    const step = stepOf(d), cur = currentApprover(d);
    return line.map((a, i) => {
        const done = i < step && (d.status === 'submitted' || d.status === 'approved' || d.status === 'rejected');
        const now = cur && i === step;
        return `<span class="ap-line-who${now ? ' is-now' : ''}">${done ? '✓ ' : ''}${esc(a.name)}</span>`;
    }).join('<span class="pd-mute"> → </span>');
};

let toastTimer = null;
function toast(msg, ms = 2800) {
    const el = $('pd-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
// 도장 이름을 못 쓰는 까닭 — 'none'(명단에 없음) | 'space'(팀원 관리 이메일 앞뒤에 빈칸: 규칙은 공백을 못 지워 저장이 막힌다)
const nameWarnText = () => S.nameIssue === 'space'
    ? '팀원 관리에 적힌 이 계정 이메일 앞뒤에 빈칸이 있어 도장을 찍을 수 없습니다. 작성·제출·결재가 막힙니다 — 관리자에게 팀원 관리의 이메일 칸을 고쳐 달라고 하세요.'
    : '직원 명단에서 이 계정의 이름을 찾지 못해 도장을 찍을 수 없습니다. 작성·제출·결재가 막힙니다 — 관리자에게 팀원 관리의 이메일을 확인해 달라고 하세요.';
const setLoading = (on, text) => { $('pd-loading').style.display = on ? 'flex' : 'none'; if (text) $('pd-loading-text').textContent = text; };
const errText = (e) => (e && e.code === 'permission-denied' ? '권한이 없습니다(규칙 게시 전이거나 상태가 바뀌었을 수 있습니다)' : (e && e.message) || '알 수 없는 오류');

// 한국 날짜 'YYYY-MM-DD'
const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const dayText = (ms) => (ms ? kstDay(ms).replace(/-/g, '.') : '');

// ── 로그인 게이트 (products.js 와 같은 틀) ───────────────────────
const GATE_ID = 'ap-auth-gate';
const GATE_STYLE = `position:fixed; inset:var(--as-h,0px) 0 0 0; z-index:2147483600; background:var(--c-bg,#F5F6F8);
    display:flex; overflow-y:auto; -webkit-overflow-scrolling:touch;
    font-family:var(--font-sans,'SUIT','Noto Sans KR','Malgun Gothic',sans-serif); color:var(--c-text,#23272E); text-align:center;`;
const GATE_INNER = `margin:auto; display:flex; flex-direction:column; align-items:center; gap:10px; padding:24px; width:100%; box-sizing:border-box;`;
const removeGate = () => { $(GATE_ID)?.remove(); document.documentElement.style.overflow = ''; };
function showGate(html) {
    removeGate();
    const el = document.createElement('div');
    el.id = GATE_ID;
    el.style.cssText = GATE_STYLE;
    el.innerHTML = `<div style="${GATE_INNER}">${html}</div>`;
    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';
    return el;
}
function showLogin(auth) {
    const inStyle = 'padding:11px 12px; border:1px solid var(--c-line-strong,#D6DAE0); border-radius:10px; font-size:15px; font-family:inherit; background:var(--c-surface,#FFFFFF); color:var(--c-text,#23272E);';
    const el = showGate(`
        <div style="font-size:17px; font-weight:600;">로그인이 필요합니다</div>
        <div style="font-size:12.5px; color:var(--c-text-2,#646B75); line-height:1.7; max-width:320px;">업무관리와 같은 계정입니다.</div>
        <form id="ap-login-form" style="display:flex; flex-direction:column; gap:8px; width:100%; max-width:300px; margin-top:6px;">
            <input id="ap-email" type="email" inputmode="email" autocomplete="username" placeholder="이메일" style="${inStyle}">
            <input id="ap-pw" type="password" autocomplete="current-password" placeholder="비밀번호" style="${inStyle}">
            <button type="submit" id="ap-login-btn" style="padding:12px; border:0; border-radius:999px; background:var(--c-accent,#2F62C9); color:#fff; font-size:15px; font-weight:600; font-family:inherit; cursor:pointer;">로그인</button>
            <div id="ap-login-err" style="font-size:12px; color:var(--c-risk-text,#A0525C); min-height:16px;"></div>
        </form>
        <a href="index.html" style="font-size:12.5px; color:var(--c-accent-deep,#1E4699);">업무관리 열기</a>`);
    el.querySelector('#ap-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = el.querySelector('#ap-login-btn'), err = el.querySelector('#ap-login-err');
        btn.disabled = true; btn.textContent = '로그인 중…'; err.textContent = '';
        try {
            await signInWithEmailAndPassword(auth, el.querySelector('#ap-email').value.trim(), el.querySelector('#ap-pw').value);
        } catch (e2) {
            const code = e2 && e2.code ? e2.code : '';
            err.textContent = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code)
                ? '이메일 또는 비밀번호가 잘못되었습니다.' : `로그인 오류: ${code || '알 수 없음'}`;
            btn.disabled = false; btn.textContent = '로그인';
        }
    });
}

// ── 데이터 ───────────────────────────────────────────────
const toDoc = (snap) => {
    const d = snap.data() || {};
    return { ...d, id: snap.id, form: normalizeForm(d.form, d.formId), _ms: tsMs(d.updatedAt) || tsMs(d.createdAt) };
};
async function loadForms() {
    try {
        const snap = await getDocs(collection(S.db, FORMS));
        S.forms = mergeForms(DEFAULT_FORMS, snap.docs.map(d => ({ ...d.data(), id: d.id })));
        S.formsDenied = false;
    } catch (e) {
        console.error('[approval] 양식 읽기 실패:', e && e.code);
        S.forms = mergeForms(DEFAULT_FORMS, []);
        S.formsDenied = true;
    }
}
async function loadDocs() {
    const col = collection(S.db, DOCS);
    if (!S.isAdmin) {
        // 내 기안 + 결재선에 내가 있는 문서(규칙: 결재선 전원은 제출 뒤 읽기 가능) — id 로 합친다
        const [mine, todo] = await Promise.all([
            getDocs(query(col, where('authorEmail', '==', S.email))),
            // 결재자는 제출 이후 문서만 읽는다(규칙) — 상태 조건이 없으면 쿼리 전체가 거부된다. array-contains + in(정렬 없음)
            // 옛 단일 결재자 칸(approverEmail)만 있는 문서는 이 목록에 안 나온다 — 그 모양은 운영 규칙 게시 전이라 운영에 없다
            getDocs(query(col, where('approverEmails', 'array-contains', S.email), where('status', 'in', ['submitted', 'approved', 'rejected'])))
        ]);
        const m = new Map();
        [...mine.docs, ...todo.docs].forEach(sn => m.set(sn.id, toDoc(sn)));
        S.docs = sortDocs([...m.values()]);
        return;
    }
    // 참조 문서 — 참조자는 관리자만이라 이 분기에서만 읽는다. 실패해도 다른 목록은 그대로(규칙 게시 전·색인 문제 등)
    const ccLoad = getDocs(query(col, where('ccEmails', 'array-contains', S.email), where('status', 'in', ['submitted', 'approved', 'rejected'])))
        .catch(e => { console.error('[approval] 참조 목록 읽기 실패:', e && e.code); return { docs: [] }; });
    // 관리자: 최근 바뀐 200건 + 결재 대기 전부(오래 묵은 결재 대기가 200건 밖으로 밀려 빠지지 않게) — id 로 합친다
    const [recent, waiting] = await Promise.all([
        getDocs(query(col, orderBy('updatedAt', 'desc'), limit(ADMIN_LIST_LIMIT))),
        getDocs(query(col, where('status', '==', 'submitted')))
    ]);
    const ccDocs = await ccLoad;
    const byId = new Map();
    [...recent.docs, ...waiting.docs, ...ccDocs.docs].forEach(sn => byId.set(sn.id, toDoc(sn)));
    S.docs = sortDocs([...byId.values()]);
}
async function refresh() {
    setLoading(true, '불러오는 중…');
    try {
        await Promise.all([loadForms(), loadDocs()]);
    } catch (e) {
        console.error('[approval] 목록 읽기 실패:', e && e.code);
        toast('기안서를 읽지 못했습니다 — ' + errText(e), 6000);
    } finally {
        setLoading(false);
    }
    route();
}
const findDoc = (id) => S.docs.find(d => d.id === id) || null;
async function fetchDoc(id) {
    const snap = await getDoc(doc(S.db, DOCS, id));
    if (!snap.exists()) return null;
    const d = toDoc(snap);
    const i = S.docs.findIndex(x => x.id === id);
    if (i > -1) S.docs[i] = d; else S.docs.unshift(d);
    return d;
}

// ── 머리 ─────────────────────────────────────────────────
function setHead({ title = '기안서', back = false, tab = 'list' } = {}) {
    $('ap-title').textContent = title;
    $('ap-back').style.display = back ? 'inline-block' : 'none';
    $('ap-head-sub').style.display = back ? 'none' : 'block';
    document.querySelectorAll('#ap-tabs .d-seg-btn').forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab));
    document.title = title === '기안서' ? '기안서' : `${title} — 기안서`;
}

// ── 이탈 확인(작성 중) ─────────────────────────────────────
const okLeave = () => {
    if (!S.dirty) return true;
    if (!confirm('작성 중인 내용이 저장되지 않았습니다.\n저장하지 않고 넘어갈까요?')) return false;
    S.dirty = false;
    return true;
};
window.addEventListener('beforeunload', (e) => {
    if (!S.dirty || leaveAlreadyConfirmed()) return;
    e.preventDefault();
    e.returnValue = '';
});
onBeforeLeave(okLeave);

// ── 화면 전환 ─────────────────────────────────────────────
function route() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    const main = $('pd-main');
    S.dirty = false;
    S.printHtml = null;   // 보기 화면(renderView)만 채운다
    window.scrollTo(0, 0);
    if (h === 'forms' || h.startsWith('forms=')) {
        if (!S.isAdmin) { location.hash = ''; return; }
        return h === 'forms' ? renderFormsList(main) : renderFormEditor(main, h.slice(6));
    }
    if (h === 'new') return renderPick(main);
    if (h.startsWith('new=')) return renderEditor(main, { formId: h.slice(4) });
    if (h.startsWith('d=')) return renderView(main, h.slice(2));
    if (h.startsWith('e=')) return renderEditor(main, { id: h.slice(2) });
    renderList(main);
}

// ── 목록 ─────────────────────────────────────────────────
const pill = (status) => {
    const cls = { draft: 'd-pill-mute', submitted: 'd-pill-warn', approved: 'd-pill-ok', rejected: 'd-pill-risk' }[status] || 'd-pill-mute';
    return `<span class="${cls}">${esc(STATUS[status] || status)}</span>`;
};
// 작성자 버튼 — 되면 누를 수 있고, 안 되면 흐리게(is-off) + 툴팁(까닭). disabled 를 쓰지 않는다 — 눌렀을 때 까닭을 띄우려고(터치 화면은 툴팁이 없다).
// 다른 사람 문서에는 [보기]만 — 관리자는 [삭제]도(모든 상태, 2026-11-10 사용자 결정).
function ownBtns(d, big = false) {
    const cls = big ? 'd-btn ap-big' : 'd-btn d-btn-sm';
    const b = (act, label, extra = '') => {
        const why = whyNot(d, S.email, S.isAdmin, act);
        return `<button class="${cls} ${extra}${why ? ' is-off' : ''}" data-row-act="${act}" data-id="${esc(d.id)}"${why ? ` title="${esc(why)}" aria-disabled="true"` : ''}>${label}</button>`;
    };
    if (d.authorEmail !== S.email) return actionsFor(d, S.email, S.isAdmin).includes('delete') ? b('delete', '삭제', 'd-btn-risk') : '';
    return b('edit', '수정') + b('withdraw', '회수') + b('delete', '삭제', 'd-btn-risk');
}
function bindRowActs(root) {
    root.querySelectorAll('[data-row-act]').forEach(btn => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.classList.contains('is-off')) { toast(btn.title, 4500); return; }
        const d = findDoc(btn.dataset.id); if (!d) return;
        const act = btn.dataset.rowAct;
        if (act === 'view') location.hash = 'd=' + encodeURIComponent(d.id);
        else if (act === 'edit') location.hash = 'e=' + encodeURIComponent(d.id);
        else if (act === 'withdraw') { if (confirm('결재 전 기안서를 회수할까요?\n임시저장으로 돌아가 고칠 수 있습니다.')) authorWrite(d.id, 'withdraw'); }
        else if (act === 'delete') deleteApproval(d);
    }));
    root.querySelectorAll('.ap-row-btns').forEach(cell => cell.addEventListener('click', (e) => e.stopPropagation()));   // 버튼 사이 빈칸을 눌러도 행 열기 안 함
}
function renderList(main) {
    setHead({ tab: 'list' });
    const mine = S.docs.filter(d => d.authorEmail === S.email);
    // 결재할 문서 — 내 차례인 것 먼저(그다음 최근 바뀐 순)
    const todo = S.docs.filter(canDecideList).sort((a, b) => (myTurn(b) - myTurn(a)) || ((b._ms || 0) - (a._ms || 0)));
    const waiting = todo.filter(d => d.status === 'submitted' && (S.isAdmin || myTurn(d))).length;
    if (S.scope == null) { S.scope = waiting ? 'todo' : 'mine'; S.filter = waiting ? 'submitted' : 'all'; }
    if (S.scope === 'all' && !S.isAdmin) S.scope = 'mine';
    const ccList = S.docs.filter(d => d.status !== 'draft' && inCc(d, S.email));   // 참조 탭은 참조 문서가 있을 때만
    if (S.scope === 'cc' && !ccList.length) S.scope = 'mine';
    const showTodo = S.isAdmin || todo.length > 0 || approverCandidates(S.cfg, '', '').some(c => c.email === S.email);
    const base = S.scope === 'all' ? S.docs : S.scope === 'todo' ? todo : S.scope === 'cc' ? ccList : mine;
    const count = (st) => base.filter(d => st === 'all' || d.status === st).length;
    const rows = base.filter(d => S.filter === 'all' || d.status === S.filter);
    const chip = (st, label) => `<button class="pd-chip${S.filter === st ? ' is-on' : ''}" data-filter="${st}">${esc(label)}<span class="num">${count(st)}</span></button>`;
    const seg = (sc, label, n) => `<button class="d-seg-btn${S.scope === sc ? ' is-on' : ''}" data-scope="${sc}">${label}${n ? ` <span class="d-pill-warn ap-seg-n">${n}</span>` : ''}</button>`;
    const nameWarn = !S.name ? `<div class="pd-alert warn" style="margin:0 24px 14px;">${esc(nameWarnText())}</div>` : '';
    const showAuthor = S.scope !== 'mine';
    main.innerHTML = `
        <section class="pd-card">
            <div class="ap-pills">
                <div class="d-seg" style="display:inline-flex;">${seg('mine', '내 기안')}${showTodo ? seg('todo', '결재할 문서', waiting) : ''}${ccList.length ? seg('cc', '참조') : ''}${S.isAdmin ? seg('all', '전체') : ''}</div><span class="pd-sep"></span>
                ${chip('all', '전체')}${chip('submitted', '결재 대기')}${S.scope === 'mine' || S.scope === 'all' ? chip('draft', '임시저장') : ''}${chip('rejected', '반려')}${chip('approved', '승인')}
            </div>
            ${nameWarn}
            ${rows.length ? `<div class="pd-scroll"><table class="pd-t ap-t">
                <thead><tr><th>상태</th><th>종류·제목</th>${showAuthor ? '<th>작성자</th>' : ''}<th>결재자</th><th>제출</th><th>최근 변경</th><th></th></tr></thead>
                <tbody>${rows.map(d => `<tr class="pd-click" data-id="${esc(d.id)}">
                    <td>${pill(d.status)}</td>
                    <td class="ap-title-cell">${esc(docTitle(d))}${(d.attachments || []).length ? ` <span class="pd-mute" title="첨부 ${d.attachments.length}개">📎${d.attachments.length}</span>` : ''}</td>
                    ${showAuthor ? `<td data-label="작성자">${esc(d.authorName)}${d.authorEmail === S.email ? '<span class="d-pill-accent ap-self">본인 기안</span>' : ''}</td>` : ''}
                    <td data-label="결재자">${lineHtml(d)}${myTurn(d) ? '<span class="d-pill-warn ap-self">내 차례</span>' : isAssigned(d) ? '<span class="d-pill-accent ap-self">나</span>' : ''}</td>
                    <td class="num" data-label="제출">${esc(dayText(tsMs(d.submittedAt)))}</td>
                    <td class="num" data-label="최근 변경">${esc(stampTime(d._ms))}</td>
                    <td class="ap-row-btns"><button class="d-btn d-btn-sm" data-row-act="view" data-id="${esc(d.id)}">보기</button>${ownBtns(d)}${actionsFor(d, S.email, S.isAdmin).includes('approve') ? `<button class="d-btn d-btn-sm d-btn-primary" data-row-act="view" data-id="${esc(d.id)}">${myTurn(d) || !currentApprover(d) ? '결재' : '대결'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
            : `<div class="ap-list-empty">${base.length ? '이 상태의 기안서가 없습니다.' : S.scope === 'todo' ? '결재할 기안서가 없습니다.' : '아직 작성한 기안서가 없습니다.<br>위의 [새 기안] 으로 시작하세요.'}</div>`}
            ${S.isAdmin && S.docs.length >= ADMIN_LIST_LIMIT ? `<div class="pd-note" style="padding:0 24px 16px;">최근 ${ADMIN_LIST_LIMIT}건과 결재 대기 전부가 보입니다.</div>` : ''}
        </section>`;
    main.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { S.filter = b.dataset.filter; renderList(main); }));
    main.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
        S.scope = b.dataset.scope; S.filter = S.scope === 'todo' ? 'submitted' : 'all'; renderList(main);
    }));
    main.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = 'd=' + encodeURIComponent(tr.dataset.id); }));
    bindRowActs(main);
}

function renderPick(main) {
    setHead({ title: '새 기안', back: true });
    const forms = S.forms.filter(f => f.active);
    main.innerHTML = `<section class="pd-card pd-card-pad">
        <h2 class="pd-h2">양식을 고르세요</h2>
        ${S.formsDenied ? '<div class="pd-alert warn" style="margin-top:12px;">저장된 양식을 읽지 못해 기본 양식만 보입니다.</div>' : ''}
        <div class="ap-pick" style="margin-top:16px;">${forms.map(f => `<button data-form="${esc(f.id)}"><b>${esc(f.title)}</b>
            <span>${esc(f.fields.map(x => x.label).slice(0, 5).join(' · '))}${f.fields.length > 5 ? ' …' : ''}</span></button>`).join('')
            || '<div class="pd-empty">사용 중인 양식이 없습니다.</div>'}</div></section>`;
    main.querySelectorAll('[data-form]').forEach(b => b.addEventListener('click', () => { location.hash = 'new=' + encodeURIComponent(b.dataset.form); }));
}

// ── 종이(A4) — 미리보기·인쇄·양식 편집 미리보기 공용 ─────────────────
function stampHtml(st) {
    if (!st || !st.name) return '';
    return `<span class="ap-stamp"><span class="ap-stamp-ring">${esc(st.name)}</span><span class="ap-stamp-at">${esc(stampTime(tsMs(st.at)))}</span></span>`;
}
/** meta: { authorName, createdMs, submittedMs, status, authorStamp, approvers:[{name}], stamps:[{name, at, proxy}], attachments } */
function sheetHtml(form, values, meta = {}) {
    const v = values || {};
    const ccs = meta.ccs || [];
    const fit = printFitLevel(form, v, ccs.length ? 1 : 0);   // 참조 줄이 있으면 한 줄 더
    const line = meta.approvers || [];
    const stamps = meta.stamps || [];
    const boxes = sheetBoxes(form.boxes || [], line, stamps, meta.authorStamp);   // 결재자 칸은 결재선 인원만큼
    const proxies = stamps.map((s, i) => (s && s.proxy ? `${i + 1}차 ${s.name || ''}` : '')).filter(Boolean);
    const st = meta.status && meta.status !== 'approved' ? `<div class="ap-sheet-status">(${esc(STATUS[meta.status] || '')}${meta.status === 'submitted' ? (line.length > 1 ? ` — ${(meta.step || 0) + 1}차 결재 전` : ' — 결재 전') : ''})</div>` : '';
    const dateMs = meta.submittedMs || meta.createdMs || 0;
    const afterText = afterPrintText(splitAttachments(meta.attachments).after);
    return `<div class="ap-sheet fit-${fit.level}" data-over="${fit.over ? 1 : 0}">
        <div class="ap-sheet-top">
            <div style="flex:1;"><h2>${esc(form.title)}</h2>${st}</div>
            ${boxes.length ? `<table class="ap-boxes${boxes.length > 3 ? ' is-many' : ''}"><tr>${boxes.map(b => `<th>${esc(b.label)}</th>`).join('')}</tr>
                <tr>${boxes.map(b => `<td>${stampHtml(b.stamp)}${b.proxy && b.stamp ? '<span class="ap-proxy">대결</span>' : ''}</td>`).join('')}</tr></table>` : ''}
        </div>
        <table class="ap-info"><tr><th>성명</th><td>${esc(meta.authorName || '')}</td><th>작성일</th><td class="num">${esc(dayText(meta.createdMs))}</td></tr>
            <tr><th>결재자</th><td colspan="3">${esc(line.map(a => a.name).join(' → '))}${proxies.length ? ` <span class="ap-proxy-note">(대결 ${esc(proxies.join(', '))})</span>` : ''}</td></tr>${ccs.length ? `
            <tr><th>참조</th><td colspan="3">${esc(ccs.map(a => a.name).join(', '))}</td></tr>` : ''}</table>
        ${form.intro ? `<div class="ap-intro">${esc(form.intro)}</div>` : ''}
        <table class="ap-body">${form.fields.map(f => `<tr><th>${esc(f.label)}</th><td class="${f.type === 'textarea' ? 'is-long' : ''}">${f.type === 'file' ? esc(attachText(meta.attachments, f.key)) : esc(v[f.key] || '')}</td></tr>`).join('')}</table>
        ${form.pledge ? `<div class="ap-pledge">${esc(form.pledge)}</div>` : ''}
        <div class="ap-sign"><span class="num">${esc(dateMs ? kstDay(dateMs).replace(/^(\d+)-(\d+)-(\d+)$/, (m, y, mo, d) => `${y}년 ${Number(mo)}월 ${Number(d)}일`) : '')}</span><br>
            작성자&nbsp;&nbsp;${esc(meta.authorName || '')}</div>
        ${afterText ? `<div class="ap-after">승인 후 추가(결재 대상 아님): ${esc(afterText)}</div>` : ''}
    </div>`;
}
const metaOf = (d) => ({ authorName: d.authorName, createdMs: tsMs(d.createdAt), submittedMs: tsMs(d.submittedAt), status: d.status,
    authorStamp: d.authorStamp, approvers: approversOf(d), ccs: ccsOf(d), stamps: stampsOf(d), step: stepOf(d), attachments: d.attachments || [] });
// 인쇄의 파일 칸 — '첨부 2개: a.pdf, b.jpg'. 승인 후 추가는 서명 아래 따로(양식 칸 키가 'after' 여도 섞이지 않게)
const attachText = (list, key) => {
    const a = (list || []).filter(x => x && x.key === key && x.addedAfter !== true);
    return a.length ? `첨부 ${a.length}개: ${a.map(x => x.name).join(', ')}` : '';
};

// 인쇄할 종이를 #print-root 에 넣고 body.ap-print 를 켠다(css 가 그때만 나머지를 숨긴다). 보기 화면이 아니면(printHtml 없음) 화면 그대로 인쇄.
function fillPrintRoot(html) {
    const root = $('print-root');
    root.innerHTML = html || '';
    document.body.classList.toggle('ap-print', !!html);
    return root;
}
function printSheet(html) {
    const root = fillPrintRoot(html);
    if (root.querySelector('[data-over="1"]')) toast('글이 길어 A4 한 장을 넘을 수 있습니다 — 미리보기에서 확인하세요', 4500);
    setTimeout(() => { window.print(); }, 50);
}
// Ctrl+P·브라우저 메뉴 인쇄 — 보기 화면이면 그 문서를 채운다(빈 종이가 나오지 않게)
window.addEventListener('beforeprint', () => { if (!document.body.classList.contains('ap-print') && S.printHtml) fillPrintRoot(S.printHtml); });
window.addEventListener('afterprint', () => fillPrintRoot(''));

// ── 보기 ─────────────────────────────────────────────────
const ACT_LABEL = { submit: '제출', resubmit: '재제출', withdraw: '회수', approve: '승인', reject: '반려' };
async function renderView(main, id) {
    let d = findDoc(id);
    if (!d) {
        try { d = await fetchDoc(id); } catch (e) { console.error('[approval] 문서 읽기 실패:', e && e.code); }
    }
    if (!d) { setHead({ title: '기안서', back: true }); main.innerHTML = '<div class="pd-card pd-empty">기안서를 찾지 못했습니다(지워졌거나 볼 권한이 없습니다).</div>'; return; }
    setHead({ title: docTitle(d), back: true });
    S.printHtml = sheetHtml(d.form, d.values, metaOf(d));
    const acts = actionsFor(d, S.email, S.isAdmin);
    const selfDoc = d.authorEmail === S.email;
    const cur = currentApprover(d);
    const proxyNow = acts.includes('approve') && !!cur && !myTurn(d);   // 관리자가 차례 결재자 대신
    const dec = d.decision;
    const atts = d.attachments || [];
    const { before: attBefore, after: attAfter } = splitAttachments(atts);
    const canAddAfter = acts.includes('addAfter');
    const afterFull = atts.length >= ATTACH_AFTER_TOTAL;
    const line = approversOf(d), stamps = stampsOf(d), step = stepOf(d);
    // 결재 진행 — 1차 ✓ 이름 일시 → 2차 대기 …
    const progHtml = line.length ? `<section class="pd-card pd-card-pad"><h3 class="pd-h3">결재선</h3><ol class="ap-prog">${line.map((a, i) => {
        const s = stamps[i];
        const state = s ? `<span class="d-pill-ok">승인</span> <span class="num pd-mute">${esc(stampTime(tsMs(s.at)))}</span>${s.proxy ? ` <span class="ap-proxy-note">(대결 ${esc(s.name || '')})</span>` : ''}`
            : d.status === 'rejected' && i === step ? '<span class="d-pill-risk">반려</span>'
            : d.status === 'submitted' && i === step ? '<span class="d-pill-warn">차례</span>'
            : d.status === 'draft' ? '' : '<span class="pd-mute">대기</span>';
        const said = s && s.comment ? `<div class="ap-decision">${esc(s.comment)}</div>` : '';
        return `<li class="${d.status === 'submitted' && i === step ? 'is-now' : ''}"><span class="ap-prog-n">${i + 1}차</span><span class="ap-prog-who">${esc(a.name)}${a.email === S.email ? ' <span class="d-pill-accent ap-self">나</span>' : ''}</span><span class="ap-prog-st">${state}</span>${said}</li>`;
    }).join('')}</ol></section>` : '';
    // 참조자 — 이메일은 보이지 않게 이름만
    const ccs = ccsOf(d);
    const ccHtml = ccs.length ? `<section class="pd-card pd-card-pad"><h3 class="pd-h3">참조 ${ccs.length}명</h3><ul class="ap-hist">${ccs.map(c => `<li><span>${esc(c.name)}${c.email === S.email ? ' <span class="d-pill-accent ap-self">나</span>' : ''}</span></li>`).join('')}</ul>
        ${inCc(d, S.email) ? '<div class="pd-note" style="margin-top:8px;">참조로 지정된 기안서입니다. 결재 순서와는 별개로 내용과 첨부를 읽고 인쇄할 수 있습니다.</div>' : ''}</section>` : '';
    main.innerHTML = `
        <section class="pd-card ap-toolbar">
            <div class="pd-row ap-toolrow">${pill(d.status)}${selfDoc && (S.isAdmin || isAssigned(d)) ? '<span class="d-pill-accent">본인 기안</span>' : ''}
                <span class="pd-note">결재자 ${line.length ? esc(line.map(a => a.name).join(' → ')) : '(지정 안 함)'}${cur && line.length > 1 ? ` · 지금 ${step + 1}차(${esc(cur.name)})` : ''}</span><span class="pd-note num">${esc(stampTime(d._ms))}</span><span class="pd-grow"></span>
                <span class="ap-actions-big">
                ${ownBtns(d, true)}
                ${acts.includes('submit') ? `<button class="d-btn ap-big d-btn-primary" data-act-btn="submit">${d.status === 'rejected' || d.decision ? '재제출' : '제출'}</button>` : ''}
                ${canAddAfter ? `<label id="ap-after-btn" class="d-btn ap-big ap-file-pick${afterFull ? ' is-off' : ''}"${afterFull ? ` title="첨부는 ${ATTACH_AFTER_TOTAL}개까지입니다."` : ''}>증빙 추가<input id="ap-after-pick" type="file" accept="${ATTACH_ACCEPT}" multiple ${afterFull ? 'disabled' : ''} hidden></label>` : ''}
                ${acts.includes('print') ? '<button class="d-btn ap-big" data-act-btn="print">인쇄 / PDF</button>' : ''}
                </span></div>
            ${d.status === 'submitted' && selfDoc ? `<div class="pd-note">${step === 0 && !stamps.length ? '아무도 결재하기 전에는 [회수] 해서 고칠 수 있습니다.' : '결재가 진행 중이라 회수할 수 없습니다 — 결재자가 반려하면 고칠 수 있습니다.'}</div>` : ''}
        </section>
        <div class="ap-view">
        <section class="pd-card pd-card-pad"><div class="ap-sheet-wrap" id="ap-sheet-box">${S.printHtml}</div></section>
        <aside class="ap-side">
            ${acts.includes('approve') ? `<section class="pd-card pd-card-pad">
                <h3 class="pd-h3">결재${line.length > 1 ? ` <small class="pd-note">(${step + 1}차 / ${line.length}차)</small>` : ''}</h3>
                ${proxyNow ? `<div class="pd-alert warn" style="margin-top:10px;">지금 차례는 ${line.length > 1 ? `${step + 1}차 ` : ''}${esc(cur.name)} 입니다. 관리자로서 <b>대신 결재(대결)</b> 하면 인쇄에 '대결' 로 남습니다.</div>` : ''}
                ${line.length > 1 && step + 1 < line.length ? `<div class="pd-note" style="margin-top:8px;">승인하면 다음 ${step + 2}차 결재자(${esc(line[step + 1].name)})에게 넘어갑니다.</div>` : ''}
                ${selfDoc ? '<div class="pd-alert info" style="margin-top:10px;">본인이 쓴 기안서입니다. 본인 결재도 기록에 남습니다.</div>' : ''}
                ${!S.name ? `<div class="pd-alert warn" style="margin-top:10px;">${esc(nameWarnText())}</div>` : ''}
                <label class="pd-field" style="margin-top:12px;"><span>결재 의견 <small>(반려는 필수, ${COMMENT_MAX}자까지)</small></span>
                    <textarea id="ap-comment" class="pd-in" maxlength="${COMMENT_MAX}"></textarea></label>
                <div class="ap-actions" style="margin-top:12px;">
                    <button class="d-btn d-btn-primary" data-decide="approve" ${S.name ? '' : 'disabled'}>${proxyNow ? '대결 승인' : '승인'}</button>
                    <button class="d-btn d-btn-risk" data-decide="reject" ${S.name ? '' : 'disabled'}>${proxyNow ? '대결 반려' : '반려'}</button>
                </div>
            </section>` : ''}
            ${progHtml}
            ${ccHtml}
            ${attBefore.length ? `<section class="pd-card pd-card-pad"><h3 class="pd-h3">${d.status === 'approved' ? '결재 때 첨부' : '첨부'} ${attBefore.length}개</h3>${attachListHtml(attBefore, false)}</section>` : ''}
            ${attAfter.length || canAddAfter ? `<section class="pd-card pd-card-pad" id="ap-after-box"><h3 class="pd-h3">승인 후 추가 <small class="pd-note">(결재 대상 아님)</small></h3>
                ${attAfter.length ? attachListHtml(attAfter, false) : '<div class="pd-note" style="margin-top:8px;">추가한 파일이 없습니다.</div>'}
                ${canAddAfter ? `<div class="pd-note" style="margin-top:8px;">이미지·PDF·엑셀·워드·한글, 파일당 10MB, 기안서 하나에 ${ATTACH_AFTER_TOTAL}개까지 (${atts.length}/${ATTACH_AFTER_TOTAL}). 올리면 지울 수 없습니다.</div>` : ''}</section>` : ''}
            ${dec && !(d.status === 'submitted' && stamps.length) ? `<section class="pd-card pd-card-pad">
                <h3 class="pd-h3">${d.status === 'approved' ? '승인 의견' : d.status === 'rejected' ? '반려 의견' : '최근 결재 의견'}</h3>
                <div class="pd-note" style="margin-top:4px;">${esc(dec.byName || '')}${dec.proxy ? ' (대결)' : ''} · ${esc(stampTime(tsMs(dec.at)))}${d.status !== 'approved' && d.status !== 'rejected' ? ' (반려 뒤 다시 냄)' : ''}</div>
                <div class="ap-decision">${esc(dec.comment || '(의견 없음)')}</div>
            </section>` : ''}
            ${(d.history || []).length ? `<section class="pd-card pd-card-pad"><h3 class="pd-h3">처리 이력</h3>
                <ul class="ap-hist">${d.history.map(x => `<li><span>${esc(ACT_LABEL[x.act] || x.act)}</span><span class="num pd-mute">${esc(stampTime(tsMs(x.at)))}</span></li>`).join('')}</ul></section>` : ''}
        </aside></div>`;
    const on = (act, fn) => main.querySelector(`[data-act-btn="${act}"]`)?.addEventListener('click', fn);
    bindRowActs(main);
    bindAttachOpen(main, d);
    $('ap-after-btn')?.addEventListener('click', (e) => { if (e.currentTarget.classList.contains('is-off')) toast(e.currentTarget.title, 4500); });
    $('ap-after-pick')?.addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addAfterFiles(d, fs); });
    on('print', () => printSheet(S.printHtml));
    on('submit', () => {
        const ln = approversOf(d);
        const apErr = checkApprovers(ln, S.email);
        if (apErr.length) { toast(`${apErr[0]} — [수정] 에서 결재자를 고른 뒤 제출하세요`, 4500); return; }
        // 반려 뒤 결재자의 직책이 바뀌었거나 퇴사했으면 규칙이 막는다 — '권한 없음' 대신 무엇을 고칠지 알려 준다
        const candEmails = new Set(approverCandidates(S.cfg, S.name, S.email).map(c => c.email));
        const gone = ln.filter(a => !candEmails.has(lower(a.email)));
        if (gone.length) { toast(`${gone.map(a => a.name).join('·')} 님은 지금 결재자로 지정할 수 없습니다(직책·퇴사 변경) — [수정] 에서 결재자를 다시 고르세요`, 5500); return; }
        // 참조자도 같은 검사 — 퇴사·권한 변경, 결재자와 겹침
        const ccNow = ccsOf(d);
        const ccOk = new Set(ccCandidates(S.cfg, S.name, S.email).map(c => c.email));
        const ccGone = ccNow.filter(a => !ccOk.has(a.email));
        if (ccGone.length) { toast(`${ccGone.map(a => a.name).join('·')} 님은 지금 참조자로 지정할 수 없습니다(권한·퇴사 변경) — [수정] 에서 참조자를 다시 고르세요`, 5500); return; }
        const ccErr = checkCcs(ccNow, S.email, ln);
        if (ccErr.length) { toast(`${ccErr[0]} — [수정] 에서 참조자를 고쳐 주세요`, 4500); return; }
        const errs = validateValues(d.form, d.values, d.attachments);
        if (errs.length) { toast('빈 필수 칸이 있습니다 — [수정] 에서 채워 주세요', 4000); return; }
        if (!confirm(`이 기안서를 제출할까요?\n결재 순서: ${ln.map(a => a.name).join(' → ')}${ccNow.length ? `\n참조: ${ccNow.map(a => a.name).join(', ')}` : ''}\n제출하면 1차 결재자(${ln[0].name})에게 알림이 갑니다.`)) return;
        authorWrite(d.id, 'submit');   // 값은 트랜잭션 안에서 읽은 서버 값(화면의 옛 값으로 덮지 않게)
    });
    main.querySelectorAll('[data-decide]').forEach(b => b.addEventListener('click', () => decide(d.id, b.dataset.decide, $('ap-comment').value)));
}

// 기안서 삭제 — 작성자의 임시저장, 또는 관리자(누구 문서든 모든 상태, 2026-11-10).
//   첨부 파일을 먼저 지운다(문서를 먼저 지우면 Storage 규칙이 문서를 못 읽어 작성자는 파일을 못 지운다).
//   첨부 목록은 지우기 직전 서버 값 — 목록을 연 뒤 붙은 승인 후 증빙까지 지운다.
async function deleteApproval(d) {
    const ownDraft = d.authorEmail === S.email && d.status === 'draft';
    const who = d.authorEmail === S.email ? '본인' : `작성자 ${d.authorName || '직원'}`;   // 이름은 화면에 이미 있는 값만
    const msg = ownDraft ? '이 임시저장 기안서를 지울까요? 첨부 파일도 함께 지워지고 되돌릴 수 없습니다.'
        : `[${STATUS[d.status] || d.status}] 기안서(${who})를 지울까요?\n\n결재 이력·의견·첨부가 모두 사라지고 되돌릴 수 없습니다.`;
    if (!confirm(msg)) return;
    setLoading(true, '지우는 중…');
    try {
        const snap = await getDocFromServer(doc(S.db, DOCS, d.id));
        const atts = snap.exists() ? (snap.data().attachments || []) : (d.attachments || []);
        for (const a of atts) {
            try { await deleteObject(sRef(storage(), a.path)); }
            catch (e) { if (!(e && e.code === 'storage/object-not-found')) throw e; }
        }
        await deleteDoc(doc(S.db, DOCS, d.id));
        S.docs = S.docs.filter(x => x.id !== d.id);
        toast('지웠습니다');
        if (location.hash) location.hash = ''; else route();
    } catch (e) {
        console.error('[approval] 삭제 실패:', e && e.code);
        toast('지우지 못했습니다 — ' + errText(e), 5000);
    } finally {
        setLoading(false);
    }
}

// ── 첨부 ─────────────────────────────────────────────────
// 추가한 사람 — 이메일은 화면에 내지 않는다(명단에서 못 찾으면 '직원')
const addedByName = (email) => memberNameFor(S.cfg.memberEmails, email) || '직원';
function attachListHtml(atts, editable) {
    const nameHtml = (a) => {
        const n = `<span class="ap-att-name" title="${esc(a.name)}">${esc(a.name)}</span>`;
        return a.addedAfter === true ? `<span class="ap-att-col">${n}<span class="ap-att-at pd-mute num">${esc(stampTime(a.addedAtMs))} · ${esc(addedByName(a.addedBy))}</span></span>` : n;
    };
    return `<ul class="ap-att">${atts.map(a => `<li>${nameHtml(a)}<span class="pd-mute num">${esc(fmtBytes(a.size))}</span>
        <button class="d-btn d-btn-sm" data-att-open="${esc(a.path)}">열기</button><button class="d-btn d-btn-sm" data-att-save="${esc(a.path)}">받기</button>${editable ? `<button class="d-btn d-btn-sm d-btn-risk" data-att-del="${esc(a.path)}">삭제</button>` : ''}</li>`).join('')}</ul>`;
}
// 열기·받기 — 로그인한 요청(getBlob, 규칙 적용)으로만 받는다. 공개 토큰 주소(getDownloadURL)는 쓰지 않는다.
// ⚠️ 보여 줄 형식은 문서 메타(a.type)가 아니라 저장 경로 확장자로 ATTACH_TYPES 에서 정한다(attachTypeOf) —
//    메타를 믿으면 text/html 등으로 바꿔 같은 출처에서 스크립트가 돌 수 있다. 표에 없으면 octet-stream(받기만).
async function attachBlobUrl(a) {
    const blob = await getBlob(sRef(storage(), a.path));
    const type = attachTypeOf(a.path);
    const url = URL.createObjectURL(new Blob([blob], { type }));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { url, viewable: type !== 'application/octet-stream' };
}
const attachErr = (e) => {
    console.error('[approval] 첨부 열기 실패:', e && e.code);
    toast(e && e.code === 'storage/unauthorized' ? '이 첨부를 볼 권한이 없습니다' : '파일을 열 수 없습니다(관리자에게 문의)', 5000);
};
const saveBlob = (url, name) => {
    const link = document.createElement('a');
    link.href = url; link.download = name || 'file'; link.rel = 'noopener';
    document.body.appendChild(link); link.click(); link.remove();
};
function bindAttachOpen(root, d) {
    root.querySelectorAll('[data-att-save]').forEach(b => b.addEventListener('click', async (e) => {
        e.preventDefault();
        const a = (d.attachments || []).find(x => x.path === b.dataset.attSave); if (!a) return;
        try { saveBlob((await attachBlobUrl(a)).url, a.name); } catch (err) { attachErr(err); }
    }));
    root.querySelectorAll('[data-att-open]').forEach(b => b.addEventListener('click', async (e) => {
        e.preventDefault();
        const a = (d.attachments || []).find(x => x.path === b.dataset.attOpen); if (!a) return;
        const viewable = attachTypeOf(a.path) !== 'application/octet-stream';
        const w = viewable ? window.open('', '_blank') : null;   // 클릭 순간에 열어 둔다(기다린 뒤 열면 팝업 차단)
        if (w) { try { w.opener = null; } catch (x) { /* 무시 */ } }
        try {
            const r = await attachBlobUrl(a);
            if (w) w.location.href = r.url; else saveBlob(r.url, a.name);
        } catch (err) {
            if (w) w.close();
            attachErr(err);
        }
    }));
}

// ── 승인 후 증빙 추가(작성자·결재선·관리자) ── 문서에서 attachments·updatedAt 만 쓴다.
//   writeAtts 를 쓰면 상태가 draft 로 돌아간다 — 전용 쓰기. 파일마다 '서버에서 확인 → 업로드 → 문서에 한 건' 순서(규칙이 한 번에 한 건만 받는다).
const AFTER_WRITE_TRIES = 3;   // 문서 쓰기 — 첫 시도 + 같은 경로로 2번 더
const afterStop = (msg) => Object.assign(new Error(msg), { stop: true });   // 다시 해도 소용없는 까닭(상태·권한·개수)
const afterGuard = (data) => {
    if (data.status !== 'approved' || !actionsFor(data, S.email, S.isAdmin).includes('addAfter')) throw afterStop('승인된 기안서에 작성자·결재자·관리자만 추가할 수 있습니다.');
    if ((data.attachments || []).length >= ATTACH_AFTER_TOTAL) throw afterStop(`첨부는 ${ATTACH_AFTER_TOTAL}개까지입니다.`);
};
const appendAfter = (id, item) => runTransaction(S.db, async (tx) => {
    const r = doc(S.db, DOCS, id);
    const sn = await tx.get(r);
    if (!sn.exists()) throw afterStop('기안서가 없습니다.');
    const cur = sn.data();
    const list = cur.attachments || [];
    if (list.some(a => a && a.path === item.path)) return;   // 앞 시도가 실제로는 적혔다(응답만 끊김) — 두 번 넣지 않는다
    afterGuard(cur);
    tx.update(r, { attachments: [...list, item], updatedAt: serverTimestamp() });
});
// 끝내 실패해도 올린 파일은 지우지 않는다 — 승인 문서 첨부는 관리자만 지울 수 있어(2026-11-10) 여기서는 지우려 하지 않고, 남는 파일은 받아들인다
//   (관리자 삭제와 증빙 추가가 겹치면 파일이 고아로 남을 수 있다 — 드물어 받아들임, 콘솔에서 지운다)
async function appendAfterRetry(id, item, fileName) {
    for (let n = 1; ; n++) {
        try { return await appendAfter(id, item); }
        catch (e) {
            if (e && e.stop) throw e;
            console.error('[approval] 증빙 문서 쓰기 실패:', e && e.code, n);
            if (n >= AFTER_WRITE_TRIES) throw afterStop(`'${fileName}' 을(를) 기안서에 적었는지 확인하지 못했습니다 — 새로고침해 목록을 확인하고, 없을 때만 다시 올려 주세요.`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}
async function addAfterFiles(d, files) {
    if (!files.length) return;
    const base = (d.attachments || []).length;
    const good = [], bad = [];
    files.forEach(f => {
        const ck = checkAttach(f, base + good.length, ATTACH_AFTER_TOTAL);
        if (ck.ok) good.push(f); else bad.push(`${f.name}: ${ck.reason}`);
    });
    if (!good.length) { toast(bad[0], 5000); return; }
    if (!confirm(`승인된 기안서에 아래 파일을 추가할까요?\n\n${good.map(f => f.name).join('\n')}\n\n올리면 지울 수 없고 작성자·결재자·관리자에게 보입니다.${bad.length ? `\n\n올리지 않는 파일:\n${bad.join('\n')}` : ''}`)) return;
    const ref = doc(S.db, DOCS, d.id);
    let done = 0;
    setLoading(true, '파일 올리는 중…');
    try {
        for (const f of good) {
            const snap = await getDocFromServer(ref);
            if (!snap.exists()) throw afterStop('기안서가 없습니다.');
            afterGuard(snap.data());
            const ck = checkAttach(f, (snap.data().attachments || []).length, ATTACH_AFTER_TOTAL);
            if (!ck.ok) throw afterStop(`${f.name}: ${ck.reason}`);
            const path = attachPath(d.id, ck.ext);
            const up = await uploadBytes(sRef(storage(), path), f, { contentType: ck.contentType });
            const item = afterAttachMeta(f, path, ck.contentType, S.email, Date.parse(up.metadata.timeCreated));   // 시각은 서버 값(PC 시계 아님)
            await appendAfterRetry(d.id, item, f.name);
            done++;
        }
        toast(`증빙 ${done}개를 추가했습니다`);
    } catch (e) {
        console.error('[approval] 증빙 추가 실패:', e && e.code);
        const why = e && e.code === 'storage/unauthorized' ? '권한이 없습니다(규칙 게시 전이거나 상태가 바뀌었을 수 있습니다)' : errText(e);
        // done 은 응답을 받은 건수라 실제보다 적을 수 있다(적혔는데 응답만 끊긴 경우) — 숫자로 말하지 않는다
        toast(`${good.length > 1 ? '일부만 추가되었을 수 있습니다. 새로고침해 목록을 확인하세요. ' : ''}증빙을 추가하지 못했습니다 — ${why}`, 7000);
    } finally {
        await fetchDoc(d.id).catch(() => null);
        setLoading(false);
        route();
    }
}

// 작성자 쓰기(제출·재제출·회수·임시저장) — 서버 문서를 다시 읽고 상태를 확인한 뒤 고친다(관리자 결재와 겹치지 않게)
async function authorWrite(id, kind, values, approvers, ccs) {
    const me = { email: S.email, name: S.name };
    const opt = { ts: serverTimestamp(), at: new Date(), approvers, ccs };   // approvers·ccs 가 undefined 면 문서의 값 그대로
    let submitted = null, ccNames = [];
    setLoading(true, '저장 중…');
    try {
        await runTransaction(S.db, async (tx) => {
            const ref = doc(S.db, DOCS, id);
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('기안서가 없습니다.');
            const cur = { ...snap.data(), form: normalizeForm(snap.data().form, snap.data().formId) };
            let patch;
            if (kind === 'save') patch = buildSave(cur, values, opt);
            else if (kind === 'submit') {
                const v = values === undefined ? (cur.values || {}) : values;
                const errs = validateValues(cur.form, v, cur.attachments);
                if (errs.length) throw new Error(errs[0]);
                patch = buildSubmit(cur, me, v, opt);
            }
            else if (kind === 'withdraw') patch = buildWithdraw(cur, me, opt);
            else throw new Error('알 수 없는 동작');
            tx.update(ref, patch);
            submitted = kind === 'submit' ? ((patch.approvers[0] || {}).name || null) : null;   // 1차 결재자
            ccNames = kind === 'submit' ? (patch.ccs || []).map(c => c.name) : [];
        });
        S.dirty = false;
        await fetchDoc(id).catch(() => null);
        toast({ save: '임시저장했습니다', submit: '제출했습니다', withdraw: '회수했습니다 — 임시저장으로 돌아갔습니다' }[kind]);
        if (submitted) await notifyApprover(submitted);
        await notifyCcs(ccNames);
        if (location.hash === '#d=' + encodeURIComponent(id)) route(); else location.hash = 'd=' + encodeURIComponent(id);
    } catch (e) {
        console.error('[approval] 저장 실패:', e && e.code);
        toast('저장하지 못했습니다 — ' + errText(e), 6000);
    } finally {
        setLoading(false);
    }
}

// 제출 알림 — 1차 결재자 한 사람에게만(문구는 내용 없는 것 그대로)
async function notifyApprover(name) {
    if (!name || name === S.name) return;
    const r = await sendApprovalNoti(S.db, { collection, addDoc }, [name], MSG_TO_APPROVER);
    if (r.failed) toast('제출은 됐지만 결재자 알림을 못 보냈습니다', 5000);
}

// 제출 알림 — 참조자에게(앱 알림만, 문구는 내용 없는 것 그대로)
async function notifyCcs(names) {
    if (!names.length) return;
    const r = await sendApprovalNoti(S.db, { collection, addDoc }, names, MSG_TO_CC);
    if (r.failed) toast('제출은 됐지만 참조자 알림을 일부 못 보냈습니다', 5000);
}

// 결재(차례 결재자·관리자 대결) — 트랜잭션으로 '결재 대기'·차례(step)를 다시 확인
async function decide(id, act, comment) {
    if (act === 'reject' && !String(comment || '').trim()) { toast('반려 의견을 입력하세요'); $('ap-comment')?.focus(); return; }
    const cd = findDoc(id);
    const cur = cd ? currentApprover(cd) : null;
    const proxy = !!(cur && cur.email !== S.email);
    const ln = cd ? approversOf(cd) : [];
    const seenStep = cd ? stepOf(cd) : 0;
    const last = seenStep + 1 >= ln.length;
    if (!confirm((proxy ? `차례 결재자(${cur.name}) 대신 결재(대결)합니다.\n` : '')
        + (act === 'approve' ? (last ? '승인할까요? 마지막 결재라 승인하면 고칠 수 없습니다.' : `승인할까요? 다음 결재자(${ln[seenStep + 1].name})에게 넘어갑니다.`)
            : '반려할까요? 작성자가 고쳐서 다시 낼 수 있습니다(다시 내면 1차부터).'))) return;
    const me = { email: S.email, name: S.name };
    let doneDoc = null, res = null;
    setLoading(true, '결재 중…');
    try {
        await runTransaction(S.db, async (tx) => {
            const ref = doc(S.db, DOCS, id);
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('기안서가 없습니다.');
            const cur = snap.data();
            if (cur.status !== 'submitted' || stepOf(cur) !== seenStep) throw new Error('그사이 상태가 바뀌었습니다(회수·다른 결재). 새로고침해 보세요.');
            res = buildDecisionStep(cur, me, act, comment, { ts: serverTimestamp(), at: new Date() });
            tx.update(ref, res.patch);
            doneDoc = cur;
        });
        toast(act === 'approve' ? (res.final ? '승인했습니다 — 결재가 끝났습니다' : '승인했습니다 — 다음 결재자에게 넘어갑니다') : '반려했습니다');
        const nt = decisionNoti(doneDoc, res, S.email);   // 단계 승인 → 다음 결재자, 최종 승인·반려 → 작성자
        if (nt) {
            const r = await sendApprovalNoti(S.db, { collection, addDoc }, [nt.to], nt.kind === 'approver' ? MSG_TO_APPROVER : MSG_TO_AUTHOR);
            if (r.failed) toast(`결재는 됐지만 ${nt.kind === 'approver' ? '다음 결재자' : '작성자'} 알림을 못 보냈습니다`, 5000);
        }
        await fetchDoc(id).catch(() => null);
        route();
    } catch (e) {
        console.error('[approval] 결재 실패:', e && e.code);
        toast('결재하지 못했습니다 — ' + errText(e), 6000);
    } finally {
        setLoading(false);
    }
}

// ── 작성·고치기 ───────────────────────────────────────────
function fieldInput(f, val) {
    const id = 'ap-f-' + f.key;
    if (f.type === 'file') return `<div class="ap-file" data-file-key="${esc(f.key)}"></div>`;
    const common = `id="${id}" class="pd-in" data-key="${esc(f.key)}"`;
    if (f.type === 'textarea') return `<textarea ${common} maxlength="${f.max}">${esc(val)}</textarea>`;
    if (f.type === 'select') return `<select ${common}><option value="">(고르세요)</option>${(f.options || []).map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    const type = f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text';
    return `<input ${common} type="${type}" value="${esc(val)}"${type === 'text' ? ` maxlength="${f.max}"` : ''}>`;
}
async function renderEditor(main, { id, formId }) {
    let d = null, form;
    if (id) {
        d = findDoc(id) || await fetchDoc(id).catch(() => null);
        if (!d || !actionsFor(d, S.email, false).includes('edit')) {
            setHead({ title: '기안서', back: true });
            main.innerHTML = '<div class="pd-card pd-empty">이 기안서는 지금 고칠 수 없습니다(제출·승인됐거나 본인 기안이 아닙니다).</div>';
            return;
        }
        form = d.form;
    } else {
        form = S.forms.find(f => f.id === formId && f.active);
        if (!form) { setHead({ title: '새 기안', back: true }); main.innerHTML = '<div class="pd-card pd-empty">양식을 찾지 못했습니다.</div>'; return; }
    }
    const vals = { ...(d ? d.values : {}) };
    setHead({ title: d ? `${form.title} 고치기` : `${form.title} 작성`, back: true });
    const dec = d && d.decision;
    const cands = approverCandidates(S.cfg, S.name, S.email);
    // 결재선(1~3명, 순서대로) — 화면 상태는 이메일 목록. 저장된 결재자가 지금 후보에 없으면(직책 바뀜 등) 빼고 다시 고르게 한다
    const stored = d ? approversOf(d) : [];
    const apGone = stored.filter(a => !cands.some(c => c.email === a.email));
    let line = stored.filter(a => cands.some(c => c.email === a.email)).map(a => a.email).slice(0, APPROVERS_MAX);
    if (!line.length) line = [cands.length === 1 ? cands[0].email : ''];
    // 참조자(선택, 재직 관리자) — 저장된 사람이 지금 후보가 아니면 빼고 안내. 결재자로 고른 사람은 drawCc 가 뺀다
    const ccCands = ccCandidates(S.cfg, S.name, S.email);
    const storedCc = d ? ccsOf(d) : [];
    const ccGone = storedCc.filter(a => !ccCands.some(c => c.email === a.email));
    let cc = storedCc.filter(a => ccCands.some(c => c.email === a.email)).map(a => a.email).slice(0, CC_MAX);
    main.innerHTML = `<section class="pd-card pd-card-pad">
        ${dec && d.status === 'rejected' ? `<div class="pd-alert risk"><b>반려 의견</b> (${esc(dec.byName || '')} · ${esc(stampTime(tsMs(dec.at)))})<div class="ap-decision">${esc(dec.comment)}</div></div>` : ''}
        ${dec && d.status === 'draft' ? `<div class="pd-alert warn"><b>지난 반려 의견</b><div class="ap-decision">${esc(dec.comment)}</div></div>` : ''}
        ${!S.name ? `<div class="pd-alert warn" style="margin-top:10px;">${esc(nameWarnText())}</div>` : ''}
        <div class="pd-row" style="margin-top:12px;"><h2 class="pd-h2">${esc(form.title)}</h2><span class="pd-grow"></span><span class="pd-note">성명 ${esc(S.name || '-')}</span></div>
        ${form.intro ? `<div class="pd-note" style="margin-top:6px; white-space:pre-wrap;">${esc(form.intro)}</div>` : ''}
        <div class="ap-form">
            <div class="pd-field"><span>결재자<b>*</b> <small>(1~${APPROVERS_MAX}명, 위에서부터 순서대로 결재 — 관리자 또는 파트장·부팀장·팀장. 제출하면 1차 결재자에게 알림이 갑니다)</small></span>
                <div id="ap-line" class="ap-line"></div>
                ${apGone.length ? `<span class="ap-hint pd-warn">저장된 결재자(${esc(apGone.map(a => a.name).join(', '))})는 지금 결재할 수 없는 사람이라 뺐습니다 — 다시 고르세요.</span>` : ''}
                ${!cands.length ? '<span class="ap-hint pd-warn">고를 수 있는 결재자가 없습니다(관리자·파트장·부팀장·팀장). 관리자에게 문의하세요.</span>' : ''}</div>
            <div class="pd-field"><span>참조자 <small>(선택, 관리자 중 ${CC_MAX}명까지 — 지정한 참조자는 제출 후 내용을 읽습니다)</small></span>
                <div id="ap-cc" class="ap-line"></div>
                ${ccGone.length ? `<span class="ap-hint pd-warn">저장된 참조자(${esc(ccGone.map(a => a.name).join(', '))})는 지금 지정할 수 없는 사람이라 뺐습니다.</span>` : ''}
                <span class="ap-hint pd-warn" id="ap-cc-hint"></span></div>
            ${form.fields.map(f => `<label class="pd-field"><span>${esc(f.label)}${f.required ? '<b>*</b>' : ''}</span>${fieldInput(f, vals[f.key] || '')}
            ${f.prefill === 'day' ? '<span class="ap-hint" id="ap-prefill-hint"></span>' : ''}</label>`).join('')}</div>
        ${form.pledge ? `<div class="pd-note" style="margin-top:14px; white-space:pre-wrap;">${esc(form.pledge)}</div>` : ''}
        <div id="ap-errs"></div>
        <div class="ap-bar">
            <button class="d-btn" id="ap-preview">미리보기</button>
            <span class="pd-grow"></span>
            <button class="d-btn" id="ap-cancel">취소</button>
            <button class="d-btn" id="ap-save" ${S.name ? '' : 'disabled'}>임시저장</button>
            <button class="d-btn d-btn-primary" id="ap-submit" ${S.name ? '' : 'disabled'}>${d && (d.status === 'rejected' || d.decision) ? '재제출' : '제출'}</button>
        </div>
        <div id="ap-prev-box" class="ap-sheet-wrap" style="margin-top:16px;"></div>
    </section>`;
    const read = () => {
        const out = {};
        main.querySelectorAll('[data-key]').forEach(el => { out[el.dataset.key] = el.value; });
        return out;
    };
    // 결재선 → [{name, email}] (빈 줄은 뺀다)
    const readApprovers = () => line.map(em => cands.find(x => x.email === em)).filter(Boolean).map(c => ({ name: c.name, email: c.email }));
    const readCcs = () => cc.map(em => ccCands.find(x => x.email === em)).filter(Boolean).map(c => ({ name: c.name, email: c.email }));
    // 참조자 줄 그리기 — 줄마다 고르기 + ✕, 아래 [참조자 추가]. 결재자로 고른 사람은 목록에서 빼고, 이미 참조에 있었으면 자동으로 뺀다
    const drawCc = () => {
        const box = $('ap-cc');
        const taken = new Set(line.filter(Boolean));
        const dropped = cc.filter(em => taken.has(em));
        if (dropped.length) cc = cc.filter(em => !taken.has(em));
        const hint = $('ap-cc-hint');
        if (dropped.length) hint.textContent = `결재자로 고른 ${dropped.map(em => (ccCands.find(c => c.email === em) || {}).name || '직원').join(', ')} 님은 참조에서 뺐습니다.`;
        const free = ccCands.filter(c => !taken.has(c.email));
        box.innerHTML = cc.map((em, i) => {
            const others = new Set(cc.filter((x, j) => j !== i && x));
            const opts = free.filter(c => !others.has(c.email)).map(c => `<option value="${esc(c.email)}"${c.email === em ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
            return `<div class="ap-line-row" data-cc-i="${i}"><select class="pd-in" data-cc-sel aria-label="참조자 ${i + 1}"><option value="">(참조자를 고르세요)</option>${opts}</select>
                <span class="ap-fe-btns"><button type="button" class="d-btn d-btn-sm d-btn-risk" data-cc-del aria-label="이 참조자 빼기">✕</button></span></div>`;
        }).join('') + `<div><button type="button" class="d-btn d-btn-sm" id="ap-cc-add" ${cc.length >= CC_MAX || cc.length >= free.length ? 'disabled' : ''}>참조자 추가</button>${free.length ? '' : ' <span class="pd-note">고를 수 있는 관리자가 없습니다.</span>'}</div>`;
        const idx = (el) => Number(el.closest('[data-cc-i]').dataset.ccI);
        box.querySelectorAll('[data-cc-sel]').forEach(sel => sel.addEventListener('change', () => { cc[idx(sel)] = sel.value; S.dirty = true; hint.textContent = ''; drawCc(); }));
        box.querySelectorAll('[data-cc-del]').forEach(b => b.addEventListener('click', () => { cc.splice(idx(b), 1); S.dirty = true; hint.textContent = ''; drawCc(); }));
        $('ap-cc-add')?.addEventListener('click', () => { if (cc.length < CC_MAX) { cc.push(''); S.dirty = true; drawCc(); } });
    };
    // 결재선 줄 그리기 — 줄마다 고르기 + ↑↓ + ✕, 아래 [결재자 추가]. 다른 줄에서 고른 사람은 목록에서 뺀다(같은 사람 두 번 안 됨)
    const drawLine = () => {
        const box = $('ap-line');
        box.innerHTML = line.map((em, i) => {
            const taken = new Set(line.filter((x, j) => j !== i && x));
            const opts = cands.filter(c => !taken.has(c.email))
                .map(c => `<option value="${esc(c.email)}"${c.email === em ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
            return `<div class="ap-line-row" data-line-i="${i}"><span class="ap-line-n">${i + 1}차</span>
                <select class="pd-in" data-line-sel aria-label="${i + 1}차 결재자"><option value="">(결재자를 고르세요)</option>${opts}</select>
                <span class="ap-fe-btns"><button type="button" class="d-btn d-btn-sm" data-line-mv="-1" aria-label="앞 순서로" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="d-btn d-btn-sm" data-line-mv="1" aria-label="뒤 순서로" ${i === line.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="d-btn d-btn-sm d-btn-risk" data-line-del aria-label="이 결재자 빼기" ${line.length <= 1 ? 'disabled' : ''}>✕</button></span></div>`;
        }).join('') + `<div><button type="button" class="d-btn d-btn-sm" id="ap-line-add" ${line.length >= APPROVERS_MAX || line.length >= cands.length ? 'disabled' : ''}>결재자 추가</button>
            <span class="pd-note">${line.length > 1 ? '1차가 승인하면 2차에게 넘어갑니다. 누구든 반려하면 작성자에게 돌아옵니다.' : `여러 명이 차례로 결재해야 하면 [결재자 추가] (최대 ${APPROVERS_MAX}명)`}</span></div>`;
        const idx = (el) => Number(el.closest('[data-line-i]').dataset.lineI);
        box.querySelectorAll('[data-line-sel]').forEach(sel => sel.addEventListener('change', () => { line[idx(sel)] = sel.value; S.dirty = true; drawLine(); }));
        box.querySelectorAll('[data-line-mv]').forEach(b => b.addEventListener('click', () => {
            const i = idx(b), j = i + Number(b.dataset.lineMv);
            if (j < 0 || j >= line.length) return;
            [line[i], line[j]] = [line[j], line[i]];
            S.dirty = true; drawLine();
        }));
        box.querySelectorAll('[data-line-del]').forEach(b => b.addEventListener('click', () => { line.splice(idx(b), 1); S.dirty = true; drawLine(); }));
        $('ap-line-add')?.addEventListener('click', () => { if (line.length < APPROVERS_MAX) { line.push(''); S.dirty = true; drawLine(); } });
        drawCc();   // 결재자가 바뀌면 참조 후보도 바뀐다
    };
    drawLine();
    main.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', () => { S.dirty = true; }));
    main.querySelectorAll('[data-key]').forEach(el => el.addEventListener('change', () => { S.dirty = true; }));
    // 근태사유서: 발생일 → 그날 내 지각(읽기만)을 빈 칸에
    const dayField = form.fields.find(f => f.prefill === 'day');
    if (dayField && S.name) $('ap-f-' + dayField.key)?.addEventListener('change', (e) => prefillTardy(form, e.target.value));
    // 파일 칸 — 문서가 있어야 올릴 수 있다(Storage 규칙이 문서의 작성자·상태를 본다). 새 문서는 고르는 순간 임시저장부터 한다.
    const drawFiles = () => main.querySelectorAll('[data-file-key]').forEach(box => {
        const key = box.dataset.fileKey;
        const all = (d && d.attachments) || [];
        const mineHere = all.filter(a => a.key === key);
        box.innerHTML = `${mineHere.length ? attachListHtml(mineHere, true) : '<div class="pd-note">붙인 파일이 없습니다.</div>'}
            <div class="pd-row" style="margin-top:6px;"><label class="d-btn d-btn-sm ap-file-pick${all.length >= ATTACH_MAX || !S.name ? ' is-off' : ''}">파일 붙이기
                <input type="file" accept="${ATTACH_ACCEPT}" multiple ${all.length >= ATTACH_MAX || !S.name ? 'disabled' : ''} hidden></label>
                <span class="pd-note">이미지·PDF·엑셀·워드·한글, 파일당 10MB, 기안서 하나에 ${ATTACH_MAX}개까지 (${all.length}/${ATTACH_MAX})${d ? '' : ' — 고르면 먼저 임시저장됩니다'}</span></div>`;
        box.querySelector('input[type=file]').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addFiles(key, fs); });
        box.querySelectorAll('[data-att-del]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); removeFile(b.dataset.attDel); }));
        if (d) bindAttachOpen(box, d);
    });
    // 첨부 칸만 바꾸는 쓰기 — 반려 건이면 임시저장으로 돌아간다(규칙: 작성자 쓰기는 draft 로만, 저장과 같음)
    const writeAtts = (mutate) => runTransaction(S.db, async (tx) => {
        const r = doc(S.db, DOCS, d.id);
        const sn = await tx.get(r);
        if (!sn.exists()) throw new Error('기안서가 없습니다.');
        const cur = sn.data();
        if (!['draft', 'rejected'].includes(cur.status)) throw new Error('지금 상태에서는 첨부를 바꿀 수 없습니다.');
        const next = mutate(cur.attachments || []);
        // 반려 건이면 단계 도장도 비운다(규칙: 작성자가 draft 로 쓸 때 step 0·stamps 빈 맵)
        tx.update(r, { attachments: next, updatedAt: serverTimestamp(), status: 'draft', submittedAt: null, authorStamp: null, step: 0, stamps: {} });
        return next;
    });
    const addFiles = async (key, files) => {
        if (!files.length) return;
        setLoading(true, '파일 올리는 중…');
        try {
            if (!d) {   // 새 문서 — 지금 칸 그대로 임시저장부터(결재자 칸도)
                const data = buildCreate(form, { email: S.email, name: S.name }, cleanValues(form, read()), { ts: serverTimestamp(), at: new Date(), approvers: readApprovers(), ccs: readCcs() });
                const r = await addDoc(collection(S.db, DOCS), data);
                d = await fetchDoc(r.id);
                history.replaceState(null, '', '#e=' + encodeURIComponent(r.id));   // 주소만 바꾼다(다시 그리면 입력 중인 칸이 사라진다)
                setHead({ title: `${form.title} 고치기`, back: true });
                toast('임시저장했습니다 — 파일을 올립니다');
            }
            for (const f of files) {
                const ck = checkAttach(f, (d.attachments || []).length);
                if (!ck.ok) { toast(`${f.name}: ${ck.reason}`, 5000); continue; }
                const path = attachPath(d.id, ck.ext);
                await uploadBytes(sRef(storage(), path), f, { contentType: ck.contentType });
                try {
                    await writeAtts(list => { if (list.length >= ATTACH_MAX) throw new Error(`첨부는 ${ATTACH_MAX}개까지입니다.`); return [...list, attachMeta(key, f, path, ck.contentType)]; });
                } catch (e) {
                    await deleteObject(sRef(storage(), path)).catch(() => null);   // 문서에 못 적었으면 올린 파일을 치운다
                    throw e;
                }
                d = await fetchDoc(d.id);
            }
        } catch (e) {
            console.error('[approval] 첨부 실패:', e && e.code);
            toast('파일을 붙이지 못했습니다 — ' + errText(e), 6000);
        } finally {
            setLoading(false);
            drawFiles();
        }
    };
    const removeFile = async (path) => {
        const a = ((d && d.attachments) || []).find(x => x.path === path);
        if (!a || !confirm(`'${a.name}' 첨부를 지울까요?`)) return;
        setLoading(true, '지우는 중…');
        try {
            await writeAtts(list => list.filter(x => x.path !== path));
            await deleteObject(sRef(storage(), path)).catch(e => {
                if (e && e.code === 'storage/object-not-found') return;
                console.error('[approval] 파일 지우기 실패:', e && e.code);
                toast('목록에서는 뺐지만 저장된 파일을 지우지 못했습니다 — 관리자에게 알려 주세요', 6000);
            });
            d = await fetchDoc(d.id);
        } catch (e) {
            console.error('[approval] 첨부 삭제 실패:', e && e.code);
            toast('지우지 못했습니다 — ' + errText(e), 5000);
        } finally {
            setLoading(false);
            drawFiles();
        }
    };
    drawFiles();
    $('ap-preview').addEventListener('click', () => {
        const meta = d ? metaOf(d) : { authorName: S.name, createdMs: Date.now(), status: 'draft' };
        $('ap-prev-box').innerHTML = sheetHtml(form, cleanValues(form, read()), { ...meta, authorStamp: null, stamps: [], step: 0, status: 'draft', approvers: readApprovers(), ccs: readCcs() });
        $('ap-prev-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('ap-cancel').addEventListener('click', () => { if (!okLeave()) return; location.hash = d ? 'd=' + encodeURIComponent(d.id) : ''; });
    const go = async (submit) => {
        const values = cleanValues(form, read());
        const approvers = readApprovers();
        const ccs = readCcs();
        $('ap-errs').innerHTML = '';
        if (submit) {
            const errs = [...checkApprovers(approvers, S.email), ...(line.some(x => !x) && approvers.length ? ['빈 결재자 줄이 있습니다 — 고르거나 ✕ 로 빼세요.'] : []),
                ...checkCcs(ccs, S.email, approvers, S.cfg), ...validateValues(form, values, d ? d.attachments : [])];
            if (errs.length) {
                $('ap-errs').innerHTML = `<div class="pd-alert risk" style="margin-top:14px;"><ul class="ap-errs">${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
                $('ap-errs').scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            if (!confirm(`제출할까요?\n결재 순서: ${approvers.map(a => a.name).join(' → ')}\n1차 결재자에게 알림이 가고, 아무도 결재하기 전까지는 회수할 수 있습니다.`)) return;
        }
        if (d) return authorWrite(d.id, submit ? 'submit' : 'save', values, approvers, ccs);
        setLoading(true, '저장 중…');
        try {
            // 참조자가 있으면 임시저장 → 제출 두 번으로 나눈다 — 만들며 바로 제출하는 규칙 경로는 식 한도(1000개)를 넘는다(firestore.rules apCcOk 주석)
            const twoStep = submit && ccs.length > 0;
            const data = buildCreate(form, { email: S.email, name: S.name }, values, { submit: submit && !twoStep, ts: serverTimestamp(), at: new Date(), approvers, ccs });
            const r = await addDoc(collection(S.db, DOCS), data);
            S.dirty = false;
            if (twoStep) {
                d = await fetchDoc(r.id).catch(() => null);   // 제출이 실패해도 다시 누르면 같은 문서로 간다(새로 만들지 않게)
                if (!d) {   // 못 읽었으면 이 화면에 남지 않는다 — 다시 누르면 addDoc 이 또 돈다. 새로 불러와 그 문서로 제출하게
                    toast('임시저장은 됐습니다 — 내용을 확인하고 다시 제출해 주세요', 5000);
                    location.hash = 'e=' + encodeURIComponent(r.id);
                    return;
                }
                history.replaceState(null, '', '#e=' + encodeURIComponent(r.id));
                setHead({ title: `${form.title} 고치기`, back: true });
                await authorWrite(r.id, 'submit', values, approvers, ccs);
                return;
            }
            await fetchDoc(r.id).catch(() => null);
            toast(submit ? '제출했습니다' : '임시저장했습니다');
            if (submit) { await notifyApprover(approvers[0].name); await notifyCcs(ccs.map(c => c.name)); }
            location.hash = 'd=' + encodeURIComponent(r.id);
        } catch (e) {
            console.error('[approval] 만들기 실패:', e && e.code);
            toast('저장하지 못했습니다 — ' + errText(e), 6000);
        } finally {
            setLoading(false);
        }
    };
    $('ap-save').addEventListener('click', () => go(false));
    $('ap-submit').addEventListener('click', () => go(true));
}

async function prefillTardy(form, day) {
    const hint = $('ap-prefill-hint');
    if (hint) hint.textContent = '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return;
    const today = kstDay();
    if (day > today) return;
    try {
        // 오늘은 daily_data(마감 전), 지난 날은 history(마감본) — 읽기만
        const snap = await getDoc(doc(S.db, APP_BASE, day === today ? 'daily_data' : 'history', day));
        const hit = snap.exists() ? tardyPrefill(snap.data(), S.name) : null;
        if (!hit) { if (hint) hint.textContent = '그날 지각 기록은 없습니다.'; return; }
        const filled = [];
        form.fields.forEach(f => {
            const el = $('ap-f-' + f.key);
            if (!el || el.value) return;
            if (f.prefill === 'tardyKind' && (f.options || []).includes(hit.kind)) { el.value = hit.kind; filled.push(f.label); }
            if (f.prefill === 'tardyTime' && hit.time) { el.value = hit.time; filled.push(f.label); }
        });
        if (hint) hint.textContent = filled.length ? `그날 지각 기록(${hit.time || '시각 없음'})으로 ${filled.join('·')} 을(를) 채웠습니다. 맞는지 확인하세요.` : `그날 지각 기록이 있습니다(${hit.time || '시각 없음'}).`;
    } catch (e) {
        console.error('[approval] 근태 읽기 실패:', e && e.code);
    }
}

// ── 양식 관리(관리자) ─────────────────────────────────────
function renderFormsList(main) {
    setHead({ title: '기안서', tab: 'forms' });
    main.innerHTML = `<section class="pd-card">
        <div class="pd-row" style="padding:18px 24px 6px;"><h2 class="pd-h2">양식 관리</h2><span class="pd-grow"></span>
            <span class="pd-note">양식은 지우지 않고 '사용 안 함' 으로 끕니다. 이미 낸 기안서는 낼 때의 양식 그대로 남습니다.</span></div>
        ${S.formsDenied ? '<div class="pd-alert warn" style="margin:8px 24px;">저장된 양식을 읽지 못했습니다(규칙 게시 전일 수 있음). 기본 양식만 보입니다.</div>' : ''}
        <div class="pd-scroll"><table class="pd-t"><thead><tr><th>순서</th><th>제목</th><th>칸</th><th>결재란</th><th>사용</th><th></th></tr></thead>
        <tbody>${S.forms.map(f => `<tr><td class="num">${esc(f.order)}</td><td>${esc(f.title)}</td><td class="num">${f.fields.length}</td>
            <td>${esc(f.boxes.map(b => b.label).join(' · '))}</td><td>${f.active ? '<span class="d-pill-ok">사용</span>' : '<span class="d-pill-mute">사용 안 함</span>'}</td>
            <td><button class="d-btn d-btn-sm" data-edit="${esc(f.id)}">편집</button> <button class="d-btn d-btn-sm" data-copy="${esc(f.id)}">복사해서 새 양식</button></td></tr>`).join('')}</tbody></table></div>
    </section>`;
    main.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { location.hash = 'forms=' + encodeURIComponent(b.dataset.edit); }));
    main.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
        const src = S.forms.find(f => f.id === b.dataset.copy);
        const id = newFormId(S.forms.map(f => f.id));
        copyDraft = { ...JSON.parse(JSON.stringify(src)), id, title: (src.title + ' (복사)').slice(0, 40), order: Math.max(0, ...S.forms.map(f => f.order)) + 1 };
        location.hash = 'forms=' + id;
    }));
}

let copyDraft = null;   // [복사해서 새 양식] — 저장 전까지 메모리에만
const TYPE_LABEL = { text: '한 줄', textarea: '여러 줄', date: '날짜', time: '시각', select: '고르기', file: '파일 첨부' };
const ROLE_LABEL = { author: '기안자 도장', approver: '결재자 도장', blank: '빈 칸' };
function renderFormEditor(main, formId) {
    const base = (copyDraft && copyDraft.id === formId) ? copyDraft : S.forms.find(f => f.id === formId);
    if (!base) { location.hash = 'forms'; return; }
    const isNew = !S.forms.some(f => f.id === formId);
    const f = JSON.parse(JSON.stringify(base));
    f.fields.forEach(x => { if (x.type === 'select') x.optText = (x.options || []).join(', '); });
    setHead({ title: isNew ? '새 양식' : `양식 편집 — ${f.title}`, back: true, tab: 'forms' });
    const keyFor = () => { const used = new Set(f.fields.map(x => x.key)); for (let i = 1; ; i++) if (!used.has('f' + i)) return 'f' + i; };
    const draw = () => {
        main.innerHTML = `<div class="ap-view">
        <section class="pd-card pd-card-pad">
            <div class="pd-grid2" style="margin-top:0;">
                <label class="pd-field"><span>제목</span><input class="pd-in" id="fe-title" maxlength="40" value="${esc(f.title)}"></label>
                <label class="pd-field"><span>순서 <small>(작은 수가 위)</small></span><input class="pd-in" id="fe-order" type="number" value="${esc(f.order)}"></label>
                <label class="pd-field span2"><span>위 문구 <small>(입력칸 위, 비워도 됨)</small></span><textarea class="pd-in" id="fe-intro" maxlength="500">${esc(f.intro)}</textarea></label>
                <label class="pd-field span2"><span>아래 문구 <small>(서약·제출 문구)</small></span><textarea class="pd-in" id="fe-pledge" maxlength="500">${esc(f.pledge)}</textarea></label>
                <label class="pd-field"><span>사용</span><span><input type="checkbox" id="fe-active" class="pd-check" ${f.active ? 'checked' : ''}> 새 기안에서 고를 수 있음</span></label>
                <div class="pd-field"><span>양식 id</span><span class="num">${esc(f.id)}</span></div>
            </div>
            <h3 class="pd-h3" style="margin-top:22px;">입력칸 <small class="pd-note">(${f.fields.length}/${MAX_FIELDS})</small></h3>
            <div>${f.fields.map((x, i) => `<div class="ap-fe-row" data-i="${i}">
                <div><input class="pd-in" data-k="label" maxlength="40" value="${esc(x.label)}" placeholder="칸 이름"><div class="ap-fe-key">키 ${esc(x.key)}${x.prefill ? ' · 근태 자동 채움' : ''}</div></div>
                <select class="pd-in" data-k="type">${FIELD_TYPES.map(t => `<option value="${t}"${t === x.type ? ' selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}</select>
                <div>${x.type === 'select' ? `<input class="pd-in" data-k="optText" value="${esc(x.optText || '')}" placeholder="선택지(쉼표로 나눔)">` : ''}</div>
                <label><input type="checkbox" data-k="required" ${x.required ? 'checked' : ''}> 필수</label>
                <div class="ap-fe-btns"><button class="d-btn d-btn-sm" data-mv="-1" aria-label="위로">↑</button><button class="d-btn d-btn-sm" data-mv="1" aria-label="아래로">↓</button><button class="d-btn d-btn-sm d-btn-risk" data-del aria-label="칸 삭제">✕</button></div>
            </div>`).join('')}</div>
            <button class="d-btn" id="fe-add" style="margin-top:10px;" ${f.fields.length >= MAX_FIELDS ? 'disabled' : ''}>칸 추가</button>
            <h3 class="pd-h3" style="margin-top:22px;">결재란 <small class="pd-note">(1~${MAX_BOXES}칸)</small></h3>
            <div class="ap-fe-boxes">${f.boxes.map((b, i) => `<div class="ap-fe-box" data-b="${i}"><input class="pd-in" data-bk="label" maxlength="10" value="${esc(b.label)}">
                <select class="pd-in" data-bk="role">${BOX_ROLES.map(r => `<option value="${r}"${r === b.role ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>
                <button class="d-btn d-btn-sm d-btn-risk" data-bdel aria-label="결재란 삭제" ${f.boxes.length <= 1 ? 'disabled' : ''}>✕</button></div>`).join('')}
                <button class="d-btn d-btn-sm" id="fe-badd" ${f.boxes.length >= MAX_BOXES ? 'disabled' : ''}>결재란 추가</button></div>
            <div id="fe-errs"></div>
            <div class="ap-bar"><span class="pd-grow"></span><button class="d-btn" id="fe-cancel">취소</button><button class="d-btn d-btn-primary" id="fe-save">저장</button></div>
        </section>
        <aside class="ap-side"><section class="pd-card pd-card-pad"><h3 class="pd-h3">미리보기</h3><div class="ap-sheet-wrap" id="fe-prev" style="margin-top:10px;"></div></section></aside>
        </div>`;
        bind();
        preview();
    };
    const collect = () => {
        f.title = $('fe-title').value; f.order = Number($('fe-order').value) || 0;
        f.intro = $('fe-intro').value; f.pledge = $('fe-pledge').value; f.active = $('fe-active').checked;
        main.querySelectorAll('.ap-fe-row').forEach(row => {
            const x = f.fields[Number(row.dataset.i)];
            x.label = row.querySelector('[data-k="label"]').value;
            x.type = row.querySelector('[data-k="type"]').value;
            x.required = row.querySelector('[data-k="required"]').checked;
            const o = row.querySelector('[data-k="optText"]');
            if (o) x.optText = o.value;
            x.options = x.type === 'select' ? String(x.optText || '').split(',').map(s => s.trim()).filter(Boolean) : undefined;
        });
        main.querySelectorAll('.ap-fe-box').forEach(row => {
            const b = f.boxes[Number(row.dataset.b)];
            b.label = row.querySelector('[data-bk="label"]').value;
            b.role = row.querySelector('[data-bk="role"]').value;
        });
    };
    const preview = () => { $('fe-prev').innerHTML = sheetHtml(normalizeForm(f, f.id), {}, { authorName: '(작성자)', createdMs: Date.now() }); };
    const bind = () => {
        main.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', () => { S.dirty = true; collect(); preview(); }));
        main.querySelectorAll('select, input[type="checkbox"]').forEach(el => el.addEventListener('change', () => { S.dirty = true; collect(); draw(); }));
        main.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => {
            collect();
            const i = Number(b.closest('.ap-fe-row').dataset.i), j = i + Number(b.dataset.mv);
            if (j < 0 || j >= f.fields.length) return;
            [f.fields[i], f.fields[j]] = [f.fields[j], f.fields[i]];
            S.dirty = true; draw();
        }));
        main.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
            collect(); f.fields.splice(Number(b.closest('.ap-fe-row').dataset.i), 1); S.dirty = true; draw();
        }));
        main.querySelectorAll('[data-bdel]').forEach(b => b.addEventListener('click', () => {
            collect(); f.boxes.splice(Number(b.closest('.ap-fe-box').dataset.b), 1); S.dirty = true; draw();
        }));
        $('fe-add').addEventListener('click', () => { collect(); f.fields.push({ key: keyFor(), label: '', type: 'text', required: false }); S.dirty = true; draw(); });
        $('fe-badd').addEventListener('click', () => { collect(); f.boxes.push({ label: '확인', role: 'blank' }); S.dirty = true; draw(); });
        $('fe-cancel').addEventListener('click', () => { if (okLeave()) location.hash = 'forms'; });
        $('fe-save').addEventListener('click', save);
    };
    const save = async () => {
        collect();
        const editable = { ...f, fields: f.fields.map(({ optText, ...x }) => x) };
        const errs = validateForm(editable);
        if (errs.length) { $('fe-errs').innerHTML = `<div class="pd-alert risk" style="margin-top:14px;"><ul class="ap-errs">${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`; return; }
        const n = normalizeForm(editable, f.id);
        const { id, ...data } = n;
        setLoading(true, '저장 중…');
        try {
            await setDoc(doc(S.db, FORMS, id), { ...data, updatedAt: serverTimestamp(), updatedBy: S.email });
            S.dirty = false; copyDraft = null;
            await loadForms();
            toast('양식을 저장했습니다');
            location.hash = 'forms';
        } catch (e) {
            console.error('[approval] 양식 저장 실패:', e && e.code);
            toast('저장하지 못했습니다 — ' + errText(e), 6000);
        } finally {
            setLoading(false);
        }
    };
    draw();
}

// ── 시작 ─────────────────────────────────────────────────
async function checkUser(user) {
    const snap = await getDocFromServer(doc(S.db, APP_BASE + '/config/mainConfig'));
    const c = snap.exists() ? snap.data() : {};
    // 결재자 후보 계산에 쓰는 칸만(js/lib/approval-logic.js approverCandidates — 규칙 apApproverOk 와 같은 조건)
    S.cfg = { memberRoles: c.memberRoles || {}, memberEmails: c.memberEmails || {}, resignedEmails: c.resignedEmails || {}, memberPositions: c.memberPositions || {} };
    const found = memberNameFor(c.memberEmails, user.email);   // 공통 상단바 알림용(공백 무시)
    // 도장 이름은 규칙(memberEmails[이름].lower() == 내 이메일)과 같게 — 앞뒤 공백이 있으면 규칙이 막으므로 여기서도 쓰지 않고 안내한다
    S.name = found && String(c.memberEmails[found]).toLowerCase() === String(user.email || '').toLowerCase() ? found : null;
    S.nameIssue = S.name ? '' : (found ? 'space' : 'none');
    if (found && S.auth.currentUser && S.auth.currentUser.uid === user.uid) setShellContext({ signedIn: true, uid: user.uid, memberName: found });
    return (c.memberRoles || {})[lower(user.email)] === 'admin';
}

let startedUid = null;
async function start(user) {
    startedUid = user.uid;
    S.email = lower(user.email);
    setLoading(true, '권한 확인 중…');
    try { S.isAdmin = await checkUser(user); }
    catch (e) { console.error('[approval] 설정 읽기 실패:', e && e.code); S.isAdmin = false; toast('권한을 확인하지 못해 직원 화면으로 엽니다'); }
    document.body.classList.toggle('is-admin', S.isAdmin);
    if (!S.isAdmin) document.querySelectorAll('.pd-adm').forEach(el => el.remove());
    $('pd-app').style.display = 'block';
    $('ap-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('.d-seg-btn'); if (!b) return;
        if (!okLeave()) return;
        location.hash = b.dataset.tab === 'forms' ? 'forms' : '';
    });
    $('ap-back').addEventListener('click', () => {
        if (!okLeave()) return;
        const h = location.hash;
        location.hash = h.startsWith('#forms=') ? 'forms' : (h.startsWith('#e=') ? 'd=' + h.slice(3) : '');
    });
    $('ap-refresh').addEventListener('click', () => { if (okLeave()) refresh(); });
    $('ap-new').addEventListener('click', () => { if (okLeave()) location.hash = 'new'; });
    let shownHash = location.hash;
    window.addEventListener('hashchange', () => {
        if (!okLeave()) { history.pushState(null, '', shownHash || location.pathname + location.search); return; }
        shownHash = location.hash;
        route();
    });
    await refresh();
}

const { app, db, auth } = initializeFirebase();
S.app = app; S.db = db; S.auth = auth;
// 🧪 ?emu=1 인데 에뮬레이터 연결이 안 됐으면(띠가 없으면) 운영으로 붙을 위험 — 멈춘다
const emuBad = emulatorEnabled() && !document.getElementById('emulator-banner');
if (!db || !auth || emuBad) {
    setLoading(false);
    showGate(`<div style="font-size:16px; font-weight:600;">${emuBad ? '에뮬레이터 연결 실패 — 창을 닫으세요(운영 데이터 보호)' : 'Firebase 초기화 실패 — 새로고침해 보세요'}</div>`);
} else {
    onAuthStateChanged(auth, (user) => {
        if (startedUid && (!user || user.uid !== startedUid)) { location.reload(); return; }
        if (!user) { setShellContext({ signedIn: false }); setLoading(false); showLogin(auth); return; }
        setShellContext({ signedIn: true, uid: user.uid });
        removeGate();
        if (!startedUid) start(user);
    });
}
