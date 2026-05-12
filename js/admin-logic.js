// === js/admin-logic.js ===
// 설명: 관리자 페이지의 데이터 수집 및 유효성 검사 로직을 담당합니다.

import { getAllDashboardDefinitions } from './admin-ui.js';

export function collectConfigFromDOM(currentConfig) {
    const newConfig = {
        teamGroups: [],
        memberWages: {},
        memberEmails: {},
        memberRoles: {},
        memberRanks: {}, 
        memberLeaveSettings: {},
        systemAccounts: [], // 💡 [신규] 시스템 전용 계정 배열
        dashboardItems: [],
        dashboardCustomItems: {},
        quantityToDashboardMap: {},
        keyTasks: [],
        taskGroups: [],
        quantityTaskTypes: [],
        
        defaultPartTimerWage: 10000,
        revenueIncrementUnit: 10000000,
        standardMonthlyWorkHours: 209,

        fixedMaterialCost: 0,
        fixedShippingCost: 0,
        fixedDirectDeliveryCost: 0,
        costCalcTasks: [],

        simulationTaskLinks: currentConfig.simulationTaskLinks || {},
        qualityCostTasks: currentConfig.qualityCostTasks || [],
        systemAccountsOld: currentConfig.systemAccounts || [], // 백업용
        standardDailyWorkHours: currentConfig.standardDailyWorkHours || { weekday: 8, weekend: 4 }
    };

    const emailCheck = new Map();
    let duplicateEmailError = null;

    // 1. 일반 팀원 그룹 정보 수집
    document.querySelectorAll('#team-groups-container .team-group-card').forEach(groupCard => {
        const groupNameInput = groupCard.querySelector('.team-group-name');
        const groupName = groupNameInput ? groupNameInput.value.trim() : '';
        if (!groupName) return;

        const newGroup = { name: groupName, members: [] };

        groupCard.querySelectorAll('.member-item').forEach(memberItem => {
            const memberName = memberItem.querySelector('.member-name').value.trim();
            const memberEmail = memberItem.querySelector('.member-email').value.trim();
            const memberWage = Number(memberItem.querySelector('.member-wage').value) || 0;
            const memberRole = memberItem.querySelector('.member-role').value || 'user';
            const memberRank = memberItem.querySelector('.member-rank')?.value || '사원'; 

            const joinDate = memberItem.querySelector('.member-join-date').value;
            const totalLeave = Number(memberItem.querySelector('.member-total-leave').value) || 0;
            const leaveResetDate = memberItem.querySelector('.member-leave-reset-date').value;
            const expirationDate = memberItem.querySelector('.member-leave-expiration-date').value;

            if (!memberName) return;

            newGroup.members.push(memberName);
            newConfig.memberWages[memberName] = memberWage;
            newConfig.memberRanks[memberName] = memberRank; 

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
                newConfig.memberRoles[emailLower] = memberRole;
            }
        });
        newConfig.teamGroups.push(newGroup);
    });

    // 💡 [신규] 2. 시스템 전용 계정 수집 로직
    document.querySelectorAll('#system-accounts-container .system-account-item').forEach(item => {
        const name = item.querySelector('.sys-name').value.trim();
        const email = item.querySelector('.sys-email').value.trim();
        const role = item.querySelector('.sys-role').value;

        if (name && email) {
            newConfig.systemAccounts.push({ name, email, role });
            
            const emailLower = email.toLowerCase();
            if (emailCheck.has(emailLower) && emailCheck.get(emailLower) !== name) {
                duplicateEmailError = email;
            }
            emailCheck.set(emailLower, name);
            newConfig.memberRoles[emailLower] = role;
        }
    });

    if (duplicateEmailError) {
        throw new Error(`이메일 주소 '${duplicateEmailError}'가 중복 할당되었습니다. 모든 팀원 및 시스템 계정의 이메일은 고유해야 합니다.`);
    }

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

    document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
        const nameEl = item.querySelector('.key-task-name');
        if (nameEl) newConfig.keyTasks.push(nameEl.textContent.trim());
    });

    document.querySelectorAll('#task-groups-container .task-group-card').forEach(groupCard => {
        const groupNameInput = groupCard.querySelector('.task-group-name');
        const groupName = groupNameInput ? groupNameInput.value.trim() : '';
        if (!groupName) return;
        
        const tasks = [];
        groupCard.querySelectorAll('.task-item').forEach(taskItem => {
            const taskNameInput = taskItem.querySelector('.task-name');
            if (taskNameInput) tasks.push(taskNameInput.value.trim());
        });
        newConfig.taskGroups.push({ name: groupName, tasks: tasks });
    });

    document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
        const nameEl = item.querySelector('.quantity-task-name');
        if (nameEl) newConfig.quantityTaskTypes.push(nameEl.textContent.trim());
    });

    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;

    const revenueUnitInput = document.getElementById('revenue-increment-unit');
    if (revenueUnitInput) newConfig.revenueIncrementUnit = Number(revenueUnitInput.value) || 10000000;

    const workHoursInput = document.getElementById('standard-monthly-work-hours');
    if (workHoursInput) newConfig.standardMonthlyWorkHours = Number(workHoursInput.value) || 209;

    const materialCostInput = document.getElementById('fixed-material-cost');
    if (materialCostInput) newConfig.fixedMaterialCost = Number(materialCostInput.value) || 0;

    const shippingCostInput = document.getElementById('fixed-shipping-cost');
    if (shippingCostInput) newConfig.fixedShippingCost = Number(shippingCostInput.value) || 0;
    
    const directDeliveryCostInput = document.getElementById('fixed-direct-delivery-cost');
    if (directDeliveryCostInput) newConfig.fixedDirectDeliveryCost = Number(directDeliveryCostInput.value) || 0;

    document.querySelectorAll('.cost-calc-task-checkbox:checked').forEach(checkbox => {
        newConfig.costCalcTasks.push(checkbox.value);
    });

    document.querySelectorAll('#quantity-mapping-container .mapping-row').forEach(row => {
        const taskName = row.dataset.taskName;
        const select = row.querySelector('.dashboard-mapping-select');
        if (taskName && select && select.value) {
            newConfig.quantityToDashboardMap[taskName] = select.value;
        }
    });

    return newConfig;
}

export function validateConfig(newConfig) {
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