// [수정됨] 부자재는 원-위안 환율로 직접 변환 후 최종 원가에 합산하도록 분리

// 라디오 묶음(수수료·통관비·포장봉투·라벨). 렌더 밖에 둔다 — 안에서 만들면 다시 그릴 때마다 새 컴포넌트가 되어
// 라디오가 새로 생기고 포커스가 빠진다(Tab 으로 들어가 화살표로 바꾸면 포커스를 잃었다).
// 이름: text/babel 의 맨 위 const 는 페이지 전역이라 다른 파일과 겹치지 않게 Import 접두.
const ImportToggleFieldset = ({ label, name, value, options, onChange }) => (
    <fieldset className="min-w-0">
        <legend className="block text-sm font-medium text-gray-700 mb-2">{label}</legend>
        <div className="flex flex-wrap gap-2 p-1 bg-slate-200/60 rounded-lg">
            {options.map((option, idx) => (
                <label key={idx} className={`relative flex-1 min-w-[60px] cursor-pointer py-2.5 px-3 text-center text-sm font-semibold focus-within:ring-2 focus-within:ring-emerald-500 focus-within:ring-offset-1 ${ String(value) === String(option.value) ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`}>
                    <input type="radio" name={name} value={option.value} checked={String(value) === String(option.value)} onChange={onChange} className="sr-only" />
                    <span>{option.label}</span>
                </label>
            ))}
        </div>
    </fieldset>
);

