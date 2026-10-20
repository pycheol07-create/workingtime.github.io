// === js/admin.js ===
import { initializeFirebase, loadAppConfig, saveAppConfig, loadLeaveSchedule, saveLeaveSchedule, loadPrivateConfig, applyPrivateConfig } from './config.js?v=202610201411';
import { notifyLeaveScheduleChanged } from './leave-schedule-sync.js?v=202610201411';
import { setShellContext, onBeforeLeave, leaveAlreadyConfirmed } from './app-shell-bridge.js?v=202610201411';
import { memberNameFor } from './app-shell-data.js?v=202610201411';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { menuConfigOf } from './lib/perm.js?v=202610201411';
import { verifyPermSave, autoAssignedCount, renameEmails } from './lib/perm-model.js?v=202610201411';
import { getPermModel } from './admin-perm.js?v=202610201411';

import {
    renderAdminUI,
    renderKeyTasks,
    renderQuantityTasks,
    renderDashboardItemsConfig,
    renderQuantityToDashboardMapping,
    populateTaskSelectModal,
    openDashboardItemModal,
    getAllDashboardDefinitions,
    renderDashboardMenu,
    menuItemRowHtml,
    loadMenuPageList,
    findDeadMenuItems,
    countNamelessMenuRows
} from './admin-ui.js?v=202610201411';

import {
    collectConfigFromDOM,
    validateConfig,
    detectEmailRenames
} from './admin-logic.js?v=202610201411';

let db, auth;
let appConfig = {};
// 급여·원가(adminPrivate)를 못 읽었으면 화면의 급여 칸이 0 이다. 그 상태로 저장하면
// 전원 급여가 0 으로 덮이므로, 이 깃발이 서 있는 동안은 저장을 막는다.
let privateLoadFailed = false;

let draggedItem = null;
let currentModalTarget = null;
let taskJustAdded = null;

// 저장 안 한 변경 경고(UI 1b, 2026-10-16) — #admin-content 의 입력·선택이 바뀌면 서고, '전체 저장' 성공 때 내린다.
// '채우기 설정'은 전체 저장 대상이 아니라(자기 [저장] 버튼) 세지 않는다.
// 행 추가·삭제·끌어 옮기기처럼 입력 이벤트가 없는 변경은 잡지 못한다(입력·선택 변경만).
// 버튼(행 추가·삭제 등)·끌어 옮기기, #admin-content 밖 선택 모달(업무·위젯 항목 추가)의 고르기·확인도 변경으로 본다.
let adminDirty = false;
const ADMIN_DIRTY_SKIP = '#section-refill';
const ADMIN_BTN_SKIP = '#save-all-btn, .admin-tab-btn, #section-refill, [data-pm-nodirty]';   // 권한 화면의 탭·펼치기·미리보기는 변경이 아니다
const ADMIN_MODAL_PICK = '.task-select-list-btn, .dashboard-item-select-btn, #confirm-add-to-quantity-btn';
const markAdminDirty = (e) => {
    const t = e && e.target;
    if (t && t.closest && t.closest(ADMIN_DIRTY_SKIP)) return;
    adminDirty = true;
};
const markAdminDirtyByClick = (e) => {
    const t = e && e.target;
    if (!t || !t.closest) return;
    const pick = t.closest(ADMIN_MODAL_PICK);
    if (pick) { if (!pick.disabled) adminDirty = true; return; }
    const btn = t.closest('button');
    const content = document.getElementById('admin-content');
    if (btn && content && content.contains(btn) && !btn.closest(ADMIN_BTN_SKIP)) adminDirty = true;
};

