// === js/admin-logic.js ===
import { getAllDashboardDefinitions, readMenuItem } from './admin-ui.js?v=202610261304';
import { withBuiltinMenus } from './menu-catalog.js?v=202610261304';
import { buildResignedEmails } from './lib/resigned-emails.js?v=202610261304';
import { resolve as resolvePerm, menuNamesFor } from './lib/perm.js?v=202610261304';
import { permFieldsForSave } from './lib/perm-model.js?v=202610261304';
import { collectTaskIds, applyTaskRenames, validateTaskNames, newTaskId } from './lib/task-ids.js?v=202610261304';

// 권한 칸 — DOM 을 긁지 않고 권한 화면의 메모리 모델(js/lib/perm-model.js)에서 만든다(권한 개편 R-a).
export const PERM_SAVE_KEYS = ['memberRoles', 'memberMenuAccess', 'permRoles', 'permAssign', 'permOverrides',
    'permDefaultRole', 'permEnforce', 'permRev'];

/** 팀원 탭에서 이메일만 고친 사람을 찾는다(같은 행 = 같은 이름, 시스템 계정은 같은 계정 이름).
 *  → { renames:[{from,to}], ambiguous }. ambiguous 면 저장을 막는다(admin.js) — 옛 이메일이 사라지면서 모르는 새 이메일이
 *  생겼는데 이름으로 이을 수 없을 때(이름도 함께 바꿈, 삭제와 추가를 한 번에 함, 이메일 맞바꿈 등).
 *  그대로 저장하면 새 이메일은 '새 팀원'(기본 역할)이 되고 옛 역할·예외·관리자 지정은 옛 키에 남는다. */
export function detectEmailRenames(currentConfig, permModel) {
    const lower = (s) => String(s || '').trim().toLowerCase();
    const before = {};
    Object.entries((currentConfig && currentConfig.memberEmails) || {}).forEach(([n, e]) => { if (e) before['m:' + n] = lower(e); });
    ((currentConfig && currentConfig.systemAccounts) || []).forEach(a => { if (a && a.name && a.email) before['s:' + a.name] = lower(a.email); });
    const rows = [];
    const memberRow = (el) => rows.push({ key: 'm:' + (el.querySelector('.member-name')?.value || '').trim(), email: lower(el.querySelector('.member-email')?.value) });
    document.querySelectorAll('#team-groups-container .team-group-card').forEach(card => card.querySelectorAll('.member-item').forEach(memberRow));
    document.querySelectorAll('#resigned-members-container .member-item').forEach(memberRow);
    document.querySelectorAll('#system-accounts-container .system-account-item').forEach(el => rows.push({
        key: 's:' + (el.querySelector('.sys-name')?.value || '').trim(), email: lower(el.querySelector('.sys-email')?.value) }));
    const persons = (permModel && permModel.persons) || {};
    const now = new Set(rows.map(r => r.email).filter(Boolean));
    const renames = [];
    let ambiguous = false;
    for (const r of rows) {
        const old = before[r.key];
        if (!old || !r.email || old === r.email || !persons[old]) continue;
        // 같은 사람이 그룹 두 곳에 있으면 같은 변경 쌍이 여러 번 나온다 — 한 번만 반영한다(애매한 것이 아니다)
        if (renames.some(x => x.from === old && x.to === r.email)) continue;
        if (now.has(old) || persons[r.email] || renames.some(x => x.from === old || x.to === r.email)) { ambiguous = true; continue; }
        renames.push({ from: old, to: r.email });
    }
    const moved = new Set(renames.map(x => x.from));
    const known = new Set(Object.keys((currentConfig && currentConfig.memberRoles) || {}).map(lower));
    const gone = Object.keys(persons).filter(e => !now.has(e) && !moved.has(e));
    const added = [...now].filter(e => !persons[e] && !known.has(e) && !renames.some(x => x.to === e));
    if (gone.length && added.length) ambiguous = true;
    return { renames, ambiguous };
}

