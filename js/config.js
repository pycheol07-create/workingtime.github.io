// === config.js (loadAppConfig 함수 수정) ===

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ... (firebaseConfig, APP_ID, initializeFirebase 함수는 동일) ...
// 1. Firebase 설정 (유지)
export const firebaseConfig = {
    apiKey: "AIzaSyBxmX7fEISWYs_JGktAZrFjdb8cb_ZcmSY",
    authDomain: "work-tool-e2943.firebaseapp.com",
    projectId: "work-tool-e2943",
    storageBucket: "work-tool-e2943.appspot.com",
    messagingSenderId: "133294945093",
    appId: "1:133294945093:web:cde90aab6716127512842c",
    measurementId: "G-ZZQLKB0057"
};

// 2. 앱 ID
const APP_ID = 'team-work-logger-v2';
let db, auth;

// 3. Firebase 초기화 함수 (공용)
export const initializeFirebase = () => {
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        console.log("Firebase initialized successfully."); // 초기화 성공 로그
        return { app, db, auth };
    } catch (error) {
        console.error("Firebase 초기화 실패:", error);
        alert("Firebase 초기화에 실패했습니다. API 키를 확인하세요.");
        return {};
    }
};

// 4. [수정] Firestore에서 *앱 설정* 불러오기
export const loadAppConfig = async (dbInstance) => {
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");

    const configDocRef = doc(dbToUse, 'artifacts', APP_ID, 'config', 'mainConfig');

    try {
        const docSnap = await getDoc(configDocRef);
        if (docSnap.exists()) {
            console.log("Firestore에서 앱 설정을 불러왔습니다.");
            const loadedData = docSnap.data();
            const defaultData = getDefaultConfig();
            // Firestore 데이터와 기본값 병합 (Firestore 우선)
            const mergedConfig = { ...defaultData, ...loadedData };
            // 배열 및 객체 필드 기본값 확인
            mergedConfig.teamGroups = loadedData.teamGroups || defaultData.teamGroups;
            mergedConfig.keyTasks = loadedData.keyTasks || defaultData.keyTasks;
            mergedConfig.dashboardItems = loadedData.dashboardItems || defaultData.dashboardItems;
            mergedConfig.dashboardQuantities = { ...defaultData.dashboardQuantities, ...(loadedData.dashboardQuantities || {}) };
            mergedConfig.dashboardCustomItems = { ...(loadedData.dashboardCustomItems || {}) };
            mergedConfig.quantityTaskTypes = loadedData.quantityTaskTypes || defaultData.quantityTaskTypes;
            mergedConfig.taskGroups = loadedData.taskGroups || defaultData.taskGroups;
            
            // ✅ [수정] memberWages, memberEmails, memberRoles 병합 (기존 수정 유지)
            mergedConfig.memberWages = { ...defaultData.memberWages, ...(loadedData.memberWages || {}) };
            mergedConfig.memberEmails = { ...defaultData.memberEmails, ...(loadedData.memberEmails || {}) };
            mergedConfig.memberRoles = { ...defaultData.memberRoles, ...(loadedData.memberRoles || {}) };
            // ✅ [수정] 처리량-현황판 연동 맵 병합 (기존 수정 유지)
            mergedConfig.quantityToDashboardMap = { ...defaultData.quantityToDashboardMap, ...(loadedData.quantityToDashboardMap || {}) };
            // ✅ [추가] 공지사항 병합
            mergedConfig.notices = loadedData.notices || defaultData.notices;


            return mergedConfig;
        } else {
            console.warn("Firestore에 앱 설정 문서가 없습니다. 기본값으로 새로 생성합니다.");
            const defaultData = getDefaultConfig();
            await setDoc(configDocRef, defaultData);
            return defaultData;
        }
    } catch (e) {
        console.error("앱 설정 불러오기 실패:", e);
        alert("앱 설정 정보를 불러오는 데 실패했습니다.");
        return getDefaultConfig();
    }
};