document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');
    if (adminContent) {
        adminContent.addEventListener('input', markAdminDirty);
        adminContent.addEventListener('change', markAdminDirty);
        adminContent.addEventListener('drop', markAdminDirty);
        adminContent.addEventListener('dragend', markAdminDirty);
    }
    document.addEventListener('click', markAdminDirtyByClick);   // 모달은 #admin-content 밖이라 문서에서 본다
    // 새로고침·탭 닫기·주소 이동 때 브라우저 경고. 공통 상단바에서 이미 물었으면(확인 누름) 다시 묻지 않는다.
    window.addEventListener('beforeunload', (e) => {
        if (!adminDirty || leaveAlreadyConfirmed()) return;
        e.preventDefault();
        e.returnValue = '';
    });
    // 공통 상단바 메뉴·홈 — 동기 confirm 만(봇이 읽는 페이지 모달을 쓰지 않는다)
    onBeforeLeave(() => !adminDirty || confirm('저장하지 않은 변경이 있습니다.\n저장하지 않고 이 화면을 떠날까요?'));

    try {
        const firebase = initializeFirebase();
        db = firebase.db;
        auth = firebase.auth;
    } catch (e) {
        console.error(e);
        if (adminContent) {
            adminContent.innerHTML = `<div class="flex justify-center items-center h-full"><h2 class="text-2xl font-bold text-red-600 bg-red-50 p-6 rounded-2xl">Firebase 초기화 실패.</h2></div>`;
            adminContent.classList.remove('hidden');
        }
        return;
    }

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                appConfig = await loadAppConfig(db);

                const userEmailLower = (user.email || '').toLowerCase();
                const memberRoles = appConfig.memberRoles || {};
                const currentUserRole = memberRoles[userEmailLower] || 'user';
                // 공통 상단바 — role 은 memberRoles 에 있을 때만(설정을 못 읽어 기본값이면 메뉴 캐시를 덮지 않게)
                // memberName 은 셸 개인 알림 구독용 — 메모리에만(캐시·로그에 남기지 않는다)
                setShellContext({ signedIn: true, uid: user.uid, email: userEmailLower, role: memberRoles[userEmailLower],
                    memberName: memberNameFor(appConfig.memberEmails, userEmailLower) || undefined,
                    menuConfig: menuConfigOf(appConfig) });

                if (currentUserRole === 'admin') {
                    // 🔒 급여·원가는 관리자 전용 저장소에서 받아 얹는다(mainConfig 에는 없다).
                    try {
                        applyPrivateConfig(appConfig, await loadPrivateConfig(db));
                        privateLoadFailed = false;
                    } catch (e) {
                        privateLoadFailed = true;
                        console.warn('급여·원가 불러오기 실패:', e && e.code);
                    }
                    // 메뉴 관리의 '연결할 곳' 목록에 새 html 페이지를 붙인다(배포 때 만든 pages.json).
                    await loadMenuPageList();
                    renderAdminUI(appConfig);
                    setupEventListeners();
                    if (adminContent) adminContent.classList.remove('hidden');
                    const saveBtn = document.getElementById('save-all-btn');
                    if (!privateLoadFailed && saveBtn && saveBtn.dataset.lockedByPrivate) {
                        // 같은 탭에서 다시 로그인해 이번엔 읽혔다면, 앞서 걸어 둔 잠금을 푼다.
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = saveBtn.dataset.lockedByPrivate;   // 아이콘까지 되살린다
                        delete saveBtn.dataset.lockedByPrivate;
                    }
                    if (privateLoadFailed) {
                        if (saveBtn) {
                            if (!saveBtn.dataset.lockedByPrivate) saveBtn.dataset.lockedByPrivate = saveBtn.innerHTML;
                            saveBtn.disabled = true; saveBtn.textContent = '저장 잠김 — 새로고침 필요';
                        }
                        alert('⚠️ 급여·원가를 불러오지 못했습니다.\n\n지금 화면의 급여 칸은 실제 값이 아닙니다(0).\n'
                            + '이 상태로 저장하면 전 직원 급여가 0 으로 덮이므로 저장을 잠갔습니다.\n'
                            + '새로고침해 주세요. 계속되면 관리자 권한(memberRoles)을 확인하세요.');
                    }
                } else {
                    if (adminContent) {
                         adminContent.innerHTML = `<div class="flex justify-center items-center h-full mt-20"><div class="text-center bg-white dark:bg-gray-800 p-10 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700"><h2 class="text-xl font-bold text-gray-800 dark:text-white mb-2">접근 권한이 없습니다</h2><p class="text-gray-500 dark:text-gray-400 text-sm">관리자 계정으로 로그인해주세요.</p></div></div>`;
                         adminContent.classList.remove('hidden');
                    }
                }
            } catch (e) {
                console.error("초기화 중 오류:", e);
                alert(`초기화 중 오류가 발생했습니다: ${e.message}`);
            }
        } else {
             setShellContext({ signedIn: false });
             if (adminContent) {
                adminContent.innerHTML = `<div class="flex justify-center items-center h-full mt-20"><div class="text-center bg-white dark:bg-gray-800 p-10 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700"><h2 class="text-xl font-bold text-gray-800 dark:text-white mb-4">로그인이 필요합니다</h2><a href="index.html" class="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">메인 앱으로 이동</a></div></div>`;
                adminContent.classList.remove('hidden');
             }
        }
    });
});

