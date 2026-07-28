// UI 文案集中表（docs/word-puzzle-ui-screens.md §6）——換語言只改這個檔，不做 i18n 框架。

// 分享文案的第一句。破關那顆報戰績、設定那顆只邀人玩，同一份盤面配不同開頭。
// bonus 為 0 時不提「額外找到 0 個單字」。
const shareHead = (n, bonus) =>
  bonus === null
    ? `我正在玩 Lexoria 第 ${n} 關`
    : `我破了 Lexoria 第 ${n} 關${bonus > 0 ? `，額外找到 ${bonus} 個單字` : ''}`;

export const strings = {
  levelTitle: (n) => `第 ${n} 關`,
  // 提示鈕的 aria-label：鈕上看得見的只有「−25」，而 aria-label 會整個蓋掉它——
  // 不寫價格的話，讀螢幕的人按下去才發現扣了 25，而這是全遊戲唯一不可逆的花費。
  hintLabel: (n) => `提示，花費 ${n} 金幣`,
  alreadyFound: '已找到',
  // 只給 #status 播報用：#preview 上無效字是「單字本身 + 抖動」，抖動是純視覺的，
  // 光把單字丟進 live region 等於只唸出剛拼的字，聽不出來被判無效（答對時聽到的也是同一個字）
  notAWord: (w) => `${w} 不是單字`,
  levelClear: '過關！',
  nextLevel: '下一關',
  bonusFound: (n) => `額外單字 +${n}`,
  noCoins: '金幣不足',
  tutorial: '滑過字母，連成單字',
  rotateDevice: '請轉直畫面',
  allClear: '更多關卡即將推出',
  backToLevels: '關卡選擇',
  settings: '設定',
  sound: '發音', // 音效已整層移除（設計文件 §13），這個開關現在只管答對時的自動發音
  about: '關於',
  replayNote: '重玩不再獲得金幣',
  share: '分享',
  shareScore: '分享戰績', // 過關卡片與全破畫面上那兩顆；設定裡的仍用中性的 share（那顆是邀人，不報戰績）
  // 字母數 3–7，用中文數字才接得上前後文；超出範圍就退回阿拉伯數字（不會讀成 undefined）。
  // 結尾的 \n 是留給 bridge.share 接上的網址，讓它與盤面之間空一行。
  // bonus：破關時的額外單字數；null = 還在玩（設定裡那顆）。
  // 問句獨立一行，讓「我的事」與「給對方的事」分開，那句才讀得出是邀請而不是說明。
  // 句中的 ⬜ 是圖例：緊接著下一行就是同一個符號的方陣，對應關係不用解釋就成立——
  // 不要改回「填滿空格」，那樣讀者得自己把「空格」對到 ⬜；也不要另加一行 `⬜ = 要填的格`，
  // 那會讓訊息變成說明書。指向盤面而不是指向網址，是這則訊息不像廣告的原因。
  shareText: (n, letters, grid, bonus) =>
    `${shareHead(n, bonus)}\n\n只有 ${letters.join(' ')} ${'三四五六七'[letters.length - 3] ?? letters.length}個字母\n能填滿這些 ⬜ 嗎？\n\n${grid}\n`,
  // 全破畫面：沒有「這一關」可秀。刻意不寫關卡總數——對外文案不寫會變的數字，
  // 而這個畫面自己就掛著「更多關卡即將推出」。分享訊息會被截圖留存，比 meta tag 更難收回。
  shareAll: () => `我破完了 Lexoria 目前所有關卡\n\n一個字母盤，拼出單字填滿空格\n`,
  // 面板關閉後也會顯示這句，所以主詞要寫出來：光說「已複製」，剛分享完的人會讀成分享失敗。
  shareCopied: '文案已複製，可直接貼上',
  // 不寫「此瀏覽器無法分享」：這句也涵蓋「面板明明有、這次卻叫不起來」（權限政策、手勢過期），
  // 那時把人導去換瀏覽器是錯的方向。只說發生什麼事、留下可再試一次的餘地。
  shareFailed: '分享失敗，請稍後再試',
  shareImageTitle: (n) => `Lexoria · 第 ${n} 關`,
  download: '下載圖片',
  tapWordHint: '點單字查看解釋', // 過關卡片單字列(§4-C)與教學第二段(§4-F)共用同一條（UI 文件）
  cellDictLabel: (w) => `查看 ${w} 的解釋`, // 已找到的格子的 aria-label：只有 role 會跟轉盤字母鈕同音
  // 以下兩句只給輔助技術聽，畫面上看不到（圖示鈕沒有可見文字）。放這裡是因為它們也是 UI 文案：
  // 其餘標籤全是繁中，寫死英文的話讀螢幕的人會聽到中英夾雜。
  shuffleLabel: '洗牌',
  speakLabel: (w) => `唸出 ${w}`,
  playerId: '玩家編號',
  copied: '已複製',
  copyFailed: '無法複製，請手動抄下',
  redeemPlaceholder: '貼上兌換碼',
  redeemAction: '兌換',
  redeemInvalid: '無效的兌換碼',
  redeemExpired: '兌換碼已過期',
  redeemUsed: '此兌換碼已使用過',
  redeemBehind: '進度已超過此兌換碼的關卡',
  // 碼比這台裝置手上的關卡新（剛推新關卡、SW 還在給舊的 index.json）——不是壞碼，所以留餘地
  redeemNoLevel: '此兌換碼的關卡還沒上線，請稍後再試',
  redeemWrongUid: '此兌換碼不屬於這個玩家編號',
  redeemCoins: (n) => `兌換成功，金幣 +${n}`,
  redeemLevel: (n) => `兌換成功，已解鎖至第 ${n} 關`,
  claimLabel: '領取金幣',
  claimReady: (n) => `+${n}`,
  claimSeconds: (s) => `${s} 秒`,
  claimSuccess: (n) => `已領取金幣 +${n}`,
  claimWait: (h, m) => (h > 0 ? `${h} 小時 ${m} 分後可領取金幣` : `${m} 分鐘後可領取金幣`),
  claimAlmost: '就快好了！',
  loading: '載入中…', // 首屏在 index.html 直接寫死同一句（JS 下載完成前就要可見），這裡給換關時重用
  loadFailed: '關卡資料載入失敗，請檢查網路連線',
  retry: '重新載入',
};
