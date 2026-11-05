// === js/approval.js ===
// 기안서(approval.html) 진입점 — 로그인 게이트 · 관리자 판정 · 목록·작성·보기·결재·인쇄·양식 관리. 2026-11-05.
// 설계: 기안서 architect 확정안(2026-11-05). 순수 계산은 js/lib/approval-logic.js, 알림은 js/lib/approval-noti.js.
//
// 화면(해시): #              목록(직원 = 내 기안, 관리자 = 전체 — 기본 거르기 '결재 대기')
//             #new           양식 고르기        #new=<formId>  새로 작성
//             #d=<id>        보기(A4 미리보기·결재·인쇄)        #e=<id>  고치기(작성자, 임시저장·반려 건)
//             #forms         양식 관리(관리자)  #forms=<formId> 양식 편집
// 관리자 판정 = mainConfig.memberRoles[소문자 이메일]==='admin' (규칙 isAdmin() 과 같음). 화면을 가리는 장치일 뿐, 읽기·결재는 firestore.rules 가 막는다.
// 도장 이름 = mainConfig.memberEmails 에서 내 이메일로 찾은 이름(규칙도 같은 표로 확인). 없으면 작성·결재를 막고 안내한다.
// 근태사유서 '발생일' → 그날 내 지각 기록을 **읽기만** 해서 빈 칸에 넣는다(daily_data/오늘 · history/지난 날). 근태 쓰기 경로 없음.
// ⚠️ role="dialog"·data-act 를 쓰지 않는다(업무마감봇·업무예상알림이 그 선택자로 확인창을 찾는다). 반려 의견은 화면 안 칸에서 받는다.
// 이름·이메일·기안 내용은 콘솔에 남기지 않는다(오류 코드만).
import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, getDocFromServer, collection, query, where, orderBy, limit, addDoc, setDoc, deleteDoc,
    runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeFirebase } from './config.js?v=202611051014';
import { emulatorEnabled } from './firebase-emulator.js?v=202611051014';
import { setShellContext, onBeforeLeave, leaveAlreadyConfirmed } from './app-shell-bridge.js?v=202611051014';
import { memberNameFor } from './app-shell-data.js?v=202611051014';
import { DEFAULT_FORMS, STATUS, FIELD_TYPES, BOX_ROLES, MAX_FIELDS, MAX_BOXES, COMMENT_MAX, mergeForms, normalizeForm, validateForm,
    validateValues, cleanValues, actionsFor, buildCreate, buildSave, buildSubmit, buildWithdraw, buildDecision, adminNamesOf,
    tardyPrefill, printFitLevel, stampTime, sortDocs, docTitle, newFormId, lower } from './lib/approval-logic.js?v=202611051014';
import { sendApprovalNoti, MSG_TO_ADMIN, MSG_TO_AUTHOR } from './lib/approval-noti.js?v=202611051014';

