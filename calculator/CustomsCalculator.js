// [수정됨] 4가지 환율 적용, 세금은 관세청 고시환율, 물품대금은 일반(송금) 환율 적용
// 2026-10-16 UX: 입력 순서(기준 → 수량·단가·입수·무게 → 관세 → 컨테이너 → 수수료 → 환율(접힘)),
//   결과 대표 숫자 = 개당 최종 원가, 고시환율 빈칸이면 결과 대신 안내, 휴대폰 하단 요약 바. 계산식은 그대로.

const CustomsCalculator = ({ exchangeRates, onRateChange, isActive, customsInfo, onCustomsReset }) => {
      const formRef = React.useRef(null);
      const resultRef = React.useRef(null);
      const { settings, defaultsStatus, defaultsMeta } = React.useContext(SettingsContext);

      // logis 3개월 평균이 들어가는 칸 → settings.customs 키. 사용자가 손댄 칸은 늦게 온 평균값이 덮지 않는다.
      const AVG_FIELDS = { unitPrice: 'defaultUnitPrice', quantityPerBox: 'defaultQuantityPerBox', weightPerBox: 'defaultWeightPerBox' };
      const AVG_FALLBACK = { unitPrice: 10, quantityPerBox: 50, weightPerBox: 12 };
      const avgOf = (f) => String(settings.customs[AVG_FIELDS[f]] ?? AVG_FALLBACK[f]);
      const touchedRef = React.useRef({});

      const [calculationMode, setCalculationMode] = React.useState('product');
      const { liveRates, rateStatus } = useLiveRates();
      const [isTaxesExpanded, setIsTaxesExpanded] = React.useState(false);
      const [isFeesExpanded, setIsFeesExpanded] = React.useState(false);
      const [rateOpen, setRateOpen] = React.useState(false);          // 환율 칸(맨 아래) — 기본 접힘
      const [commNotice, setCommNotice] = React.useState(null);
      const [resultInView, setResultInView] = React.useState(false);

      const [isAnalysisOpen, setIsAnalysisOpen] = React.useState(false);

      const [formData, setFormData] = React.useState(() => ({
        productQuantity: '1000',
        unitPrice: String(settings.customs.defaultUnitPrice ?? 10),
        quantityPerBox: String(settings.customs.defaultQuantityPerBox ?? 50),
        boxQuantity: '',
        totalProductPrice: '',
        weightPerBox: String(settings.customs.defaultWeightPerBox ?? 12),
        tariffRate: '8',
        shippingType: 'LCL',
        containerCost: '',
        commissionType: 'percentage',
        commissionValue: '0',
      }));

      // 기본값(logis 평균)이 바뀌면 입력 필드에 반영합니다 — 사용자가 손댄 칸은 그대로 둡니다([평균으로]로 되돌린다).
      React.useEffect(() => {
        setFormData(prev => {
          const next = { ...prev };
          Object.keys(AVG_FIELDS).forEach(f => { if (!touchedRef.current[f]) next[f] = avgOf(f); });
          return next;
        });
      }, [settings.customs.defaultUnitPrice, settings.customs.defaultQuantityPerBox, settings.customs.defaultWeightPerBox]);

      const resetToAvg = (f) => {
        touchedRef.current[f] = false;
        setFormData(prev => ({ ...prev, [f]: avgOf(f) }));
      };

      // 칸 아래 회색 안내 — 'logis 3개월 평균 값 · 기간' + [평균으로]
      const avgHint = (f) => {
        const m = defaultsMeta || {};
        const avg = avgOf(f);
        const src = defaultsStatus === 'ok'
          ? `logis 3개월 평균 ${avg}${m.window ? ` · ${m.window.from} ~ ${m.window.to}` : ''}`
          : defaultsStatus === 'loading' ? 'logis 3개월 평균 불러오는 중...' : `기본값 ${avg} (마지막 저장값 — 로그인하면 logis 3개월 평균)`;
        const isAvg = parseNum(formData[f]) === parseNum(avg);
        return (
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-400" data-k={`avg-hint-${f}`}>
            <span className="min-w-0">{src}</span>
            {!isAvg && <button type="button" onClick={() => resetToAvg(f)} className="flex-shrink-0 px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">평균으로</button>}
          </div>
        );
      };

      // 박스기준으로 바꾸며 치워 둔 개당 수수료 { commissionType, commissionValue } — 상품기준으로 돌아오면 되살린다
      const savedCommRef = React.useRef(null);
      // 상태 키 = data-key(있으면) 또는 name — radio 는 탭끼리 같은 그룹이 되지 않게 DOM name 을 'customs-…' 로 따로 쓴다
      const handleInputChange = React.useCallback((e) => {
          const { value } = e.target;
          const name = e.target.dataset.key || e.target.name;
          if (name in AVG_FIELDS) touchedRef.current[name] = true;
          if (name === 'commissionValue') savedCommRef.current = null;   // 그사이 값을 직접 고쳤으면 되살리지 않는다(종류만 다시 고른 것은 제외 — 박스기준에선 개당 값 칸이 잠겨 있다)
          setFormData(prev => ({ ...prev, [name]: value }));
      }, []);
      // 박스기준에서는 개당 수수료를 쓸 수 없다(예전엔 칸만 막히고 수수료 0) — % 로 바꾸고 값은 0 으로(결과는 예전과 같다) 안내한다.
      // 바꾸기 전 값은 보관했다가 상품기준으로 돌아오면 되살린다(그사이 수수료를 직접 고쳤으면 그대로 둔다).
      const handleModeChange = (e) => {
          const mode = e.target.value;
          setCalculationMode(mode);
          if (mode === 'box' && formData.commissionType === 'perItem') {
              savedCommRef.current = { commissionType: formData.commissionType, commissionValue: formData.commissionValue };
              setFormData(prev => ({ ...prev, commissionType: 'percentage', commissionValue: '0' }));
              setCommNotice('박스기준에는 개당 수수료를 쓸 수 없어 수수료를 % (0%) 로 바꿨습니다. 상품기준으로 돌아가면 개당 수수료가 되돌아옵니다.');
          } else if (mode === 'product' && savedCommRef.current) {
              const saved = savedCommRef.current;
              savedCommRef.current = null;
              setFormData(prev => ({ ...prev, ...saved }));
              setCommNotice('상품기준으로 돌아와 개당 수수료를 되살렸습니다.');
          }
      };
      React.useEffect(() => {
          if (!commNotice) return undefined;
          const t = setTimeout(() => setCommNotice(null), 6000);
          return () => clearTimeout(t);
      }, [commNotice]);
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

      // 고시환율 빈칸(또는 0) — 예전엔 1 로 바꿔 계산했다. 지금은 계산하지 않고 '고시환율을 입력하세요'.
      const customsRateNum = parseNum(exchangeRates.customs);
      const customsRateMissing = !Number.isFinite(customsRateNum) || customsRateNum === 0;

      const currentRates = React.useMemo(() => {
          if (exchangeRates.mode === 'live' && liveRates.krw && liveRates.cny) {
              return {
                  customs: customsRateNum,
                  usdKrw: liveRates.krw,
                  cnyKrw: liveRates.krw / liveRates.cny,
                  usdCny: 1 / liveRates.cny
              };
          }
          // 빈칸은 NaN 그대로 둔다 — 예전엔 `|| 1` 로 1원 환율 계산을 했다. 비면 remitMissing 이 결과 대신 안내를 띄운다.
          return {
              customs: customsRateNum,
              usdKrw: parseNum(exchangeRates.usdKrw),
              cnyKrw: parseNum(exchangeRates.cnyKrw),
              usdCny: parseNum(exchangeRates.usdCny)
          };
      }, [exchangeRates, liveRates, customsRateNum]);
      const rateState = liveRateState(exchangeRates, liveRates, rateStatus);
      // 이 탭이 쓰는 송금 환율은 원-달러 하나(물품대금). 비었으면(빈칸·0·음수) 계산하지 않는다.
      const remitMissing = missingRateFields(currentRates, ['usdKrw']);
      const remitMissingKey = remitMissing.join(',');

      const results = React.useMemo(() => {
          if (customsRateMissing || remitMissingKey) return null;
          const DOCS_FEE = settings.common.docsFee;
          const CO_FEE = settings.common.coFee;
          const OCEAN_FREIGHT_RATE_PER_CBM = settings.common.oceanFreightPerCbm;
          const CBM_WEIGHT_DIVISOR = settings.common.cbmWeightDivisor;
          const VAT_RATE = settings.common.vatRate;
          const MIN_CBM = settings.common.minCbm || 0;

          const tariffRateValue = parseNum(formData.tariffRate) / 100;
          const { shippingType, containerCost, commissionType, commissionValue } = formData;
          const weightPerBox = parseNum(formData.weightPerBox) || 0;

          let totalBoxes;
          let totalProductPriceUSD;
          let totalWeight;
          let productQuantity = 0;
          let costPerItem = 0;
          let commissionAmountKRW = 0;

          if (calculationMode === 'product') {
              productQuantity = parseNum(formData.productQuantity) || 0;
              const unitPrice = parseNum(formData.unitPrice) || 0;
              const quantityPerBox = parseNum(formData.quantityPerBox) || 1;
              if (productQuantity === 0 || unitPrice === 0 || quantityPerBox === 0) return null;
              totalBoxes = Math.ceil(productQuantity / quantityPerBox);
              totalProductPriceUSD = productQuantity * unitPrice;
          } else {
              totalBoxes = parseNum(formData.boxQuantity) || 0;
              totalProductPriceUSD = parseNum(formData.totalProductPrice) || 0;
              if (totalBoxes === 0 || totalProductPriceUSD === 0) return null;
          }

          totalWeight = totalBoxes * weightPerBox;
          const cbm = totalWeight / CBM_WEIGHT_DIVISOR;

          let oceanFreightKRW;
          if (shippingType === 'FCL') {
              oceanFreightKRW = parseNum(containerCost) || 0;
          } else {
              const chargeableCbm = Math.max(cbm, MIN_CBM);
              oceanFreightKRW = chargeableCbm * OCEAN_FREIGHT_RATE_PER_CBM;
          }

          // 세금계산을 위해 해운비를 USD로 역산 (고시환율 사용)
          const oceanFreightUSDForTax = oceanFreightKRW / currentRates.customs;
          const taxableBaseUSD = totalProductPriceUSD + oceanFreightUSDForTax;

          // 과세표준(Taxable Base) 및 관/부가세 산출 (고시환율 사용)
          const taxableBaseKRW = taxableBaseUSD * currentRates.customs;
          const tariffAmountKRW = taxableBaseKRW * tariffRateValue;
          const vatBaseKRW = taxableBaseKRW + tariffAmountKRW;
          const vatAmountKRW = vatBaseKRW * VAT_RATE;
          const totalTaxes = tariffAmountKRW + vatAmountKRW;

          // 실제 물품대금 결제는 원-달러(송금) 환율 적용
          const totalProductPriceKRW = totalProductPriceUSD * currentRates.usdKrw;

          const commissionValueNum = parseNum(commissionValue) || 0;
          if (commissionType === 'percentage') {
              commissionAmountKRW = totalProductPriceKRW * (commissionValueNum / 100);
          } else if (commissionType === 'perItem' && calculationMode === 'product' && productQuantity > 0) {
              commissionAmountKRW = commissionValueNum * productQuantity;
          }

          const totalCost = DOCS_FEE + CO_FEE + oceanFreightKRW + totalTaxes + commissionAmountKRW;

          if (calculationMode === 'product' && productQuantity > 0) {
              costPerItem = (totalProductPriceKRW + totalCost) / productQuantity;
          }

          return {
            totalProductPriceUSD, totalProductPriceKRW, totalBoxes, totalWeight, cbm, oceanFreightKRW,
            taxableBase: taxableBaseKRW, tariffAmount: tariffAmountKRW, vatAmount: vatAmountKRW, totalTaxes,
            docsFee: DOCS_FEE, coFee: CO_FEE, commissionAmountKRW, totalCost, costPerItem,
          };
      }, [formData, calculationMode, currentRates, settings, customsRateMissing, remitMissingKey]);

      // 휴대폰 하단 요약 바 — 결과 카드가 화면에 보이면 숨긴다
      React.useEffect(() => {
          const el = resultRef.current;
          if (!el || typeof IntersectionObserver === 'undefined') return undefined;
          const io = new IntersectionObserver((entries) => setResultInView(entries.some(en => en.isIntersecting)), { threshold: 0.15 });
          io.observe(el);
          return () => io.disconnect();
      }, [!!results]);
      const scrollToResult = () => { if (resultRef.current) resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

      const formatCurrency = (v, c='KRW') => new Intl.NumberFormat('ko-KR', {style:'currency', currency:c, minimumFractionDigits: c==='USD'?2:0}).format(typeof v==='number'&&!isNaN(v)?v:0);
      const formatNumber = (v, u='', d=2) => `${new Intl.NumberFormat('ko-KR', {maximumFractionDigits:d}).format(typeof v==='number'&&!isNaN(v)?v:0)} ${u}`;
      const AnimatedNumber = ({value, formatter}) => <>{formatter(typeof value==='number'&&!isNaN(value)?value:0)}</>;
      const ResultItem = ({ label, value, icon, isSub }) => (
        <div className={`flex items-center justify-between py-3 ${isSub ? 'pl-4 sm:pl-10' : ''}`}>
          <div className="flex items-center min-w-0"><div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${isSub ? 'bg-slate-100' : 'bg-emerald-100'}`}>{icon}</div><span className={`ml-4 font-medium truncate ${isSub ? 'text-sm text-gray-600' : 'text-gray-800'}`}>{label}</span></div>
          <span className={`font-semibold text-right whitespace-nowrap ${isSub ? 'text-sm text-gray-700' : 'text-gray-900'}`}>{value}</span>
        </div>
      );
      const Icons = {
          Price: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
          Shipping: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 2h8a1 1 0 001-1z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 16h2a2 2 0 002-2V6a2 2 0 00-2-2h-1" /></svg>,
          Tax: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 14l-6-6m5.5.5h.01M4.99 9h.01" /></svg>,
          Fee: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
          Tariff: <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7.014A8.003 8.003 0 0117.657 18.657z" /></svg>,
          Vat: <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>,
          DocsFee: <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
          CoFee: <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 4h3m-3 4h3" /></svg>,
          ChevronDown: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>,
          PriceTag: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 8V3z" /></svg>,
          Receipt: <ReceiptIcon />,
      };
      
      const CalculatorIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 14h.01M12 11h.01M15 11h.01M9 11h.01M12 21a9 9 0 110-18 9 9 0 010 18z" /></svg>);
      const CurrencyDollarIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 12v-2m-3-4H9m6 0h-3m-3-4h3m0 0V6m0 0h-3" /></svg>);
      const CurrencyWonIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7l4 8 4-8M6 12h12m-12 3h12" /></svg>);
      const BoxIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>);
      const ScaleIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l-6-2m6 2l-3 1m-3-1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>);
      const PercentageIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16l-4-4m0 0l4-4m-4 4h18m-4 4l4-4m0 0l-4-4m-4 8a2 2 0 11-4 0 2 2 0 014 0zM5 8a2 2 0 100-4 2 2 0 000 4z" /></svg>);

      const productModeFields = [
        { label: "상품 수량", name: "productQuantity", unit: "개", icon: <CalculatorIcon /> },
        { label: "상품 단가", name: "unitPrice", unit: "USD/개", icon: <CurrencyDollarIcon /> },
        { label: "박스당 수량", name: "quantityPerBox", unit: "개/박스", icon: <BoxIcon /> },
      ];
      const boxModeFields = [
        { label: "총 박스 수량", name: "boxQuantity", unit: "박스", icon: <BoxIcon /> },
        { label: "총 상품 금액", name: "totalProductPrice", unit: "USD", icon: <CurrencyDollarIcon /> },
      ];

      const calculationModeOptions = [{ label: '상품기준', value: 'product' }, { label: '박스기준', value: 'box' }];
      const shippingOptions = settings.customs.shippingTypes;
      const tariffOptions = settings.customs.tariffRates;
      const commissionTypeOptions = settings.customs.commissionTypes;
      // 공용 설정의 옵션 목록이 바뀌어 지금 값(처음 '8'·'LCL'·'percentage')이 없으면 첫 옵션으로
      const optionNotice = useOptionFix([
        { name: 'tariffRate', label: '관세', options: tariffOptions },
        { name: 'shippingType', label: '운송 형태', options: shippingOptions },
        { name: 'commissionType', label: '수수료', options: commissionTypeOptions },
      ], formData, setFormData);

      const rateBlockOpen = rateOpen || customsRateMissing || !!remitMissingKey;     // 고시환율·원-달러가 비면 펼쳐 둔다
      const segLabel = (on) => `relative flex-1 cursor-pointer py-2 px-2 sm:px-4 text-center text-xs sm:text-sm font-semibold whitespace-nowrap focus-within:ring-2 focus-within:ring-emerald-500 ${on ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`;
      const totalWithGoods = results ? results.totalProductPriceKRW + results.totalCost : 0;   // 총 비용(상품가 포함) — 표시용 합

      return (
          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 mt-8 ${results ? 'pb-20 sm:pb-0' : ''}`}>
            <div ref={formRef} className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200">
              <OptionFixNotice text={optionNotice} />
              <div className="grid grid-cols-2 gap-x-4 mb-8">
                  <div>
                      <h3 className="text-base font-semibold text-gray-800 mb-3 text-center">계산 기준</h3>
                      <fieldset className="flex rounded-lg shadow-sm p-1 bg-slate-200/60">
                          <legend className="sr-only">계산 기준</legend>
                          {calculationModeOptions.map(option => (
                          <label key={option.value} className={`relative flex-1 cursor-pointer py-2.5 px-2 sm:px-4 text-center text-sm font-semibold whitespace-nowrap focus-within:ring-2 focus-within:ring-emerald-500 focus-within:ring-offset-1 ${calculationMode === option.value ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`}>
                              <input type="radio" name="customs-calculationMode" value={option.value} checked={calculationMode === option.value} onChange={handleModeChange} className="sr-only" />
                              <span>{option.label}</span>
                          </label>
                          ))}
                      </fieldset>
                  </div>
                  <div>
                      <h3 className="text-base font-semibold text-gray-800 mb-3 text-center">운송 형태</h3>
                      <fieldset className="flex rounded-lg shadow-sm p-1 bg-slate-200/60">
                          <legend className="sr-only">운송 형태</legend>
                          {shippingOptions.map((option, idx) => (
                          <label key={idx} className={`relative flex-1 cursor-pointer py-2.5 px-2 sm:px-4 text-center text-sm font-semibold whitespace-nowrap focus-within:ring-2 focus-within:ring-emerald-500 focus-within:ring-offset-1 ${formData.shippingType === option.value ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80' } transition-all duration-300 ease-in-out`}>
                              <input type="radio" name="shippingType" value={option.value} checked={formData.shippingType === option.value} onChange={handleInputChange} className="sr-only" />
                              <span>{option.label}</span>
                          </label>
                          ))}
                      </fieldset>
                  </div>
              </div>

              <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b border-slate-200 pb-4">상세 정보 입력</h2>

              <div className="space-y-6">
                {(calculationMode === 'product' ? productModeFields : boxModeFields).map(field => (
                  <InputControl key={field.name} {...field} value={formData[field.name]} onChange={handleInputChange} onKeyDown={handleKeyDown} hint={AVG_FIELDS[field.name] ? avgHint(field.name) : null} />
                ))}
                <InputControl label="박스당 무게" name="weightPerBox" value={formData.weightPerBox} onChange={handleInputChange} unit="kg/박스" icon={<ScaleIcon />} onKeyDown={handleKeyDown} hint={avgHint('weightPerBox')} />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" id="cus-tariff-label">관세</label>
                  <fieldset aria-labelledby="cus-tariff-label" className="flex rounded-lg shadow-sm p-1 bg-slate-200/60 overflow-x-auto">
                    {tariffOptions.map((option, idx) => (
                      <label key={idx} className={`relative flex-1 min-w-[60px] cursor-pointer py-2.5 px-4 text-center text-sm font-semibold focus-within:ring-2 focus-within:ring-emerald-500 focus-within:ring-offset-1 ${String(formData.tariffRate) === String(option.value) ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`}>
                        <input type="radio" name="customs-tariffRate" data-key="tariffRate" value={option.value} checked={String(formData.tariffRate) === String(option.value)} onChange={handleInputChange} className="sr-only" />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </fieldset>
                </div>

                {/* FCL 이면 관세 바로 아래 — 숨긴 칸으로 두지 않고 그릴 때만 넣는다(Enter 이동이 숨은 칸에 들어가지 않게) */}
                {formData.shippingType === 'FCL' && (
                  <InputControl label="컨테이너 비용" name="containerCost" value={formData.containerCost} onChange={handleInputChange} unit="원" icon={<CurrencyWonIcon />} onKeyDown={handleKeyDown} />
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" id="cus-commission-label">수수료</label>
                  <OptionFixNotice text={commNotice} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <fieldset aria-labelledby="cus-commission-label" className="flex rounded-lg shadow-sm p-1 bg-slate-200/60 h-full">
                          {commissionTypeOptions.map((option, idx) => (
                              <label key={idx} className={`relative flex-1 cursor-pointer py-2.5 px-3 text-center text-xs sm:text-sm font-semibold whitespace-nowrap focus-within:ring-2 focus-within:ring-emerald-500 focus-within:ring-offset-1 ${
                                  formData.commissionType === option.value ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'
                              } transition-all duration-300 ease-in-out`}>
                                  <input type="radio" name="commissionType" value={option.value} checked={formData.commissionType === option.value} onChange={handleInputChange} className="sr-only"
                                    disabled={calculationMode === 'box' && option.value === 'perItem'} />
                                  <span className={calculationMode === 'box' && option.value === 'perItem' ? 'opacity-50 cursor-not-allowed' : ''}>{option.label}</span>
                              </label>
                          ))}
                      </fieldset>
                      <InputControl label="" ariaLabel={formData.commissionType === 'percentage' ? '수수료 (%)' : '수수료 (원/개)'} name="commissionValue" value={formData.commissionValue} onChange={handleInputChange} unit={formData.commissionType === 'percentage' ? '%' : '원/개'} icon={formData.commissionType === 'percentage' ? <PercentageIcon /> : <CurrencyWonIcon />} onKeyDown={handleKeyDown} placeholder="0" disabled={calculationMode === 'box' && formData.commissionType === 'perItem'} />
                  </div>
                </div>

                {/* 환율 — 맨 아래, 기본 접힘(접힘 때 적용 환율 한 줄). 고시환율이 비면 펼친다 */}
                <div className="bg-slate-50 rounded-xl border border-slate-200">
                    <button type="button" onClick={() => setRateOpen(o => !o)} aria-expanded={rateBlockOpen} aria-controls="cus-rate-body" className="w-full flex items-center justify-between gap-2 p-4 text-left">
                        <span className="min-w-0">
                            <span className="block text-sm font-bold text-gray-800">환율 적용 방식</span>
                            {!rateBlockOpen && <span className="block text-xs text-gray-500 mt-0.5" data-k="rate-summary">{rateSummaryText(currentRates.customs, currentRates.usdKrw, rateState, customsInfo && customsInfo.source)}</span>}
                        </span>
                        <span className={`flex-shrink-0 transform transition-transform duration-200 ${rateBlockOpen ? 'rotate-180' : ''}`}>{Icons.ChevronDown}</span>
                    </button>
                    {rateBlockOpen && (
                    <div id="cus-rate-body" className="px-4 pb-4">
                    <fieldset className="flex rounded-lg shadow-sm p-1 bg-slate-200/60 mb-4">
                        <legend className="sr-only">환율 적용 방식</legend>
                        <label className={segLabel(exchangeRates.mode === 'fixed')}>
                            <input type="radio" name="customs-exchangeRateMode" value="fixed" checked={exchangeRates.mode === 'fixed'} onChange={() => onRateChange('mode', 'fixed')} className="sr-only" />
                            <span>고정환율<span className="hidden sm:inline"> (직접입력)</span></span>
                        </label>
                        <label className={segLabel(exchangeRates.mode === 'live')}>
                            <input type="radio" name="customs-exchangeRateMode" value="live" checked={exchangeRates.mode === 'live'} onChange={() => onRateChange('mode', 'live')} className="sr-only" />
                            <span>실시간환율<span className="hidden sm:inline"> (자동)</span></span>
                        </label>
                    </fieldset>

                    <div className="space-y-4">
                        <div>
                            <InputControl label="관세청 고시환율 (세금용)" id="cus-rate-customs" name="customs" value={exchangeRates.customs} onChange={(e) => onRateChange('customs', e.target.value)} unit="원/달러" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} placeholder="고시환율 입력" hint={<CustomsFxrtHint info={customsInfo} onReset={onCustomsReset} />} />
                            <p className="mt-2 text-xs text-gray-500 flex items-center flex-wrap gap-1">
                                <span>{customsInfo && customsInfo.source === 'auto' ? '※ ' : '※ 당일 고시환율을 확인 후 입력하세요. '}수입가·창고료 탭과 같은 값입니다.</span>
                                <a href="https://unipass.customs.go.kr/csp/index.do" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-700 underline font-medium">
                                    관세청 UNI-PASS 바로가기 →
                                </a>
                            </p>
                        </div>

                        {exchangeRates.mode === 'fixed' ? (
                            <>
                                <InputControl label="원-달러 환율" id="cus-rate-usdKrw" name="usdKrw" value={exchangeRates.usdKrw} onChange={(e) => onRateChange('usdKrw', e.target.value)} unit="원/달러" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} />
                                <InputControl label="원-위안 환율" id="cus-rate-cnyKrw" name="cnyKrw" value={exchangeRates.cnyKrw} onChange={(e) => onRateChange('cnyKrw', e.target.value)} unit="원/위안" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} />
                                <InputControl label="위안-달러 환율" id="cus-rate-usdCny" name="usdCny" value={exchangeRates.usdCny} onChange={(e) => onRateChange('usdCny', e.target.value)} unit="달러/위안" icon={<TrendingUpIcon />} onKeyDown={handleKeyDown} />
                                <p className="text-xs text-gray-500">※ 원-달러·원-위안·위안-달러 칸도 수입가 탭과 같은 값입니다.</p>
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
                    )}
                </div>
              </div>
            </div>

            {/* EfficiencyAnalysis에도 여러 환율 객체를 전달 */}
            <EfficiencyAnalysis
                show={isAnalysisOpen}
                onClose={() => setIsAnalysisOpen(false)}
                formData={formData}
                currentRates={currentRates}
                calculationMode={calculationMode}
            />

            {results ? (
              <div ref={resultRef} className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 w-full animate-fade-in-slide-up scroll-mt-28" data-k="customs-result">
                  <div className="text-center mb-4">
                      {results.costPerItem > 0 ? (
                        <>
                          <p className="text-base sm:text-lg text-gray-600">개당 최종 원가</p>
                          <p className="text-3xl sm:text-5xl font-extrabold text-emerald-600 tracking-tight my-2 break-all" data-k="costPerItem"><AnimatedNumber value={results.costPerItem} formatter={formatCurrency} /></p>
                        </>
                      ) : (
                        <>
                          <p className="text-base sm:text-lg text-gray-600">총 비용 (상품가 포함)</p>
                          <p className="text-3xl sm:text-5xl font-extrabold text-emerald-600 tracking-tight my-2 break-all"><AnimatedNumber value={totalWithGoods} formatter={formatCurrency} /></p>
                        </>
                      )}
                  </div>
                  <div className="mb-4">
                      <AppliedRateChip customs={currentRates.customs} usdKrw={currentRates.usdKrw} state={rateState} customsSource={customsInfo && customsInfo.source} />
                  </div>
                  <div className="space-y-1 divide-y divide-slate-200">
                    {results.costPerItem > 0 && (
                      <div className="flex items-center justify-between gap-2 py-3" data-k="totalWithGoods">
                          <span className="font-semibold text-gray-800">총 비용 <span className="text-xs font-normal text-gray-500">(상품가 포함)</span></span>
                          <span className="font-bold text-gray-900 text-right whitespace-nowrap"><AnimatedNumber value={totalWithGoods} formatter={formatCurrency} /></span>
                      </div>
                    )}
                    <ResultItem label="총 상품가" value={<AnimatedNumber value={results.totalProductPriceKRW} formatter={formatCurrency} />} icon={Icons.Price} />
                    <div className="flex items-center justify-between gap-2 py-3" data-k="totalCost">
                        <span className="font-semibold text-gray-800">통관 부대비용 <span className="text-xs font-normal text-gray-500">(상품가 제외)</span></span>
                        <span className="font-bold text-gray-900 text-right whitespace-nowrap"><AnimatedNumber value={results.totalCost} formatter={formatCurrency} /></span>
                    </div>
                    <ResultItem label="해운비" value={<AnimatedNumber value={results.oceanFreightKRW} formatter={formatCurrency} />} icon={Icons.Shipping} isSub={true} />
                    {results.commissionAmountKRW > 0 && (<ResultItem label="수수료" value={<AnimatedNumber value={results.commissionAmountKRW} formatter={formatCurrency} />} icon={Icons.Receipt} isSub={true} />)}
                    <div>
                        <button type="button" onClick={() => setIsTaxesExpanded(!isTaxesExpanded)} aria-expanded={isTaxesExpanded} aria-controls="cus-taxes-detail" className="w-full flex items-center justify-between py-3 pl-4 sm:pl-10 text-left"><span className="flex items-center min-w-0"><span className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center bg-slate-100">{Icons.Tax}</span><span className="ml-4 text-sm font-medium text-gray-600">세금 (관세·부가세)</span></span><span className="flex items-center"><span className="text-sm font-semibold text-gray-700 whitespace-nowrap"><AnimatedNumber value={results.totalTaxes} formatter={formatCurrency} /></span><span className={`ml-2 transform transition-transform duration-200 ${isTaxesExpanded ? 'rotate-180' : ''}`}>{Icons.ChevronDown}</span></span></button>
                        <div id="cus-taxes-detail" className={`transition-all duration-300 ease-in-out overflow-hidden ${isTaxesExpanded ? 'max-h-40' : 'max-h-0'}`}><ResultItem label="관세" value={<AnimatedNumber value={results.tariffAmount} formatter={formatCurrency} />} icon={Icons.Tariff} isSub={true} /><ResultItem label="부가가치세" value={<AnimatedNumber value={results.vatAmount} formatter={formatCurrency} />} icon={Icons.Vat} isSub={true} /></div>
                    </div>
                    <div>
                        <button type="button" onClick={() => setIsFeesExpanded(!isFeesExpanded)} aria-expanded={isFeesExpanded} aria-controls="cus-fees-detail" className="w-full flex items-center justify-between py-3 pl-4 sm:pl-10 text-left"><span className="flex items-center min-w-0"><span className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center bg-slate-100">{Icons.Fee}</span><span className="ml-4 text-sm font-medium text-gray-600">서류·CO 비용</span></span><span className="flex items-center"><span className="text-sm font-semibold text-gray-700 whitespace-nowrap"><AnimatedNumber value={results.docsFee + results.coFee} formatter={formatCurrency} /></span><span className={`ml-2 transform transition-transform duration-200 ${isFeesExpanded ? 'rotate-180' : ''}`}>{Icons.ChevronDown}</span></span></button>
                        <div id="cus-fees-detail" className={`transition-all duration-300 ease-in-out overflow-hidden ${isFeesExpanded ? 'max-h-40' : 'max-h-0'}`}><ResultItem label="서류비" value={<AnimatedNumber value={results.docsFee} formatter={formatCurrency} />} icon={Icons.DocsFee} isSub={true} /><ResultItem label="CO발급비" value={<AnimatedNumber value={results.coFee} formatter={formatCurrency} />} icon={Icons.CoFee} isSub={true} /></div>
                    </div>
                  </div>

                  <div className="mt-6 pt-6 border-t border-dashed">
                    <button onClick={() => setIsAnalysisOpen(true)} className="w-full py-3 bg-emerald-50 text-emerald-700 font-bold rounded-xl hover:bg-emerald-100 transition-colors flex items-center justify-center gap-2">
                        <span>운송 효율 분석 (최적 수량 찾기)</span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" /></svg>
                    </button>
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
                  <p className="text-gray-500 mt-2">정보를 입력하면<br /> 예상 통관 비용이 자동으로 계산됩니다.</p>
              </div>
            )}

            {/* 휴대폰 하단 요약 바 — 이 탭이 보일 때, 결과 카드가 화면 밖일 때. 누르면 결과로 */}
            {isActive && results && !resultInView && ReactDOM.createPortal(
              <button type="button" onClick={scrollToResult} data-k="mobile-summary" aria-label="결과 보기" className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-3 text-left">
                  <span className="min-w-0">
                      <span className="block text-xs text-gray-500">{results.costPerItem > 0 ? '개당 최종 원가' : '총 비용 (상품가 포함)'}</span>
                      <span className="block text-lg font-bold text-emerald-600 truncate">{formatCurrency(results.costPerItem > 0 ? results.costPerItem : totalWithGoods)}</span>
                  </span>
                  <span className="text-right flex-shrink-0">
                      <span className="block text-xs text-gray-500">{results.costPerItem > 0 ? '총 비용' : '부대비용'}</span>
                      <span className="block text-sm font-semibold text-gray-800">{formatCurrency(results.costPerItem > 0 ? totalWithGoods : results.totalCost)}</span>
                  </span>
              </button>,
              document.body
            )}
          </div>
      );
};
