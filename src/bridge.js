// 平台抽象層（設計文件 §13）——第一階段全是 web 實作，第二階段逐個換成 native。
// 遊戲程式碼只准 import bridge，不准直接碰 localStorage 或 native API。
const SAVE_KEY = 'lexoria-save';

// 非 secure context 下 navigator.clipboard 為 undefined，?. 短路整串 → 回 undefined，
// ?? 收成 false，呼叫端一律拿到「成功/失敗」的 boolean promise。
// try 不能省：writeText 被權限政策擋下時有機會同步丟例外，漏出去會讓沒包 try 的呼叫端
// （btn-uid）整顆按鈕沒反應——正是這裡回 false 想避免的情況。
const writeClipboard = (text) => {
  try {
    return (
      navigator.clipboard?.writeText(text).then(
        () => true,
        () => false
      ) ?? Promise.resolve(false)
    );
  } catch {
    return Promise.resolve(false);
  }
};

// 等焦點回到頁面，最多 300ms。分享面板收掉後焦點才會回來，而它跟 navigator.share 的 promise
// settle 沒有規範保證的先後——不等就有機會撞上跟第一次一模一樣的「Document is not focused」。
// 上限不能省：手機分享成功會直接切到對方 App，focus 事件永遠不會來，share() 就永不回傳。
const refocused = () =>
  new Promise((resolve) => {
    if (document.hasFocus()) return resolve();
    addEventListener('focus', resolve, { once: true });
    setTimeout(resolve, 300);
  });

export const bridge = {
  save(data) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  },
  load() {
    return JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
  },
  // 複製到剪貼簿 → true/false。遊戲程式碼不准直接碰 navigator.clipboard（Phase 2 換 native
  // 就只改這裡）；不 await 也可以，回傳的是 promise。
  copy: writeClipboard,
  // 分享進度：先寫剪貼簿當保險，再開系統分享面板——兩者都做。
  // 部分分享目標（Facebook 那類政策上只收連結的）仍會丟掉 text，文案會不見。（Windows 桌面
  // 面板下面另外處理了。）
  // 回傳值講的是「使用者接下來能做什麼」，不是「哪條路成功了」：
  //   'copied' 剪貼簿確實寫進去了 → 提示「可直接貼上」。**面板有沒有開都提示**：想貼到網頁版
  //            聊天室／表單／文件的人，目標根本不在系統面板上，取消面板正是那個訊號。提示只在
  //            面板關閉（或取消）後才閃——呼叫端是 await 完才 flash——所以不會被面板蓋掉。
  //   'shared' 面板開了但剪貼簿兩次都沒寫成 → 不提示。
  //   'failed' 兩條路都不可用 → 一定要提示，否則按鈕按下去毫無反應。
  // 只有真的寫成功才回 'copied'：這句提示是承諾，讓人去貼卻貼不出東西比不提示更糟——所以
  // 也不能「先樂觀提示再開面板」，那時 writeText 還沒 settle（先 await 它就開不了面板，見下）。
  // 剪貼簿只發動不 await：navigator.share 需要 transient user activation，
  // 先 await 一個非 microtask 的 promise 會吃掉手勢，Safari 會直接 NotAllowedError（面板不開）。
  async share(text, url) {
    const full = `${text}\n${url}`; // 剪貼簿與 Windows 面板共用同一份，不能各組各的
    let copying = writeClipboard(full);
    let shared = false;
    if (navigator.share) {
      // Windows 面板把 text/url 當 DataPackage 上兩個各自獨立的欄位（SetText/SetWebLink），多數
      // 目標只讀 WebLink 就把文案整段丟了；併成單一 text 欄位才收得到。其他平台維持分開傳。
      // 完整取捨、判斷條件的依據與已知例外都在 UI 文件 §4-D，唯一一份，不要在這裡再抄一遍。
      const payload =
        navigator.userAgentData?.platform === 'Windows' ? { text: full } : { text, url };
      // 使用者取消（AbortError）算送出，不再提示。但**真正失敗**（權限政策擋下、transient
      // activation 過期、面板叫不起來）不能也回 'shared'：呼叫端對 'shared' 不提示，按鈕會變成
      // 按了完全沒反應。落回剪貼簿的結果，至少還說得出「已複製，可直接貼上」。
      shared = await navigator.share(payload).then(
        () => true,
        (e) => e?.name === 'AbortError'
      );
      // 補寫一次剪貼簿：桌面上面板搶走焦點時 Chromium 會用「Document is not focused」擋掉第一次
      // writeText，那正好是「取消面板 → 提示可直接貼上」最需要它成功的時候。等焦點真的回到頁面
      // 才寫得進去（見 refocused）。不是每次都失敗（手機上第一次就成功），所以只在失敗後補。
      if (!(await copying)) {
        await refocused();
        copying = writeClipboard(full);
      }
    }
    if (await copying) return 'copied';
    return shared ? 'shared' : 'failed';
  },
};
