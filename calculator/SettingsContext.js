// 설정 상태를 전역으로 관리하는 Context입니다.
// 통관비 옵션의 상품단가/박스당수량/박스당무게는 logis 3개월 평균(Firestore integrations/customsDefaults)을
// calculator/logis-defaults.js(모듈)가 읽어 window.__customsDefaults + 'customs-defaults' 이벤트로 넘겨 줍니다.
// 로그아웃·실패면 localStorage 의 마지막 저장값을 그대로 씁니다.
// 그 밖의 설정 칸은 팀 공용(Firestore persistent_data/calculatorSettings)입니다 — calculator/shared-settings.js(모듈)가
// 읽어 window.__calcShared + 'calc-shared-settings' 이벤트로 넘기고, 저장은 window.__calcSharedSave 로 합니다.

const SettingsContext = React.createContext();

// 공용 값을 이 PC 에 처음 얹기 전의 설정(localStorage appSettings 원문)을 한 번만 남겨 둔다 — 덮어쓰지 않는다.
// 페이지를 열 때 읽은 원문을 쓴다(그 뒤 저장 효과가 appSettings 를 바꾸기 전). 원문이 없었으면 'null'.
const SHARED_BACKUP_KEY = 'appSettings_공용전';
const RAW_SETTINGS_AT_LOAD = (() => { try { return localStorage.getItem('appSettings'); } catch (e) { return null; } })();
const backupBeforeShared = () => {
    try {
        if (localStorage.getItem(SHARED_BACKUP_KEY) !== null) return;
        localStorage.setItem(SHARED_BACKUP_KEY, RAW_SETTINGS_AT_LOAD === null ? 'null' : RAW_SETTINGS_AT_LOAD);
    } catch (e) { console.warn('설정 백업 실패:', e); }
};

// 공용 설정에서 빼는 칸(logis 평균 자동값) — js/lib/calc-settings.js AUTO_KEYS 와 같게
const AUTO_CUSTOMS_KEYS = ['defaultUnitPrice', 'defaultQuantityPerBox', 'defaultWeightPerBox'];

// 지금 설정에 공용 값을 얹는다(js/lib/calc-settings.js applyShared 와 같은 규칙 — Babel 파일이라 import 를 못 해 옮겨 둠)
const applySharedSettings = (current, shared) => {
    const next = JSON.parse(JSON.stringify(current));
    if (!shared || typeof shared !== 'object') return next;
    for (const cat of Object.keys(shared)) {
        const src = shared[cat];
        if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
        if (!next[cat] || typeof next[cat] !== 'object') next[cat] = {};
        for (const k of Object.keys(src)) {
            if (cat === 'customs' && AUTO_CUSTOMS_KEYS.includes(k)) continue;
            next[cat][k] = JSON.parse(JSON.stringify(src[k]));
        }
    }
    return next;
};

// 저장된 설정과 기본 설정을 머지합니다. 신규 키가 DEFAULT_SETTINGS에 추가된 경우에도 기존 사용자가 누락 없이 사용할 수 있도록 합니다.
const mergeWithDefaults = (saved) => {
    const merged = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (!saved || typeof saved !== 'object') return merged;
    for (const category of Object.keys(merged)) {
        if (saved[category] && typeof saved[category] === 'object') {
            for (const key of Object.keys(saved[category])) {
                merged[category][key] = saved[category][key];
            }
        }
    }
    return merged;
};