const ImportCalculator = ({ exchangeRates, onRateChange, customsInfo, onCustomsReset }) => {
    const formRef = React.useRef(null);
    const { settings } = React.useContext(SettingsContext);
    
    const { liveRates, rateStatus } = useLiveRates();     // LiveRateDisplay.js — 탭끼리 한 번만 부른다

    // 처음 값은 각 옵션 목록의 첫 값(목록이 비었을 때만 예전 기본값). 목록이 나중에 바뀌면 useOptionFix 가 맞춘다.
    const importDefaults = () => ({
        productCost: '10',
        commissionRate: String(settings.import.commissionRates[0]?.value ?? 0.035),
        customsFeeRate: String(settings.import.customsFeeRates[0]?.value ?? 0.22),
        packagingBag: String(settings.import.packagingOptions[0]?.value ?? 0.31),
        label: String(settings.import.labelOptions[0]?.value ?? 0.03),
    });
    // 입력값 기억(CalcMemory.js) — 지난번 값을 얹는다. 옵션이 목록에서 빠졌으면 useOptionFix 가 첫 옵션으로 맞춘다.
    const MEM_KEYS = ['productCost', 'commissionRate', 'customsFeeRate', 'packagingBag', 'label'];
    const [formData, setFormData] = React.useState(() => ({ ...importDefaults(), ...calcMemLoad('import', MEM_KEYS) }));
    React.useEffect(() => {
        calcMemSave('import', calcMemPick(formData, MEM_KEYS), calcMemPick(importDefaults(), MEM_KEYS));
    }, [formData]);
    const resetInputs = () => {
        calcMemClear('import');
        setFormData(importDefaults());
    };
    const optionNotice = useOptionFix([
        { name: 'commissionRate', label: '수수료', options: settings.import.commissionRates },
        { name: 'customsFeeRate', label: '통관비', options: settings.import.customsFeeRates },
        { name: 'packagingBag', label: '포장봉투', options: settings.import.packagingOptions },
        { name: 'label', label: '라벨', options: settings.import.labelOptions },
    ], formData, setFormData);


    const handleInputChange = React.useCallback((e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }, []);

    const handleKeyDown = React.useCallback((e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const form = formRef.current;
          if (!form) return;
          const focusable = Array.from(form.querySelectorAll('input:not([type="radio"]), select'));
          const index = focusable.indexOf(e.target);
          if (index > -1 && index < focusable.length - 1) {
            focusable[index + 1].focus();
          } else if (index === focusable.length - 1) {
            document.activeElement?.blur();
          }
        }
    }, []);

    const currentRates = React.useMemo(() => {
        if (exchangeRates.mode === 'live' && liveRates.krw && liveRates.cny) {
            return {
                customs: parseNum(exchangeRates.customs) || 0,
                usdKrw: liveRates.krw,
                cnyKrw: liveRates.krw / liveRates.cny,
                usdCny: 1 / liveRates.cny
            };
        }
        return {
            customs: parseNum(exchangeRates.customs) || 0,
            usdKrw: parseNum(exchangeRates.usdKrw) || 0,
            cnyKrw: parseNum(exchangeRates.cnyKrw) || 0,
            usdCny: parseNum(exchangeRates.usdCny) || 0
        };
    }, [exchangeRates, liveRates]);
    const rateState = liveRateState(exchangeRates, liveRates, rateStatus);
    const customsRateMissing = currentRates.customs === 0;     // 빈칸·0 — 결과 대신 '고시환율을 입력하세요'
    // 송금 환율 빈칸(빈칸·0·음수) — 원-달러·위안-달러는 늘, 원-위안은 부자재(포장비+라벨)가 있을 때만 쓴다.
    //   예전엔 원-위안이 비면 부자재비가 소리 없이 0원이 됐다. 비면 결과 대신 비어 있는 칸 이름을 안내한다.
    const subsidiaryInput = (parseNum(formData.packagingBag) || 0) + (parseNum(formData.label) || 0);
    const remitMissing = missingRateFields(currentRates, subsidiaryInput > 0 ? ['usdKrw', 'cnyKrw', 'usdCny'] : ['usdKrw', 'usdCny']);
    const remitMissingKey = remitMissing.join(',');

    const results = React.useMemo(() => {
        const productCost = parseNum(formData.productCost) || 0;
        const packagingCost = parseNum(formData.packagingBag) || 0;
        const labelCost = parseNum(formData.label) || 0;
        const commissionRate = parseNum(formData.commissionRate) || 0;
        const customsFeeRate = parseNum(formData.customsFeeRate) || 0;

        if (productCost === 0 || remitMissingKey || currentRates.customs === 0) return null;

        const subsidiaryCostCNY = packagingCost + labelCost;

        // 1. 상품원가: 위안 -> 달러(USD) -> 원화(KRW) 변환
        const productCostUSD = productCost * currentRates.usdCny;
        const productCostKRW = productCostUSD * currentRates.usdKrw;
        
        // 2. 부자재: 위안 -> 원화(KRW) 직접 변환 (원-위안 환율 적용)
        const subsidiaryCostKRW = subsidiaryCostCNY * currentRates.cnyKrw;
        
        // 3. 수수료 계산: 상품원가(USD) * 수수료율 -> 원-달러 환율 적용(KRW)
        const commissionUSD = productCostUSD * commissionRate;
        const commissionKRW = commissionUSD * currentRates.usdKrw;
        
        // 4. 통관비 계산: 상품원가(USD) * 통관비율 -> 관세청 고시환율 적용(KRW)
        const customsFeeUSD = productCostUSD * customsFeeRate;
        const customsFeeKRW = customsFeeUSD * currentRates.customs;
        
        // 5. 최종 예상 수입가 = 상품원가(KRW) + 부자재(KRW) + 수수료(KRW) + 통관비(KRW)
        const finalImportCost = productCostKRW + subsidiaryCostKRW + commissionKRW + customsFeeKRW;

        return { 
            productCostCNY: productCost,
            subsidiaryCostCNY,
            productCostUSD,
            productCostKRW,
            subsidiaryCostKRW,
            commissionKRW, 
            customsFeeKRW, 
            finalImportCost 
        };
    }, [formData, currentRates, remitMissingKey]);
    
    const CurrencyYenIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 8h6m-5 4h4m-5 4h5M5 8h14a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2z" /></svg>);
    const formatKRW = (value) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(value || 0);
    const formatUSD = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
    const formatCNY = (value) => `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)} ¥`;
    const AnimatedNumber = ({ value, formatter }) => <>{formatter(value)}</>;

    // [결과 복사] 글자 — 입력 → 적용 환율 → 결과
    const copyText = () => {
        if (!results) return '';
        const remit = rateState.liveOk ? `실시간 ${fmtRateTime(rateState.at)}` : '고정';
        return [
            calcCopyHead('수입가 계산'),
            `상품원가: ${calcCopyNum(formData.productCost)} 위안`,
            `수수료: ${calcCopyOpt(settings.import.commissionRates, formData.commissionRate)}`,
            `통관비: ${calcCopyOpt(settings.import.customsFeeRates, formData.customsFeeRate)}`,
            `포장봉투: ${calcCopyOpt(settings.import.packagingOptions, formData.packagingBag)}`,
            `라벨: ${calcCopyOpt(settings.import.labelOptions, formData.label)}`,
            `적용 환율: 고시 ${fmtRate(currentRates.customs)} (${customsSourceText(customsInfo && customsInfo.source)}) / 원-달러 ${fmtRate(currentRates.usdKrw)} · 원-위안 ${fmtRate(currentRates.cnyKrw)} · 위안-달러 ${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 }).format(currentRates.usdCny || 0)} (${remit})`,
            '',
            `예상 수입가: ${formatKRW(results.finalImportCost)}`,
            `- 상품원가 (CNY): ${formatCNY(results.productCostCNY)}`,
            `- 부자재 (CNY): ${formatCNY(results.subsidiaryCostCNY)}`,
            `- 상품원가 (USD): ${formatUSD(results.productCostUSD)}`,
            `- 상품원가 (KRW): ${formatKRW(results.productCostKRW)}`,
            `- 부자재 (KRW): ${formatKRW(results.subsidiaryCostKRW)}`,
            `- 수수료 (KRW): ${formatKRW(results.commissionKRW)}`,
            `- 통관비 (KRW): ${formatKRW(results.customsFeeKRW)}`,
        ].join('\n');
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 mt-8">
            <div ref={formRef} className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200">
                <OptionFixNotice text={optionNotice} />
                <div className="flex items-center justify-between gap-2 mb-6 border-b border-slate-200 pb-4">
                    <h2 className="text-2xl font-bold text-gray-800">정보 입력</h2>
                    <CalcResetButton onReset={resetInputs} note="환율 칸은 그대로 둡니다(통관비 탭과 같은 값)." />
                </div>
                <div className="space-y-6">
                    <InputControl label="상품원가" name="productCost" value={formData.productCost} onChange={handleInputChange} unit="위안화" icon={<CurrencyYenIcon />} onKeyDown={handleKeyDown} />
                    
                    <ImportToggleFieldset label="수수료" name="commissionRate" value={formData.commissionRate} options={settings.import.commissionRates} onChange={handleInputChange} />
                    <ImportToggleFieldset label="통관비" name="customsFeeRate" value={formData.customsFeeRate} options={settings.import.customsFeeRates} onChange={handleInputChange} />
                    <ImportToggleFieldset label="포장봉투" name="packagingBag" value={formData.packagingBag} options={settings.import.packagingOptions} onChange={handleInputChange} />
                    <ImportToggleFieldset label="라벨" name="label" value={formData.label} options={settings.import.labelOptions} onChange={handleInputChange} />
                    
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                        <label className="block text-sm font-bold text-gray-800 mb-3">환율 적용 방식</label>
                        <fieldset className="flex rounded-lg shadow-sm p-1 bg-slate-200/60 mb-4">
                            <legend className="sr-only">환율 적용 방식</legend>
                            <label className={`relative flex-1 cursor-pointer py-2 px-2 sm:px-4 text-center text-xs sm:text-sm font-semibold whitespace-nowrap focus-within:ring-2 focus-within:ring-emerald-500 ${exchangeRates.mode === 'fixed' ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`}>
                                <input type="radio" name="import-exchangeRateMode" value="fixed" checked={exchangeRates.mode === 'fixed'} onChange={() => onRateChange('mode', 'fixed')} className="sr-only" />
                                <span>고정환율<span className="hidden sm:inline"> (직접입력)</span></span>
                            </label>
                            <label className={`relative flex-1 cursor-pointer py-2 px-2 sm:px-4 text-center text-xs sm:text-sm font-semibold whitespace-nowrap focus-within:ring-2 focus-within:ring-emerald-500 ${exchangeRates.mode === 'live' ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`}>
                                <input type="radio" name="import-exchangeRateMode" value="live" checked={exchangeRates.mode === 'live'} onChange={() => onRateChange('mode', 'live')} className="sr-only" />
                                <span>실시간환율<span className="hidden sm:inline"> (자동)</span></span>
                            </label>
                        </fieldset>

                        <div className="space-y-4">
                            <div>
                                <InputControl label="관세청 고시환율 (통관비용)" id="imp-rate-customs" name="customs" value={exchangeRates.customs} onChange={(e) => onRateChange('customs', e.target.value)} unit="원/달러" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} placeholder="고시환율 입력" hint={<CustomsFxrtHint info={customsInfo} onReset={onCustomsReset} />} />
                                <p className="mt-2 text-xs text-gray-500 flex items-center flex-wrap gap-1">
                                    <span>{customsInfo && customsInfo.source === 'auto' ? '※ ' : '※ 당일 고시환율을 확인 후 입력하세요. '}통관비·창고료 탭과 같은 값입니다.</span>
                                    <a href="https://unipass.customs.go.kr/csp/index.do" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-700 underline font-medium">
                                        관세청 UNI-PASS 바로가기 →
                                    </a>
                                </p>
                            </div>
                            
                            {exchangeRates.mode === 'fixed' ? (
                                <>
                                    <InputControl label="원-달러 환율" id="imp-rate-usdKrw" name="usdKrw" value={exchangeRates.usdKrw} onChange={(e) => onRateChange('usdKrw', e.target.value)} unit="원/달러" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} />
                                    <InputControl label="원-위안 환율" id="imp-rate-cnyKrw" name="cnyKrw" value={exchangeRates.cnyKrw} onChange={(e) => onRateChange('cnyKrw', e.target.value)} unit="원/위안" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} />
                                    <InputControl label="위안-달러 환율" id="imp-rate-usdCny" name="usdCny" value={exchangeRates.usdCny} onChange={(e) => onRateChange('usdCny', e.target.value)} unit="달러/위안" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} />
                                    <p className="text-xs text-gray-500">※ 환율 칸은 통관비 탭과 같은 값입니다.</p>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">현재 실시간 환율 (참고용)</label>
                                        <LiveRateDisplay rates={liveRates} status={rateStatus} />
                                    </div>
                                </>
                            ) : (
                                <div>
                                    <label className="block text-sm font-medium text-emerald-700 mb-2">실시간 환율 자동 적용</label>
                                    <LiveRateDisplay rates={liveRates} status={rateStatus} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {results ? (
                <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 w-full animate-fade-in-slide-up">
                    <div className="text-center mb-6">
                        <p className="text-base sm:text-lg text-gray-600">예상 수입가</p>
                        <p className="text-3xl sm:text-5xl font-extrabold text-emerald-600 tracking-tight my-2 break-all" data-k="finalImportCost">
                           <AnimatedNumber value={results.finalImportCost} formatter={formatKRW} />
                        </p>
                    </div>
                    <div className="mb-4">
                        <AppliedRateChip customs={currentRates.customs} usdKrw={currentRates.usdKrw} cnyKrw={currentRates.cnyKrw} state={rateState} customsSource={customsInfo && customsInfo.source} />
                    </div>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between py-2 border-b border-slate-200">
                            <span className="text-gray-600">상품원가 (CNY)</span>
                            <span className="font-semibold text-gray-800"><AnimatedNumber value={results.productCostCNY} formatter={formatCNY} /></span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-200">
                            <span className="text-gray-600">부자재 (CNY)</span>
                            <span className="font-semibold text-gray-800"><AnimatedNumber value={results.subsidiaryCostCNY} formatter={formatCNY} /></span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-200 bg-slate-50 rounded-lg px-2">
                            <span className="text-gray-600">상품원가 (USD) <span className="text-xs text-gray-400 font-normal">위안-달러 적용</span></span>
                            <span className="font-semibold text-gray-800"><AnimatedNumber value={results.productCostUSD} formatter={formatUSD} /></span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-200 px-2">
                            <span className="text-gray-600">상품원가 (KRW) <span className="text-xs text-gray-400 font-normal">원-달러 적용</span></span>
                            <span className="font-semibold text-gray-800"><AnimatedNumber value={results.productCostKRW} formatter={formatKRW} /></span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-200 px-2">
                            <span className="text-gray-600">부자재 (KRW) <span className="text-xs text-gray-400 font-normal">원-위안 적용</span></span>
                            <span className="font-semibold text-gray-800"><AnimatedNumber value={results.subsidiaryCostKRW} formatter={formatKRW} /></span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-200 px-2">
                            <span className="text-gray-600">수수료 (KRW) <span className="text-xs text-gray-400 font-normal">원-달러 적용</span></span>
                            <span className="font-semibold text-gray-800"><AnimatedNumber value={results.commissionKRW} formatter={formatKRW} /></span>
                        </div>
                        <div className="flex justify-between py-2 px-2">
                            <span className="text-gray-600">통관비 (KRW) <span className="text-xs text-gray-400 font-normal">고시환율 적용</span></span>
                            <span className="font-semibold text-gray-800"><AnimatedNumber value={results.customsFeeKRW} formatter={formatKRW} /></span>
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end">
                        <CalcCopyButton getText={copyText} />
                    </div>
                </div>
            ) : (customsRateMissing && !remitMissingKey) ? (
                <CustomsRateMissing where="'환율 적용 방식' 칸의 관세청 고시환율" />
            ) : (customsRateMissing || remitMissingKey) ? (
                <RateMissing
                    fields={rateFieldLabels((customsRateMissing ? ['customs'] : []).concat(remitMissing))}
                    where="'환율 적용 방식' 칸"
                    note={(rateState.liveLoading || rateState.liveFailed) ? `${rateState.liveFailed ? '실시간 환율을 받지 못했고' : '실시간 환율을 아직 받는 중이고'}, 대신 쓸 고정값도 비어 있습니다. '고정 환율'로 바꿔 입력하세요.` : null}
                />
            ) : (
                <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 flex flex-col items-center justify-center text-center">
                    <svg className="w-20 h-20 text-emerald-200 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <h3 className="text-xl font-semibold text-gray-700">결과를 기다리는 중...</h3>
                    <p className="text-gray-500 mt-2">좌측에 정보를 입력하면<br /> 예상 수입가가 자동으로 계산됩니다.</p>
                </div>
            )}
        </div>
    );
};