// 5. Firestore에 *앱 설정* 저장하기 (admin.js용)
export const saveAppConfig = async (dbInstance, configData) => {
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");

    // 순환 참조나 함수 등 Firestore에 저장할 수 없는 타입 제거
    const cleanedConfig = JSON.parse(JSON.stringify(configData));
    const configDocRef = doc(dbToUse, 'artifacts', APP_ID, 'config', 'mainConfig');
    await setDoc(configDocRef, cleanedConfig);
};

// 6. Firestore에서 *근태 일정* 불러오기
export const loadLeaveSchedule = async (dbInstance) => {
    // ... (이전과 동일) ...
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");

    const leaveDocRef = doc(dbToUse, 'artifacts', APP_ID, 'persistent_data', 'leaveSchedule');

    try {
        const docSnap = await getDoc(leaveDocRef);
        if (docSnap.exists()) {
            console.log("Firestore에서 근태 일정을 불러왔습니다.");
            return docSnap.data() || { onLeaveMembers: [] };
        } else {
            // 문서가 없으면 빈 일정으로 새로 생성
            console.warn("Firestore에 근태 일정 문서가 없습니다. 새로 생성합니다.");
            const defaultLeaveData = { onLeaveMembers: [] };
            await setDoc(leaveDocRef, defaultLeaveData);
            return defaultLeaveData;
        }
    } catch (e) {
        console.error("근태 일정 불러오기 실패:", e);
        return { onLeaveMembers: [] }; // 실패 시 빈 일정 반환
    }
};

// 7. Firestore에 *근태 일정* 저장하기
export const saveLeaveSchedule = async (dbInstance, leaveData) => {
    // ... (이전과 동일) ...
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");

    const cleanedLeaveData = JSON.parse(JSON.stringify(leaveData));
    const leaveDocRef = doc(dbToUse, 'artifacts', APP_ID, 'persistent_data', 'leaveSchedule');
    await setDoc(leaveDocRef, cleanedLeaveData);
};


// 8. 기본 앱 설정 데이터 (근태 일정 제거)
function getDefaultConfig() {
    return {
        teamGroups: [
            { name: '관리', members: ['박영철', '박호진', '유아라', '이승운'] },
            { name: '공통파트', members: ['김수은', '이미숙', '김현', '박상희', '배은정', '김성곤', '김동훈', '신민재', '황호석'] },
            { name: '담당파트', members: ['송다진', '정미혜', '진희주'] },
            { name: '제작파트', members: ['이승운'] },
        ],
        memberWages: {
            '유아라': 14114, '박호진': 14354, '송다진': 11722, '정미혜': 11483,
            '김수은': 11253, '이미숙': 11253, '이승운': 14593, '진희주': 10526,
            '김현': 10287, '배은정': 10287, '박상희': 10287, '김동훈': 10287,
            '신민재': 10047, '황호석': 10047
        },
        memberEmails: {},
        memberRoles: {},
        keyTasks: ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'],
        dashboardItems: [
            'total-staff', 'leave-staff', 'active-staff', 'working-staff', 'idle-staff',
            'ongoing-tasks', 'total-work-time',
            'domestic-invoice', 'china-production', 'direct-delivery'
        ],
        dashboardQuantities: {
            'domestic-invoice': 0,
            'china-production': 0,
            'direct-delivery': 0
        },
        dashboardCustomItems: {},
        quantityToDashboardMap: {},
        taskGroups: {
            '공통': ['국내배송', '중국제작', '직진배송', '티니', '택배포장', '해외배송', '재고조사', '앵글정리', '상품재작업'],
            '담당': ['개인담당업무', '상.하차', '검수', '아이롱', '오류'],
            '기타': ['채우기', '강성', '2층업무', '재고찾는시간', '매장근무']
        },
        quantityTaskTypes: ['채우기', '국내배송', '직진배송', '중국제작', '티니', '택배포장', '해외배송', '상.하차', '검수'],
        defaultPartTimerWage: 10000,
        // ✅ [추가] 공지사항 기본값 (배열 형태)
        notices: [
            "📢 **첫 번째 공지:** 오늘 오후 3시 택배 마감입니다.",
            "✅ **두 번째 공지:** 재고 조사 예정입니다. 협조 부탁드립니다."
        ]
    };
}