// [수정됨] 'LCL 최소 CBM' 설정 추가
// 2026-10-16: 설정 칸은 팀 공용(Firestore) — 저장은 SettingsContext.saveSettings(base, local). 통관비 기본값 3개는 logis 평균 자동값(이 PC).

// 키 순서와 상관없는 JSON (js/lib/calc-settings.js same() 와 같은 규칙)
const canonJson = (v) => {
    if (Array.isArray(v)) return '[' + v.map(canonJson).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonJson(v[k])).join(',') + '}';
    return v === undefined ? 'undefined' : JSON.stringify(v);
};
// 공용 설정 비교용 JSON — 통관비 기본값 3개(자동값)는 뺀다(SettingsContext.js AUTO_CUSTOMS_KEYS)
const sharedJsonOf = (s) => {
    const c = JSON.parse(JSON.stringify(s || {}));
    if (c.customs) AUTO_CUSTOMS_KEYS.forEach(k => { delete c.customs[k]; });
    return canonJson(c);
};

// 숫자 칸 — 고치는 동안은 입력한 글자 그대로(문자열) 들고 있다가 저장·비교 직전에 숫자로 바꾼다.
// (예전처럼 칠 때마다 parseFloat 하면 '0.' 같은 중간 글자가 사라진다.) 빈칸·글자는 0 — 예전 parseFloat(v) || 0 과 같다.
const ADMIN_NUMBER_FIELDS = {
    common: ['docsFee', 'coFee', 'oceanFreightPerCbm', 'minCbm', 'cbmWeightDivisor', 'vatRate'],
    warehouse: ['ratePerCBMPerDay', 'freeDays', 'surchargeRate', 'paymentDueDays', 'dailyInterestRate'],
};
const numberizeSettings = (s) => {
    const out = JSON.parse(JSON.stringify(s || {}));
    for (const cat of Object.keys(ADMIN_NUMBER_FIELDS)) {
        if (!out[cat]) continue;
        for (const k of ADMIN_NUMBER_FIELDS[cat]) {
            if (typeof out[cat][k] === 'string') out[cat][k] = parseNum(out[cat][k]) || 0;
        }
    }
    return out;
};

const fmtWhen = (iso) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

