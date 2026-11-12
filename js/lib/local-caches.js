// === js/lib/local-caches.js ===
// 🔒 로그아웃 때 이 브라우저에 남는 업무 자료 사본을 지운다(2026-11-12 보안 점검).
//   공용 PC 에서 로그아웃한 뒤에도 근태·업무 이력(13개월), 중국 재고 시트 원문, 월 요약, Firestore 오프라인 사본이 남아
//   다음 사람이 개발자 도구로 볼 수 있었다. 모두 서버에서 다시 받으면 되는 사본이다.
// 지우지 않는 것: 테마·열 너비·보기 설정 같은 화면 설정, 스캐너의 아직 안 보낸 대기열(scanInQueue·scanLocQueue — 지우면 스캔이 사라진다),
//   계산기 입력 기억값(calculator/CalcMemory.js — 로그아웃해도 이어 쓰는 것이 설계).
// 순수 모듈 — 저장소·Firestore 함수는 부르는 쪽이 넘긴다(시험: tests/local-caches.test.js).

/** 지울 localStorage 키 — 각 파일의 키 이름 그대로. 키를 바꾸면 여기도 같이. */
export const SENSITIVE_LOCAL_KEYS = Object.freeze([
    'historyDataCache', 'historyDataCacheTime',            // js/history-data-manager.js 전체 이력(근태·업무)
    'historyDataCacheDash', 'historyDataCacheDashTime',    // 〃 대시보드용 최근 100일
    'plannedDataCache', 'plannedDataCacheTime',            // 〃 예정 물량
    'chinastock_csv_cache_v1',                             // js/china-stock-goods.js 시트 CSV 원문
    'opsMonthlyCache',                                     // js/ops-monthly-store.js 월 요약
    'incoming_schedule_cache_v1',                          // js/widget-incoming-schedule.js 입고일정
]);

const withTimeout = (p, ms) => {
    let t = null;
    const timer = new Promise((_, no) => { t = setTimeout(() => no(new Error('timeout')), ms); });
    return Promise.race([p, timer]).finally(() => clearTimeout(t));
};

/** Firestore 오프라인 사본을 못 지웠을 때(다른 탭이 쥐고 있음) 새로고침 전에 보여 줄 안내 — 대시보드·계산기 로그아웃 공용 */
//   새로 열리면 이미 로그아웃 상태라 — 다시 로그인한 뒤 로그아웃하라고 안내한다
export const FIRESTORE_CLEAR_FAILED_MSG = '다른 업무 탭(부족수량관리 등)을 모두 닫고, 다시 로그인한 뒤 로그아웃해야 이 PC 의 자료 사본이 지워집니다.';

/**
 * 로그아웃 때 부른다. 실패해도 예외를 던지지 않는다(로그아웃은 그대로 진행).
 * @param {object} o
 * @param {Storage} [o.storage]   기본 globalThis.localStorage
 * @param {object} [o.db]         Firestore 인스턴스 — 주면 terminate 뒤 오프라인 사본(IndexedDB)을 지운다.
 *                                ⚠️ terminate 한 db 는 다시 못 쓴다 → 부르는 쪽이 끝나고 페이지를 새로 연다.
 * @param {{terminate:Function, clearIndexedDbPersistence:Function}} [o.firestore]  firebase-firestore 의 두 함수
 * @param {number} [o.timeoutMs]  Firestore 정리 한도(다른 탭이 사본을 쥐고 있으면 오래 기다릴 수 있다)
 * @returns {Promise<{removed:number, firestore:'cleared'|'skipped'|'failed'}>}
 */
export async function clearLocalCaches({ storage, db, firestore, timeoutMs = 3000 } = {}) {
    let removed = 0;
    let st = storage;
    try { if (!st) st = globalThis.localStorage; } catch (e) { st = null; }
    if (st) {
        for (const k of SENSITIVE_LOCAL_KEYS) {
            try {
                if (st.getItem(k) !== null) removed++;
                st.removeItem(k);
            } catch (e) { /* 저장소 막힘 — 다음 키 */ }
        }
    }
    let fsResult = 'skipped';
    if (db && firestore && typeof firestore.terminate === 'function' && typeof firestore.clearIndexedDbPersistence === 'function') {
        try {
            await withTimeout(firestore.terminate(db), timeoutMs);
            await withTimeout(firestore.clearIndexedDbPersistence(db), timeoutMs);
            fsResult = 'cleared';
        } catch (e) {
            // 다른 탭이 열려 있으면(failed-precondition) 못 지운다 — 그 탭을 닫고 다시 로그아웃하면 된다. 내용은 찍지 않는다.
            fsResult = 'failed';
            try { console.warn('[로그아웃] 오프라인 사본을 지우지 못함:', (e && (e.code || e.message)) || 'unknown'); } catch (_) { /* */ }
        }
    }
    return { removed, firestore: fsResult };
}
