# 音效素材來源（設計文件 §7、§14）

出處：Kenney「Interface Sounds」1.0（https://kenney.nl/assets/interface-sounds），CC0。
原始為 OGG，因 iOS Safari 不支援 OGG Vorbis，轉為 mono 16-bit WAV（soundfile 轉檔，未重採樣）。

| 檔案 | 原始檔 | 用途 |
|------|--------|------|
| tick.wav | tick_001.ogg | 選字（**目前未使用**，見設計文件 §7；檔案保留） |
| target.wav | confirmation_001.ogg | 命中目標字 |
| invalid.wav | error_004.ogg | 無效字 |
| coin.wav | glass_002.ogg | 拼出 bonus 字得金幣 |
| clear.wav | confirmation_002.ogg | 過關 |
| silence.wav | 無（以 python `wave` 產生） | 250ms、440Hz、峰值 2/32768（約 -84dBFS）的正弦波，`loop` 播放。職責只有一個：把整頁音訊 session 升級成媒體類別，讓 Web Audio 不受 iOS 靜音鍵影響。**不能改成數位全零**（系統不當它是音訊活動，`AudioContext.resume()` 會拖到 5~9 秒），**也不能停掉 loop**（播完 session 就掉回去）。原因與量測見設計文件 §7 |