// 변경 이력 — 최근 순, 설정 이름으로 거르기
const SettingsHistory = ({ history, status }) => {
    const [filter, setFilter] = React.useState('');
    const labels = React.useMemo(() => [...new Set((history || []).map(h => h.label).filter(Boolean))].sort(), [history]);
    const rows = (history || []).filter(h => !filter || h.label === filter);
    return (
        <div>
            <h3 className="text-lg font-bold text-gray-800 mt-6 mb-3 border-b pb-2">변경 이력 (최근 {(history || []).length}건)</h3>
            {status === 'signed-out' && <div className="text-sm text-gray-500 mb-3">로그인하면 팀 공용 설정의 변경 이력을 볼 수 있습니다.</div>}
            {status === 'error' && <div className="text-sm text-red-600 mb-3">공용 설정을 읽지 못해 이력을 볼 수 없습니다.</div>}
            <div className="flex items-center gap-2 mb-3">
                <label className="text-sm text-gray-600" htmlFor="calc-history-filter">설정</label>
                <select id="calc-history-filter" value={filter} onChange={e => setFilter(e.target.value)} className="border rounded px-2 py-1 text-sm">
                    <option value="">전체</option>
                    {labels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
            </div>
            {rows.length === 0 ? (
                <div className="text-sm text-gray-400 py-6 text-center">이력이 없습니다.</div>
            ) : (
                <ul className="divide-y border rounded">
                    {rows.map((h, i) => (
                        <li key={i} className="px-3 py-2 text-sm">
                            <div className="flex flex-wrap gap-x-2 text-xs text-gray-500">
                                <span>{fmtWhen(h.at)}</span><span>·</span><span>{h.by || '알 수 없음'}</span>
                            </div>
                            <div className="text-gray-800 font-medium">{h.label}</div>
                            <div className="text-gray-600 break-all">
                                {h.key === '*' ? h.after : <span>{h.before} <span className="text-gray-400">→</span> {h.after}</span>}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

// 아래 셋은 AdminPage 밖(파일 최상위)에 둔다 — 안에 두면 그릴 때마다 새 컴포넌트가 되어 입력칸이 다시 만들어지고 포커스가 빠진다.
const AdminSectionTitle = ({ title }) => <h3 className="text-lg font-bold text-gray-800 mt-6 mb-3 border-b pb-2">{title}</h3>;

// 저장 전 검사 — 칸 id → 안내 글. 막는 것: ① 숫자 칸의 빈칸·글자(예전엔 조용히 0 으로 저장됐다 — 0 이 맞으면 0 을 친다)
//   ② 0 이면 계산이 깨지는 칸(나눗셈의 분모): common.cbmWeightDivisor(무게 ÷ 이 값 = CBM — 통관비·창고료·효율분석),
//      파레트 길이·너비(컨테이너 길이·너비 ÷ 파레트 — 선적, '없음' 파레트 제외)
//   ③ 관세율 옵션 값의 빈칸·글자(통관비 계산이 관세율 ÷ 100 을 그대로 쓴다 — 0 은 정상).
//   부가세율·수수료율·가산세율 등 0 이 정상인 칸은 0 을 막지 않는다. (고시환율은 설정 칸이 아니라 계산기 환율 칸 — 거기서 '고시환율을 입력하세요')
const ADMIN_POSITIVE_FIELDS = { common: ['cbmWeightDivisor'] };
const validateAdminSettings = (s) => {
    const errs = {};
    const num = (v) => (typeof v === 'number' ? v : parseNum(v));
    for (const cat of Object.keys(ADMIN_NUMBER_FIELDS)) {
        for (const k of ADMIN_NUMBER_FIELDS[cat]) {
            const v = s[cat] ? s[cat][k] : undefined;
            if (v === undefined) continue;
            const n = num(v);
            const id = `calc-set-${cat}-${k}`;
            if (!Number.isFinite(n)) errs[id] = '숫자를 입력하세요 (0 이면 0 을 입력)';
            else if ((ADMIN_POSITIVE_FIELDS[cat] || []).includes(k) && n <= 0) errs[id] = '0 보다 커야 합니다 — 무게 ÷ 이 값으로 CBM 을 계산합니다';
        }
    }
    ((s.customs && s.customs.tariffRates) || []).forEach((it, i) => {
        if (!Number.isFinite(num(it && it.value))) errs[`calc-set-tariff-${i}`] = '관세율 값은 숫자로 (0 도 됩니다)';
    });
    ((s.shipping && s.shipping.palletTypes) || []).forEach((p, i) => {
        if (!p || p.value === 'none') return;
        ['length', 'width'].forEach(f => {
            const n = num(p[f]);
            if (!(Number.isFinite(n) && n > 0)) errs[`calc-set-pallet-${i}-${f}`] = '0 보다 큰 숫자 — 컨테이너 크기 ÷ 파레트 크기로 계산합니다';
        });
    });
    return errs;
};
const adminTabOfError = (id) => (id.startsWith('calc-set-common') ? 'common' : id.startsWith('calc-set-warehouse') ? 'warehouse'
    : id.startsWith('calc-set-tariff') ? 'customs' : id.startsWith('calc-set-pallet') ? 'shipping' : 'common');
const AdminFieldError = ({ id, text }) => (text ? <p id={`${id}-err`} className="mt-1 text-xs font-semibold text-red-600 text-right" data-k="admin-field-error">{text}</p> : null);

const AdminInputRow = ({ id, label, value, onChange, unit, note, readOnly, error }) => (
    <div className="py-2">
        <div className="flex items-center justify-between gap-3">
            <label htmlFor={id} className="text-sm font-medium text-gray-600">
                {label}
                {note && <span className="block text-[11px] font-normal text-gray-400">{note}</span>}
            </label>
            <div className="flex items-center flex-shrink-0">
                <input id={id} type="text" inputMode="decimal" autoComplete="off" value={value ?? ''} readOnly={!!readOnly}
                    onChange={e => { if (!readOnly && onChange) onChange(e.target.value); }}
                    aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined}
                    style={error ? BAD_INPUT_STYLE : undefined}
                    className={`border rounded px-2 py-1 w-32 text-right text-sm ${readOnly ? 'bg-gray-50 text-gray-500' : ''}`} />
                <span className="ml-2 text-xs text-gray-400 w-14">{unit}</span>
            </div>
        </div>
        <AdminFieldError id={id} text={error} />
    </div>
);

// valueErrorOf(idx) → 그 줄 '값' 칸의 안내(없으면 null)
const AdminArrayEditor = ({ title, note, data, onAdd, onChange, onDelete, valueErrorOf, idPrefix }) => (
    <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-bold text-gray-700">
                {title}
                {note && <span className="block text-[11px] font-normal text-gray-400">{note}</span>}
            </h4>
            <button onClick={onAdd} className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded hover:bg-blue-200">+ 추가</button>
        </div>
        <div className="space-y-2">
            {(data || []).map((item, idx) => {
                const err = valueErrorOf ? valueErrorOf(idx) : null;
                const vid = idPrefix ? `${idPrefix}-${idx}` : undefined;
                return (
                <div key={idx} className="bg-gray-50 p-2 rounded">
                    <div className="flex gap-2 items-center">
                        <input type="text" value={item.label ?? ''} onChange={(e) => onChange(idx, 'label', e.target.value)} placeholder="이름" aria-label={`${title} ${idx + 1}번 이름`} className="border rounded px-2 py-1 text-sm flex-1 min-w-0" />
                        <input type="text" id={vid} value={item.value ?? ''} onChange={(e) => onChange(idx, 'value', e.target.value)} placeholder="값" aria-label={`${title} ${idx + 1}번 값`}
                            aria-invalid={err ? true : undefined} aria-describedby={err && vid ? `${vid}-err` : undefined} style={err ? BAD_INPUT_STYLE : undefined}
                            className="border rounded px-2 py-1 text-sm w-24" />
                        <button onClick={() => onDelete(idx)} aria-label={`${title} ${idx + 1}번 삭제`} title="삭제" className="text-red-400 hover:text-red-600 px-1">×</button>
                    </div>
                    <AdminFieldError id={vid || `${title}-${idx}`} text={err} />
                </div>
                );
            })}
        </div>
    </div>
);

const AdminPage = ({ onClose }) => {
    const { settings, defaultsStatus, defaultsMeta, defaultsError, reloadDefaults,
            sharedStatus, sharedMeta, sharedHistory, sharedError, sharedRev, saveSettings, reloadShared } = React.useContext(SettingsContext);

    const [localSettings, setLocalSettings] = React.useState(settings);
    // 화면을 열 때의 값 — 저장할 때 '내가 바꾼 칸' 을 가르는 기준(그사이 남이 바꾼 칸은 덮지 않는다)
    const [baseSettings, setBaseSettings] = React.useState(settings);
    const [activeTab, setActiveTab] = React.useState('common');
    const [saving, setSaving] = React.useState(false);

    // 고친 칸이 있는가(숫자 칸은 숫자로 바꿔 비교) — 공용 값 다시 그리기·[취소] 확인에 쓴다
    const isDirty = sharedJsonOf(numberizeSettings(localSettings)) !== sharedJsonOf(baseSettings);

    // 공용 값이 (늦게) 도착했을 때 — 아직 아무것도 안 고쳤으면 새 값으로 다시 그린다. 고치는 중이면 그대로(저장 때 충돌로 걸러진다)
    React.useEffect(() => {
        if (sharedRev === 0) return;
        if (!isDirty) {
            setLocalSettings(settings);
            setBaseSettings(settings);
        }
    }, [sharedRev]);

    // 칸 옆 '마지막 변경' — meta 는 {분류: {키: {at, by}}}
    const lastChange = (mk) => {
        if (!mk) return null;
        const [cat, k] = mk.split('.');
        const m = sharedMeta && sharedMeta[cat] && sharedMeta[cat][k];
        return m && m.at ? `마지막 변경: ${fmtWhen(m.at)} · ${m.by || '알 수 없음'}` : null;
    };

    // logis 평균(logis-defaults.js)으로 settings.customs 의 자동값 3개가 갱신되면 localSettings 에는 그 3개만 반영
    // (customs 전체를 덮으면 고치고 있던 관세율 옵션 등이 공용 값으로 되돌아간다)
    React.useEffect(() => {
        setLocalSettings(prev => {
            const customs = { ...prev.customs };
            AUTO_CUSTOMS_KEYS.forEach(k => { customs[k] = settings.customs[k]; });
            return { ...prev, customs };
        });
    }, [settings.customs.defaultUnitPrice, settings.customs.defaultQuantityPerBox, settings.customs.defaultWeightPerBox]);

    const handleNumberChange = (category, key, value) => {
        setLocalSettings(prev => ({
            ...prev,
            [category]: {
                ...prev[category],
                [key]: value                // 문자열 그대로 — 저장 직전 numberizeSettings
            }
        }));
    };

    const handleArrayChange = (category, arrayName, index, field, value) => {
        const newArray = [...localSettings[category][arrayName]];
        newArray[index] = { ...newArray[index], [field]: value };
        
        setLocalSettings(prev => ({
            ...prev,
            [category]: {
                ...prev[category],
                [arrayName]: newArray
            }
        }));
    };

    const handleAddItem = (category, arrayName, template) => {
        setLocalSettings(prev => ({
            ...prev,
            [category]: {
                ...prev[category],
                [arrayName]: [...prev[category][arrayName], template]
            }
        }));
    };

    const handleDeleteItem = (category, arrayName, index) => {
        const newArray = localSettings[category][arrayName].filter((_, i) => i !== index);
        setLocalSettings(prev => ({
            ...prev,
            [category]: {
                ...prev[category],
                [arrayName]: newArray
            }
        }));
    };

    // 저장을 막는 칸(빨간 표시 + 안내). 저장을 눌러 막혔으면 위에 요약 상자.
    const fieldErrors = validateAdminSettings(localSettings);
    const errorIds = Object.keys(fieldErrors);
    const [saveBlocked, setSaveBlocked] = React.useState(false);
    const errorTabs = new Set(errorIds.map(adminTabOfError));

    const handleSave = async () => {
        if (saving) return;
        if (errorIds.length) {
            setSaveBlocked(true);
            if (!errorTabs.has(activeTab)) setActiveTab(adminTabOfError(errorIds[0]));
            return;
        }
        setSaveBlocked(false);
        setSaving(true);
        try {
            const local = numberizeSettings(localSettings);
            let res = await saveSettings(baseSettings, local);
            if (res.mode === 'shared' && res.needInitialConfirm) {
                // 처음 이전 — 공용 문서가 없어 이 PC 설정 전체가 시작값이 된다
                if (!confirm('이 PC 설정 전체가 팀 공용 설정의 시작값이 됩니다. 계속할까요?')) return;
                res = await saveSettings(baseSettings, local, { confirmedInitial: true });
            }
            if (res.mode === 'shared' && res.noInitial) {
                alert('바뀐 설정이 없어 저장하지 않았습니다.');
                onClose();
                return;
            }
            if (res.mode !== 'shared') {
                alert(`이 PC 에만 저장했습니다 (${res.reason || '로그인하지 않음'}).\n팀 공용 설정은 로그인한 뒤 저장하세요.`);
                onClose();
                return;
            }
            const lines = [];
            if (res.initial) lines.push('팀 공용 설정을 처음 만들었습니다 — 이 PC 의 설정으로 시작합니다.');
            lines.push(res.applied.length ? `공용 설정 ${res.applied.length}칸을 저장했습니다.` : '바뀐 공용 설정이 없습니다.');
            if (res.conflicts.length) {
                lines.push('', '그사이 다른 사람이 먼저 바꾼 칸은 저장하지 않았습니다(지금 공용 값으로 바뀝니다):');
                res.conflicts.forEach(c => lines.push(`· ${c.label}: ${c.remoteText}`));
            }
            alert(lines.join('\n'));
            onClose();
        } catch (e) {
            console.warn('공용 설정 저장 실패:', e && e.code ? e.code : e);
            alert('공용 설정 저장에 실패했습니다 — 아무것도 저장하지 않았습니다.\n잠시 뒤 다시 저장해 보세요.' + (e && e.code ? ` (${e.code})` : ''));
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        if (isDirty && !confirm('저장하지 않은 변경이 있습니다. 버리고 닫을까요?')) return;
        onClose();
    };

    // 공용 숫자 칸 한 줄('분류.키')
    const numRow = (category, key, label, unit, fallback) => (
        <AdminInputRow id={`calc-set-${category}-${key}`} label={label} unit={unit} note={lastChange(category + '.' + key)}
            error={fieldErrors[`calc-set-${category}-${key}`]}
            value={localSettings[category]?.[key] ?? fallback} onChange={v => handleNumberChange(category, key, v)} />
    );
    const arrayEd = (category, arrayKey, title, idPrefix) => (
        <AdminArrayEditor title={title} note={lastChange(category + '.' + arrayKey)} data={localSettings[category][arrayKey]}
            idPrefix={idPrefix} valueErrorOf={idPrefix ? (idx) => fieldErrors[`${idPrefix}-${idx}`] || null : null}
            onAdd={() => handleAddItem(category, arrayKey, { label: '새 옵션', value: 0 })}
            onChange={(idx, field, v) => handleArrayChange(category, arrayKey, idx, field, v)}
            onDelete={(idx) => handleDeleteItem(category, arrayKey, idx)} />
    );
    const palletErr = (idx, f) => fieldErrors[`calc-set-pallet-${idx}-${f}`];

    return (
        <div className="fixed inset-0 bg-gray-100 z-50 overflow-y-auto animate-fade-in">
            <div className="max-w-4xl mx-auto bg-white min-h-screen shadow-xl">
                {/* Header */}
                <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center z-10">
                    <h2 className="text-xl font-bold text-gray-800">설정 관리</h2>
                    <div className="flex gap-2">
                        <button onClick={handleCancel} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
                        <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">{saving ? '저장 중' : '저장'}</button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 pb-20">
                    {/* 팀 공용 설정 상태 (shared-settings.js) */}
                    <div className={`mb-4 p-3 rounded-lg border flex items-center justify-between gap-3 text-sm ${sharedStatus === 'ok' || sharedStatus === 'empty' ? 'bg-slate-50 border-slate-200' : 'bg-yellow-50 border-yellow-300'}`}>
                        <div className="flex-1 min-w-0 text-xs text-gray-600">
                            {sharedStatus === 'loading' && '팀 공용 설정을 불러오는 중...'}
                            {sharedStatus === 'ok' && '팀 공용 설정입니다 — 저장하면 모든 직원의 계산기에 반영되고 변경 이력이 남습니다.'}
                            {sharedStatus === 'empty' && '아직 팀 공용 설정이 없습니다 — 처음 저장하면 이 PC 의 설정으로 공용 설정이 시작됩니다.'}
                            {sharedStatus === 'signed-out' && (
                                <span>로그인하지 않아 이 PC 의 마지막 설정을 쓰고 있습니다 — 저장해도 이 PC 에만 저장됩니다.{' '}
                                    <a href="../index.html" className="font-semibold text-emerald-700 underline">로그인하러 가기</a></span>
                            )}
                            {sharedStatus === 'error' && <span className="text-red-600">팀 공용 설정을 불러오지 못했습니다({sharedError}) — 지금은 이 PC 의 마지막 설정입니다.</span>}
                        </div>
                        {(sharedStatus === 'error' || sharedStatus === 'ok' || sharedStatus === 'empty') && (
                            <button onClick={reloadShared} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 whitespace-nowrap">공용 설정 새로고침</button>
                        )}
                    </div>

                    {saveBlocked && errorIds.length > 0 && (
                        <div role="alert" className="mb-4 p-3 rounded-lg border border-red-300 bg-red-50 text-sm text-red-700" data-k="admin-save-blocked">
                            저장하지 않았습니다 — 빨간 칸 {errorIds.length}곳을 고쳐 주세요(0 이나 빈칸이면 계산이 깨지는 칸).
                        </div>
                    )}

                    <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                        {['common', 'import', 'customs', 'shipping', 'warehouse', 'history'].map(tab => (
                            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${activeTab === tab ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-600'}`}>
                                {tab === 'common' ? '기본 수수료' : tab === 'import' ? '수입가 옵션' : tab === 'customs' ? '통관비 옵션' : tab === 'shipping' ? '선적 옵션' : tab === 'warehouse' ? '창고료&가산세' : '변경 이력'}
                                {errorTabs.has(tab) && <span className="ml-1 text-red-600" aria-label="고칠 칸 있음">●</span>}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'history' && <SettingsHistory history={sharedHistory} status={sharedStatus} />}

                    {activeTab === 'common' && (
                        <div>
                            <AdminSectionTitle title="고정 수수료 및 기준값" />
                            {numRow('common', 'docsFee', '서류비 (Docs Fee)', '원')}
                            {numRow('common', 'coFee', 'CO 발급비', '원')}
                            {numRow('common', 'oceanFreightPerCbm', '해운비 기준가 (Per CBM)', '원')}

                            {/* [추가됨] LCL 최소 CBM 설정 */}
                            {numRow('common', 'minCbm', 'LCL 최소 CBM (기본 1.0)', 'CBM')}

                            {numRow('common', 'cbmWeightDivisor', 'CBM 무게 나누기 기준', '')}
                            {numRow('common', 'vatRate', '부가세율 (0.1 = 10%)', '')}
                        </div>
                    )}

                    {activeTab === 'import' && (
                        <div>
                            <AdminSectionTitle title="수입가 계산기 옵션" />
                            {arrayEd('import', 'commissionRates', '수수료율 옵션')}
                            {arrayEd('import', 'customsFeeRates', '통관비율 옵션')}
                            {arrayEd('import', 'packagingOptions', '포장비 옵션')}
                            {arrayEd('import', 'labelOptions', '라벨비 옵션')}
                        </div>
                    )}

                    {activeTab === 'customs' && (
                        <div>
                            <AdminSectionTitle title="통관비 계산기 기본값" />

                            {(() => {
                                // logis 3개월 평균 상태 (값은 앱\통관비기본값\실행.py 가 15일마다 계산)
                                const m = defaultsMeta || {};
                                const fmtDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
                                const stale = defaultsStatus === 'ok' && m.lastOkAt && (Date.now() - m.lastOkAt) > 20 * 86400000;
                                return (
                                    <div className={`mb-4 p-3 rounded-lg border flex items-center justify-between gap-3 text-sm ${stale ? 'bg-yellow-50 border-yellow-300' : 'bg-slate-50 border-slate-200'}`}>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-gray-800">logis 3개월 평균 (자동)</div>
                                            <div className="text-xs text-gray-500 mt-0.5">
                                                {defaultsStatus === 'loading' && '불러오는 중...'}
                                                {defaultsStatus === 'ok' && (
                                                    <span>
                                                        {m.window ? `${m.window.from} ~ ${m.window.to}` : '기간 알 수 없음'}
                                                        {m.packings != null ? ` · 패킹 ${m.packings}건` : ''}
                                                        {m.lastOkAt ? ` · 계산일 ${fmtDay(m.lastOkAt)}` : ''}
                                                    </span>
                                                )}
                                                {defaultsStatus === 'signed-out' && '로그인하면 최신값 — 지금은 마지막 저장값'}
                                                {defaultsStatus === 'error' && (
                                                    <span className="text-red-600">불러오기 실패: {defaultsError} — 지금은 마지막 저장값</span>
                                                )}
                                            </div>
                                            {defaultsStatus === 'ok' && m.ok === false && m.error && (
                                                <div className="text-xs text-red-600 mt-0.5">최근 자동 계산 실패: {m.error} — 지난 값을 계속 씁니다</div>
                                            )}
                                            {stale && (
                                                <div className="text-xs text-yellow-800 mt-0.5">계산일이 20일 넘게 지났습니다 — 자동 계산(매일 08:10, 15일 주기)이 멈췄는지 확인하세요</div>
                                            )}
                                            <div className="text-xs text-gray-400 mt-0.5">자동으로 계산되는 값이라 여기서는 고칠 수 없습니다 — 통관비 계산기 화면에서 그때그때 바꿔 쓰세요.</div>
                                        </div>
                                        <button
                                            onClick={reloadDefaults}
                                            disabled={defaultsStatus === 'loading'}
                                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                        >
                                            {defaultsStatus === 'loading' ? '읽는 중' : '평균값 새로고침'}
                                        </button>
                                    </div>
                                );
                            })()}

                            {/* 자동값 3칸 — 읽기 전용(공용 설정이 아니고 여기서 저장하지 않는다) */}
                            <AdminInputRow id="calc-set-customs-defaultUnitPrice" label="상품 단가" value={localSettings.customs.defaultUnitPrice} readOnly unit="USD/개" />
                            <AdminInputRow id="calc-set-customs-defaultQuantityPerBox" label="박스당 수량" value={localSettings.customs.defaultQuantityPerBox} readOnly unit="개/박스" />
                            <AdminInputRow id="calc-set-customs-defaultWeightPerBox" label="박스당 무게" value={localSettings.customs.defaultWeightPerBox} readOnly unit="kg/박스" />

                            <AdminSectionTitle title="통관비 계산기 옵션" />
                            {arrayEd('customs', 'tariffRates', '관세율 옵션', 'calc-set-tariff')}
                        </div>
                    )}
                    
                    {activeTab === 'warehouse' && (
                        <div>
                            <AdminSectionTitle title="창고료 & 가산세 기본값" />
                            {numRow('warehouse', 'ratePerCBMPerDay', '창고료 단가', '원/CBM/일', 1200)}
                            {numRow('warehouse', 'freeDays', '무료보관일수', '일', 7)}
                            {numRow('warehouse', 'surchargeRate', '가산세율 (0.03 = 3%)', '', 0.03)}
                            {numRow('warehouse', 'paymentDueDays', '납부마감기한 (입항일+N)', '일', 25)}
                            {numRow('warehouse', 'dailyInterestRate', '일 지연이자율 (0.00025 = 0.025%)', '', 0.00025)}
                        </div>
                    )}

                    {activeTab === 'shipping' && (
                         <div>
                            <AdminSectionTitle title="파레트 규격" />
                            {lastChange('shipping.palletTypes') && <div className="-mt-2 mb-3 text-[11px] text-gray-400">{lastChange('shipping.palletTypes')}</div>}
                            {localSettings.shipping.palletTypes.map((pallet, idx) => (
                                <div key={idx} className="border p-4 rounded mb-4 bg-gray-50">
                                    <div className="flex justify-between mb-2">
                                        <input aria-label={`파레트 ${idx + 1}번 이름`} className="font-bold bg-transparent border-b border-transparent focus:border-blue-500 outline-none" value={pallet.label} onChange={e => handleArrayChange('shipping', 'palletTypes', idx, 'label', e.target.value)} />
                                        <button onClick={() => handleDeleteItem('shipping', 'palletTypes', idx)} className="text-red-500 text-xs">삭제</button>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <input type="number" id={`calc-set-pallet-${idx}-length`} placeholder="길이" aria-label={`파레트 ${idx + 1}번 길이`} value={Number.isFinite(pallet.length) ? pallet.length : ''} onChange={e => handleArrayChange('shipping', 'palletTypes', idx, 'length', parseNum(e.target.value))} aria-invalid={palletErr(idx, 'length') ? true : undefined} style={palletErr(idx, 'length') ? BAD_INPUT_STYLE : undefined} className="border p-1 text-sm rounded" />
                                        <input type="number" id={`calc-set-pallet-${idx}-width`} placeholder="너비" aria-label={`파레트 ${idx + 1}번 너비`} value={Number.isFinite(pallet.width) ? pallet.width : ''} onChange={e => handleArrayChange('shipping', 'palletTypes', idx, 'width', parseNum(e.target.value))} aria-invalid={palletErr(idx, 'width') ? true : undefined} style={palletErr(idx, 'width') ? BAD_INPUT_STYLE : undefined} className="border p-1 text-sm rounded" />
                                        <input type="number" placeholder="높이" aria-label={`파레트 ${idx + 1}번 높이`} value={pallet.height} onChange={e => handleArrayChange('shipping', 'palletTypes', idx, 'height', parseNum(e.target.value))} className="border p-1 text-sm rounded" />
                                    </div>
                                    <AdminFieldError id={`calc-set-pallet-${idx}-length`} text={palletErr(idx, 'length') || palletErr(idx, 'width')} />
                                </div>
                            ))}
                            <button onClick={() => handleAddItem('shipping', 'palletTypes', {label:'새 파레트', value: 'new_pallet', length:1000, width:1000, height:150})} className="w-full py-2 bg-blue-50 text-blue-600 rounded dashed border border-blue-200">+ 파레트 추가</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};