// Service worker（設計文件 §16 翻案）——只做兩件事：離線可開、更新自己會好。
// 快取策略全站一律 stale-while-revalidate，沒有第二條規則：先吐快取（離線也開得了），
// 同時背景抓新版寫回。代價是玩家看到的永遠是「上一次載入時的版本」，換來的是壞版本會在
// 下一次載入自己修好——不必依賴「記得改快取版本號」這個人為環節。cache-first 沒有這個性質：
// 忘記改版本號會讓玩家永久卡在舊版，而且 SW 攔截了請求，他重新整理也清不掉。
const CACHE = 'lexoria-v1';

// 首次安裝就抓齊「開得了遊戲」的最小集合；關卡本體不預抓（500 檔 2MB），
// 靠 main.js 既有的預取（當前關 + 下一關）順勢寫進同一份快取，玩過的關卡就能離線重玩。
// src/*.js 新增或更名時要一併改這裡，同 index.html 的 modulepreload 清單
// （tests/game.test.mjs 會驗證三份清單一致、且每條路徑都存在——addAll 是全有全無，一條壞路徑＝完全沒有離線）。
const SHELL = [
  './',
  'manifest.webmanifest',
  'src/style.css',
  'src/main.js',
  'src/game.js',
  'src/bridge.js',
  'src/storage.js',
  'src/grid.js',
  'src/wheel.js',
  'src/dictionary-card.js',
  'src/redeem.js',
  'src/strings.js',
  'assets/icon.svg',
  'assets/icon-180.png',
  // manifest 引用的兩張圖示也要進來：離線安裝到主畫面時抓不到，啟動器只會給預設圖或裁壞的圖
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  // 授權條文必須跟著每一份副本走（設計文件 §14），離線也得打得開，不能等玩家線上點過才進快取。
  'assets/licenses.txt',
  'data/levels/index.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// 換版時把不同名的快取整批刪掉。skipWaiting + clients.claim 讓新 SW 立刻接管：
// 預設會卡在 waiting 直到所有分頁關閉，而手機分頁常年不關，等於永遠不更新。
// ponytail: 關卡跟 SHELL 共用一份快取，所以改 CACHE 名字會把玩過的關卡一起刪掉（下次上線
// 才補得回來）。SWR 的設計本來就不需要改版本號，真要改再把關卡拆到第二份不帶版本的快取。
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 每個請求都 caches.open 一次是白花的 I/O；快取只有一份、activate 也不會刪掉它，開一次就好。
const cacheReady = caches.open(CACHE);

// 首頁自己的路徑（scope 根目錄）。'./' 這個快取鍵只能給它用，見下面 navShell。
const SHELL_PATH = new URL('./', location).pathname;

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 導覽請求「而且指的就是首頁」才用 './' 當快取鍵：預快取的是 './'，而兌換／分享連結是
  // '/?code=…'。讀取端逐字比對會 miss（離線點兌換連結變白屏），寫入端逐字比對更糟——每個
  // 不同的 query 都寫一筆永遠讀不到的死資料（比對時會先命中插入較早的 './'），而真正該更新
  // 的 './' 反而永不刷新，只用帶參數網址進來的玩家就被釘在安裝當下那版。
  // 但條件一定要連 pathname 一起看：關於區的 <a href="assets/licenses.txt" target="_blank">
  // 也是導覽請求，只看 mode 的話讀到的是首頁 HTML（§14 的授權條文根本打不開），寫入更會把
  // 那份純文字蓋到 './' 上，下次啟動整個 App 變成一頁授權條文——離線的話再也修不回來。
  const navShell = e.request.mode === 'navigate' && url.pathname === SHELL_PATH;
  e.respondWith(
    cacheReady
      .then(async (cache) => {
        const key = navShell ? './' : e.request;
        const cached = await cache.match(key);
        const fresh = fetch(e.request).then(async (res) => {
          // 背景更新要活過 respondWith，否則有快取可回時 SW 可能先被休眠、新版永遠寫不進去。
          // fetch 在收到 header 就 resolve，body 還在傳——所以要 await 到 put 完成才算數，
          // 不然 waitUntil 早早放手，寫到一半就被砍。put 失敗（配額、206）也在這裡吞掉。
          if (res.ok) await cache.put(key, res.clone()).catch(() => {});
          return res;
        });
        e.waitUntil(fresh.catch(() => {}));
        return cached ?? fresh; // 沒快取就等網路（首次載入、沒玩過的關卡）
      })
      // Cache API 整組不能用（隱私模式、配額被拒）時要退回純網路：cacheReady 是模組層的
      // 單一 promise，它一旦 reject 就是每個請求都拿到 network error——連首頁都打不開，而且
      // SW 已經接管，重新整理也救不回來。沒有快取總比整站掛掉好。
      .catch(() => fetch(e.request))
  );
});
