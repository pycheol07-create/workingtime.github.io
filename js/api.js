// === js/api.js ===

import { doc, setDoc, getDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, APP_ID } from './firebase.js';
import { appState, appConfig } from './store.js'; // appState 저장을 위해 import
import { getTodayDateString, showToast, debounce } from './utils.js';

// --- 1. Config (기존 config.js) ---

/**
 * 기본 앱 설정을 반환합니다. (config.js의 getDefaultConfig)
 */
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
        dashboardCustomItems: {},
        quantityToDashboardMap: {},
        taskGroups: {
            '공통': ['국내배송', '중국제작', '직진배송', '티니', '택배포장', '해외배송', '재고조사', '앵글정리', '상품재작업'],
            '담당': ['개인담당업무', '상.하차', '검수', '아이롱', '오류'],
            '기타': ['채우기', '강성', '2층업무', '재고찾는시간', '매장근무']
        },
        quantityTaskTypes: ['채우기', '국내배송', '직진배송', '중국제작', '티니', '택배포장', '해외배송', '상.하차', '검수'],
        defaultPartTimerWage: 10000
    };
}

/**
 * Firestore에서 *앱 설정* 불러오기 (config.js에서 이동)
 */
export const loadAppConfig = async () => {
    if (!db) throw new Error("DB가 초기화되지 않았습니다.");
    const configDocRef = doc(db, 'artifacts', APP_ID, 'config', 'mainConfig');

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
            mergedConfig.dashboardCustomItems = { ...(loadedData.dashboardCustomItems || {}) };
            mergedConfig.quantityTaskTypes = loadedData.quantityTaskTypes || defaultData.quantityTaskTypes;
            mergedConfig.taskGroups = loadedData.taskGroups || defaultData.taskGroups;
            mergedConfig.memberWages = { ...defaultData.memberWages, ...(loadedData.memberWages || {}) };
            mergedConfig.memberEmails = { ...defaultData.memberEmails, ...(loadedData.memberEmails || {}) };
            mergedConfig.memberRoles = { ...defaultData.memberRoles, ...(loadedData.memberRoles || {}) };
            mergedConfig.quantityToDashboardMap = { ...defaultData.quantityToDashboardMap, ...(loadedData.quantityToDashboardMap || {}) };

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

/**
 * Firestore에 *앱 설정* 저장하기 (config.js에서 이동, admin.js용)
 */
export const saveAppConfig = async (configData) => {
    if (!db) throw new Error("DB가 초기화되지 않았습니다.");
    const cleanedConfig = JSON.parse(JSON.stringify(configData));
    const configDocRef = doc(db, 'artifacts', APP_ID, 'config', 'mainConfig');
    await setDoc(configDocRef, cleanedConfig);
};

// --- 2. Leave Schedule (기존 config.js) ---

/**
 * Firestore에서 *근태 일정* 불러오기 (config.js에서 이동)
 */
export const loadLeaveSchedule = async () => {
    if (!db) throw new Error("DB가 초기화되지 않았습니다.");
    const leaveDocRef = doc(db, 'artifacts', APP_ID, 'persistent_data', 'leaveSchedule');

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
        return { onLeaveMembers: [] };
    }
};

/**
 * Firestore에 *근태 일정* 저장하기 (config.js에서 이동)
 */
export const saveLeaveSchedule = async (leaveData) => {
    if (!db) throw new Error("DB가 초기화되지 않았습니다.");
    const cleanedLeaveData = JSON.parse(JSON.stringify(leaveData));
    const leaveDocRef = doc(db, 'artifacts', APP_ID, 'persistent_data', 'leaveSchedule');
    await setDoc(leaveDocRef, cleanedLeaveData);
};


// --- 3. Daily Data (기존 app.js) ---

let isDataDirty = false; // 자동 저장을 위한 플래그

export const markDataAsDirty = () => {
    isDataDirty = true;
};

/**
 * 오늘의 실시간 상태를 Firestore 'daily_data'에 저장합니다.
 * (app.js에서 이동)
 */
async function saveStateToFirestore() {
    if (!auth || !auth.currentUser) { // auth는 firebase.js에서 import
      console.warn('Cannot save state: User not authenticated.');
      return;
    }
    try {
      const docRef = doc(db, 'artifacts', APP_ID, 'daily_data', getTodayDateString());

      // 전역 store의 appState를 참조
      const stateToSave = JSON.stringify({
        workRecords: appState.workRecords || [],
        taskQuantities: appState.taskQuantities || {},
        onLeaveMembers: appState.dailyOnLeaveMembers || [],
        partTimers: appState.partTimers || [],
        hiddenGroupIds: appState.hiddenGroupIds || [],
        lunchPauseExecuted: appState.lunchPauseExecuted || false,
        lunchResumeExecuted: appState.lunchResumeExecuted || false
      }, (k, v) => (typeof v === 'function' ? undefined : v));

      if (stateToSave.length > 900000) {
        showToast('저장 데이터가 큽니다. 오래된 기록을 이력으로 옮기거나 정리하세요.', true);
        return;
      }

      await setDoc(docRef, { state: stateToSave });
      markDataAsDirty(); // Firestore 저장 시 dirty 플래그 설정 (기존 로직 유지)

    } catch (error) {
      console.error('Error saving state to Firestore:', error);
      showToast('데이터 동기화 중 오류 발생.', true);
    }
}

// 1초 디바운스된 Firestore 저장 함수
export const debouncedSaveState = debounce(saveStateToFirestore, 1000);

