// === config.js (getDefaultConfig에 예시 memberPins 추가) ===

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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
export const APP_ID = 'team-work-logger-v2'; // ✅ export 추가
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

// 4. Firestore에서 *앱 설정* 불러오기
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

            // ✅ memberPins 병합
            mergedConfig.memberPins = { ...defaultData.memberPins, ...(loadedData.memberPins || {}) };

            return mergedConfig;
        } else {
            console.warn("Firestore에 앱 설정 문서가 없습니다. 기본값으로 새로 생성합니다.");
            const defaultData = getDefaultConfig(); // memberPins 포함된 기본값
            await setDoc(configDocRef, defaultData);
            return defaultData;
        }
    } catch (e) {
        console.error("앱 설정 불러오기 실패:", e);
        alert("앱 설정 정보를 불러오는 데 실패했습니다.");
        return getDefaultConfig(); // memberPins 포함된 기본값
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
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");
    const leaveDocRef = doc(dbToUse, 'artifacts', APP_ID, 'persistent_data', 'leaveSchedule');

    try {
        const docSnap = await getDoc(leaveDocRef);
        if (docSnap.exists()) {
            console.log("Firestore에서 근태 일정을 불러왔습니다.");
            return docSnap.data() || { onLeaveMembers: [] };
        } else {
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
    const dbToUse = dbInstance || db;
    if (!dbToUse) throw new Error("DB가 초기화되지 않았습니다.");
    const cleanedLeaveData = JSON.parse(JSON.stringify(leaveData));
    const leaveDocRef = doc(dbToUse, 'artifacts', APP_ID, 'persistent_data', 'leaveSchedule');
    await setDoc(leaveDocRef, cleanedLeaveData);
};

// 8. 기본 앱 설정 데이터
function getDefaultConfig() {
    return {
        teamGroups: [
            { name: '관리', members: ['박영철', '박호진', '유아라', '이승운'] },
            { name: '공통파트', members: ['김수은', '이미숙', '김현', '박상희', '배은정', '김성곤', '김동훈', '신민재', '황호석'] },
            { name: '담당파트', members: ['송다진', '정미혜', '진희주'] },
            { name: '제작파트', members: ['이승운'] }, // 이승운은 관리, 제작 중복 가능
        ],
        memberWages: {
            '박영철': 15000, '박호진': 14354, '유아라': 14114, '이승운': 14593,
            '김수은': 11253, '이미숙': 11253, '김현': 10287, '박상희': 10287,
            '배은정': 10287, '김성곤': 11000, '김동훈': 10287, '신민재': 10047,
            '황호석': 10047, '송다진': 11722, '정미혜': 11483, '진희주': 10526
        },
        // ✅ [수정] 예시 PIN 번호 추가 (실제 운영 시 반드시 변경하세요!)
        memberPins: {
            '박영철': '0000', '박호진': '0001', '유아라': '0003', '이승운': '0004',
            '김수은': '0005', '이미숙': '0006', '김현': '0007', '박상희': '0008',
            '배은정': '0009', '김성곤': '0010', '김동훈': '0011', '신민재': '0012',
            '황호석': '0013', '송다진': '0014', '정미혜': '0015', '진희주': '0016'
        },
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
        dashboardCustomItems: {}, // 커스텀 항목 기본값은 비어있음
        taskGroups: {
            '공통': ['국내배송', '중국제작', '직진배송', '티니', '택배포장', '해외배송', '재고조사', '앵글정리', '상품재작업'],
            '담당': ['개인담당업무', '상.하차', '검수', '아이롱', '오류'],
            '기타': ['채우기', '강성', '2층업무', '재고찾는시간', '매장근무', '출장'] // '출장' 추가
        },
        quantityTaskTypes: ['채우기', '국내배송', '직진배송', '중국제작', '티니', '택배포장', '해외배송', '상.하차', '검수'],
        defaultPartTimerWage: 10000
    };
}