/** permModel: 권한 화면 모델. 없으면 권한 칸을 저장 전 값 그대로 둔다(메뉴 미리보기용 호출 등) — 이때 저장은 admin.js 가 막는다.
 *  taskInfo: 객체를 주면 업무 이름 변경 결과를 채운다 { renames, reused } (저장 확인창용). 반환값은 예전처럼 설정 하나. */
export function collectConfigFromDOM(currentConfig, permModel = null, taskInfo = null) {
    // ⚠️ 아래 목록에 없는 설정도 그대로 보존해야 한다.
    //    saveAppConfig 는 문서를 통째로 덮어쓰므로(merge 아님), 여기서 빠뜨린 키는
    //    관리자 설정을 한 번 저장하는 순간 Firestore에서 사라진다.
    //    (예: headcountExcludedMembers, utilizationRate)
    const newConfig = {
        ...(currentConfig || {}),

        dashboardMenu: [],
        teamGroups: [],
        memberWages: {},
        memberEmails: {},
        memberRoles: {},       // 아래 '권한 칸' 에서 채운다(모델 또는 저장 전 값 사본)
        memberMenuAccess: {},  // 파생값 — 기능 권한에서 다시 만든다(옛 코드·셸 호환)
        memberRanks: {},
        memberLeaveSettings: {},
        resignedMembers: {}, // 퇴사 처리(비활성): { 이름: 퇴사일 }
        resignedEmails: {}, // { 이메일(소문자): 퇴사일 } — 저장마다 resignedMembers·memberEmails 로 만들고 이전 값을 물려받는다(재직 중이 된 이메일만 뺌, 2026-10-23)
        systemAccounts: [], 
        dashboardItems: [],
        dashboardCustomItems: {},
        quantityToDashboardMap: {},
        keyTasks: [],
        taskGroups: [],
        quantityTaskTypes: [],
        
        defaultPartTimerWage: 10000,
        standardMonthlyWorkHours: 209,

        fixedMaterialCost: 0,
        fixedShippingCost: 0,
        fixedDirectDeliveryCost: 0,
        costCalcTasks: [],

        simulationTaskLinks: currentConfig.simulationTaskLinks || {},
        qualityCostTasks: currentConfig.qualityCostTasks || [],
        systemAccountsOld: currentConfig.systemAccounts || [], 
        standardDailyWorkHours: currentConfig.standardDailyWorkHours || { weekday: 8, weekend: 4 }
    };

    const emailCheck = new Map();
    let duplicateEmailError = null;

    document.querySelectorAll('#menu-categories-container .menu-category-card').forEach(categoryCard => {
        const categoryNameInput = categoryCard.querySelector('.menu-category-name');
        const categoryName = categoryNameInput ? categoryNameInput.value.trim() : '';
        if (!categoryName) return;
        
        const items = [];
        categoryCard.querySelectorAll('.menu-item').forEach(itemEl => {
            // 링크 칸은 이제 '연결할 곳' 선택 목록이다. 값 해석은 admin-ui 의 readMenuItem 이 맡는다.
            const it = readMenuItem(itemEl);
            if (it) items.push(it);
        });
        newConfig.dashboardMenu.push({ category: categoryName, items: items });
    });

    document.querySelectorAll('#team-groups-container .team-group-card').forEach(groupCard => {
        const groupNameInput = groupCard.querySelector('.team-group-name');
        const groupName = groupNameInput ? groupNameInput.value.trim() : '';
        if (!groupName) return;

        const newGroup = { name: groupName, members: [] };

        groupCard.querySelectorAll('.member-item').forEach(memberItem => {
            const memberName = memberItem.querySelector('.member-name').value.trim();
            const memberEmail = memberItem.querySelector('.member-email').value.trim();
            const memberWage = Number(memberItem.querySelector('.member-wage').value) || 0;
            const memberRank = memberItem.querySelector('.member-rank')?.value || '사원'; 

            const joinDate = memberItem.querySelector('.member-join-date').value;
            const totalLeave = Number(memberItem.querySelector('.member-total-leave').value) || 0;
            const leaveResetDate = memberItem.querySelector('.member-leave-reset-date').value;
            const expirationDate = memberItem.querySelector('.member-leave-expiration-date').value;
            const resignDate = memberItem.querySelector('.member-resign-date')?.value || '';

            if (!memberName) return;

            newGroup.members.push(memberName);
            newConfig.memberWages[memberName] = memberWage;
            newConfig.memberRanks[memberName] = memberRank;
            // 퇴사일이 입력된 팀원만 퇴사 명단에 기록(데이터는 그대로 보존, 화면에서만 비활성)
            if (resignDate) newConfig.resignedMembers[memberName] = resignDate;

            newConfig.memberLeaveSettings[memberName] = {
                joinDate: joinDate,
                totalLeave: totalLeave,
                leaveResetDate: leaveResetDate,
                expirationDate: expirationDate 
            };

            if (memberEmail) {
                const emailLower = memberEmail.toLowerCase();
                if (emailCheck.has(emailLower) && emailCheck.get(emailLower) !== memberName) {
                    duplicateEmailError = memberEmail;
                }
                emailCheck.set(emailLower, memberName);
                newConfig.memberEmails[memberName] = memberEmail;
            }
        });
        newConfig.teamGroups.push(newGroup);
    });

    // 🚪 퇴사자 섹션: 원래 그룹으로 되돌리고 급여·연차·이메일·퇴사일을 모두 보존(데이터 유실 방지).
    //    (퇴사일을 비운 채 저장하면 resignedMembers에 안 들어가 → 재직으로 복귀)
    document.querySelectorAll('#resigned-members-container .member-item').forEach(memberItem => {
        const memberName = memberItem.querySelector('.member-name').value.trim();
        if (!memberName) return;

        const groupName = memberItem.dataset.groupName || '';
        const memberEmail = memberItem.querySelector('.member-email').value.trim();
        const memberWage = Number(memberItem.querySelector('.member-wage').value) || 0;
        const memberRank = memberItem.querySelector('.member-rank')?.value || '사원';
        const joinDate = memberItem.querySelector('.member-join-date').value;
        const totalLeave = Number(memberItem.querySelector('.member-total-leave').value) || 0;
        const leaveResetDate = memberItem.querySelector('.member-leave-reset-date').value;
        const expirationDate = memberItem.querySelector('.member-leave-expiration-date').value;
        const resignDate = memberItem.querySelector('.member-resign-date')?.value || '';

        // 원래 소속 그룹으로 되돌림(그룹이 삭제됐으면 복원 생성해 데이터 보존)
        let grp = newConfig.teamGroups.find(g => g.name === groupName);
        if (!grp) { grp = { name: groupName || '퇴사자', members: [] }; newConfig.teamGroups.push(grp); }
        if (!grp.members.includes(memberName)) grp.members.push(memberName);

        newConfig.memberWages[memberName] = memberWage;
        newConfig.memberRanks[memberName] = memberRank;
        newConfig.memberLeaveSettings[memberName] = { joinDate, totalLeave, leaveResetDate, expirationDate };

        if (memberEmail) {
            const emailLower = memberEmail.toLowerCase();
            if (emailCheck.has(emailLower) && emailCheck.get(emailLower) !== memberName) duplicateEmailError = memberEmail;
            emailCheck.set(emailLower, memberName);
            newConfig.memberEmails[memberName] = memberEmail;
        }

        if (resignDate) newConfig.resignedMembers[memberName] = resignDate;
    });

    document.querySelectorAll('#system-accounts-container .system-account-item').forEach(item => {
        const name = item.querySelector('.sys-name').value.trim();
        const email = item.querySelector('.sys-email').value.trim();

        if (name && email) {
            newConfig.systemAccounts.push({ name, email });
            const emailLower = email.toLowerCase();
            if (emailCheck.has(emailLower) && emailCheck.get(emailLower) !== name) {
                duplicateEmailError = email;
            }
            emailCheck.set(emailLower, name);
        }
    });

    if (duplicateEmailError) {
        throw new Error(`이메일 주소 '${duplicateEmailError}'가 중복 할당되었습니다. 모든 팀원 및 시스템 계정의 이메일은 고유해야 합니다.`);
    }

    // 🔐 권한 칸 — 권한 화면의 메모리 모델에서 만든다(DOM 을 긁지 않는다). 모델이 없으면 저장 전 값 사본을 둔다.
    //    메뉴는 권한 화면·사이드바와 같은 목록(코드로 붙는 신규 메뉴 포함)으로 파생값을 만든다.
    const menuGroups = withBuiltinMenus(newConfig.dashboardMenu);
    if (permModel) {
        Object.assign(newConfig, permFieldsForSave(permModel, menuGroups, currentConfig));
    } else {
        PERM_SAVE_KEYS.forEach(k => {
            if (currentConfig && currentConfig[k] !== undefined) newConfig[k] = JSON.parse(JSON.stringify(currentConfig[k]));
        });
    }
    newConfig.permAssign = { ...(newConfig.permAssign || {}) };
    newConfig.permOverrides = { ...(newConfig.permOverrides || {}) };
    const dropPerm = (email) => { delete newConfig.permAssign[email]; delete newConfig.permOverrides[email]; };
    const systemEmails = new Set(newConfig.systemAccounts.map(a => String(a.email || '').toLowerCase()));

    // 퇴사자 이메일은 이 기본값 부여에서 제외한다.
    // 권한 화면에서 퇴사자를 뿌렸기 때문에, 제외하지 않으면 아래 루프가
    // '목록에 없는 사람'으로 보고 오히려 전체 메뉴 허용을 다시 박아 넣는다.
    // 보안(2026-10-14): 규칙이 퇴사자를 이메일로 막을 수 있게 { 이메일: 퇴사일 } 을 함께 저장한다.
    //   퇴사자 행의 이메일 칸이 비었으면 저장 전 설정(currentConfig.memberEmails)의 이메일로 보충한다.
    //   저장 전 resignedEmails 도 물려받는다(2026-10-23) — 퇴사자 행을 지워도 빠지지 않게. 재직 중이 된 이메일만 뺀다.
    newConfig.resignedEmails = buildResignedEmails(newConfig.resignedMembers, newConfig.memberEmails, currentConfig?.memberEmails, emailCheck,
        currentConfig?.resignedEmails);
    const resignedEmails = new Set(Object.keys(newConfig.resignedEmails));
    // 보충한 이메일은 아래 emailCheck 루프에 없다 → 이미 역할이 있으면 여기서 같은 강등을 적용한다
    //   (역할이 없던 이메일에 새 항목을 만들지는 않는다).
    resignedEmails.forEach(email => {
        if (emailCheck.has(email) || !(email in newConfig.memberRoles)) return;
        newConfig.memberRoles[email] = 'user';
        newConfig.memberMenuAccess[email] = [];
        dropPerm(email);
    });

    Array.from(emailCheck.keys()).forEach(email => {
        if (resignedEmails.has(email)) {
            // 퇴사자: 접근 전부 해제(역할·예외도 지운다). 퇴사일을 지우면(재입사) 다시 권한을 줄 수 있다.
            newConfig.memberRoles[email] = 'user';
            newConfig.memberMenuAccess[email] = [];
            dropPerm(email);
            return;
        }
        if (!newConfig.memberRoles[email]) {
            newConfig.memberRoles[email] = 'user';
            // 새 팀원 = 새 직원 기본 역할(permDefaultRole). 예전엔 전 메뉴(관리자 페이지 이름까지)를 줬다 — 버그.
            // 직전까지 퇴사자였던 사람(= 이번에 복귀)과 시스템 계정은 역할 없음 — 관리자가 명시적으로 주게 한다
            // (복귀자를 '신규'로 보고 기본 역할을 주면 퇴사 전보다 권한이 넘칠 수 있다).
            const wasResigned = Boolean((currentConfig?.resignedMembers || {})[emailCheck.get(email)]);
            newConfig.permAssign[email] = (wasResigned || systemEmails.has(email)) ? '' : String(newConfig.permDefaultRole || '');
            delete newConfig.permOverrides[email];
            newConfig.memberMenuAccess[email] = menuNamesFor(resolvePerm(newConfig, email).set, menuGroups);
        }
    });

    const allDefinitions = getAllDashboardDefinitions(currentConfig);
    document.querySelectorAll('#dashboard-items-container .dashboard-item-config').forEach(item => {
        const nameSpan = item.querySelector('.dashboard-item-name');
        if (nameSpan) {
            const id = nameSpan.dataset.id;
            newConfig.dashboardItems.push(id);
            
            if (id.startsWith('custom-') && allDefinitions[id]) {
                newConfig.dashboardCustomItems[id] = {
                    title: allDefinitions[id].title,
                    isQuantity: true
                };
            }
        }
    });

    // 🆔 업무 id — 업무 줄의 data-task-id 로 taskIdNames 를 만든다. 주요 업무·처리량·원가·위젯 연결 줄도 id 를 달고 있어
    //    지금 이름으로 읽는다(화면에 옛 이름이 남아 있어도). id 없는 줄만 화면 글자 그대로.
    const taskRows = [];
    document.querySelectorAll('#task-groups-container .task-group-card').forEach(groupCard => {
        const groupNameInput = groupCard.querySelector('.task-group-name');
        const groupName = groupNameInput ? groupNameInput.value.trim() : '';
        if (!groupName) return;
        
        const tasks = [];
        groupCard.querySelectorAll('.task-item').forEach(taskItem => {
            const taskNameInput = taskItem.querySelector('.task-name');
            if (!taskNameInput) return;
            tasks.push(taskNameInput.value.trim());
            taskRows.push({ el: taskItem, id: (taskItem.dataset && taskItem.dataset.taskId) || '', name: taskNameInput.value.trim() });
        });
        newConfig.taskGroups.push({ name: groupName, tasks: tasks });
    });
    const beforeIds = (currentConfig && currentConfig.taskIdNames) || null;
    if (beforeIds) {
        // id 없는 줄(정상이면 없음)은 여기서 붙이고 줄에 적어 둔다 — 미리보기를 여러 번 해도 같은 id
        const used = new Set([...Object.keys(beforeIds), ...taskRows.map(r => r.id).filter(Boolean)]);
        taskRows.forEach(r => {
            if (r.id || !r.name) return;
            r.id = newTaskId(used);
            used.add(r.id);
            if (r.el.dataset) r.el.dataset.taskId = r.id;
        });
        newConfig.taskIdNames = collectTaskIds(taskRows, beforeIds).taskIdNames;
    }
    const nameById = newConfig.taskIdNames || null;
    // id 가 있는데 업무 목록에 없는 줄 = 업무 관리에서 지운 업무 → 빼고 모은다(null). id 없는 줄은 화면 글자 그대로(검사가 거른다).
    const rowTaskName = (el, text) => {
        const id = el && el.dataset && el.dataset.taskId;
        if (!id || !nameById) return text;
        return nameById[id] || null;
    };
    // 같은 업무가 두 줄이면 앞 줄만(대소문자·앞뒤 공백 무시)
    const pushTask = (list, name) => {
        if (!name) return;
        const k = name.trim().toLowerCase();
        if (!list.some(t => t.trim().toLowerCase() === k)) list.push(name);
    };

    document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
        const nameEl = item.querySelector('.key-task-name');
        if (nameEl) pushTask(newConfig.keyTasks, rowTaskName(item, nameEl.textContent.trim()));
    });

    document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
        const nameEl = item.querySelector('.quantity-task-name');
        if (nameEl) pushTask(newConfig.quantityTaskTypes, rowTaskName(item, nameEl.textContent.trim()));
    });

    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;

    const workHoursInput = document.getElementById('standard-monthly-work-hours');
    if (workHoursInput) newConfig.standardMonthlyWorkHours = Number(workHoursInput.value) || 209;

    const materialCostInput = document.getElementById('fixed-material-cost');
    if (materialCostInput) newConfig.fixedMaterialCost = Number(materialCostInput.value) || 0;

    const shippingCostInput = document.getElementById('fixed-shipping-cost');
    if (shippingCostInput) newConfig.fixedShippingCost = Number(shippingCostInput.value) || 0;
    
    const directDeliveryCostInput = document.getElementById('fixed-direct-delivery-cost');
    if (directDeliveryCostInput) newConfig.fixedDirectDeliveryCost = Number(directDeliveryCostInput.value) || 0;

    document.querySelectorAll('.cost-calc-task-checkbox:checked').forEach(checkbox => {
        pushTask(newConfig.costCalcTasks, rowTaskName(checkbox, checkbox.value));
    });

    // 같은 업무의 연결 줄이 둘 이상이면 위젯을 고른 첫 줄만 쓴다(뒤 줄은 무시)
    document.querySelectorAll('#quantity-mapping-container .mapping-row').forEach(row => {
        const taskName = rowTaskName(row, row.dataset.taskName);
        const select = row.querySelector('.dashboard-mapping-select');
        if (taskName && select && select.value && !(taskName in newConfig.quantityToDashboardMap)) {
            newConfig.quantityToDashboardMap[taskName] = select.value;
        }
    });

    // 이름 변경을 나머지 이름 칸(품질비용·예측 설정 등 화면에 없는 칸)에 퍼뜨리고 별칭을 남긴다.
    //   위에서 id 로 읽은 칸은 이미 새 이름이라 건너뛴다(두 번 바꾸면 A↔B 맞바꾸기가 되돌아간다).
    if (!beforeIds) return newConfig;
    const { config, renames, reused } = applyTaskRenames(newConfig, currentConfig,
        { skip: ['keyTasks', 'quantityTaskTypes', 'costCalcTasks', 'quantityToDashboardMap'] });
    if (taskInfo) { taskInfo.renames = renames; taskInfo.reused = reused; }
    return config;
}

