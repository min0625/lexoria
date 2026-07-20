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
| silence.wav | 無（`tools/` 外以 python `wave` 產生） | 250ms 數位靜音，只用來在第一個手勢裡暖機音訊輸出。**格式必須與上面四顆一致**（44.1kHz/16-bit/mono），對不上會讓最初幾次音效被吃掉或衰減，原因見設計文件 §7 |
