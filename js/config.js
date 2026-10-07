// === js/config.js ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { connectEmulatorsIfEnabled } from './firebase-emulator.js?v=202610071546';

export const firebaseConfig = {
    apiKey: "AIzaSyBxmX7fEISWYs_JGktAZrFjdb8cb_ZcmSY",
    authDomain: "work-tool-e2943.firebaseapp.com",
    projectId: "work-tool-e2943",
    storageBucket: "work-tool-e2943.firebasestorage.app", 
    messagingSenderId: "133294945093",
    appId: "1:133294945093:web:cde90aab6716127512842c",
    measurementId: "G-ZZQLKB0057"
};

const APP_ID = 'team-work-logger-v2';
let db, auth;

// 🔒 급여·원가는 mainConfig 에 두지 않는다.
//    mainConfig 는 artifacts/** 아래라 규칙상 로그인한 직원 전원이 읽는다(출퇴근·업무보드에 필요).
//    Firestore 규칙은 OR 로 합쳐지므로, 같은 경로 안에서는 '관리자만 읽기' 를 덧붙여도 막히지 않는다.
//    그래서 경로 자체를 artifacts 밖(adminPrivate/settings)으로 옮기고, 그 경로는 관리자만 읽고 쓴다.
//    defaultPartTimerWage 는 일반 직원의 '알바 추가' 가 쓰므로 그대로 둔다.
export const PRIVATE_CONFIG_KEYS = ['memberWages', 'fixedMaterialCost', 'fixedShippingCost', 'fixedDirectDeliveryCost'];
const privateConfigRef = (dbToUse) => doc(dbToUse, 'adminPrivate', 'settings');

// 관리자만 부른다. 문서가 없으면 {} · **읽기에 실패하면 예외를 던진다.**
// ⚠️ '읽지 못함' 을 '없음({})' 으로 삼키면 안 된다. 관리자 화면이 급여를 0 으로 그리고,
//    그 상태로 '전체 저장' 을 누르면 전원 급여·원가가 0 으로 영구히 덮인다.
//    부르는 쪽이 실패를 알고 저장을 막아야 한다.
export const loadPrivateConfig = async (dbInstance) => {
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");
    const snap = await getDoc(privateConfigRef(dbToUse));
    return snap.exists() ? snap.data() : {};
};

// 불러온 관리자 전용 값을 설정 객체에 얹는다. 비어 있으면 아무것도 바꾸지 않는다
// (이전 기간에 mainConfig 에 남아 있던 값을 지우지 않기 위해서).
export const applyPrivateConfig = (config, privateData) => {
    if (!config || !privateData) return config;
    PRIVATE_CONFIG_KEYS.forEach(k => {
        if (privateData[k] === undefined) return;
        config[k] = (k === 'memberWages') ? { ...(config.memberWages || {}), ...privateData.memberWages } : privateData[k];
    });
    return config;
};

export const initializeFirebase = () => {
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        // 🧪 로컬에서 ?emu=1 로 열었을 때만 에뮬레이터로 돌린다(첫 읽기·쓰기보다 먼저 불러야 한다).
        //    운영(GitHub Pages)에서는 hostname 검사에 걸려 아무 일도 하지 않는다.
        connectEmulatorsIfEnabled(db, auth);
        console.log("Firebase initialized successfully.");
        return { app, db, auth };
    } catch (error) {
        console.error("Firebase 초기화 실패:", error);
        alert("Firebase 초기화에 실패했습니다. API 키를 확인하세요.");
        return {};
    }
};

