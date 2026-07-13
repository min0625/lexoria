// 下載產生器輸入資料（設計文件 §5、§14）——只在建置期跑，遊戲執行期不碰網路。
// 產出 tools/data/enable1.txt 與 tools/data/wordinfo.json，供 generate-levels.mjs 離線讀取。
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const dataDir = new URL('./data/', import.meta.url);
mkdirSync(dataDir, { recursive: true });

// ENABLE 字表（public domain，§14）：bonus 判定字典
const enablePath = new URL('enable1.txt', dataDir);
if (!existsSync(enablePath)) {
  const res = await fetch('https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt');
  if (!res.ok) throw new Error(`ENABLE 下載失敗：HTTP ${res.status}`);
  writeFileSync(enablePath, await res.text());
  console.log('enable1.txt 下載完成');
}

// ECDICT（MIT，§14）：目標字的中文翻譯來源（簡體，build-wordinfo.py 會轉繁體）
const ecdictPath = new URL('ecdict.csv', dataDir);
if (!existsSync(ecdictPath)) {
  const res = await fetch('https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv');
  if (!res.ok) throw new Error(`ECDICT 下載失敗：HTTP ${res.status}`);
  writeFileSync(ecdictPath, Buffer.from(await res.arrayBuffer()));
  console.log('ecdict.csv 下載完成');
}

// 字頻（wordfreq，MIT）+ 英文釋義（WordNet via NLTK）+ 中文翻譯（ECDICT + OpenCC 轉繁）→ wordinfo.json
execFileSync(
  'uv',
  ['run', '--with', 'wordfreq', '--with', 'nltk', '--with', 'opencc',
    'python', fileURLToPath(new URL('build-wordinfo.py', import.meta.url))],
  { stdio: 'inherit' },
);