function setupEventListeners() {
    document.getElementById('save-all-btn')?.addEventListener('click', handleSaveAll);
    
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.modalId;
            if (modalId) {
                const modal = document.getElementById(modalId);
                if (modal) modal.classList.add('hidden');
            }
        });
    });

    // 권한 관리 화면의 입력은 js/admin-perm.js 가 받는다(권한 개편 — 예전 '메뉴 체크박스' 처리는 지웠다).

    document.getElementById('add-menu-category-btn')?.addEventListener('click', () => {
        const container = document.getElementById('menu-categories-container');
        if (!container) return;
        const groupEl = document.createElement('div');
        groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 menu-category-card transition-colors drop-zone';
        groupEl.innerHTML = `
            <div class="flex flex-wrap justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
                <div class="flex items-center gap-2"> 
                   <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move text-lg" draggable="true">☰</span>
                   <input type="text" value="새 대분류" class="text-lg font-extrabold text-gray-800 dark:text-white menu-category-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1 outline-none" placeholder="대분류 이름">
                 </div>
                <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-menu-category-btn" type="button">대분류 삭제</button>
            </div>
            <div class="space-y-2 menu-items-container min-h-[60px] p-2 -mx-2 rounded-lg border-2 border-transparent border-dashed hover:border-gray-300 dark:hover:border-gray-600 transition-colors"></div>
            <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition add-menu-item-btn" type="button">+ 소분류 추가</button>
            </div>
        `;
        container.appendChild(groupEl);
        setupDragDropListeners('.menu-items-container', '.menu-item');
        setupDragDropListeners('#menu-categories-container', '.menu-category-card');
    });

    document.getElementById('add-team-group-btn')?.addEventListener('click', addTeamGroup);
    document.getElementById('add-task-group-btn')?.addEventListener('click', addTaskGroup);
    document.getElementById('add-dashboard-item-btn')?.addEventListener('click', () => openDashboardItemModal(appConfig));
    document.getElementById('add-custom-dashboard-item-btn')?.addEventListener('click', addCustomDashboardItem);

    document.getElementById('add-key-task-btn')?.addEventListener('click', () => {
        currentModalTarget = 'key';
        populateTaskSelectModal('key');
        document.getElementById('select-task-modal')?.classList.remove('hidden');
    });
    document.getElementById('add-quantity-task-btn')?.addEventListener('click', () => {
        currentModalTarget = 'quantity';
        populateTaskSelectModal('quantity');
        document.getElementById('select-task-modal')?.classList.remove('hidden');
    });

    document.getElementById('select-task-list')?.addEventListener('click', (e) => {
        const button = e.target.closest('.task-select-list-btn');
        if (button) {
            const taskName = button.dataset.taskName;
            if (currentModalTarget === 'key') addKeyTask(taskName);
            else if (currentModalTarget === 'quantity') addQuantityTask(taskName);
            
            document.getElementById('select-task-modal')?.classList.add('hidden');
            currentModalTarget = null;
        }
    });

    document.getElementById('select-dashboard-item-list')?.addEventListener('click', (e) => {
        const button = e.target.closest('.dashboard-item-select-btn');
        if (button && !button.disabled) {
            const itemId = button.dataset.id;
            if (!appConfig.dashboardItems) appConfig.dashboardItems = [];
            appConfig.dashboardItems.push(itemId);
            
            renderDashboardItemsConfig(appConfig.dashboardItems, appConfig);
            renderQuantityToDashboardMapping(appConfig);
            
            document.getElementById('select-dashboard-item-modal')?.classList.add('hidden');
        }
    });

    document.getElementById('confirm-add-to-quantity-btn')?.addEventListener('click', () => {
        if (taskJustAdded) addQuantityTask(taskJustAdded);
        document.getElementById('confirm-add-to-quantity-modal')?.classList.add('hidden');
        taskJustAdded = null;
    });
    document.getElementById('cancel-add-to-quantity-btn')?.addEventListener('click', () => {
        document.getElementById('confirm-add-to-quantity-modal')?.classList.add('hidden');
        taskJustAdded = null;
    });

    document.body.addEventListener('click', handleDynamicClicks);
    setupAllDragListeners();
}

// ★ 연차 사용기한(적용 시작일/사용 만료일) 변경 감지 → 새 적용 시작일 이전의 연차/반차 내역을 실제로 삭제
// 대상이 없으면 null, 취소되면 'cancelled', 정리할 게 있으면 { deletedCount, updatedLeaveData } 반환
async function prepareLeaveCleanup(oldConfig, newConfig) {
    const oldSettings = oldConfig.memberLeaveSettings || {};
    const newSettings = newConfig.memberLeaveSettings || {};

    const changedMembers = Object.keys(newSettings).filter(member => {
        const oldS = oldSettings[member] || {};
        const newS = newSettings[member] || {};
        return (oldS.leaveResetDate || '') !== (newS.leaveResetDate || '') ||
               (oldS.expirationDate || '') !== (newS.expirationDate || '');
    });

    if (changedMembers.length === 0) return null;

    const leaveData = await loadLeaveSchedule(db);
    const allLeaves = Array.isArray(leaveData.onLeaveMembers) ? leaveData.onLeaveMembers : [];

    const toDelete = [];
    changedMembers.forEach(member => {
        const newResetDate = (newSettings[member] || {}).leaveResetDate || '';
        if (!newResetDate) return; // 새 적용 시작일이 없으면 정리 대상 없음
        allLeaves.forEach(l => {
            if (l.member !== member) return;
            if (!(l.type && (l.type.includes('연차') || l.type.includes('반차')))) return;
            const d = l.startDate || l.date || '';
            if (d && d < newResetDate) toDelete.push(l);
        });
    });

    if (toDelete.length === 0) return null;

    const countByMember = {};
    toDelete.forEach(l => { countByMember[l.member] = (countByMember[l.member] || 0) + 1; });
    const summary = Object.entries(countByMember).map(([m, c]) => `${m} ${c}건`).join(', ');

    const confirmed = confirm(
        `연차 사용기한이 변경되어 새 적용 시작일 이전의 연차/반차 내역을 정리합니다.\n\n` +
        `삭제 대상: ${summary} (총 ${toDelete.length}건)\n\n` +
        `삭제된 내역은 복구할 수 없습니다. 계속하시겠습니까?`
    );
    if (!confirmed) return 'cancelled';

    const updatedLeaves = allLeaves.filter(l => !toDelete.includes(l));

    return {
        deletedCount: toDelete.length,
        updatedLeaveData: { ...leaveData, onLeaveMembers: updatedLeaves }
    };
}

