// [수정됨] 부자재는 원-위안 환율로 직접 변환 후 최종 원가에 합산하도록 분리

const ImportCalculator = ({ exchangeRates, onRateChange }) => {
    const formRef = React.useRef(null);
    const { settings } = React.useContext(SettingsContext);
    
    const [liveRates, setLiveRates] = React.useState({ krw: null, cny: null });
    const [rateStatus, setRateStatus] = React.useState('loading');

    const [formData, setFormData] = React.useState({
        productCost: '10',
        commissionRate: String(settings.import.commissionRates[0]?.value || 0.035),
        customsFeeRate: String(settings.import.customsFeeRates[0]?.value || 0.22),
        packagingBag: String(settings.import.packagingOptions[0]?.value || 0.31),
        label: String(settings.import.labelOptions[0]?.value || 0.03),
    });

    React.useEffect(() => {
        const fetchRates = async () => {
            setRateStatus('loading');
            try {
                const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
                if (!response.ok) throw new Error('Network response was not ok');
                const data = await response.json();
                if (data && data.rates && data.rates.KRW && data.rates.CNY) {
                    setLiveRates({ krw: data.rates.KRW, cny: data.rates.CNY });
                    setRateStatus('success');
                } else {
                    throw new Error('Invalid API response format');
                }
            } catch (error) {
                console.error("Failed to fetch exchange rates:", error);
                setRateStatus('error');
            }
        };
        fetchRates();
    }, []);

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
                customs: parseFloat(exchangeRates.customs) || 0,
                usdKrw: liveRates.krw,
                cnyKrw: liveRates.krw / liveRates.cny,
                usdCny: 1 / liveRates.cny
            };
        }
        return {
            customs: parseFloat(exchangeRates.customs) || 0,
            usdKrw: parseFloat(exchangeRates.usdKrw) || 0,
            cnyKrw: parseFloat(exchangeRates.cnyKrw) || 0,
            usdCny: parseFloat(exchangeRates.usdCny) || 0
        };
    }, [exchangeRates, liveRates]);

    const results = React.useMemo(() => {
        const productCost = parseFloat(formData.productCost) || 0;
        const packagingCost = parseFloat(formData.packagingBag) || 0;
        const labelCost = parseFloat(formData.label) || 0;
        const commissionRate = parseFloat(formData.commissionRate) || 0;
        const customsFeeRate = parseFloat(formData.customsFeeRate) || 0;

        if (productCost === 0 || currentRates.usdCny === 0 || currentRates.usdKrw === 0 || currentRates.customs === 0) return null;

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
    }, [formData, currentRates]);
    
    const CurrencyYenIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 8h6m-5 4h4m-5 4h5M5 8h14a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2z" /></svg>);
    const formatKRW = (value) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(value || 0);
    const formatUSD = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
    const formatCNY = (value) => `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)} ¥`;
    const AnimatedNumber = ({ value, formatter }) => <>{formatter(value)}</>;

    const ToggleFieldset = ({ label, name, value, options, onChange }) => (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
            <div className="flex flex-wrap gap-2 p-1 bg-slate-200/60 rounded-lg">
                {options.map((option, idx) => (
                    <label key={idx} className={`relative flex-1 min-w-[60px] cursor-pointer py-2.5 px-3 text-center text-sm font-semibold focus-within:ring-2 focus-within:ring-emerald-500 focus-within:ring-offset-1 ${ String(value) === String(option.value) ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`}>
                        <input type="radio" name={name} value={option.value} checked={String(value) === String(option.value)} onChange={onChange} className="sr-only" />
                        <span>{option.label}</span>
                    </label>
                ))}
            </div>
        </div>
    );

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 mt-8">
            <div ref={formRef} className="bg-gradient-to-br from-emerald-50/60 to-white/60 backdrop-blur-xl p-6 md:p-8 rounded-2xl shadow-lg border border-slate-200">
                <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b border-slate-200 pb-4">정보 입력</h2>
                <div className="space-y-6">
                    <InputControl label="상품원가" name="productCost" value={formData.productCost} onChange={handleInputChange} unit="위안화" icon={<CurrencyYenIcon />} onKeyDown={handleKeyDown} />
                    
                    <ToggleFieldset label="수수료" name="commissionRate" value={formData.commissionRate} options={settings.import.commissionRates} onChange={handleInputChange} />
                    <ToggleFieldset label="통관비" name="customsFeeRate" value={formData.customsFeeRate} options={settings.import.customsFeeRates} onChange={handleInputChange} />
                    <ToggleFieldset label="포장봉투" name="packagingBag" value={formData.packagingBag} options={settings.import.packagingOptions} onChange={handleInputChange} />
                    <ToggleFieldset label="라벨" name="label" value={formData.label} options={settings.import.labelOptions} onChange={handleInputChange} />
                    
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                        <label className="block text-sm font-bold text-gray-800 mb-3">환율 적용 방식</label>
                        <fieldset className="flex rounded-lg shadow-sm p-1 bg-slate-200/60 mb-4">
                            <label className={`relative flex-1 cursor-pointer py-2 px-4 text-center text-sm font-semibold focus-within:ring-2 focus-within:ring-emerald-500 ${exchangeRates.mode === 'fixed' ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`}>
                                <input type="radio" name="exchangeRateMode" value="fixed" checked={exchangeRates.mode === 'fixed'} onChange={() => onRateChange('mode', 'fixed')} className="sr-only" />
                                <span>고정환율 (직접입력)</span>
                            </label>
                            <label className={`relative flex-1 cursor-pointer py-2 px-4 text-center text-sm font-semibold focus-within:ring-2 focus-within:ring-emerald-500 ${exchangeRates.mode === 'live' ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`}>
                                <input type="radio" name="exchangeRateMode" value="live" checked={exchangeRates.mode === 'live'} onChange={() => onRateChange('mode', 'live')} className="sr-only" />
                                <span>실시간환율 (자동)</span>
                            </label>
                        </fieldset>

                        <div className="space-y-4">
                            <div>
                                <InputControl label="관세청 고시환율 (통관비용)" name="customs" value={exchangeRates.customs} onChange={(e) => onRateChange('customs', e.target.value)} unit="원/달러" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} />
                                <p className="mt-2 text-xs text-gray-500 flex items-center flex-wrap gap-1">
                                    <span>※ 당일 고시환율을 확인 후 입력하세요.</span>
                                    <a href="https://unipass.customs.go.kr/csp/index.do" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-700 underline font-medium">
                                        관세청 UNI-PASS 바로가기 →
                                    </a>
                                </p>
                            </div>
                            
                            {exchangeRates.mode === 'fixed' ? (
                                <>
                                    <InputControl label="원-달러 환율" name="usdKrw" value={exchangeRates.usdKrw} onChange={(e) => onRateChange('usdKrw', e.target.value)} unit="원/달러" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} />
                                    <InputControl label="원-위안 환율" name="cnyKrw" value={exchangeRates.cnyKrw} onChange={(e) => onRateChange('cnyKrw', e.target.value)} unit="원/위안" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} />
                                    <InputControl label="위안-달러 환율" name="usdCny" value={exchangeRates.usdCny} onChange={(e) => onRateChange('usdCny', e.target.value)} unit="달러/위안" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} />
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
                <div className="bg-gradient-to-br from-emerald-50/60 to-white/60 backdrop-blur-xl p-6 md:p-8 rounded-2xl shadow-lg border border-slate-200 w-full animate-fade-in-slide-up">
                    <div className="text-center mb-6">
                        <p className="text-lg text-gray-600">예상 수입가</p>
                        <p className="text-5xl font-extrabold text-emerald-600 tracking-tight my-2">
                           <AnimatedNumber value={results.finalImportCost} formatter={formatKRW} />
                        </p>
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
                </div>
            ) : (
                <div className="bg-gradient-to-br from-emerald-50/60 to-white/60 backdrop-blur-xl p-6 md:p-8 rounded-2xl shadow-lg border border-slate-200 flex flex-col items-center justify-center text-center">
                    <svg className="w-20 h-20 text-emerald-200 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <h3 className="text-xl font-semibold text-gray-700">결과를 기다리는 중...</h3>
                    <p className="text-gray-500 mt-2">좌측에 정보를 입력하면<br /> 예상 수입가가 자동으로 계산됩니다.</p>
                </div>
            )}
        </div>
    );
};