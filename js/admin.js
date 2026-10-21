// === js/admin.js ===
import { initializeFirebase, loadAppConfig, saveAppConfig, loadLeaveSchedule, saveLeaveSchedule, loadPrivateConfig, applyPrivateConfig } from './config.js?v=202610211344';
import { notifyLeaveScheduleChanged } from './leave-schedule-sync.js?v=202610211344';
import { setShellContext, onBeforeLeave, leaveAlreadyConfirmed } from './app-shell-bridge.js?v=202610211344';
import { memberNameFor } from './app-shell-data.js?v=202610211344';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { menuConfigOf } from './lib/perm.js?v=202610211344';
import { verifyPermSave, autoAssignedCount, renameEmails } from './lib/perm-model.js?v=202610211344';
import { getPermModel } from './admin-perm.js?v=202610211344';
import { showConfirm } from './utils.js?v=202610211344';
import { ensureTaskIds, newTaskId, isLockedTaskId, LOCKED_TASKS } from './lib/task-ids.js?v=202610211344';

import {
    renderAdminUI,
    renderKeyTasks,
    renderQuantityTasks,
    renderDashboardItemsConfig,
    renderQuantityToDashboardMapping,
    renderCostAnalysisConfig,
    taskItemHtml,
    populateTaskSelectModal,
    openDashboardItemModal,
    getAllDashboardDefinitions,
    renderDashboardMenu,
    menuItemRowHtml,
    buildMemberItemHtml,
    loadMenuPageList,
    findDeadMenuItems,
    countNamelessMenuRows
} from './admin-ui.js?v=202610211344';

import {
    collectConfigFromDOM,
    validateConfig,
    detectEmailRenames
} from './admin-logic.js?v=202610211344';

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
                    // 🆔 업무 id 를 메모리에서만 붙인다(첫 저장 때 기록 — 불러오기만으로는 쓰지 않는다)
                    appConfig = ensureTaskIds(appConfig);
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
                            + '새로고침해 주세요. 계속되면 관리자 화면의 권한 설정을 확인하세요.');
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
            redrawMappingFromScreen();
            
            document.getElementById('select-dashboard-item-modal')?.classList.add('hidden');
        }
    });

    document.getElementById('confirm-add-to-quantity-btn')?.addEventListener('click', () => {
        // 화면 값을 못 읽으면(이메일 중복 등) 창·고른 것을 그대로 둔다 — 고친 뒤 다시 [확인]
        if (taskJustAdded && !applyNewTaskLinks(taskJustAdded, {
            quantity: !!document.getElementById('new-task-add-quantity')?.checked,
            key: !!document.getElementById('new-task-add-key')?.checked,
            widget: document.getElementById('new-task-dashboard-link')?.value || ''
        })) return;
        document.getElementById('confirm-add-to-quantity-modal')?.classList.add('hidden');
        taskJustAdded = null;
    });
    // 처리량에 넣지 않으면 위젯 연결도 못 고른다(연결 줄은 처리량 업무에만 있다)
    document.getElementById('new-task-add-quantity')?.addEventListener('change', syncNewTaskWidgetSelect);
    document.getElementById('cancel-add-to-quantity-btn')?.addEventListener('click', () => {
        document.getElementById('confirm-add-to-quantity-modal')?.classList.add('hidden');
        taskJustAdded = null;
    });

    document.body.addEventListener('click', handleDynamicClicks);
    // 🆔 기존 업무 이름을 고치면(칸을 벗어날 때) 같은 업무의 다른 그룹 칸도 맞추고, 주요 업무·처리량·위젯 연결·원가 칸을 새 이름으로 다시 그린다
    document.getElementById('task-groups-container')?.addEventListener('change', (e) => {
        const input = e.target.closest && e.target.closest('.task-name');
        if (!input) return;
        const id = input.closest('.task-item')?.dataset.taskId;
        if (id) document.querySelectorAll('#task-groups-container .task-item').forEach(row => {
            const other = row.querySelector('.task-name');
            if (row.dataset.taskId === id && other && other !== input) other.value = input.value;
        });
        refreshTaskViews();
    });
    setupAllDragListeners();
}