const $ = (id) => document.getElementById(id);
const APP_BASE = 'artifacts/team-work-logger-v2';
const DOCS = 'ApprovalDocs', FORMS = 'ApprovalForms';
const ADMIN_LIST_LIMIT = 200;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tsMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (t instanceof Date ? t.getTime() : 0));
const S = { db: null, auth: null, email: '', name: null, nameIssue: '', printHtml: null, isAdmin: false, cfg: {}, forms: [], docs: [], filter: null, scope: 'all', dirty: false, formsDenied: false };

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
        const snap = await getDocs(query(col, where('authorEmail', '==', S.email)));
        S.docs = sortDocs(snap.docs.map(toDoc));
        return;
    }
    // 관리자: 최근 바뀐 200건 + 결재 대기 전부(오래 묵은 결재 대기가 200건 밖으로 밀려 빠지지 않게) — id 로 합친다
    const [recent, waiting] = await Promise.all([
        getDocs(query(col, orderBy('updatedAt', 'desc'), limit(ADMIN_LIST_LIMIT))),
        getDocs(query(col, where('status', '==', 'submitted')))
    ]);
    const byId = new Map();
    [...recent.docs, ...waiting.docs].forEach(sn => byId.set(sn.id, toDoc(sn)));
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
function renderList(main) {
    setHead({ tab: 'list' });
    if (S.filter == null) S.filter = S.isAdmin ? 'submitted' : 'all';
    const mine = S.docs.filter(d => d.authorEmail === S.email);
    const base = S.isAdmin && S.scope === 'all' ? S.docs : mine;
    const count = (st) => base.filter(d => st === 'all' || d.status === st).length;
    const rows = base.filter(d => S.filter === 'all' || d.status === S.filter);
    const chip = (st, label) => `<button class="pd-chip${S.filter === st ? ' is-on' : ''}" data-filter="${st}">${esc(label)}<span class="num">${count(st)}</span></button>`;
    const nameWarn = !S.name ? `<div class="pd-alert warn" style="margin:0 24px 14px;">${esc(nameWarnText())}</div>` : '';
    main.innerHTML = `
        <section class="pd-card">
            <div class="ap-pills">
                ${S.isAdmin ? `<div class="d-seg" style="display:inline-flex;"><button class="d-seg-btn${S.scope === 'all' ? ' is-on' : ''}" data-scope="all">전체</button><button class="d-seg-btn${S.scope === 'mine' ? ' is-on' : ''}" data-scope="mine">내 기안</button></div><span class="pd-sep"></span>` : ''}
                ${chip('all', '전체')}${chip('submitted', '결재 대기')}${chip('draft', '임시저장')}${chip('rejected', '반려')}${chip('approved', '승인')}
            </div>
            ${nameWarn}
            ${rows.length ? `<div class="pd-scroll"><table class="pd-t ap-t">
                <thead><tr><th>상태</th><th>종류·제목</th>${S.isAdmin ? '<th>작성자</th>' : ''}<th>제출</th><th>최근 변경</th></tr></thead>
                <tbody>${rows.map(d => `<tr class="pd-click" data-id="${esc(d.id)}">
                    <td>${pill(d.status)}</td>
                    <td class="ap-title-cell">${esc(docTitle(d))}</td>
                    ${S.isAdmin ? `<td>${esc(d.authorName)}${d.authorEmail === S.email ? '<span class="d-pill-accent ap-self">본인 기안</span>' : ''}</td>` : ''}
                    <td class="num">${esc(dayText(tsMs(d.submittedAt)))}</td>
                    <td class="num">${esc(stampTime(d._ms))}</td></tr>`).join('')}</tbody></table></div>`
            : `<div class="ap-list-empty">${base.length ? '이 상태의 기안서가 없습니다.' : '아직 작성한 기안서가 없습니다.<br>위의 [새 기안] 으로 시작하세요.'}</div>`}
            ${S.isAdmin && S.docs.length >= ADMIN_LIST_LIMIT ? `<div class="pd-note" style="padding:0 24px 16px;">최근 ${ADMIN_LIST_LIMIT}건과 결재 대기 전부가 보입니다.</div>` : ''}
        </section>`;
    main.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { S.filter = b.dataset.filter; renderList(main); }));
    main.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => { S.scope = b.dataset.scope; renderList(main); }));
    main.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = 'd=' + encodeURIComponent(tr.dataset.id); }));
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
/** meta: { authorName, createdMs, submittedMs, status, authorStamp, approverStamp } */
function sheetHtml(form, values, meta = {}) {
    const v = values || {};
    const fit = printFitLevel(form, v);
    const boxes = form.boxes || [];
    const st = meta.status && meta.status !== 'approved' ? `<div class="ap-sheet-status">(${esc(STATUS[meta.status] || '')}${meta.status === 'submitted' ? ' — 결재 전' : ''})</div>` : '';
    const dateMs = meta.submittedMs || meta.createdMs || 0;
    return `<div class="ap-sheet fit-${fit.level}" data-over="${fit.over ? 1 : 0}">
        <div class="ap-sheet-top">
            <div style="flex:1;"><h2>${esc(form.title)}</h2>${st}</div>
            ${boxes.length ? `<table class="ap-boxes"><tr>${boxes.map(b => `<th>${esc(b.label)}</th>`).join('')}</tr>
                <tr>${boxes.map(b => `<td>${b.role === 'author' ? stampHtml(meta.authorStamp) : b.role === 'approver' ? stampHtml(meta.approverStamp) : ''}</td>`).join('')}</tr></table>` : ''}
        </div>
        <table class="ap-info"><tr><th>성명</th><td>${esc(meta.authorName || '')}</td><th>작성일</th><td class="num">${esc(dayText(meta.createdMs))}</td></tr></table>
        ${form.intro ? `<div class="ap-intro">${esc(form.intro)}</div>` : ''}
        <table class="ap-body">${form.fields.map(f => `<tr><th>${esc(f.label)}</th><td class="${f.type === 'textarea' ? 'is-long' : ''}">${esc(v[f.key] || '')}</td></tr>`).join('')}</table>
        ${form.pledge ? `<div class="ap-pledge">${esc(form.pledge)}</div>` : ''}
        <div class="ap-sign"><span class="num">${esc(dateMs ? kstDay(dateMs).replace(/^(\d+)-(\d+)-(\d+)$/, (m, y, mo, d) => `${y}년 ${Number(mo)}월 ${Number(d)}일`) : '')}</span><br>
            작성자&nbsp;&nbsp;${esc(meta.authorName || '')}</div>
    </div>`;
}
const metaOf = (d) => ({ authorName: d.authorName, createdMs: tsMs(d.createdAt), submittedMs: tsMs(d.submittedAt), status: d.status,
    authorStamp: d.authorStamp, approverStamp: d.approverStamp });

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
    const dec = d.decision;
    const btn = (act, label, cls = '') => acts.includes(act) ? `<button class="d-btn ${cls}" data-act-btn="${act}">${label}</button>` : '';
    main.innerHTML = `<div class="ap-view">
        <section class="pd-card pd-card-pad"><div class="ap-sheet-wrap" id="ap-sheet-box">${sheetHtml(d.form, d.values, metaOf(d))}</div></section>
        <aside class="ap-side">
            <section class="pd-card pd-card-pad">
                <div class="pd-row">${pill(d.status)}${S.isAdmin && selfDoc ? '<span class="d-pill-accent">본인 기안</span>' : ''}<span class="pd-grow"></span><span class="pd-note num">${esc(stampTime(d._ms))}</span></div>
                <div class="ap-actions" style="margin-top:14px;">
                    ${btn('edit', '고치기')}${btn('submit', d.status === 'rejected' ? '재제출' : '제출', 'd-btn-primary')}${btn('withdraw', '회수')}${btn('delete', '삭제', 'd-btn-risk')}
                    ${btn('print', '인쇄 / PDF')}
                </div>
                ${d.status === 'approved' ? '<div class="pd-note" style="margin-top:10px;">승인된 기안서는 고칠 수 없습니다.</div>' : ''}
                ${d.status === 'submitted' && selfDoc ? '<div class="pd-note" style="margin-top:10px;">결재 전에는 [회수] 해서 고칠 수 있습니다.</div>' : ''}
            </section>
            ${acts.includes('approve') ? `<section class="pd-card pd-card-pad">
                <h3 class="pd-h3">결재</h3>
                ${selfDoc ? '<div class="pd-alert info" style="margin-top:10px;">본인이 쓴 기안서입니다. 본인 결재도 기록에 남습니다.</div>' : ''}
                ${!S.name ? `<div class="pd-alert warn" style="margin-top:10px;">${esc(nameWarnText())}</div>` : ''}
                <label class="pd-field" style="margin-top:12px;"><span>결재 의견 <small>(반려는 필수, ${COMMENT_MAX}자까지)</small></span>
                    <textarea id="ap-comment" class="pd-in" maxlength="${COMMENT_MAX}"></textarea></label>
                <div class="ap-actions" style="margin-top:12px;">
                    <button class="d-btn d-btn-primary" data-decide="approve" ${S.name ? '' : 'disabled'}>승인</button>
                    <button class="d-btn d-btn-risk" data-decide="reject" ${S.name ? '' : 'disabled'}>반려</button>
                </div>
            </section>` : ''}
            ${dec ? `<section class="pd-card pd-card-pad">
                <h3 class="pd-h3">${d.status === 'approved' ? '승인 의견' : '최근 결재 의견'}</h3>
                <div class="pd-note" style="margin-top:4px;">${esc(dec.byName || '')} · ${esc(stampTime(tsMs(dec.at)))}${d.status !== 'approved' && d.status !== 'rejected' ? ' (반려 뒤 다시 냄)' : ''}</div>
                <div class="ap-decision">${esc(dec.comment || '(의견 없음)')}</div>
            </section>` : ''}
            ${(d.history || []).length ? `<section class="pd-card pd-card-pad"><h3 class="pd-h3">처리 이력</h3>
                <ul class="ap-hist">${d.history.map(x => `<li><span>${esc(ACT_LABEL[x.act] || x.act)}</span><span class="num pd-mute">${esc(stampTime(tsMs(x.at)))}</span></li>`).join('')}</ul></section>` : ''}
        </aside></div>`;
    const on = (act, fn) => main.querySelector(`[data-act-btn="${act}"]`)?.addEventListener('click', fn);
    on('edit', () => { location.hash = 'e=' + encodeURIComponent(d.id); });
    on('print', () => printSheet(S.printHtml));
    on('submit', () => {
        const errs = validateValues(d.form, d.values);
        if (errs.length) { toast('빈 필수 칸이 있습니다 — [고치기] 에서 채워 주세요', 4000); return; }
        if (!confirm('이 기안서를 제출할까요?\n제출하면 관리자에게 알림이 갑니다.')) return;
        authorWrite(d.id, 'submit');   // 값은 트랜잭션 안에서 읽은 서버 값(화면의 옛 값으로 덮지 않게)
    });
    on('withdraw', () => { if (confirm('결재 전 기안서를 회수할까요?\n임시저장으로 돌아가 고칠 수 있습니다.')) authorWrite(d.id, 'withdraw'); });
    on('delete', async () => {
        if (!confirm('이 임시저장 기안서를 지울까요? 되돌릴 수 없습니다.')) return;
        try { await deleteDoc(doc(S.db, DOCS, d.id)); S.docs = S.docs.filter(x => x.id !== d.id); toast('지웠습니다'); location.hash = ''; }
        catch (e) { console.error('[approval] 삭제 실패:', e && e.code); toast('지우지 못했습니다 — ' + errText(e), 5000); }
    });
    main.querySelectorAll('[data-decide]').forEach(b => b.addEventListener('click', () => decide(d.id, b.dataset.decide, $('ap-comment').value)));
}

