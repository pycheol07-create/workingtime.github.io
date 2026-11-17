// 통관비·창고료 탭 [패킹 불러오기] (2026-11-17) — 제목줄 [입력 초기화] 왼쪽 버튼 + 제목줄 아래 목록·결과 띠.
//   자료: calc-packings.js(window.__calcPackings, 'calc-packings' 이벤트) — 직원이 읽기에 성공했을 때만 버튼을 그린다
//     (guest·로그아웃·연동 전·실패면 버튼 자체가 없다).
//   목록 글자·순서·칸 옮기기: ../js/lib/calc-pack-map.js(window.CalcPackMap, index.html 의 모듈이 붙인다).
//   쓰는 쪽(CustomsCalculator.js·WarehouseFeeCalculator.js)이 펼침 상태·되돌리기 기록을 갖고,
//     고르면 onPick(pack) → 칸을 채우고 banner { name, changed[], missing[] } 를 넘긴다.
// 이름: text/babel 의 맨 위 const 는 페이지 전역이라 다른 파일과 겹치지 않게 CalcPack 접두.

// window.__calcPackings 구독
const useCalcPackings = () => {
    const get = () => window.__calcPackings || { status: 'loading', packs: null, updatedAt: null, docOk: null, error: null };
    const [st, setSt] = React.useState(get);
    React.useEffect(() => {
        const on = () => setSt(get());
        window.addEventListener('calc-packings', on);
        on();
        return () => window.removeEventListener('calc-packings', on);
    }, []);
    return st;
};

// [패킹 불러오기] — 펼칠 때 목록을 조용히 다시 읽는다(시트를 방금 고쳤을 수 있다)
const CalcPackButton = ({ st, open, onToggle }) => {
    if (!st || st.status !== 'ok') return null;
    const onClick = () => {
        if (!open && typeof window.__reloadCalcPackings === 'function') window.__reloadCalcPackings({ quiet: true });
        onToggle();
    };
    return (
        <button type="button" onClick={onClick} aria-expanded={open} data-k="calc-pack-open"
            className={`${CALC_TOOL_BTN} ${open ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-300 text-gray-700 hover:bg-gray-100'}`}
            title="패킹.송금관리 시트의 미입고 패킹을 골라 칸을 채웁니다">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
            <span>패킹 불러오기</span>
        </button>
    );
};

// 고른 뒤 띠 — '패킹 X 불러옴 · 바뀐 칸: … · 못 채운 칸: …' + [되돌리기][닫기]
const CalcPackBanner = ({ banner, onUndo, onClose }) => {
    if (!banner) return null;
    return (
        <div role="status" data-k="calc-pack-banner" className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <p className="leading-relaxed">
                <span className="font-bold">패킹 {banner.name} 불러옴</span>
                {banner.changed && banner.changed.length > 0 && <span> · 바뀐 칸: {banner.changed.join(', ')}</span>}
                {banner.missing && banner.missing.length > 0 && <span className="text-emerald-800/80"> · 못 채운 칸: {banner.missing.join(', ')}</span>}
            </p>
            <div className="mt-2 flex justify-end gap-2">
                {onUndo && <button type="button" onClick={onUndo} data-k="calc-pack-undo" className="px-3 py-1 rounded-md border border-emerald-300 bg-white font-semibold text-emerald-700 hover:bg-emerald-100">되돌리기</button>}
                <button type="button" onClick={onClose} data-k="calc-pack-close" className="px-3 py-1 rounded-md border border-slate-300 bg-white font-semibold text-gray-600 hover:bg-gray-100">닫기</button>
            </div>
        </div>
    );
};

// 펼친 목록 — 입항일 순(미정은 뒤). 1줄 '라벨 · 박스 N · N ea · $N' / 2줄 '입항 M/D · 통관예정 M/D · CBM N'
const CalcPackList = ({ st, onPick }) => {
    const M = window.CalcPackMap;
    const packs = React.useMemo(() => M.sortForPicker(st.packs || []), [st.packs]);
    const time = M.sheetTimeView(st.updatedAt, Date.now());
    return (
        <div data-k="calc-pack-list" className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {packs.length === 0 ? (
                <p className="py-3 text-center text-sm text-gray-500" data-k="calc-pack-empty">미입고 패킹 없음</p>
            ) : (
                <ul className="max-h-72 overflow-y-auto space-y-1.5">
                    {packs.map((p, i) => {
                        const l = M.packLines(p);
                        return (
                            <li key={`${p.label}-${p.entryDate}-${i}`}>
                                <button type="button" onClick={() => onPick(p)} data-k="calc-pack-item"
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                                    <span className="block text-sm font-semibold text-gray-800">{l.line1}</span>
                                    <span className="block text-xs text-gray-500 mt-0.5">{l.line2}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <p className="mt-2 text-xs text-gray-400" data-k="calc-pack-time">시트 기준 {time.text}</p>
            {(time.stale || st.docOk === false) && (
                <p role="alert" data-k="calc-pack-stale" className="mt-2 rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-xs font-semibold text-yellow-800">
                    ⚠ {st.docOk === false ? '마지막 시트 반영이 실패했습니다' : '시트 기준 시각이 3시간 넘게 지났습니다'} — 목록이 최신이 아닐 수 있습니다. 시트 값을 확인하세요.
                </p>
            )}
        </div>
    );
};

// 제목줄 아래 — 펼쳤으면 목록, 고른 뒤면 띠
const CalcPackPanel = ({ st, open, onPick, banner, onUndo, onCloseBanner }) => (
    <>
        <CalcPackBanner banner={banner} onUndo={onUndo} onClose={onCloseBanner} />
        {open && st && st.status === 'ok' && <CalcPackList st={st} onPick={onPick} />}
    </>
);