// 🆔 지금 화면 기준 설정(미리보기) — 업무 이름 변경이 반영된 이름 칸. 못 만들면(이메일 중복 등) null.
//    ensureTaskIds 를 다시 부르지 않는다(id 를 새로 만들면 이름 변경을 못 알아본다).
function previewTaskConfig() {
    try { return collectConfigFromDOM(appConfig); } catch (e) { lastPreviewError = e; return null; }
}
let lastPreviewError = null;
// 미리보기를 못 만들면 저장 전 설정(appConfig)으로 다시 그리지 않는다 — 이번에 추가·변경한 줄이 사라진다. 알리고 멈춘다.
function previewOrWarn() {
    const cfg = previewTaskConfig();
    if (!cfg) alert('화면 값을 읽지 못해 목록을 다시 그리지 않았습니다(입력한 내용은 그대로 둡니다).\n'
        + (lastPreviewError && lastPreviewError.message ? lastPreviewError.message + '\n' : '')
        + '위 문제를 먼저 고친 뒤 다시 해 주세요.');
    return cfg;
}
function redrawMappingFromScreen() {
    const cfg = previewOrWarn();
    if (cfg) renderQuantityToDashboardMapping(cfg);
}

function refreshTaskViews() {
    const cfg = previewTaskConfig();
    if (!cfg) return;
    renderKeyTasks(cfg.keyTasks || [], cfg.taskIdNames);
    renderQuantityTasks(cfg.quantityTaskTypes || [], cfg.taskIdNames);
    renderQuantityToDashboardMapping(cfg);
    renderCostAnalysisConfig(cfg);
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
        const taskInfo = {};
        const newConfig = collectConfigFromDOM(appConfig, permModel, taskInfo);
        validateConfig(newConfig);
        // 저장 전에 기능 집합 검사 — 손대지 않은 사람의 권한이 바뀌거나, 저장될 값이 화면과 다르거나, 옛 이메일 키가 남으면 멈춘다(건수만 알린다).
        const permCheck = verifyPermSave(permModel, newConfig, renames);
        if (permCheck.mismatch || permCheck.changed || permCheck.stale) {
            throw new Error(`[저장 멈춤] 권한 검사에 걸렸습니다 — 저장 값이 화면과 다른 사람 ${permCheck.mismatch}명, `
                + `손대지 않았는데 권한이 바뀌는 사람 ${permCheck.changed}명, 옛 이메일이 남은 사람 ${permCheck.stale}명.\n`
                + '아무것도 저장하지 않았습니다. 새로고침 후 다시 해 보고, 계속되면 개발 담당에게 알려 주세요.');
        }

        // 🆔 업무 이름 변경은 저장 전에 무엇이 함께 바뀌는지 보여 주고 확인받는다
        if ((taskInfo.renames && taskInfo.renames.length) || (taskInfo.reused && taskInfo.reused.length)) {
            if (!(await showConfirm(taskRenameMessage(taskInfo, appConfig), { title: '업무 이름 변경', okText: '바꾸고 저장' }))) return;
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

// 업무 이름 칸 → 확인창에 보일 이름
const TASK_FIELD_LABELS = {
    keyTasks: '주요 업무', quantityTaskTypes: '처리량 집계', costCalcTasks: '원가 계산', qualityCostTasks: '품질비용',
    quantityToDashboardMap: '대시보드 위젯 연결', simulationTaskLinks: '시뮬레이션 연결',
    forecastBacklogTasks: '예측 이월', staffingBasketTasks: '인원 산정'
};
const taskFieldLabel = (f) => TASK_FIELD_LABELS[f] || (f.startsWith('sim') ? '예측 설정(' + f + ')' : f);

function taskRenameMessage(info, beforeCfg) {
    const lines = [];
    (info.renames || []).forEach(r => {
        lines.push(`이름 변경: ${r.from} → ${r.to}`);
        const labels = [...new Set(r.fields.map(taskFieldLabel))];
        lines.push(`  함께 바뀌는 설정: ${labels.length ? labels.join(', ') : '없음'}`);
    });
    (info.reused || []).forEach(u => {
        const prev = (beforeCfg.taskIdNames || {})[u.prevId] || '지운 업무';
        lines.push(`'${u.name}' 은(는) 예전에 다른 업무(지금 '${prev}')의 이름이었습니다 — 옛 기록이 이 업무로 합쳐 보입니다.`);
    });
    lines.push('', '과거 기록은 옛 이름으로 남고 통계에서 합쳐 봅니다.',
        '오늘 진행 중인 업무는 옛 이름으로 마감되니 마감 뒤에 바꾸는 것이 안전합니다.');
    return lines.join('\n');
}

/** 서버의 지금 permRev(없으면 0). 캐시가 아니라 서버에서 읽는다 — 못 읽으면 예외(저장하지 않는다). */
async function readServerPermRev() {
    const snap = await getDocFromServer(doc(db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig'));
    return snap.exists() ? (Number((snap.data() || {}).permRev) || 0) : 0;
}

// 목록은 지금 화면 기준(미리보기)으로 다시 그린다 — 저장 전 설정(appConfig)으로 그리면 방금 바꾼 업무 이름이 옛 이름으로 돌아간다.
function addKeyTask(taskName) {
    const nameToAdd = taskName || '새 주요 업무';
    const cfg = previewOrWarn();
    if (!cfg) return;
    const list = (cfg.keyTasks || []).slice();

    if (list.some(t => t.trim().toLowerCase() === nameToAdd.trim().toLowerCase())) {
        alert("이미 등록된 업무입니다.");
        return;
    }
    list.push(nameToAdd);
    renderKeyTasks(list, cfg.taskIdNames);
}

function addQuantityTask(taskName) {
    const nameToAdd = taskName || '새 처리량 업무';
    const cfg = previewOrWarn();
    if (!cfg) return;
    const list = (cfg.quantityTaskTypes || []).slice();

    if (list.some(t => t.trim().toLowerCase() === nameToAdd.trim().toLowerCase())) {
        if (taskJustAdded === taskName) return; 
        alert("이미 등록된 업무입니다.");
        return;
    }
    list.push(nameToAdd);
    renderQuantityTasks(list, cfg.taskIdNames);
    renderQuantityToDashboardMapping({ ...cfg, quantityTaskTypes: list });
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
    redrawMappingFromScreen();
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
    else if (e.target.classList.contains('delete-member-btn')) {
        // 팀원 삭제는 과거 급여 계산까지 빠지므로 항상 확인(퇴사는 퇴사일로)
        const item = e.target.closest('.member-item');
        if (item) {
            const name = item.querySelector('.member-name')?.value.trim() || '(이름 없음)';
            showConfirm(`'${name}' 팀원을 목록에서 삭제할까요?\n퇴사라면 삭제 대신 '퇴사일'을 넣으세요 — 삭제하면 과거 기록 계산에서 급여까지 빠집니다.\n(전체 저장 전에는 새로고침하면 되돌아갑니다)`,
                { title: '팀원 삭제', okText: '삭제', danger: true }).then(ok => ok && item.remove());
        }
    }
    else if (e.target.classList.contains('delete-team-group-btn')) {
        // 그룹 삭제는 소속 팀원까지 함께 지워지므로 마우스 환경에서도 확인
        const card = e.target.closest('.team-group-card');
        if (card) {
            const gName = card.querySelector('.team-group-name')?.value.trim() || '(이름 없음)';
            const cnt = card.querySelectorAll('.members-container .member-item').length;
            showConfirm(`'${gName}' 그룹을 삭제할까요?\n이 그룹의 팀원 ${cnt}명도 함께 목록에서 빠집니다.\n(전체 저장 전에는 새로고침하면 되돌아갑니다)`,
                { title: '그룹 삭제', okText: '삭제', danger: true }).then(ok => ok && card.remove());
        }
    }
    else if (e.target.classList.contains('delete-key-task-btn')) { if (touchConfirm(DELETE_CONFIRM_MSG)) e.target.closest('.key-task-item')?.remove(); }
    else if (e.target.classList.contains('delete-task-btn')) {
        // 🔒 프로그램이 이름으로 계산하는 업무는 마우스 환경에서도 한 번 더 묻는다
        const row = e.target.closest('.task-item');
        if (row && isLockedTaskId(row.dataset.taskId)) {
            const name = row.querySelector('.task-name')?.value.trim() || '';
            showConfirm(`'${name}' 은(는) 프로그램이 이 이름으로 계산하는 업무입니다(예측·대시보드 등).\n지우면 그 계산에서 빠집니다. 그래도 삭제할까요?\n(전체 저장 전에는 새로고침하면 되돌아갑니다)`,
                { title: '고정 업무 삭제', okText: '삭제', danger: true }).then(ok => ok && row.remove());
        } else if (touchConfirm(DELETE_CONFIRM_MSG)) row?.remove();
    }
    else if (e.target.classList.contains('delete-task-group-btn')) {
        const card = e.target.closest('.task-group-card');
        const locked = card ? [...card.querySelectorAll('.task-item')].filter(r => isLockedTaskId(r.dataset.taskId))
            .map(r => r.querySelector('.task-name')?.value.trim()).filter(Boolean) : [];
        if (locked.length) {
            showConfirm(`이 그룹에 프로그램이 이름으로 계산하는 업무가 있습니다: ${locked.join(', ')}\n그룹을 지우면 그 계산에서 빠집니다. 그래도 삭제할까요?\n(전체 저장 전에는 새로고침하면 되돌아갑니다)`,
                { title: '그룹 삭제', okText: '삭제', danger: true }).then(ok => ok && card.remove());
        } else if (touchConfirm(DELETE_CONFIRM_MSG)) card?.remove();
    }
    else if (e.target.classList.contains('delete-quantity-task-btn')) {
        if (touchConfirm(DELETE_CONFIRM_MSG)) {
            e.target.closest('.quantity-task-item')?.remove();
            // 지금 화면 기준으로(업무 이름 변경·고른 위젯 유지)
            redrawMappingFromScreen();
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
        const item = e.target.closest('.system-account-item');
        if (item) {
            const alias = item.querySelector('.sys-name')?.value.trim() || '(별칭 없음)';
            showConfirm(`시스템 계정 '${alias}'을(를) 삭제할까요?\n(전체 저장 전에는 새로고침하면 되돌아갑니다)`,
                { title: '시스템 계정 삭제', okText: '삭제', danger: true }).then(ok => ok && item.remove());
        }
    }
    else if (e.target.closest('#add-system-account-btn')) {
        const container = document.getElementById('system-accounts-container');
        if (!container) return;
        
        const item = document.createElement('div');
        item.className = 'system-account-item flex flex-wrap md:flex-nowrap items-end gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 transition-colors';
        item.innerHTML = `
            <div class="flex flex-col flex-1 min-w-[150px]">
                <label class="text-[11px] text-gray-500 dark:text-gray-400 font-bold mb-1">계정 이름 (별칭)</label>
                <input type="text" class="sys-name p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white outline-none focus:border-blue-500" placeholder="예: 외부 관리자">
            </div>
            <div class="flex flex-col flex-1 min-w-[200px]">
                <label class="text-[11px] text-gray-500 dark:text-gray-400 font-bold mb-1">이메일 (로그인 ID)</label>
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
        const card = e.target.closest('.team-group-card');
        const container = card.querySelector('.members-container');
        const groupName = card.querySelector('.team-group-name')?.value.trim() || '';

        // 로컬 기준 오늘(UTC 로 바꾸면 한국시간 오전 9시 이전에 '어제'가 된다)
        const _n = new Date();
        const today = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, '0')}-${String(_n.getDate()).padStart(2, '0')}`;

        // 기존 행과 같은 함수로 그린다. member-wage 는 월 기본급(저장 후 ÷209 = 시급)이라
        // 예전처럼 알바 시급을 기본값으로 넣으면 시급이 수십 원이 됐다 → 기본급 0 으로 시작.
        const newName = '새 팀원';
        const maps = { memberLeaveSettings: { [newName]: { joinDate: today, totalLeave: 15, leaveResetDate: today } } };
        const tmp = document.createElement('div');
        tmp.innerHTML = buildMemberItemHtml(newName, maps, groupName).trim();
        const newMemberEl = tmp.firstElementChild;
        container.appendChild(newMemberEl);
    }
    else if (e.target.classList.contains('add-task-btn')) {
        const container = e.target.closest('.task-group-card').querySelector('.tasks-container');
        // 🆔 새 업무 id — 화면의 id·저장된 id·별칭이 가리키는 id 와 겹치지 않게
        const used = new Set([...Object.keys(appConfig.taskIdNames || {}), ...Object.values(appConfig.taskAliases || {})]);
        document.querySelectorAll('#task-groups-container .task-item').forEach(r => { if (r.dataset.taskId) used.add(r.dataset.taskId); });
        const tmp = document.createElement('div');
        tmp.innerHTML = taskItemHtml('새 업무', newTaskId(used)).trim();
        const newTaskEl = tmp.firstElementChild;
        container.appendChild(newTaskEl);
        
        const input = newTaskEl.querySelector('.task-name');
        if (input) {
            input.focus();
            // 이름을 정해 칸을 벗어날 때 한 번만 묻는다('새 업무' 그대로면 다음에 벗어날 때 묻는다)
            input.addEventListener('blur', handleNewTaskNameBlur);
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
    const input = e.target;
    const newTaskName = input.value.trim();
    if (!newTaskName || newTaskName === '새 업무') return;
    // 한 줄에 한 번만 — 뒤에 이름을 또 바꿔도 다시 묻지 않는다
    input.removeEventListener('blur', handleNewTaskNameBlur);

    // 이미 있는 업무 이름(잠금 업무·다른 그룹의 같은 업무·저장된 업무)으로 만든 줄은 그 업무의 설정을 따르므로 묻지 않는다
    const key = newTaskName.toLowerCase();
    const sameName = (n) => String(n || '').trim().toLowerCase() === key;
    if (Object.keys(LOCKED_TASKS).some(sameName)) return;
    if (Object.values(appConfig.taskIdNames || {}).some(sameName)) return;
    const row = input.closest('.task-item');
    if ([...document.querySelectorAll('#task-groups-container .task-item')]
        .some(r => r !== row && sameName(r.querySelector('.task-name')?.value))) return;

    const currentQuantityTasks = getAllCurrentQuantityTasks();
    if (currentQuantityTasks.some(t => t.toLowerCase() === key)) return;

    taskJustAdded = newTaskName;
    const msgEl = document.getElementById('confirm-add-to-quantity-message');
    if (msgEl) msgEl.textContent = `방금 추가한 '${newTaskName}' 업무를 어디에 함께 넣을까요?`;
    // 고르는 칸은 열 때마다 기본값으로(처리량 예 · 주요 업무 아니요 · 위젯 연동 안 함)
    const qty = document.getElementById('new-task-add-quantity');
    if (qty) qty.checked = true;
    const keyChk = document.getElementById('new-task-add-key');
    if (keyChk) keyChk.checked = false;
    fillNewTaskWidgetOptions();
    syncNewTaskWidgetSelect();
    document.getElementById('confirm-add-to-quantity-modal')?.classList.remove('hidden');
}

// 위젯 연결 줄(renderQuantityToDashboardMapping)과 같은 출처 — 화면의 위젯 항목 중 수량 항목
// 다른 업무가 이미 연결한 위젯은 '(사용 중: 업무명)' 으로 보이고 고를 수 없다(지금 화면 기준)
function fillNewTaskWidgetOptions() {
    const select = document.getElementById('new-task-dashboard-link');
    if (!select) return;
    const defs = getAllDashboardDefinitions(appConfig);
    // 미리보기를 못 만들면 저장 전 설정(appConfig)으로 대신하지 않는다 — 표시만 생략([확인] 때 previewOrWarn 이 알린다)
    const preview = previewTaskConfig();
    const map = (preview && preview.quantityToDashboardMap) || {};
    const usedBy = {};
    Object.entries(map).forEach(([task, wid]) => { if (wid && !(wid in usedBy)) usedBy[wid] = task; });
    select.innerHTML = '';
    select.add(new Option('-- 연동 안 함 --', ''));
    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(span => {
        const id = span.dataset.id;
        const def = defs[id];
        if (!def || !def.isQuantity) return;
        const title = span.textContent.trim().replace('📦 ', '');
        const opt = new Option(id in usedBy ? `${title} (사용 중: ${usedBy[id]})` : title, id);
        opt.disabled = id in usedBy;
        select.add(opt);
    });
    select.value = '';
}

function syncNewTaskWidgetSelect() {
    const select = document.getElementById('new-task-dashboard-link');
    if (!select) return;
    const on = !!document.getElementById('new-task-add-quantity')?.checked;
    select.disabled = !on;
    if (!on) select.value = '';
}

// 새 업무 연결 창의 [확인] — 지금 화면 기준(미리보기)에 고른 것만 더해 다시 그린다. 저장은 [전체 저장]
// 화면 값을 못 읽었으면 false(아무것도 넣지 않음), 그 밖엔 true
function applyNewTaskLinks(taskName, { quantity, key, widget }) {
    if (!quantity && !key) return true;
    const cfg = previewOrWarn();
    if (!cfg) return false;
    const has = (list, n) => list.some(t => t.trim().toLowerCase() === n.trim().toLowerCase());
    if (key) {
        const keyTasks = (cfg.keyTasks || []).slice();
        if (!has(keyTasks, taskName)) keyTasks.push(taskName);
        renderKeyTasks(keyTasks, cfg.taskIdNames);
    }
    if (quantity) {
        const qtyTasks = (cfg.quantityTaskTypes || []).slice();
        if (!has(qtyTasks, taskName)) qtyTasks.push(taskName);
        const map = { ...(cfg.quantityToDashboardMap || {}) };
        if (widget) map[taskName] = widget;
        renderQuantityTasks(qtyTasks, cfg.taskIdNames);
        renderQuantityToDashboardMapping({ ...cfg, quantityTaskTypes: qtyTasks, quantityToDashboardMap: map });
    }
    return true;
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
                    redrawMappingFromScreen();
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