export const loadAppConfig = async (dbInstance) => {
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");

    const configDocRef = doc(dbToUse, 'artifacts', APP_ID, 'config', 'mainConfig');

    try {
        const docSnap = await getDoc(configDocRef);
        if (docSnap.exists()) {
            const loadedData = docSnap.data();
            const defaultData = getDefaultConfig();

            const mergedConfig = { ...defaultData, ...loadedData };

            mergedConfig.teamGroups = loadedData.teamGroups || defaultData.teamGroups;
            mergedConfig.keyTasks = loadedData.keyTasks || defaultData.keyTasks;
            mergedConfig.dashboardItems = loadedData.dashboardItems || defaultData.dashboardItems;
            mergedConfig.dashboardQuantities = { ...defaultData.dashboardQuantities, ...(loadedData.dashboardQuantities || {}) };
            mergedConfig.dashboardCustomItems = { ...(loadedData.dashboardCustomItems || {}) };
            
            let loadedMenu = loadedData.dashboardMenu || defaultData.dashboardMenu;
            try {
                if (loadedMenu && Array.isArray(loadedMenu) && loadedMenu.length > 0) {
                    const firstCat = loadedMenu[0];
                    if ((firstCat.category === '메인 업무' || firstCat.category === '메인업무') && (!firstCat.items || firstCat.items.length <= 2)) {
                        loadedMenu = defaultData.dashboardMenu;
                    }
                }
            } catch(e) {
                loadedMenu = defaultData.dashboardMenu;
            }
            mergedConfig.dashboardMenu = loadedMenu;

            let loadedQtyTasks = loadedData.quantityTaskTypes || defaultData.quantityTaskTypes;
            if (loadedQtyTasks.includes('검수')) {
                loadedQtyTasks = loadedQtyTasks.filter(t => t !== '검수');
                if (!loadedQtyTasks.includes('샘플검수')) loadedQtyTasks.push('샘플검수');
                if (!loadedQtyTasks.includes('전량검수')) loadedQtyTasks.push('전량검수');
            }
            mergedConfig.quantityTaskTypes = loadedQtyTasks;

            if (!mergedConfig.keyTasks.includes('교환반품')) {
                const idx = mergedConfig.keyTasks.indexOf('상.하차');
                if (idx !== -1) mergedConfig.keyTasks.splice(idx + 1, 0, '교환반품');
                else mergedConfig.keyTasks.push('교환반품');
            }
            if (!mergedConfig.quantityTaskTypes.includes('교환반품')) {
                const idx = mergedConfig.quantityTaskTypes.indexOf('상.하차');
                if (idx !== -1) mergedConfig.quantityTaskTypes.splice(idx + 1, 0, '교환반품');
                else mergedConfig.quantityTaskTypes.push('교환반품');
            }

            mergedConfig.qualityCostTasks = loadedData.qualityCostTasks || defaultData.qualityCostTasks;
            mergedConfig.systemAccounts = loadedData.systemAccounts || defaultData.systemAccounts;
            mergedConfig.standardDailyWorkHours = { ...defaultData.standardDailyWorkHours, ...(loadedData.standardDailyWorkHours || {}) };

            if (Array.isArray(loadedData.taskGroups)) {
                mergedConfig.taskGroups = loadedData.taskGroups.map(group => {
                    if (group.tasks && group.tasks.includes('검수')) {
                        group.tasks = group.tasks.filter(t => t !== '검수');
                        if (!group.tasks.includes('샘플검수')) group.tasks.push('샘플검수');
                        if (!group.tasks.includes('전량검수')) group.tasks.push('전량검수');
                    }
                    if (group.name === '담당' && !group.tasks.includes('교환반품')) {
                        const idx = group.tasks.indexOf('상.하차');
                        if (idx !== -1) group.tasks.splice(idx + 1, 0, '교환반품');
                        else group.tasks.push('교환반품');
                    }
                    return group;
                });
            } else if (typeof loadedData.taskGroups === 'object' && loadedData.taskGroups !== null && !Array.isArray(loadedData.taskGroups)) {
                mergedConfig.taskGroups = Object.entries(loadedData.taskGroups).map(([groupName, tasks]) => {
                    let parsedTasks = Array.isArray(tasks) ? tasks : [];
                    if (parsedTasks.includes('검수')) {
                        parsedTasks = parsedTasks.filter(t => t !== '검수');
                        if (!parsedTasks.includes('샘플검수')) parsedTasks.push('샘플검수');
                        if (!parsedTasks.includes('전량검수')) parsedTasks.push('전량검수');
                    }
                    if (groupName === '담당' && !parsedTasks.includes('교환반품')) {
                        const idx = parsedTasks.indexOf('상.하차');
                        if (idx !== -1) parsedTasks.splice(idx + 1, 0, '교환반품');
                        else parsedTasks.push('교환반품');
                    }
                    return { name: groupName, tasks: parsedTasks };
                });
            } else {
                mergedConfig.taskGroups = defaultData.taskGroups;
            }

            mergedConfig.memberWages = { ...defaultData.memberWages, ...(loadedData.memberWages || {}) };
            mergedConfig.memberEmails = { ...defaultData.memberEmails, ...(loadedData.memberEmails || {}) };
            mergedConfig.memberRoles = { ...defaultData.memberRoles, ...(loadedData.memberRoles || {}) };
            mergedConfig.memberMenuAccess = { ...defaultData.memberMenuAccess, ...(loadedData.memberMenuAccess || {}) };
            
            mergedConfig.quantityToDashboardMap = { ...defaultData.quantityToDashboardMap, ...(loadedData.quantityToDashboardMap || {}) };
            mergedConfig.simulationTaskLinks = { ...(loadedData.simulationTaskLinks || {}), ...defaultData.simulationTaskLinks };

            // 🚨 최악의 쓰기(Write) 폭탄 원인 제거 완료!
            // 기존에는 JSON.stringify 문자열 비교 때문에 키 순서만 달라도 접속할 때마다 무한히 DB를 덮어썼습니다.
            // 이제 로컬에서만 병합(Merge)해서 사용하므로 접속만으로는 절대 요금이 발생하지 않습니다.
            
            return mergedConfig;
        } else {
            const defaultData = getDefaultConfig();
            await setDoc(configDocRef, defaultData);
            return defaultData;
        }
    } catch (e) {
        console.error("앱 설정 불러오기 실패:", e);
        return getDefaultConfig();
    }
};