export function validateConfig(newConfig) {
    // 관리자가 한 명도 안 남으면 아무도 관리자 페이지에 들어갈 수 없게 된다.
    // (마지막 관리자가 자기 퇴사일을 입력하고 저장하는 경우 등)
    // Firestore 콘솔을 직접 고치는 것 외엔 되돌릴 수 없으므로 저장 자체를 막는다.
    if (!Object.values(newConfig.memberRoles || {}).includes('admin')) {
        throw new Error(`[저장 실패] 관리자가 한 명도 없습니다.

이대로 저장하면 아무도 설정·관리에 들어올 수 없습니다.
권한 관리에서 최소 한 명을 '관리자'로 지정해 주세요.`);
    }

    const taskNameErrors = validateTaskNames(newConfig);
    if (taskNameErrors.length > 0) {
        throw new Error("[저장 실패] '업무 관리' 의 업무 이름을 확인해 주세요.\n\n- " + taskNameErrors.join('\n- '));
    }

    const allTaskNames = new Set(
        newConfig.taskGroups.flatMap(group => group.tasks).map(t => t.trim().toLowerCase())
    );

    const invalidKeyTasks = newConfig.keyTasks.filter(task => !allTaskNames.has(task.trim().toLowerCase()));
    const invalidQuantityTasks = newConfig.quantityTaskTypes.filter(task => !allTaskNames.has(task.trim().toLowerCase()));
    const invalidCostTasks = newConfig.costCalcTasks.filter(task => !allTaskNames.has(task.trim().toLowerCase()));

    if (invalidKeyTasks.length > 0 || invalidQuantityTasks.length > 0 || invalidCostTasks.length > 0) {
        let errorMsg = "[저장 실패] '업무 관리' 목록에 존재하지 않는 업무 이름이 포함되어 있습니다.\n\n";
        if (invalidKeyTasks.length > 0) {
            errorMsg += `▶ 주요 업무 오류:\n- ${invalidKeyTasks.join('\n- ')}\n\n`;
        }
        if (invalidQuantityTasks.length > 0) {
            errorMsg += `▶ 처리량 집계 오류:\n- ${invalidQuantityTasks.join('\n- ')}\n\n`;
        }
        if (invalidCostTasks.length > 0) {
            errorMsg += `▶ 원가 계산 업무 오류:\n- ${invalidCostTasks.join('\n- ')}\n\n`;
        }
        errorMsg += "오타를 수정하거나 '업무 관리' 섹션에 해당 업무를 먼저 추가해주세요.";
        throw new Error(errorMsg);
    }

    return true; 
}