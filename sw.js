// === sw.js === 서비스워커 (PWA)
// 전략: network-first (온라인이면 항상 최신 → 잦은 배포에도 stale 없음).
//        네트워크 실패(오프라인) 시에만 마지막으로 캐시된 응답을 제공.
// 예외(2026-11-26): 주소에 ?v= 가 붙은 .js/.css 는 cache-first.
//   배포.py 가 ?v= 에 '파일 내용으로 만든 값' 을 붙인다 — 내용이 바뀌면 주소가 바뀌므로 같은 주소는 늘 같은 내용이다.
//   그래서 받아 둔 것을 서버에 묻지 않고 바로 쓴다(예전엔 화면을 열 때마다 모듈 200여 개를 하나씩 서버에 확인했다).
//   같은 파일의 옛 주소는 새 주소를 받을 때 지운다(캐시가 쌓이지 않게). 개발(localhost)은 ?v= 가 없어 그대로 network-first.
// 주의: 크로스오리진(Firebase/구글 CDN/Apps Script) 요청에는 관여하지 않음(그대로 네트워크).
const CACHE = 'work-app-v2';
const ASSETS = 'work-assets-v1';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== ASSETS).map(k => caches.delete(k))))
            // 예전엔 ?v=빌드번호 파일도 CACHE 에 넣어 배포마다 쌓였다 — 그 사본은 치운다(이제는 ASSETS 에만 둔다)
            .then(() => caches.open(CACHE)).then(c => c.keys().then(ks => Promise.all(ks.map(k => {
                let u; try { u = new URL(k.url); } catch (e) { return null; }
                return isVersionedAsset(u) ? c.delete(k) : null;
            })))).catch(() => {})
            .then(() => self.clients.claim())
    );
});

// ?v= 모양 = 묶음값 12자 '-' 자기 내용값 8자(배포.py content_versions). 이 모양일 때만 cache-first
const V_RE = /^[0-9a-f]{12}-([0-9a-f]{8})$/;
const isVersionedAsset = (url) => /\.(js|css)$/i.test(url.pathname) && V_RE.test(url.searchParams.get('v') || '');

/** 받은 본문에서 ?v=… 를 지운 글자의 sha1 앞 8자 — 배포.py self_hash 와 같은 계산(UTF-8, BOM 유지) */
async function selfHashOf(res) {
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text.replace(/\?v=[0-9A-Za-z._-]+/g, '')));
    return [...new Uint8Array(buf)].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 같은 파일(경로)의 다른 ?v= 항목을 지운다 */
async function dropOldVersions(cache, url) {
    const keys = await cache.keys();
    await Promise.all(keys.map(k => {
        let u; try { u = new URL(k.url); } catch (e) { return null; }
        return (u.pathname === url.pathname && u.search !== url.search) ? cache.delete(k) : null;
    }));
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return; // 크로스오리진은 SW 미관여

    if (isVersionedAsset(url)) {
        // 저장 전에 본문이 주소의 내용값과 맞는지 본다 — 옛 탭이 옛 주소로 새 파일을 받는 경우(Pages 는 ?v 를 무시)·
        //   배포 전파 중 새 주소로 옛 파일이 오는 경우는 저장하지 않는다(그 응답은 그대로 쓰되 다음에 다시 받는다).
        event.respondWith((async () => {
            const cache = await caches.open(ASSETS);
            const hit = await cache.match(req);
            if (hit) return hit;
            let res;
            try { res = await fetch(req); }
            catch (e) {   // 오프라인 — 예전 캐시에 같은 주소가 있으면 그것
                const any = await caches.match(req);
                if (any) return any;
                throw e;
            }
            if (res && res.ok && res.type === 'basic') {
                const want = V_RE.exec(url.searchParams.get('v'))[1];
                const copy = res.clone();
                event.waitUntil(selfHashOf(res.clone())
                    .then(got => got === want ? cache.put(req, copy).then(() => dropOldVersions(cache, url)) : null)
                    .catch(() => {}));
            }
            return res;
        })());
        return;
    }

    // cache:'no-cache' → 서버와 항상 재검증(변경 시 200, 미변경 시 304). 온라인이면 stale 없음.
    event.respondWith(
        fetch(req, { cache: 'no-cache' })
            .then(res => {
                if (res && res.ok && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
                }
                return res;
            })
            .catch(() => caches.match(req).then(m => m || Promise.reject(new Error('offline & uncached'))))
    );
});