const SettingsProvider = ({ children }) => {
    const [settings, setSettings] = React.useState(() => {
        try {
            const saved = localStorage.getItem('appSettings');
            return saved ? mergeWithDefaults(JSON.parse(saved)) : DEFAULT_SETTINGS;
        } catch (e) {
            console.error("Failed to load settings", e);
            return DEFAULT_SETTINGS;
        }
    });

    // logis 평균 기본값 상태: 'loading' | 'ok' | 'signed-out' | 'error' (logis-defaults.js 와 같다)
    const [defaultsStatus, setDefaultsStatus] = React.useState('loading');
    const [defaultsMeta, setDefaultsMeta] = React.useState(null);
    const [defaultsError, setDefaultsError] = React.useState(null);

    const applyDefaults = React.useCallback((st) => {
        if (!st) return;
        setDefaultsStatus(st.status || 'error');
        setDefaultsMeta(st.meta || null);
        setDefaultsError(st.error || null);
        if (st.status === 'ok' && st.values) {
            setSettings(prev => ({
                ...prev,
                customs: {
                    ...prev.customs,
                    defaultUnitPrice: st.values.defaultUnitPrice,
                    defaultQuantityPerBox: st.values.defaultQuantityPerBox,
                    defaultWeightPerBox: st.values.defaultWeightPerBox,
                },
            }));
        }
    }, []);

    // 모듈이 먼저 끝났을 수도, 나중에 끝날 수도 있다 — 지금 값 확인 + 이벤트 구독
    React.useEffect(() => {
        const on = (e) => applyDefaults((e && e.detail) || window.__customsDefaults);
        window.addEventListener('customs-defaults', on);
        if (window.__customsDefaults) applyDefaults(window.__customsDefaults);
        return () => window.removeEventListener('customs-defaults', on);
    }, [applyDefaults]);

    const reloadDefaults = React.useCallback(() => {
        if (typeof window.__reloadCustomsDefaults === 'function') window.__reloadCustomsDefaults();
    }, []);

    // 공용 설정 상태: 'loading' | 'ok' | 'empty' | 'signed-out' | 'error' (shared-settings.js 와 같다)
    const [sharedStatus, setSharedStatus] = React.useState('loading');
    const [sharedMeta, setSharedMeta] = React.useState({});
    const [sharedHistory, setSharedHistory] = React.useState([]);
    const [sharedError, setSharedError] = React.useState(null);
    const [sharedRev, setSharedRev] = React.useState(0);     // 공용 값이 설정에 얹힐 때마다 +1 (설정 화면이 안 고친 상태면 새로 그린다)

    const applyShared = React.useCallback((st) => {
        if (!st) return;
        setSharedStatus(st.status || 'error');
        setSharedMeta(st.meta || {});
        setSharedHistory(Array.isArray(st.history) ? st.history : []);
        setSharedError(st.error || null);
        if (st.status === 'ok' && st.settings) {
            backupBeforeShared();
            setSettings(prev => applySharedSettings(prev, st.settings));
            setSharedRev(n => n + 1);
        }
    }, []);

    React.useEffect(() => {
        const on = (e) => applyShared((e && e.detail) || window.__calcShared);
        window.addEventListener('calc-shared-settings', on);
        if (window.__calcShared) applyShared(window.__calcShared);
        return () => window.removeEventListener('calc-shared-settings', on);
    }, [applyShared]);

    // 설정 화면 저장 — base(화면을 열 때 값) → local(저장할 값). 공용 저장이 되면 결과(남이 바꾼 칸 포함)를 얹는다.
    // 로그인 안 됨·모듈 없음이면 이 PC 에만 저장한다. 공용 저장 실패는 예외(아무것도 안 바꿈).
    // 처음 이전(공용 문서 없음)은 shared-settings.js 가 쓰지 않고 돌려준다 — needInitialConfirm 이면 아무것도 바꾸지 않는다.
    const saveSettings = React.useCallback(async (base, local, opts) => {
        const fn = window.__calcSharedSave;
        if (typeof fn !== 'function') {
            setSettings(local);
            return { mode: 'local', reason: '공용 설정 모듈을 불러오지 못함' };
        }
        const res = await fn(base, local, opts || {});
        if (!res || res.mode !== 'shared') {
            setSettings(local);
            return res || { mode: 'local', reason: '알 수 없음' };
        }
        if (res.needInitialConfirm) return res;
        if (!res.settings) { setSettings(local); return res; }
        backupBeforeShared();
        setSettings(applySharedSettings(local, res.settings));
        return res;
    }, []);

    const reloadShared = React.useCallback(() => {
        if (typeof window.__reloadCalcShared === 'function') window.__reloadCalcShared();
    }, []);

    // 설정이 변경될 때마다 localStorage에 저장합니다.
    React.useEffect(() => {
        localStorage.setItem('appSettings', JSON.stringify(settings));
    }, [settings]);

    const updateSettings = (newSettings) => {
        setSettings(newSettings);
    };

    return (
        <SettingsContext.Provider value={{
            settings, updateSettings,
            defaultsStatus, defaultsMeta, defaultsError, reloadDefaults,
            sharedStatus, sharedMeta, sharedHistory, sharedError, sharedRev, saveSettings, reloadShared,
        }}>
            {children}
        </SettingsContext.Provider>
    );
};
