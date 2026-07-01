// === js/presence.js ===
// 현재 접속 중(앱을 열어둔) 인원을 표시한다.
// 각 클라이언트가 자신의 presence 문서에 주기적으로 하트비트(lastSeen)를 기록하고,
// presence 컬렉션을 구독해 최근 접속자 목록을 대시보드에 렌더링한다.
import * as State from './state.js';
import {
    doc, setDoc, deleteDoc, collection, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const PRESENCE_PATH = ['artifacts', 'team-work-logger-v2', 'presence'];

// 하트비트 주기(1분)와 "접속중"으로 볼 최대 유휴 시간(3분).
// 유휴 3분이면 하트비트 3회분의 여유가 있어 일시적 지연에도 안정적.
const HEARTBEAT_MS = 60 * 1000;
const ONLINE_WINDOW_MS = 3 * 60 * 1000;
// 새 하트비트가 오지 않아도 만료된 인원을 화면에서 걷어내기 위한 로컬 재렌더 주기.
const LOCAL_REFRESH_MS = 30 * 1000;

let heartbeatTimer = null;
let refreshTimer = null;
let unsubscribe = null;
let latestDocs = [];
let started = false;

function presenceDocRef(name) {
    return doc(State.db, ...PRESENCE_PATH, name);
}

async function writeHeartbeat() {
    const name = State.appState.currentUser;
    if (!name || !State.db) return;
    try {
        await setDoc(presenceDocRef(name), {
            member: name,
            role: State.appState.currentUserRole || 'user',
            lastSeen: Date.now()
        });
    } catch (e) {
        // 오프라인 등 일시적 실패는 조용히 무시 (다음 하트비트에서 복구)
    }
}

async function removeHeartbeat() {
    const name = State.appState.currentUser;
    if (!name || !State.db) return;
    try { await deleteDoc(presenceDocRef(name)); } catch (e) {}
}

function renderOnline() {
    const now = Date.now();
    const seen = new Map(); // member -> {member, role, lastSeen}
    latestDocs.forEach(d => {
        if (!d || !d.member || typeof d.lastSeen !== 'number') return;
        if (now - d.lastSeen > ONLINE_WINDOW_MS) return; // 유휴 초과 → 오프라인 간주
        const prev = seen.get(d.member);
        if (!prev || d.lastSeen > prev.lastSeen) seen.set(d.member, d);
    });

    const me = State.appState.currentUser;
    const list = [...seen.values()].sort((a, b) => {
        // 본인을 맨 위로, 그다음 이름순
        if (a.member === me && b.member !== me) return -1;
        if (b.member === me && a.member !== me) return 1;
        return a.member.localeCompare(b.member);
    });

    // 카운트 갱신 (데스크톱/모바일 공통 클래스)
    document.querySelectorAll('.presence-online-count').forEach(el => {
        el.textContent = String(list.length);
    });

    // 인디케이터 노출 여부
    document.querySelectorAll('.presence-indicator').forEach(el => {
        el.classList.toggle('hidden', list.length === 0);
    });

    // 목록 렌더
    document.querySelectorAll('.presence-users-list').forEach(ul => {
        ul.innerHTML = '';
        if (list.length === 0) {
            ul.innerHTML = '<li class="text-xs text-gray-400 px-1 py-1">접속 중인 인원이 없습니다.</li>';
            return;
        }
        list.forEach(u => {
            const li = document.createElement('li');
            li.className = 'flex items-center gap-2 px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50';
            const isMe = u.member === me;
            li.innerHTML = `
                <span class="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                <span class="font-medium text-gray-700 dark:text-gray-200 truncate">${u.member}${isMe ? ' <span class="text-[10px] text-emerald-600">(나)</span>' : ''}</span>
                ${u.role === 'admin' ? '<span class="ml-auto text-[10px] text-indigo-500 flex-shrink-0">관리자</span>' : ''}
            `;
            ul.appendChild(li);
        });
    });
}

export function startPresence() {
    if (started) return;
    if (!State.db || !State.appState.currentUser) return;
    started = true;

    writeHeartbeat();
    heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_MS);
    refreshTimer = setInterval(renderOnline, LOCAL_REFRESH_MS);

    const colRef = collection(State.db, ...PRESENCE_PATH);
    unsubscribe = onSnapshot(colRef, (snap) => {
        latestDocs = [];
        snap.forEach(docSnap => latestDocs.push(docSnap.data()));
        renderOnline();
    }, () => {});

    // 탭을 닫을 때 본인 presence 제거 (best-effort)
    window.addEventListener('pagehide', removeHeartbeat);
    window.addEventListener('beforeunload', removeHeartbeat);

    // 백그라운드로 갔다가 돌아오면 즉시 하트비트 갱신
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') writeHeartbeat();
    });
}

export function stopPresence() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    removeHeartbeat();
    latestDocs = [];
    started = false;
    renderOnline();
}

// 팝오버 토글 등 UI 상호작용 (로그인 후 세팅 — 중복 바인딩 방지)
let uiBound = false;
export function setupPresenceUI() {
    document.querySelectorAll('.presence-toggle-btn').forEach(btn => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wrap = btn.closest('.presence-indicator');
            const pop = wrap && wrap.querySelector('.presence-popover');
            if (pop) pop.classList.toggle('hidden');
        });
    });

    if (uiBound) return;
    uiBound = true;
    // 바깥 클릭 시 팝오버 닫기 (document 리스너는 1회만 등록)
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.presence-popover').forEach(pop => {
            if (pop.classList.contains('hidden')) return;
            const wrap = pop.closest('.presence-indicator');
            if (wrap && !wrap.contains(e.target)) pop.classList.add('hidden');
        });
    });
}