// 작성자 쓰기(제출·재제출·회수·임시저장) — 서버 문서를 다시 읽고 상태를 확인한 뒤 고친다(관리자 결재와 겹치지 않게)
async function authorWrite(id, kind, values) {
    const me = { email: S.email, name: S.name };
    const opt = { ts: serverTimestamp(), at: new Date() };
    let submitted = false;
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
                const errs = validateValues(cur.form, v);
                if (errs.length) throw new Error(errs[0]);
                patch = buildSubmit(cur, me, v, opt);
            }
            else if (kind === 'withdraw') patch = buildWithdraw(cur, me, opt);
            else throw new Error('알 수 없는 동작');
            tx.update(ref, patch);
            submitted = kind === 'submit';
        });
        S.dirty = false;
        await fetchDoc(id).catch(() => null);
        toast({ save: '임시저장했습니다', submit: '제출했습니다', withdraw: '회수했습니다 — 임시저장으로 돌아갔습니다' }[kind]);
        if (submitted) await notifyAdmins();
        if (location.hash === '#d=' + encodeURIComponent(id)) route(); else location.hash = 'd=' + encodeURIComponent(id);
    } catch (e) {
        console.error('[approval] 저장 실패:', e && e.code);
        toast('저장하지 못했습니다 — ' + errText(e), 6000);
    } finally {
        setLoading(false);
    }
}