// --- 4. History Data (기존 app.js) ---

/**
 * 현재 '완료'된 기록을 'history' 문서에 중간 저장합니다.
 * (app.js에서 이동)
 */
export async function saveProgress(isAutoSave = false) {
  const dateStr = getTodayDateString();
  
  if (!isAutoSave) {
    showToast('현재까지 완료된 기록을 저장합니다...');
  }
  
  const historyDocRef = doc(db, 'artifacts', APP_ID, 'history', dateStr);
  
  try {
    const docSnap = await getDoc(historyDocRef);
    const existingData = docSnap.exists() ? (docSnap.data() || { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] }) : { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] };
    
    // 전역 store의 appState 참조
    const completedRecordsFromState = (appState.workRecords || []).filter(r => r.status === 'completed');
    
    const currentQuantities = {};
    for (const task in (appState.taskQuantities || {})) {
      const q = Number(appState.taskQuantities[task]);
      if (!Number.isNaN(q) && q >= 0) {
         currentQuantities[task] = q;
      }
    }
    const currentLeaveMembersCombined = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
    const currentPartTimers = appState.partTimers || [];

    if (completedRecordsFromState.length === 0 && Object.keys(currentQuantities).length === 0 && currentLeaveMembersCombined.length === 0 && currentPartTimers.length === 0 && !(existingData.workRecords?.length > 0) && !(existingData.taskQuantities && Object.keys(existingData.taskQuantities).length > 0) && !(existingData.onLeaveMembers?.length > 0) && !(existingData.partTimers?.length > 0)) {
        if (!isAutoSave) {
            showToast('저장할 새로운 완료 기록, 처리량, 근태 정보 또는 알바 정보가 없습니다.', true);
        }
        isDataDirty = false;
        return;
    }

    const combinedRecords = [...(existingData.workRecords || []), ...completedRecordsFromState];
    const uniqueRecords = Array.from(new Map(combinedRecords.map(item => [item.id, item])).values());
    const finalQuantities = currentQuantities;
    const combinedPartTimers = [...(existingData.partTimers || []), ...currentPartTimers];
    const uniquePartTimers = Array.from(new Map(combinedPartTimers.map(item => [item.id, item])).values());

    const dataToSave = {
      workRecords: uniqueRecords,
      taskQuantities: finalQuantities,
      onLeaveMembers: currentLeaveMembersCombined,
      partTimers: uniquePartTimers
    };

    await setDoc(historyDocRef, dataToSave);

    if (isAutoSave) {
        console.log("Auto-save completed.");
    } else {
        showToast('현재까지의 기록이 성공적으로 저장되었습니다.');
    }
    isDataDirty = false;

  } catch (e) {
    console.error('Error in saveProgress: ', e);
    showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
  }
}

/**
 * 5분마다 자동 저장 타이머를 실행합니다.
 */
export function startAutoSaveTimer() {
    const AUTO_SAVE_INTERVAL = 5 * 60 * 1000; // 5분
    
    const autoSaveProgress = () => {
        if (isDataDirty) {
            console.log("Auto-save: Dirty data found. Saving progress...");
            saveProgress(true); // true = 자동 저장 모드
        } else {
            console.log("Auto-save: No changes to save.");
        }
    };
    
    return setInterval(autoSaveProgress, AUTO_SAVE_INTERVAL);
}


/**
 * Firestore 'history' 컬렉션의 모든 문서를 가져옵니다.
 * (app.js에서 이동)
 */
export async function fetchAllHistoryData() {
  const historyCollectionRef = collection(db, 'artifacts', APP_ID, 'history');
  try {
    const querySnapshot = await getDocs(historyCollectionRef);
    let allHistoryData = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data && ( (data.workRecords && data.workRecords.length > 0) || (data.onLeaveMembers && data.onLeaveMembers.length > 0) || (data.partTimers && data.partTimers.length > 0) )) {
         allHistoryData.push({ id: doc.id, ...data });
      }
    });
    allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
    return allHistoryData;
  } catch (error) {
    console.error('Error fetching all history data:', error);
    showToast('전체 이력 로딩 실패', true);
    return [];
  }
}

/**
 * Firestore 'history'에서 특정 날짜의 문서를 삭제합니다.
 * (app.js의 confirmHistoryDeleteBtn 리스너에서 분리)
 */
export async function deleteHistoryDoc(dateKey) {
    if (!dateKey) return;
    const historyDocRef = doc(db, 'artifacts', APP_ID, 'history', dateKey);
    try {
        await deleteDoc(historyDocRef);
        showToast(`${dateKey} 이력이 삭제되었습니다.`);
    } catch (e) {
        console.error('Error deleting history:', e);
        showToast('이력 삭제 중 오류 발생.', true);
        throw e; // 호출한 곳에서 오류를 처리할 수 있도록 throw
    }
}

/**
 * Firestore 'history'의 특정 날짜 문서를 업데이트합니다. (수량 수정용)
 * (app.js의 openHistoryQuantityModal에서 분리)
 */
export async function updateHistoryDoc(dateKey, dataToSave) {
    if (!dateKey || !dataToSave) return;
    const historyDocRef = doc(db, 'artifacts', APP_ID, 'history', dateKey);
    try {
        await setDoc(historyDocRef, dataToSave);
        showToast(`${dateKey}의 처리량이 수정되었습니다.`);
    } catch (e) {
        console.error('Error updating history quantities:', e);
        showToast('처리량 업데이트 중 오류 발생.', true);
        throw e;
    }
}