async function handleSaveAll() {
    const btn = document.getElementById('save-all-btn');
    // 버튼을 잠가도 단축키·다른 경로로 들어올 수 있으므로 함수 입구에서 한 번 더 막는다.
    if (privateLoadFailed) {
        alert('급여·원가를 불러오지 못한 상태라 저장할 수 없습니다. 새로고침해 주세요.');
        return;
    }
    const btnHtml = btn ? btn.innerHTML : '';   // 끝나면 아이콘까지 그대로 되돌린다
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    try {
        // 🔐 권한 칸은 권한 화면의 메모리 모델에서 만든다. 모델이 없으면(화면 초기화 실패) 저장하지 않는다 —
        //    그대로 저장하면 권한 칸이 비거나 옛 값이 섞인다(mainConfig 는 통째 덮어쓰기).
        const uiModel = getPermModel();
        if (!uiModel) throw new Error('권한 화면을 불러오지 못해 저장을 막았습니다. 새로고침해 주세요.');
        // 팀원 탭에서 이메일만 고친 사람은 역할·예외·관리자 지정을 새 이메일로 옮긴다(안 옮기면 '새 팀원' 기본 역할로 떨어진다).
        const { renames, ambiguous } = detectEmailRenames(appConfig, uiModel);
        if (ambiguous) {
            throw new Error('이메일이 바뀐 사람이 있습니다 — 권한 화면에서 확인 후 저장해 주세요.\n'
                + '(이름과 이메일을 한꺼번에 바꿨거나, 팀원 삭제와 추가를 한 번에 했다면 나눠서 저장해 주세요. 아무것도 저장하지 않았습니다)');
        }
        // 로그인한 관리자 본인의 이메일은 바꿔 저장하지 않는다 — 규칙의 '자기 관리자 유지' 검사에 걸리고,
        //    그 전에 급여·원가(adminPrivate)만 먼저 써지는 일이 없게 여기서(쓰기 전에) 막는다.
        const myEmail = String((auth && auth.currentUser && auth.currentUser.email) || '').toLowerCase();
        if (myEmail && renames.some(r => r.from === myEmail)) {
            throw new Error('자기 이메일은 다른 관리자가 바꿔야 합니다.\n(아무것도 저장하지 않았습니다)');
        }
        const permModel = renameEmails(uiModel, renames);
        const autoCount = autoAssignedCount(permModel);
        const newConfig = collectConfigFromDOM(appConfig, permModel);
        validateConfig(newConfig);
        // 저장 전에 기능 집합 검사 — 손대지 않은 사람의 권한이 바뀌거나, 저장될 값이 화면과 다르거나, 옛 이메일 키가 남으면 멈춘다(건수만 알린다).
        const permCheck = verifyPermSave(permModel, newConfig, renames);
        if (permCheck.mismatch || permCheck.changed || permCheck.stale) {
            throw new Error(`[저장 멈춤] 권한 검사에 걸렸습니다 — 저장 값이 화면과 다른 사람 ${permCheck.mismatch}명, `
                + `손대지 않았는데 권한이 바뀌는 사람 ${permCheck.changed}명, 옛 이메일이 남은 사람 ${permCheck.stale}명.\n`
                + '아무것도 저장하지 않았습니다. 새로고침 후 다시 해 보고, 계속되면 개발 담당에게 알려 주세요.');
        }

        // 눌러도 열리지 않을 메뉴는 저장 전에 알린다(막지는 않는다 — 만들다 만 상태로 저장할 수도 있다).
        const deadMenus = findDeadMenuItems(newConfig.dashboardMenu);
        const nameless = countNamelessMenuRows();   // 이름이 비어 저장에서 빠질 줄
        if ((deadMenus.length || nameless) && !confirm('⚠️ 메뉴 관리에 확인할 줄이 있습니다.\n\n'
            + (deadMenus.length ? '눌러도 열리지 않는 메뉴(연결할 곳 없음):\n' + deadMenus.map(n => ' · ' + n).join('\n') + '\n\n' : '')
            + (nameless ? `이름이 비어 있어 저장되지 않고 사라질 메뉴: ${nameless}개\n\n` : '')
            + '그래도 저장할까요?')) {
            return;
        }

        const leaveCleanup = await prepareLeaveCleanup(appConfig, newConfig);
        if (leaveCleanup === 'cancelled') {
            return;
        }

        // 다른 창이 먼저 저장했으면 덮지 않는다(permRev 비교) — 규칙의 permRev +1 검사가 게시되기 전에도 화면에서 같은 판정을 한다.
        const serverRev = await readServerPermRev();
        if (serverRev !== permModel.baseRev) {
            alert('⚠️ 다른 창에서 먼저 저장했습니다 — 새로고침 후 다시 해 주세요.\n(이 화면에 입력한 내용은 그대로 두었습니다. 저장한 것은 없습니다)');
            return;
        }

        // permRev 비교와 mainConfig 쓰기를 한 트랜잭션으로(통째 set 은 그대로) — 위 확인과 저장 사이에 다른 창이 저장해도 덮지 않는다
        await saveAppConfig(db, newConfig, { expectPermRev: permModel.baseRev });
        if (leaveCleanup && leaveCleanup.updatedLeaveData) {
            await saveLeaveSchedule(db, leaveCleanup.updatedLeaveData);
            notifyLeaveScheduleChanged('admin-cleanup');
        }

        appConfig = newConfig;
        adminDirty = false;   // 저장 안 한 변경 경고 해제
        // 퇴사자는 저장할 때 접근이 전부 해제된다. 말없이 지우면 관리자가 눈치채지 못하므로 알린다.
        const resignedCount = Object.keys(newConfig.resignedMembers || {}).length;
        alert('✅ 모든 변경사항이 성공적으로 저장되었습니다!'
            + (leaveCleanup && leaveCleanup.deletedCount ? `\n(연차 내역 ${leaveCleanup.deletedCount}건 정리됨)` : '')
            + (resignedCount > 0 ? `\n(퇴사자 ${resignedCount}명은 권한 목록에서 제외되고 접근이 해제됩니다)` : '')
            + (autoCount > 0 ? `\n(옛 권한에서 자동 배정된 ${autoCount}명이 새 권한 형식으로 저장되었습니다)` : ''));

        renderAdminUI(appConfig);
        setupAllDragListeners();

    } catch (e) {
        console.error("저장 실패:", e);
        // 규칙(permRev +1 검사)이 게시된 뒤 옛 값으로 저장하려 하면 permission-denied 가 난다
        alert(e && (e.code === 'permission-denied' || e.code === 'perm-rev-conflict')
            ? '❌ 저장 거부됨 — 다른 창에서 먼저 저장했거나 권한이 없습니다. 새로고침 후 다시 해 주세요.\n(이 화면에 입력한 내용은 그대로 두었습니다)'
            : `❌ 저장 실패:\n${e.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
    }
}

/** 서버의 지금 permRev(없으면 0). 캐시가 아니라 서버에서 읽는다 — 못 읽으면 예외(저장하지 않는다). */
async function readServerPermRev() {
    const snap = await getDocFromServer(doc(db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig'));
    return snap.exists() ? (Number((snap.data() || {}).permRev) || 0) : 0;
}

function addKeyTask(taskName) {
    const nameToAdd = taskName || '새 주요 업무';
    if (!appConfig.keyTasks) appConfig.keyTasks = [];

    if (appConfig.keyTasks.some(t => t.trim().toLowerCase() === nameToAdd.trim().toLowerCase())) {
        alert("이미 등록된 업무입니다.");
        return;
    }
    appConfig.keyTasks.push(nameToAdd);
    renderKeyTasks(appConfig.keyTasks);
}

function addQuantityTask(taskName) {
    const nameToAdd = taskName || '새 처리량 업무';
    if (!appConfig.quantityTaskTypes) appConfig.quantityTaskTypes = [];

    if (appConfig.quantityTaskTypes.some(t => t.trim().toLowerCase() === nameToAdd.trim().toLowerCase())) {
        if (taskJustAdded === taskName) return; 
        alert("이미 등록된 업무입니다.");
        return;
    }
    appConfig.quantityTaskTypes.push(nameToAdd);
    renderQuantityTasks(appConfig.quantityTaskTypes);
    renderQuantityToDashboardMapping(appConfig);
}

function addCustomDashboardItem() {
    const newTitle = prompt("새로 추가할 수량 항목의 이름을 입력하세요:");
    if (!newTitle || newTitle.trim() === '') return;
    const trimmedTitle = newTitle.trim();

    const allDefinitions = getAllDashboardDefinitions(appConfig);
    if (Object.values(allDefinitions).some(def => def.title.toLowerCase() === trimmedTitle.toLowerCase())) {
        alert("이미 같은 이름의 항목이 존재합니다.");
        return;
    }

    const newId = `custom-${Date.now()}-${Math.random().toString(16).substring(2, 6)}`;
    if (!appConfig.dashboardCustomItems) appConfig.dashboardCustomItems = {};
    appConfig.dashboardCustomItems[newId] = { title: trimmedTitle, isQuantity: true };

    if (!appConfig.dashboardItems) appConfig.dashboardItems = [];
    appConfig.dashboardItems.push(newId);

    renderDashboardItemsConfig(appConfig.dashboardItems, appConfig);
    renderQuantityToDashboardMapping(appConfig);
}

function addTeamGroup() {
    const container = document.getElementById('team-groups-container');
    if (!container) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 team-group-card transition-colors';
    groupEl.innerHTML = `
        <div class="flex flex-wrap justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
            <div class="flex items-center gap-2">
                <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span> 
                <input type="text" value="새 그룹" class="text-lg font-extrabold text-gray-800 dark:text-white team-group-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1">
            </div>
            <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-team-group-btn">그룹 삭제</button>
        </div>
        <div class="space-y-3 members-container"></div>
        <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-center">
            <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition w-full md:w-auto add-member-btn">+ 팀원 추가</button>
        </div>
    `;
    container.appendChild(groupEl);
    setupDragDropListeners('.members-container', '.member-item'); 
}

function addTaskGroup() {
    const container = document.getElementById('task-groups-container');
    if (!container) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 task-group-card transition-colors';
    groupEl.innerHTML = `
         <div class="flex flex-wrap justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
            <div class="flex items-center gap-2"> 
               <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
               <input type="text" value="새 업무 그룹" class="text-lg font-extrabold text-gray-800 dark:text-white task-group-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1">
             </div>
            <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-task-group-btn">그룹 삭제</button>
        </div>
        <div class="space-y-2 tasks-container grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2"></div>
        <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
            <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition add-task-btn">+ 업무 추가</button>
        </div>
    `;
    container.appendChild(groupEl);
    setupDragDropListeners('.tasks-container', '.task-item');
}

// 📱 터치 화면(hover 없음)에선 삭제 버튼이 항상 보여 스크롤 중 잘못 누르기 쉬우므로 확인을 받는다.
//    마우스 환경은 지금처럼 확인 없이 바로 지운다.
const touchConfirm = (m) => !window.matchMedia('(hover: none)').matches || confirm(m);
const DELETE_CONFIRM_MSG = '삭제할까요? (전체 저장 전에는 새로고침하면 되돌아갑니다)';

function handleDynamicClicks(e) {
    // 🚪 퇴사자 섹션 접기/펼치기 (기본 접힘)
    const resignedToggle = e.target.closest('#resigned-toggle-btn');
    if (resignedToggle) {
        const list = document.getElementById('resigned-members-container');
        const chevron = document.getElementById('resigned-chevron');
        if (list) {
            const collapsed = list.classList.toggle('hidden');
            if (chevron) chevron.textContent = collapsed ? '▶' : '▼';
        }
        return;
    }

    if (e.target.classList.contains('reactivate-member-btn')) {
        // 🚪→✅ 재직 복귀: 퇴사일을 비우고 저장하면 원래 그룹의 재직 팀원으로 돌아감
        const item = e.target.closest('.member-item');
        if (item) {
            const dateInput = item.querySelector('.member-resign-date');
            if (dateInput) dateInput.value = '';
            item.classList.add('ring-2', 'ring-green-400');
            e.target.textContent = '복귀 예정 (저장하세요)';
            e.target.disabled = true;
        }
    }
    else if (e.target.classList.contains('delete-member-btn')) e.target.closest('.member-item')?.remove();
    else if (e.target.classList.contains('delete-team-group-btn')) { if (touchConfirm(DELETE_CONFIRM_MSG)) e.target.closest('.team-group-card')?.remove(); }
    else if (e.target.classList.contains('delete-key-task-btn')) { if (touchConfirm(DELETE_CONFIRM_MSG)) e.target.closest('.key-task-item')?.remove(); }
    else if (e.target.classList.contains('delete-task-btn')) { if (touchConfirm(DELETE_CONFIRM_MSG)) e.target.closest('.task-item')?.remove(); }
    else if (e.target.classList.contains('delete-task-group-btn')) { if (touchConfirm(DELETE_CONFIRM_MSG)) e.target.closest('.task-group-card')?.remove(); }
    else if (e.target.classList.contains('delete-quantity-task-btn')) {
        if (touchConfirm(DELETE_CONFIRM_MSG)) {
            e.target.closest('.quantity-task-item')?.remove();
            renderQuantityToDashboardMapping({ ...appConfig, quantityTaskTypes: getAllCurrentQuantityTasks() });
        }
    }
    else if (e.target.classList.contains('delete-dashboard-item-btn')) {
        if (touchConfirm(DELETE_CONFIRM_MSG)) {
            e.target.closest('.dashboard-item-config')?.remove();
            setTimeout(() => renderQuantityToDashboardMapping(collectConfigFromDOM(appConfig)), 0);
        }
    }
    
    else if (e.target.classList.contains('delete-menu-item-btn')) {
        if (touchConfirm(DELETE_CONFIRM_MSG)) e.target.closest('.menu-item')?.remove();
    }
    else if (e.target.classList.contains('delete-menu-category-btn')) {
        if(confirm('이 대분류와 포함된 모든 메뉴를 삭제하시겠습니까?')) {
            e.target.closest('.menu-category-card')?.remove();
        }
    }
    
    else if (e.target.classList.contains('delete-sys-account-btn')) {
        e.target.closest('.system-account-item')?.remove();
    }
    else if (e.target.closest('#add-system-account-btn')) {
        const container = document.getElementById('system-accounts-container');
        if (!container) return;
        
        const item = document.createElement('div');
        item.className = 'system-account-item flex flex-wrap md:flex-nowrap items-end gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 transition-colors';
        item.innerHTML = `
            <div class="flex flex-col flex-1 min-w-[150px]">
                <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">계정 이름 (별칭)</label>
                <input type="text" class="sys-name p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white outline-none focus:border-blue-500" placeholder="예: 외부 관리자">
            </div>
            <div class="flex flex-col flex-1 min-w-[200px]">
                <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">이메일 (로그인 ID)</label>
                <input type="email" class="sys-email p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white outline-none focus:border-blue-500" placeholder="admin@example.com">
            </div>
            <button type="button" class="delete-sys-account-btn w-full md:w-auto text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-4 py-2.5 rounded-md md:h-[38px] transition-colors shadow-sm">삭제</button>
        `;
        container.appendChild(item);
    }

    else if (e.target.classList.contains('add-menu-item-btn')) {
        const container = e.target.closest('.menu-category-card').querySelector('.menu-items-container');
        // 렌더링과 같은 줄 모양(연결할 곳 선택 목록 포함). 파일명을 칠 필요 없이 목록에서 고른다.
        const tmp = document.createElement('div');
        tmp.innerHTML = menuItemRowHtml({ name: '', link: '' }).trim();
        const newItemEl = tmp.firstElementChild;
        container.appendChild(newItemEl);
        newItemEl.querySelector('.menu-item-link')?.focus();
    }

    else if (e.target.classList.contains('add-member-btn')) {
        const container = e.target.closest('.team-group-card').querySelector('.members-container');
        const defaultWage = document.getElementById('default-part-timer-wage')?.value || 10000;
        const newMemberEl = document.createElement('div');
        newMemberEl.className = 'flex flex-col gap-3 mb-4 p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/30 member-item transition-colors';
        
        // 로컬 기준 오늘(UTC 로 바꾸면 한국시간 오전 9시 이전에 '어제'가 된다)
        const _n = new Date();
        const today = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, '0')}-${String(_n.getDate()).padStart(2, '0')}`;

        newMemberEl.innerHTML = `
            <div class="flex flex-wrap md:flex-nowrap justify-between items-start gap-4">
                <div class="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
                    <div class="flex flex-col">
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">이름</label>
                        <input type="text" value="새 팀원" class="member-name w-24 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white">
                    </div>

                    <div class="flex flex-col">
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">직급</label>
                        <select class="member-rank w-20 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white">
                            <option value="사원" selected>사원</option>
                            <option value="주임">주임</option>
                            <option value="대리">대리</option>
                            <option value="과장">과장</option>
                            <option value="차장">차장</option>
                            <option value="부장">부장</option>
                            <option value="이사">이사</option>
                            <option value="상무">상무</option>
                            <option value="전무">전무</option>
                            <option value="사장">사장</option>
                            <option value="대표">대표</option>
                        </select>
                    </div>

                    <div class="flex flex-col">
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">이메일</label>
                        <input type="email" value="" class="member-email w-48 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white" placeholder="example@email.com">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">시급</label>
                        <input type="number" value="${defaultWage}" class="member-wage w-24 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white">
                    </div>
                </div>
                <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-2 rounded-md transition delete-member-btn">삭제</button>
            </div>
            
            <div class="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <span class="text-xs font-bold text-gray-700 dark:text-gray-300 w-full md:w-auto mb-2 md:mb-0">연차 설정</span>
                <div class="flex flex-col">
                    <label class="text-[9px] text-gray-500 dark:text-gray-400 mb-1">입사일자</label>
                    <input type="date" value="${today}" class="member-join-date w-32 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded text-xs dark:text-gray-200">
                </div>
                <div class="flex flex-col">
                    <label class="text-[9px] text-gray-500 dark:text-gray-400 mb-1">총연차(일)</label>
                    <input type="number" value="15" class="member-total-leave w-16 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded text-xs text-center dark:text-gray-200" min="0">
                </div>
                <div class="hidden md:block w-px h-8 bg-gray-300 dark:bg-gray-600 mx-2"></div>
                <div class="flex flex-col">
                    <label class="text-[9px] text-gray-500 dark:text-gray-400 mb-1 font-bold">적용 시작일</label>
                    <input type="date" value="${today}" class="member-leave-reset-date w-32 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded text-xs font-bold text-gray-700 dark:text-gray-200">
                </div>
                <div class="flex flex-col">
                    <label class="text-[9px] text-red-500 dark:text-red-400 mb-1 font-bold">사용 만료일</label>
                    <input type="date" value="" class="member-leave-expiration-date w-32 p-1.5 border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 rounded text-xs text-red-700 dark:text-red-400">
                </div>
                <div class="hidden md:block w-px h-8 bg-gray-300 dark:bg-gray-600 mx-2"></div>
                <div class="flex flex-col">
                    <label class="text-[9px] text-gray-700 dark:text-gray-300 mb-1 font-bold">퇴사일 (비활성)</label>
                    <input type="date" value="" class="member-resign-date w-32 p-1.5 border border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-800 rounded text-xs font-bold text-gray-800 dark:text-gray-100" title="입력하면 이 날짜 다음날부터 팀 선택·명단·집계에서 제외됩니다. 급여·과거기록은 그대로 보존됩니다.">
                </div>
            </div>
        `;
        container.appendChild(newMemberEl);
    }
    else if (e.target.classList.contains('add-task-btn')) {
        const container = e.target.closest('.task-group-card').querySelector('.tasks-container');
        const newTaskEl = document.createElement('div');
        newTaskEl.className = 'flex items-center justify-between p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-500 transition-colors task-item group';
        newTaskEl.innerHTML = `
            <div class="flex items-center gap-2 flex-grow">
                <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
                <input type="text" value="새 업무" class="task-name flex-grow p-1.5 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 text-sm font-semibold dark:text-white outline-none">
            </div>
            <button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-task-btn opacity-0 group-hover:opacity-100">삭제</button>
        `;
        container.appendChild(newTaskEl);
        
        const input = newTaskEl.querySelector('.task-name');
        if (input) {
            input.focus();
            input.addEventListener('blur', handleNewTaskNameBlur, { once: true });
        }
    }

    const toggleBtn = e.target.closest('.config-card-toggle');
    if (toggleBtn) {
        const card = toggleBtn.closest('.config-card');
        card.querySelector('.config-card-content')?.classList.toggle('hidden');
        toggleBtn.querySelector('svg')?.classList.toggle('arrow-rotated');
    }
}

function handleNewTaskNameBlur(e) {
    const newTaskName = e.target.value.trim();
    if (!newTaskName || newTaskName === '새 업무') return;

    const currentQuantityTasks = getAllCurrentQuantityTasks();
    if (currentQuantityTasks.some(t => t.toLowerCase() === newTaskName.toLowerCase())) return;

    taskJustAdded = newTaskName;
    const msgEl = document.getElementById('confirm-add-to-quantity-message');
    if (msgEl) msgEl.textContent = `방금 추가한 '${newTaskName}' 업무를 처리량 집계 목록에도 추가하시겠습니까?`;
    document.getElementById('confirm-add-to-quantity-modal')?.classList.remove('hidden');
}

function getAllCurrentQuantityTasks() {
    const tasks = [];
    document.querySelectorAll('#quantity-tasks-container .quantity-task-name').forEach(el => {
        tasks.push(el.textContent.trim());
    });
    return tasks;
}

function setupAllDragListeners() {
    setupDragDropListeners('#team-groups-container', '.team-group-card');
    setupDragDropListeners('.members-container', '.member-item');
    setupDragDropListeners('#dashboard-items-container', '.dashboard-item-config');
    setupDragDropListeners('#key-tasks-container', '.key-task-item');
    setupDragDropListeners('#task-groups-container', '.task-group-card');
    setupDragDropListeners('.tasks-container', '.task-item');
    setupDragDropListeners('#quantity-tasks-container', '.quantity-task-item');
    setupDragDropListeners('#menu-categories-container', '.menu-category-card');
    setupDragDropListeners('.menu-items-container', '.menu-item');
}

function setupDragDropListeners(containerSelector, itemSelector) {
    const containers = document.querySelectorAll(containerSelector);
    containers.forEach(container => {
        if (container.dataset.dragAttached) return;
        container.dataset.dragAttached = 'true';

        container.addEventListener('dragstart', (e) => {
            if (!e.target.classList.contains('drag-handle')) return;
            if (draggedItem) return; 

            const item = e.target.closest(itemSelector);
            if (item) {
                draggedItem = item;
                setTimeout(() => { if (draggedItem) draggedItem.classList.add('dragging'); }, 0);
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setDragImage(item, 20, 20); } catch(err) {} 
            }
        });

        container.addEventListener('dragend', (e) => {
            if (draggedItem && draggedItem.matches(itemSelector)) {
                draggedItem.classList.remove('dragging');
                draggedItem = null;
                container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                if (containerSelector === '#dashboard-items-container') {
                    renderQuantityToDashboardMapping(collectConfigFromDOM(appConfig));
                }
            }
        });

        container.addEventListener('dragover', (e) => {
            if (!draggedItem || !draggedItem.matches(itemSelector)) return;
            e.preventDefault(); 
            
            const afterElement = getDragAfterElement(container, e.clientY, itemSelector);
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            if (afterElement) afterElement.classList.add('drag-over');
        });

        container.addEventListener('drop', (e) => {
            if (!draggedItem || !draggedItem.matches(itemSelector)) return;
            e.preventDefault();
            e.stopPropagation(); 
            
            const afterElement = getDragAfterElement(container, e.clientY, itemSelector);
            if (afterElement) container.insertBefore(draggedItem, afterElement);
            else container.appendChild(draggedItem);
            
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
    });
}

function getDragAfterElement(container, y, itemSelector) {
    const draggableElements = [...container.querySelectorAll(`${itemSelector}:not(.dragging)`)];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}