async function notifyAdmins() {
    const names = adminNamesOf(S.cfg, S.name);
    if (!names.length) return;
    const r = await sendApprovalNoti(S.db, { collection, addDoc }, names, MSG_TO_ADMIN);
    if (r.failed) toast(`제출은 됐지만 관리자 알림 ${r.failed}건을 못 보냈습니다`, 5000);
}

// 관리자 결재 — 트랜잭션으로 '결재 대기' 를 다시 확인
async function decide(id, act, comment) {
    if (act === 'reject' && !String(comment || '').trim()) { toast('반려 의견을 입력하세요'); $('ap-comment')?.focus(); return; }
    if (!confirm(act === 'approve' ? '승인할까요? 승인하면 고칠 수 없습니다.' : '반려할까요? 작성자가 고쳐서 다시 낼 수 있습니다.')) return;
    const me = { email: S.email, name: S.name };
    let doneDoc = null;
    setLoading(true, '결재 중…');
    try {
        await runTransaction(S.db, async (tx) => {
            const ref = doc(S.db, DOCS, id);
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('기안서가 없습니다.');
            const cur = snap.data();
            if (cur.status !== 'submitted') throw new Error('그사이 상태가 바뀌었습니다(회수·결재). 새로고침해 보세요.');
            tx.update(ref, buildDecision(cur, me, act, comment, { ts: serverTimestamp(), at: new Date() }));
            doneDoc = cur;
        });
        toast(act === 'approve' ? '승인했습니다' : '반려했습니다');
        if (doneDoc && doneDoc.authorName && doneDoc.authorEmail !== S.email) {
            const r = await sendApprovalNoti(S.db, { collection, addDoc }, [doneDoc.authorName], MSG_TO_AUTHOR);
            if (r.failed) toast('결재는 됐지만 작성자 알림을 못 보냈습니다', 5000);
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
    main.innerHTML = `<section class="pd-card pd-card-pad">
        ${dec && d.status === 'rejected' ? `<div class="pd-alert risk"><b>반려 의견</b> (${esc(dec.byName || '')} · ${esc(stampTime(tsMs(dec.at)))})<div class="ap-decision">${esc(dec.comment)}</div></div>` : ''}
        ${dec && d.status === 'draft' ? `<div class="pd-alert warn"><b>지난 반려 의견</b><div class="ap-decision">${esc(dec.comment)}</div></div>` : ''}
        ${!S.name ? `<div class="pd-alert warn" style="margin-top:10px;">${esc(nameWarnText())}</div>` : ''}
        <div class="pd-row" style="margin-top:12px;"><h2 class="pd-h2">${esc(form.title)}</h2><span class="pd-grow"></span><span class="pd-note">성명 ${esc(S.name || '-')}</span></div>
        ${form.intro ? `<div class="pd-note" style="margin-top:6px; white-space:pre-wrap;">${esc(form.intro)}</div>` : ''}
        <div class="ap-form">${form.fields.map(f => `<label class="pd-field"><span>${esc(f.label)}${f.required ? '<b>*</b>' : ''}</span>${fieldInput(f, vals[f.key] || '')}
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
    main.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', () => { S.dirty = true; }));
    main.querySelectorAll('[data-key]').forEach(el => el.addEventListener('change', () => { S.dirty = true; }));
    // 근태사유서: 발생일 → 그날 내 지각(읽기만)을 빈 칸에
    const dayField = form.fields.find(f => f.prefill === 'day');
    if (dayField && S.name) $('ap-f-' + dayField.key)?.addEventListener('change', (e) => prefillTardy(form, e.target.value));
    $('ap-preview').addEventListener('click', () => {
        const meta = d ? metaOf(d) : { authorName: S.name, createdMs: Date.now(), status: 'draft' };
        $('ap-prev-box').innerHTML = sheetHtml(form, cleanValues(form, read()), { ...meta, authorStamp: null, approverStamp: null, status: 'draft' });
        $('ap-prev-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('ap-cancel').addEventListener('click', () => { if (!okLeave()) return; location.hash = d ? 'd=' + encodeURIComponent(d.id) : ''; });
    const go = async (submit) => {
        const values = cleanValues(form, read());
        $('ap-errs').innerHTML = '';
        if (submit) {
            const errs = validateValues(form, values);
            if (errs.length) {
                $('ap-errs').innerHTML = `<div class="pd-alert risk" style="margin-top:14px;"><ul class="ap-errs">${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
                $('ap-errs').scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            if (!confirm('제출할까요? 제출하면 관리자에게 알림이 가고, 결재 전까지는 회수할 수 있습니다.')) return;
        }
        if (d) return authorWrite(d.id, submit ? 'submit' : 'save', values);
        setLoading(true, '저장 중…');
        try {
            const data = buildCreate(form, { email: S.email, name: S.name }, values, { submit, ts: serverTimestamp(), at: new Date() });
            const ref = await addDoc(collection(S.db, DOCS), data);
            S.dirty = false;
            await fetchDoc(ref.id).catch(() => null);
            toast(submit ? '제출했습니다' : '임시저장했습니다');
            if (submit) await notifyAdmins();
            location.hash = 'd=' + encodeURIComponent(ref.id);
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
const TYPE_LABEL = { text: '한 줄', textarea: '여러 줄', date: '날짜', time: '시각', select: '고르기' };
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
    S.cfg = { memberRoles: c.memberRoles || {}, memberEmails: c.memberEmails || {}, resignedEmails: c.resignedEmails || {} };   // 알림 받을 관리자 계산에 쓰는 칸만
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

const { db, auth } = initializeFirebase();
S.db = db; S.auth = auth;
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
