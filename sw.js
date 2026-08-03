// Service worker（設計文件 §16 翻案）——只做兩件事：離線可開、更新自己會好。
// 快取策略全站一律 stale-while-revalidate，沒有第二條規則：先吐快取（離線也開得了），
// 同時背景抓新版寫回。代價是玩家看到的永遠是「上一次載入時的版本」，換來的是壞版本會在
// 下一次載入自己修好——不必依賴「記得改快取版本號」這個人為環節。cache-first 沒有這個性質：
// 忘記改版本號會讓玩家永久卡在舊版，而且 SW 攔截了請求，他重新整理也清不掉。
const CACHE = "lexoria-v1";

// 首次安裝就抓齊「開得了遊戲」的最小集合；關卡本體不進這裡（500 檔 2MB，而 addAll 是全有全無，
// 501 條裡壞一條就完全沒有離線），改由下面的 warmLevels 在背景補。
// src/*.js 新增或更名時要一併改這裡，同 index.html 的 modulepreload 清單
// （tests/game.test.mjs 會驗證三份清單一致、且每條路徑都存在——addAll 是全有全無，一條壞路徑＝完全沒有離線）。
const SHELL = [
	"./",
	"manifest.webmanifest",
	"src/style.css",
	"src/main.js",
	"src/game.js",
	"src/bridge.js",
	"src/storage.js",
	"src/grid.js",
	"src/wheel.js",
	"src/dictionary-card.js",
	"src/redeem.js",
	"src/strings.js",
	"assets/icon.svg",
	"assets/icon-180.png",
	// manifest 引用的兩張圖示也要進來：離線安裝到主畫面時抓不到，啟動器只會給預設圖或裁壞的圖
	"assets/icon-512.png",
	"assets/icon-maskable-512.png",
	// 授權條文必須跟著每一份副本走（設計文件 §14），離線也得打得開，不能等玩家線上點過才進快取。
	"assets/licenses.txt",
	"data/levels/index.json",
];

self.addEventListener("install", (e) => {
	e.waitUntil(
		caches
			.open(CACHE)
			.then((c) => c.addAll(SHELL))
			.then(() => self.skipWaiting()),
	);
});

// 換版時把不同名的快取整批刪掉。skipWaiting + clients.claim 讓新 SW 立刻接管：
// 預設會卡在 waiting 直到所有分頁關閉，而手機分頁常年不關，等於永遠不更新。
// 關卡跟 SHELL 共用一份快取，所以改 CACHE 名字會把補好的 500 關一起刪掉、下次上線由
// warmLevels 重補一輪 2MB。這是特性不是 bug：重新產生關卡資料之後改一次名字，就是讓所有人
// 換到新內容的手段（平常不必改——SWR 會在玩家實際開那一關時自己更新，只是慢一拍）。
self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

// 每個請求都 caches.open 一次是白花的 I/O；快取只有一份、activate 也不會刪掉它，開一次就好。
const cacheReady = caches.open(CACHE);

// 一次開 500 條連線會把手機的網路塞滿，也搶掉玩家當下真正在等的那一關；切批串著跑。
const WARM_BATCH = 20;

// 已經在快取裡的就跳過，所以重跑幾乎不花流量。整條吞掉（呼叫端 catch，連 cache.match 自己爆掉
// 也算）：補不齊只是退回「只有玩過的關卡能離線」，不能讓一個 404、一次斷線或一次配額錯誤把整串
// 批次炸掉、後面幾百關都不補。
const warmLevel = async (cache, id) => {
	const key = `data/levels/${id}.json`;
	if (!(await cache.match(key))) await cache.add(key);
};

// 把 500 個關卡檔補進快取。少了它，離線的玩家只有「當前關 + 下一關」可玩（main.js 的預取），
// 第三關就撞上載入失敗畫面——飛航模式一路玩下去這件事並不成立。
async function warmLevels() {
	const cache = await cacheReady;
	const index = await cache.match("data/levels/index.json");
	if (!index) return; // install 沒成功，別瞎猜關卡數；下一次 activate 會再來
	const { count } = await index.json();
	const ids = Array.from({ length: count }, (_, i) => i + 1);
	const batches = [];
	for (let i = 0; i < ids.length; i += WARM_BATCH)
		batches.push(ids.slice(i, i + WARM_BATCH));
	// reduce 串接而不是 for-await：批次之間必須是序列的，但 noAwaitInLoops 在這個 repo 是硬錯誤。
	await batches.reduce(
		(prev, batch) =>
			prev.then(() =>
				Promise.all(batch.map((id) => warmLevel(cache, id).catch(() => {}))),
			),
		Promise.resolve(),
	);
}

// 由頁面 postMessage 觸發，不是掛在 activate 上：waitUntil 沒 settle 之前 SW 都還算 activating，
// fetch 事件會被排隊等它——2MB 補完之前整個 App 卡住，正是離線功能不該付的代價。
// 但 waitUntil 還是要用（ExtendableMessageEvent 有），不然 SW 補到一半就被瀏覽器休眠砍掉。
// 同一顆 promise 共用：兩個分頁（或推新版時 load + controllerchange 各一發）會同時觸發，兩輪
// 幾乎同步地 cache.match miss 在同一批檔案上，整整 2MB 被重抓一次。跑完才允許下一輪。
// catch 是必要的：cacheReady 在隱私模式會 reject，讓 waitUntil 拿到 rejected promise 沒有意義。
let warming = null;
self.addEventListener("message", (e) => {
	if (e.data !== "warm-levels") return;
	warming ??= warmLevels()
		.catch(() => {})
		.finally(() => {
			warming = null;
		});
	e.waitUntil(warming);
});

// 首頁自己的路徑（scope 根目錄）。'./' 這個快取鍵只能給它用，見下面 navShell。
const SHELL_PATH = new URL("./", location).pathname;

self.addEventListener("fetch", (e) => {
	const url = new URL(e.request.url);
	if (e.request.method !== "GET" || url.origin !== location.origin) return;
	// 導覽請求「而且指的就是首頁」才用 './' 當快取鍵：預快取的是 './'，但分享出去的連結被平台
	// 加上追蹤參數後會變成 '/?fbclid=…'、'/?utm_source=…'。讀取端逐字比對會 miss（離線從那種
	// 連結點進來就是白屏），寫入端逐字比對更糟——每個
	// 不同的 query 都寫一筆永遠讀不到的死資料（比對時會先命中插入較早的 './'），而真正該更新
	// 的 './' 反而永不刷新，只用帶參數網址進來的玩家就被釘在安裝當下那版。
	// 但條件一定要連 pathname 一起看：關於區的 <a href="assets/licenses.txt" target="_blank">
	// 也是導覽請求，只看 mode 的話讀到的是首頁 HTML（§14 的授權條文根本打不開），寫入更會把
	// 那份純文字蓋到 './' 上，下次啟動整個 App 變成一頁授權條文——離線的話再也修不回來。
	const navShell = e.request.mode === "navigate" && url.pathname === SHELL_PATH;
	e.respondWith(
		cacheReady
			.then(async (cache) => {
				const key = navShell ? "./" : e.request;
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
			.catch(() => fetch(e.request)),
	);
});