export const saveAppConfig = async (dbInstance, configData) => {
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");
    const cleanedConfig = JSON.parse(JSON.stringify(configData));
    const configDocRef = doc(dbToUse, 'artifacts', APP_ID, 'config', 'mainConfig');

    // 급여·원가를 떼어 관리자 전용 문서에 먼저 쓴다.
    // ⚠️ 순서가 중요하다. mainConfig 는 통째로 덮어쓰므로(merge 아님) 여기서 뗀 값은 mainConfig 에서
    //    사라진다. 관리자 전용 문서 쓰기가 실패하면(규칙 미게시 등) 예외로 멈춰서 mainConfig 를
    //    건드리지 않는다 — 그래야 급여 값이 어디에도 없는 상태가 생기지 않는다.
    const privatePart = {};
    PRIVATE_CONFIG_KEYS.forEach(k => {
        if (cleanedConfig[k] !== undefined) { privatePart[k] = cleanedConfig[k]; delete cleanedConfig[k]; }
    });
    if (Object.keys(privatePart).length > 0) {
        // 관리자 화면 '전체 저장' 은 네 값을 모두 넘긴다 → 통째로 덮어쓴다(예전 mainConfig 와 같은 동작).
        // merge 로 쓰면 명단에서 뺀 직원의 급여가 저장소에 계속 남는다.
        // 일부만 넘어온 경우에만 merge 로 나머지를 보존한다.
        const isFull = PRIVATE_CONFIG_KEYS.every(k => privatePart[k] !== undefined);
        try {
            await setDoc(privateConfigRef(dbToUse), privatePart, isFull ? {} : { merge: true });
        } catch (e) {
            throw new Error('급여·원가 저장 실패(관리자 전용 저장소). 설정은 저장하지 않았습니다. ' +
                            'Firestore 규칙에 adminPrivate 가 게시됐는지 확인하세요. (' + ((e && e.code) || e) + ')');
        }
    }
    await setDoc(configDocRef, cleanedConfig);
};

export const loadLeaveSchedule = async (dbInstance) => {
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");
    const leaveDocRef = doc(dbToUse, 'artifacts', APP_ID, 'persistent_data', 'leaveSchedule');
    try {
        const docSnap = await getDoc(leaveDocRef);
        if (docSnap.exists()) {
            return docSnap.data() || { onLeaveMembers: [] };
        } else {
            const defaultLeaveData = { onLeaveMembers: [] };
            await setDoc(leaveDocRef, defaultLeaveData);
            return defaultLeaveData;
        }
    } catch (e) {
        console.error("근태 일정 불러오기 실패:", e);
        return { onLeaveMembers: [] };
    }
};

