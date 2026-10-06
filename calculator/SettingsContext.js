// 설정 상태를 전역으로 관리하는 Context입니다.
// 통관비 옵션의 상품단가/박스당수량/박스당무게는 구글 스프레드시트에서 자동 fetch합니다.

const SettingsContext = React.createContext();

// 게시된 시트 CSV URL (파일→공유→웹에 게시). 원본 시트가 아닌 세 값만 미러링한 공개용 참조 시트를 게시하여 민감 데이터 노출을 방지.
// CSV 첫 행에서 M/O/P 컬럼(0-index 12/14/15) = 박스당무게/박스당수량/상품단가
const CUSTOMS_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGznMa6vr4OagMM6Be-bqGIfRS4my0PLltJVNZUjLXR03DxYyGDkjeETNJ6c1t2twiEwvcFTcO8SA9/pub?gid=1675654509&single=true&output=csv';

// CSV 첫 행을 파싱해 셀 배열 반환 (따옴표 및 콤마 처리)
const parseFirstRow = (csv) => {
    const line = (csv || '').split('\n')[0] || '';
    const cells = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuote = !inQuote;
        } else if (c === ',' && !inQuote) {
            cells.push(cur); cur = '';
        } else {
            cur += c;
        }
    }
    cells.push(cur);
    return cells;
};

// "$ 6.43", "26kg", " ₩ 1,234 " 등에서 숫자만 추출
const parseNum = (s) => parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, ''));

const fetchCustomsDefaultsFromSheet = async () => {
    // cache-buster로 브라우저·중간 캐시 회피
    const url = `${CUSTOMS_SHEET_CSV_URL}&_ts=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const cells = parseFirstRow(text);
    // A=0, B=1, ..., M=12, N=13, O=14, P=15
    const values = {
        defaultWeightPerBox: parseNum(cells[12]),
        defaultQuantityPerBox: parseNum(cells[14]),
        defaultUnitPrice: parseNum(cells[15]),
    };
    if ([values.defaultWeightPerBox, values.defaultQuantityPerBox, values.defaultUnitPrice].some(v => !Number.isFinite(v))) {
        throw new Error('시트에서 유효한 숫자를 얻지 못했습니다 (M1/O1/P1 확인 필요)');
    }
    return values;
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

    // 시트 동기화 상태: 'idle' | 'loading' | 'success' | 'error'
    const [sheetSyncStatus, setSheetSyncStatus] = React.useState('idle');
    const [sheetSyncError, setSheetSyncError] = React.useState(null);
    const [sheetSyncedAt, setSheetSyncedAt] = React.useState(null);

    const syncFromSheet = React.useCallback(async () => {
        setSheetSyncStatus('loading');
        setSheetSyncError(null);
        try {
            const values = await fetchCustomsDefaultsFromSheet();
            setSettings(prev => ({
                ...prev,
                customs: {
                    ...prev.customs,
                    defaultUnitPrice: values.defaultUnitPrice,
                    defaultQuantityPerBox: values.defaultQuantityPerBox,
                    defaultWeightPerBox: values.defaultWeightPerBox,
                },
            }));
            setSheetSyncStatus('success');
            setSheetSyncedAt(new Date());
        } catch (e) {
            console.warn('시트 동기화 실패:', e);
            setSheetSyncStatus('error');
            setSheetSyncError(e.message || String(e));
        }
    }, []);

    // 앱 로드 시 자동으로 시트에서 fetch
    React.useEffect(() => {
        syncFromSheet();
    }, [syncFromSheet]);

    // 설정이 변경될 때마다 localStorage에 저장합니다.
    React.useEffect(() => {
        localStorage.setItem('appSettings', JSON.stringify(settings));
    }, [settings]);

    const updateSettings = (newSettings) => {
        setSettings(newSettings);
    };

    const resetSettings = () => {
        if (confirm('모든 설정을 초기값으로 되돌리시겠습니까?')) {
            setSettings(DEFAULT_SETTINGS);
        }
    };

    return (
        <SettingsContext.Provider value={{
            settings, updateSettings, resetSettings,
            sheetSyncStatus, sheetSyncError, sheetSyncedAt, syncFromSheet,
        }}>
            {children}
        </SettingsContext.Provider>
    );
};
