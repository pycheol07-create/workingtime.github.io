// 'import'와 'export' 키워드를 모두 삭제합니다.
// [수정됨] 모든 React 훅(useState, useRef 등) 앞에 'React.'를 추가합니다.

// --- From components/ShippingCalculator.tsx ---
const ShippingCalculator = () => {
    const formRef = React.useRef(null);
    // [수정] SettingsContext 사용
    const { settings } = React.useContext(SettingsContext);
    
    const [formData, setFormData] = React.useState({
        boxLength: '500',
        boxWidth: '400',
        boxHeight: '300',
        palletType: 'none',
    });

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
    
    const calculateMaxBoxes = (container, box) => {
        if (box.length <= 0 || box.width <= 0 || box.height <= 0) return 0;
        const { length: cL, width: cW, height: cH } = container;
        const { length: bL, width: bW, height: bH } = box;
        const orientations = [[bL, bW, bH], [bL, bH, bW], [bW, bL, bH], [bW, bH, bL], [bH, bL, bW], [bH, bW, bL]];
        let maxBoxes = 0;
        for (const [l, w, h] of orientations) {
            if (l > cL || w > cW || h > cH) continue;
            const boxes = Math.floor(cL / l) * Math.floor(cW / w) * Math.floor(cH / h);
            if (boxes > maxBoxes) maxBoxes = boxes;
        }
        return maxBoxes;
    }

    const calculateOptimalPalletLoad = (pallet, box) => {
        if (box.length <= 0 || box.width <= 0 || box.height <= 0 || pallet.loadHeight <= 0) return { boxesPerPallet: 0, boxStackHeight: 0 };
        const { length: pL, width: pW, loadHeight: pLH } = pallet;
        const { length: bL, width: bW, height: bH } = box;
        const boxOrientations = [{ l: bL, w: bW, h: bH }, { l: bL, w: bH, h: bW }, { l: bW, w: bH, h: bL }];
        let maxBoxes = 0;
        let optimalStackHeight = 0;
        for (const { l, w, h } of boxOrientations) {
            if (h > pLH) continue;
            const layers = Math.floor(pLH / h);
            if (layers === 0) continue;
            const boxesPerLayer1 = Math.floor(pL / l) * Math.floor(pW / w);
            const boxesPerLayer2 = Math.floor(pL / w) * Math.floor(pW / l);
            const boxesPerLayer = Math.max(boxesPerLayer1, boxesPerLayer2);
            const totalBoxes = layers * boxesPerLayer;
            if (totalBoxes > maxBoxes) {
                maxBoxes = totalBoxes;
                optimalStackHeight = layers * h;
            }
        }
        return { boxesPerPallet: maxBoxes, boxStackHeight: optimalStackHeight };
    };

    const results = React.useMemo(() => {
        // [수정] settings에서 컨테이너 및 파레트 정보 가져오기
        const CONTAINER_DIMENSIONS = {
            FT20: settings.shipping.container20,
            FT40: settings.shipping.container40
        };
        const PALLET_TYPES = settings.shipping.palletTypes;

        const boxLength = parseFloat(formData.boxLength) || 0;
        const boxWidth = parseFloat(formData.boxWidth) || 0;
        const boxHeight = parseFloat(formData.boxHeight) || 0;
        const { palletType } = formData;

        if (boxLength <= 0 || boxWidth <= 0 || boxHeight <= 0) return null;
        const boxDims = { length: boxLength, width: boxWidth, height: boxHeight };
        
        const looseBoxesIn20ft = calculateMaxBoxes(CONTAINER_DIMENSIONS.FT20, boxDims);
        const looseBoxesIn40ft = calculateMaxBoxes(CONTAINER_DIMENSIONS.FT40, boxDims);
        
        if (palletType === 'none') return { boxesIn20ft: looseBoxesIn20ft, boxesIn40ft: looseBoxesIn40ft };
        
        // [수정] PALLET_TYPES가 배열이므로 find로 검색
        const selectedPallet = PALLET_TYPES.find(p => p.value === palletType);
        if (!selectedPallet) return { boxesIn20ft: looseBoxesIn20ft, boxesIn40ft: looseBoxesIn40ft };
        
        const containerHeight = CONTAINER_DIMENSIONS.FT20.height;
        const palletLoadHeight = containerHeight - selectedPallet.height;
        
        if (palletLoadHeight <= 0) return { boxesIn20ft: looseBoxesIn20ft, boxesIn40ft: looseBoxesIn40ft, boxesPerPallet: 0, palletsIn20ft: 0, palletsIn40ft: 0 };
        
        const { boxesPerPallet, boxStackHeight } = calculateOptimalPalletLoad({ length: selectedPallet.length, width: selectedPallet.width, loadHeight: palletLoadHeight }, boxDims);
        
        if (boxesPerPallet === 0) return { boxesIn20ft: looseBoxesIn20ft, boxesIn40ft: looseBoxesIn40ft, boxesPerPallet: 0, palletsIn20ft: 0, palletsIn40ft: 0 };
        
        const totalLoadedPalletHeight = selectedPallet.height + boxStackHeight;
        const loadedPalletDims = { length: selectedPallet.length, width: selectedPallet.width, height: totalLoadedPalletHeight };
        
        const calculatePalletsInContainer = (container, pallet) => {
            if (pallet.height > container.height) return 0;
            const count1 = Math.floor(container.length / pallet.length) * Math.floor(container.width / pallet.width);
            const count2 = Math.floor(container.length / pallet.width) * Math.floor(container.width / pallet.length);
            return Math.max(count1, count2);
        };
        
        const palletsIn20ft = calculatePalletsInContainer(CONTAINER_DIMENSIONS.FT20, loadedPalletDims);
        const palletsIn40ft = calculatePalletsInContainer(CONTAINER_DIMENSIONS.FT40, loadedPalletDims);
        
        return { boxesIn20ft: palletsIn20ft * boxesPerPallet, boxesIn40ft: palletsIn40ft * boxesPerPallet, boxesPerPallet, palletsIn20ft, palletsIn40ft };
    }, [formData, settings]);

    const DimensionIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 10l-6 6" /><path strokeLinecap="round" strokeLinejoin="round" d="M3 8v11h11" /></svg>);
    const PalletIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path d="M2 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1V5zM3 9h14v2H3V9zM3 13h14v2H3v-2z" /></svg>);
    const ContainerIcon = ({ size }) => (<svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><rect x="3" y="6" width="18" height="12" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="3" y1="14" x2="21" y2="14" /><text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" fontSize="6" fill="currentColor" fontWeight="bold">{size}ft</text></svg>);

    const formatNumber = (value) => new Intl.NumberFormat('ko-KR').format(Math.round(value || 0)); 
    const AnimatedNumber = ({ value, formatter }) => <>{formatter(value)}</>;

    const inputFields = [{ label: "박스 길이", name: "boxLength", unit: "mm" }, { label: "박스 너비", name: "boxWidth", unit: "mm" }, { label: "박스 높이", name: "boxHeight", unit: "mm" }];
    
    // [수정] settings에서 파레트 목록 가져오기
    const palletOptions = settings.shipping.palletTypes;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 mt-8">
            <div ref={formRef} className="bg-gradient-to-br from-emerald-50/60 to-white/60 backdrop-blur-xl p-6 md:p-8 rounded-2xl shadow-lg border border-slate-200">
                <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b border-slate-200 pb-4">정보 입력</h2>
                <div className="space-y-6">
                    {inputFields.map(field => (<InputControl key={field.name} {...field} value={formData[field.name]} onChange={handleInputChange} onKeyDown={handleKeyDown} />))}
                    <div>
                        <label htmlFor="palletType" className="block text-sm font-medium text-gray-700 mb-1">파레트 종류</label>
                        <div className="relative">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"><PalletIcon /></div>
                            <select id="palletType" name="palletType" value={formData.palletType} onChange={handleInputChange} onKeyDown={handleKeyDown} className="w-full appearance-none rounded-md border-gray-300 py-2 pl-10 pr-10 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm">
                                {/* [수정] '없음' 옵션을 기본적으로 포함하거나 settings에 포함되어 있다고 가정 */}
                                {palletOptions.map(option => (<option key={option.value} value={option.value}>{option.label}</option>))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700"><svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg></div>
                        </div>
                    </div>
                </div>
            </div>

            {results ? (
                 <div className="bg-gradient-to-br from-emerald-50/60 to-white/60 backdrop-blur-xl p-6 md:p-8 rounded-2xl shadow-lg border border-slate-200 w-full animate-fade-in-slide-up">
                    <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">컨테이너 적재 수량</h2>
                    {formData.palletType !== 'none' && results.boxesPerPallet !== undefined && (
                        <div className="text-center mb-6 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                            <p className="font-semibold text-emerald-800">파레트당 적재 가능 수량: <span className="text-xl font-bold"><AnimatedNumber value={results.boxesPerPallet} formatter={formatNumber} /></span> 박스</p>
                            <p className="text-xs text-emerald-600 mt-1">(컨테이너 높이 기준 자동 계산)</p>
                        </div>
                    )}
                    <div className="space-y-6">
                        <div className="flex items-center p-4 bg-slate-50/70 rounded-xl border border-slate-200">
                            <div className="flex-shrink-0"><ContainerIcon size="20" /></div>
                            <div className="ml-4 flex-grow">
                                <p className="text-lg font-semibold text-gray-700">20ft 컨테이너</p>
                                {formData.palletType !== 'none' && results.palletsIn20ft !== undefined && results.boxesPerPallet !== undefined ? (<p className="text-sm text-green-700 font-semibold">{results.palletsIn20ft} 파레트</p>) : (<p className="text-sm text-gray-500">Loose Loading</p>)}
                            </div>
                            <p className="text-3xl font-bold text-emerald-600"><AnimatedNumber value={results.boxesIn20ft} formatter={formatNumber} /><span className="text-base font-medium text-gray-600 ml-1.5">박스</span></p>
                        </div>
                        <div className="flex items-center p-4 bg-slate-50/70 rounded-xl border border-slate-200">
                            <div className="flex-shrink-0"><ContainerIcon size="40" /></div>
                             <div className="ml-4 flex-grow">
                                <p className="text-lg font-semibold text-gray-700">40ft 컨테이너</p>
                                {formData.palletType !== 'none' && results.palletsIn40ft !== undefined && results.boxesPerPallet !== undefined ? (<p className="text-sm text-green-700 font-semibold">{results.palletsIn40ft} 파레트</p>) : (<p className="text-sm text-gray-500">Loose Loading</p>)}
                            </div>
                            <p className="text-3xl font-bold text-emerald-600"><AnimatedNumber value={results.boxesIn40ft} formatter={formatNumber} /><span className="text-base font-medium text-gray-600 ml-1.5">박스</span></p>
                        </div>
                    </div>
                 </div>
            ) : (
                <div className="bg-gradient-to-br from-emerald-50/60 to-white/60 backdrop-blur-xl p-6 md:p-8 rounded-2xl shadow-lg border border-slate-200 flex flex-col items-center justify-center text-center">
                    <svg className="w-20 h-20 text-emerald-200 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                    <h3 className="text-xl font-semibold text-gray-700">결과를 기다리는 중...</h3>
                    <p className="text-gray-500 mt-2">좌측에 정보를 입력하면<br /> 컨테이너별 적재 수량이 계산됩니다.</p>
                </div>
            )}
        </div>
    );
};