export const saveLeaveSchedule = async (dbInstance, leaveData) => {
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");
    const cleanedLeaveData = JSON.parse(JSON.stringify(leaveData));
    const leaveDocRef = doc(dbToUse, 'artifacts', APP_ID, 'persistent_data', 'leaveSchedule');
    await setDoc(leaveDocRef, cleanedLeaveData);
};

function getDefaultConfig() {
    return {
        dashboardMenu: [
            {
                category: '메인업무',
                items: [
                    { name: '대시보드', link: 'index.html' },
                    { name: '오늘 처리량 입력', link: '#' },
                    { name: '데이터 관리', link: 'history.html' }
                ]
            },
            {
                category: '관리 및 조회',
                items: [
                    { name: '주말 근무 신청', link: '#' },
                    { name: '내 연차관리', link: '#' },
                    { name: '로케이션 관리', link: 'location.html' },
                    { name: '중국제작 미발계산기', link: 'china-stock-goods.html' },
                    { name: '비품 관리', link: 'supplies.html' }
                ]
            },
            {
                category: '관리자 메뉴',
                items: [
                    { name: '관리자 일정/투두', link: '#' },
                    { name: '관리자 페이지', link: 'admin.html' },
                    { name: '업무 마감', link: '#' }
                ]
            }
        ],
        teamGroups: [
            { name: '관리', members: ['박영철', '박호진', '유아라', '이승운'] },
            { name: '공통파트', members: ['김수은', '이미숙', '김현', '박상희', '배은정', '김성곤', '김동훈', '신민재', '황호석'] },
            { name: '담당파트', members: ['송다진', '정미혜', '진희주'] },
            { name: '제작파트', members: ['이승운'] },
        ],
        systemAccounts: ['관리자', '시스템'],
        // 가용인원/총원 산정 시 제외할 ID 명단 (프로그램 전용 계정 등).
        // teamGroups 안에 있어도 인원 카운트에선 빼고, 멤버 선택 UI 등에는 그대로 노출.
        headcountExcludedMembers: ['물류팀공용', '정진현 상무이사'],
        resignedMembers: {}, // { '이름': '퇴사일 YYYY-MM-DD' } — 퇴사 처리(비활성). 데이터·과거기록은 보존.
        memberWages: {},
        memberEmails: {},
        memberRoles: {},
        memberMenuAccess: {},
        keyTasks: ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무', '상.하차', '교환반품'],
        dashboardItems: [
            'total-staff', 'leave-staff', 'active-staff', 'working-staff', 'idle-staff',
            'ongoing-tasks', 'total-work-time',
            'domestic-invoice', 'china-production', 'direct-delivery'
        ],
        dashboardQuantities: { 'domestic-invoice': 0, 'china-production': 0, 'direct-delivery': 0 },
        dashboardCustomItems: {},
        quantityToDashboardMap: {},
        taskGroups: [
            { name: '공통', tasks: ['국내배송', '중국제작', '직진배송', '티니', '택배포장', '해외배송', '재고조사', '앵글정리', '상품재작업', '직진배송 사전작업'] },
            { name: '담당', tasks: ['개인담당업무', '상.하차', '교환반품', '샘플검수', '전량검수', '아이롱', '오류'] },
            { name: '기타', tasks: ['채우기', '강성', '2층업무', '재고찾는시간', '매장근무'] }
        ],
        quantityTaskTypes: ['채우기', '국내배송', '직진배송', '중국제작', '티니', '택배포장', '해외배송', '상.하차', '교환반품', '샘플검수', '전량검수'],
        qualityCostTasks: ['오류', '상품재작업', '재고찾는시간'],
        defaultPartTimerWage: 10000,
        simulationTaskLinks: {
            '직진배송': '직진배송 사전작업' 
        },
        revenueIncrementUnit: 10000000,
        standardMonthlyWorkHours: 209,
        standardDailyWorkHours: {
             weekday: 8,
             weekend: 4
        }
    };
}