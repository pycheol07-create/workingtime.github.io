// [수정됨] 'LCL 최소 CBM' 설정 추가
const AdminPage = ({ onClose }) => {
    const { settings, updateSettings, resetSettings, sheetSyncStatus, sheetSyncError, sheetSyncedAt, syncFromSheet } = React.useContext(SettingsContext);

    const [localSettings, setLocalSettings] = React.useState(settings);
    const [activeTab, setActiveTab] = React.useState('common');

    // 시트 동기화로 settings.customs가 갱신되면 localSettings에도 반영
    React.useEffect(() => {
        setLocalSettings(prev => ({
            ...prev,
            customs: { ...prev.customs, ...settings.customs },
        }));
    }, [settings.customs.defaultUnitPrice, settings.customs.defaultQuantityPerBox, settings.customs.defaultWeightPerBox]);

    const handleNumberChange = (category, key, value) => {
        setLocalSettings(prev => ({
            ...prev,
            [category]: {
                ...prev[category],
                [key]: parseFloat(value) || 0
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

    const handleSave = () => {
        updateSettings(localSettings);
        alert('설정이 저장되었습니다.');
        onClose();
    };

    const SectionTitle = ({ title }) => <h3 className="text-lg font-bold text-gray-800 mt-6 mb-3 border-b pb-2">{title}</h3>;
    const InputRow = ({ label, value, onChange, unit }) => (
        <div className="flex items-center justify-between py-2">
            <label className="text-sm font-medium text-gray-600">{label}</label>
            <div className="flex items-center">
                <input type="number" value={value} onChange={e => onChange(e.target.value)} className="border rounded px-2 py-1 w-32 text-right text-sm" />
                <span className="ml-2 text-xs text-gray-400 w-8">{unit}</span>
            </div>
        </div>
    );

    const ArrayEditor = ({ title, data, category, arrayKey, template }) => (
        <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-bold text-gray-700">{title}</h4>
                <button onClick={() => handleAddItem(category, arrayKey, template)} className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded hover:bg-blue-200">+ 추가</button>
            </div>
            <div className="space-y-2">
                {data.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2 rounded">
                        <input type="text" value={item.label} onChange={(e) => handleArrayChange(category, arrayKey, idx, 'label', e.target.value)} placeholder="이름" className="border rounded px-2 py-1 text-sm flex-1" />
                        <input type="text" value={item.value} onChange={(e) => handleArrayChange(category, arrayKey, idx, 'value', e.target.value)} placeholder="값" className="border rounded px-2 py-1 text-sm w-24" />
                        <button onClick={() => handleDeleteItem(category, arrayKey, idx)} className="text-red-400 hover:text-red-600 px-1">×</button>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-gray-100 z-50 overflow-y-auto animate-fade-in">
            <div className="max-w-4xl mx-auto bg-white min-h-screen shadow-xl">
                {/* Header */}
                <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center z-10">
                    <h2 className="text-xl font-bold text-gray-800">설정 관리</h2>
                    <div className="flex gap-2">
                        <button onClick={resetSettings} className="px-4 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100">초기화</button>
                        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
                        <button onClick={handleSave} className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">저장</button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 pb-20">
                    <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                        {['common', 'import', 'customs', 'shipping', 'warehouse'].map(tab => (
                            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${activeTab === tab ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-600'}`}>
                                {tab === 'common' ? '기본 수수료' : tab === 'import' ? '수입가 옵션' : tab === 'customs' ? '통관비 옵션' : tab === 'shipping' ? '선적 옵션' : '창고료&가산세'}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'common' && (
                        <div>
                            <SectionTitle title="고정 수수료 및 기준값" />
                            <InputRow label="서류비 (Docs Fee)" value={localSettings.common.docsFee} onChange={v => handleNumberChange('common', 'docsFee', v)} unit="원" />
                            <InputRow label="CO 발급비" value={localSettings.common.coFee} onChange={v => handleNumberChange('common', 'coFee', v)} unit="원" />
                            <InputRow label="해운비 기준가 (Per CBM)" value={localSettings.common.oceanFreightPerCbm} onChange={v => handleNumberChange('common', 'oceanFreightPerCbm', v)} unit="원" />
                            
                            {/* [추가됨] LCL 최소 CBM 설정 */}
                            <InputRow label="LCL 최소 CBM (기본 1.0)" value={localSettings.common.minCbm} onChange={v => handleNumberChange('common', 'minCbm', v)} unit="CBM" />
                            
                            <InputRow label="CBM 무게 나누기 기준" value={localSettings.common.cbmWeightDivisor} onChange={v => handleNumberChange('common', 'cbmWeightDivisor', v)} unit="" />
                            <InputRow label="부가세율 (0.1 = 10%)" value={localSettings.common.vatRate} onChange={v => handleNumberChange('common', 'vatRate', v)} unit="" />
                        </div>
                    )}

                    {activeTab === 'import' && (
                        <div>
                            <SectionTitle title="수입가 계산기 옵션" />
                            <ArrayEditor title="수수료율 옵션" data={localSettings.import.commissionRates} category="import" arrayKey="commissionRates" template={{label: '새 옵션', value: 0}} />
                            <ArrayEditor title="통관비율 옵션" data={localSettings.import.customsFeeRates} category="import" arrayKey="customsFeeRates" template={{label: '새 옵션', value: 0}} />
                            <ArrayEditor title="포장비 옵션" data={localSettings.import.packagingOptions} category="import" arrayKey="packagingOptions" template={{label: '새 옵션', value: 0}} />
                            <ArrayEditor title="라벨비 옵션" data={localSettings.import.labelOptions} category="import" arrayKey="labelOptions" template={{label: '새 옵션', value: 0}} />
                        </div>
                    )}

                    {activeTab === 'customs' && (
                        <div>
                            <SectionTitle title="통관비 계산기 기본값" />

                            <div className="mb-4 p-3 rounded-lg border flex items-center justify-between gap-3 text-sm bg-slate-50 border-slate-200">
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-gray-800">📊 구글 스프레드시트 자동 동기화</div>
                                    <div className="text-xs text-gray-500 mt-0.5">
                                        {sheetSyncStatus === 'loading' && '동기화 중...'}
                                        {sheetSyncStatus === 'success' && `동기화 성공 (${sheetSyncedAt ? sheetSyncedAt.toLocaleTimeString('ko-KR') : ''}) — M1/O1/P1 값 반영됨`}
                                        {sheetSyncStatus === 'error' && (
                                            <span className="text-red-600">동기화 실패: {sheetSyncError} — 시트가 웹에 게시(파일→공유→웹에 게시, CSV)되어 있는지 확인하세요</span>
                                        )}
                                        {sheetSyncStatus === 'idle' && '앱 로드 시 자동 fetch됩니다'}
                                    </div>
                                </div>
                                <button
                                    onClick={syncFromSheet}
                                    disabled={sheetSyncStatus === 'loading'}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                >
                                    {sheetSyncStatus === 'loading' ? '동기화 중' : '시트에서 새로고침'}
                                </button>
                            </div>

                            <InputRow label="상품 단가 (P1)" value={localSettings.customs.defaultUnitPrice} onChange={v => handleNumberChange('customs', 'defaultUnitPrice', v)} unit="USD/개" />
                            <InputRow label="박스당 수량 (O1)" value={localSettings.customs.defaultQuantityPerBox} onChange={v => handleNumberChange('customs', 'defaultQuantityPerBox', v)} unit="개/박스" />
                            <InputRow label="박스당 무게 (M1)" value={localSettings.customs.defaultWeightPerBox} onChange={v => handleNumberChange('customs', 'defaultWeightPerBox', v)} unit="kg/박스" />

                            <SectionTitle title="통관비 계산기 옵션" />
                            <ArrayEditor title="관세율 옵션" data={localSettings.customs.tariffRates} category="customs" arrayKey="tariffRates" template={{label: '새 옵션', value: 0}} />
                            <div className="p-4 bg-yellow-50 text-yellow-800 text-sm rounded mb-4">
                                ⚠️ 운송 형태(LCL/FCL)와 수수료 타입은 로직에 영향을 주므로 수정 시 주의하세요.
                            </div>
                        </div>
                    )}
                    
                    {activeTab === 'warehouse' && (
                        <div>
                            <SectionTitle title="창고료 & 가산세 기본값" />
                            <InputRow label="창고료 단가" value={localSettings.warehouse?.ratePerCBMPerDay ?? 1200} onChange={v => handleNumberChange('warehouse', 'ratePerCBMPerDay', v)} unit="원/CBM/일" />
                            <InputRow label="무료보관일수" value={localSettings.warehouse?.freeDays ?? 7} onChange={v => handleNumberChange('warehouse', 'freeDays', v)} unit="일" />
                            <InputRow label="가산세율 (0.03 = 3%)" value={localSettings.warehouse?.surchargeRate ?? 0.03} onChange={v => handleNumberChange('warehouse', 'surchargeRate', v)} unit="" />
                            <InputRow label="납부마감기한 (입항일+N)" value={localSettings.warehouse?.paymentDueDays ?? 25} onChange={v => handleNumberChange('warehouse', 'paymentDueDays', v)} unit="일" />
                            <InputRow label="일 지연이자율 (0.00025 = 0.025%)" value={localSettings.warehouse?.dailyInterestRate ?? 0.00025} onChange={v => handleNumberChange('warehouse', 'dailyInterestRate', v)} unit="" />
                        </div>
                    )}

                    {activeTab === 'shipping' && (
                         <div>
                            <SectionTitle title="파레트 규격" />
                            {localSettings.shipping.palletTypes.map((pallet, idx) => (
                                <div key={idx} className="border p-4 rounded mb-4 bg-gray-50">
                                    <div className="flex justify-between mb-2">
                                        <input className="font-bold bg-transparent border-b border-transparent focus:border-blue-500 outline-none" value={pallet.label} onChange={e => handleArrayChange('shipping', 'palletTypes', idx, 'label', e.target.value)} />
                                        <button onClick={() => handleDeleteItem('shipping', 'palletTypes', idx)} className="text-red-500 text-xs">삭제</button>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <input type="number" placeholder="길이" value={pallet.length} onChange={e => handleArrayChange('shipping', 'palletTypes', idx, 'length', parseFloat(e.target.value))} className="border p-1 text-sm rounded" />
                                        <input type="number" placeholder="너비" value={pallet.width} onChange={e => handleArrayChange('shipping', 'palletTypes', idx, 'width', parseFloat(e.target.value))} className="border p-1 text-sm rounded" />
                                        <input type="number" placeholder="높이" value={pallet.height} onChange={e => handleArrayChange('shipping', 'palletTypes', idx, 'height', parseFloat(e.target.value))} className="border p-1 text-sm rounded" />
                                    </div>
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