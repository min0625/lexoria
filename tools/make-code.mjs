// 兌換碼簽發工具（.local.feature-evaluation.md §2）。
// 私鑰存 tools/keys/<kid>.pem（已列入 .gitignore），絕不進版控。
//
// 用法：
//   bun tools/make-code.mjs keygen [kid]                          產生金鑰對（kid 預設隨機 6 碼 hex），印出要貼進 src/redeem.js 的公鑰
//   bun tools/make-code.mjs coins <amount> [--exp 2026-08-31] [--kid <kid>]
//   bun tools/make-code.mjs level <id>     [--exp 2026-08-31] [--kid <kid>]
// --exp 省略時預設 1 天後過期；--exp none 為永久有效。
// --kid 省略時，tools/keys/ 只有一把私鑰就用那把。
import { createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const KEYS_DIR = new URL('keys/', import.meta.url);
const b64url = (data) => Buffer.from(data).toString('base64url');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const [cmd, arg, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i += 2) flags[String(rest[i]).replace(/^--/, '')] = rest[i + 1];

if (cmd === 'keygen') {
  const kid = arg ?? randomBytes(3).toString('hex');
  const pemPath = new URL(`${kid}.pem`, KEYS_DIR);
  if (existsSync(pemPath)) die(`金鑰已存在：${pemPath.pathname}（換個 kid，或手動刪除後重生）`);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  mkdirSync(KEYS_DIR, { recursive: true });
  writeFileSync(pemPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
  console.log(`私鑰已寫入 ${pemPath.pathname}（不進版控，遺失＝該 kid 再也簽不了新碼）`);
  console.log('把這行貼進 src/redeem.js 的 PUBLIC_KEYS：');
  console.log(
    `  ${kid}: ${JSON.stringify({ kty, crv, x, y })
      .replace(/"(\w+)":/g, '$1: ')
      .replace(/,/g, ', ')},`
  );
  process.exit(0);
}

const effect =
  cmd === 'coins'
    ? { type: 'coins', amount: Number(arg) }
    : cmd === 'level'
      ? { type: 'level', id: Number(arg) }
      : null;
if (!effect)
  die(
    '用法：make-code.mjs keygen [kid] | coins <amount> | level <id>  （選項：--exp 2026-08-31|none，省略預設 1 天；--kid <kid>）'
  );
const value = effect.amount ?? effect.id;
if (!Number.isInteger(value) || value <= 0) die(`數值必須是正整數，收到：${arg}`);

if (effect.type === 'level') {
  const levels = JSON.parse(readFileSync(new URL('../data/levels.json', import.meta.url)));
  const maxId = levels.at(-1).id;
  // 前端 validator 管不到兌換碼，關卡範圍在簽發當下把關（評估文件 §4）
  if (effect.id > maxId) die(`第 ${effect.id} 關不存在，levels.json 目前只到第 ${maxId} 關`);
}

let exp;
if (flags.exp === 'none') {
  // 永久有效
} else if (flags.exp) {
  // 純日期視為台灣時區當日結束——「限 2026-08-31 前兌換」的自然語意
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(flags.exp) ? `${flags.exp}T23:59:59+08:00` : flags.exp;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) die(`看不懂的日期：${flags.exp}`);
  if (ms < Date.now()) die(`過期日在過去：${flags.exp}`);
  exp = Math.floor(ms / 1000);
} else {
  exp = Math.floor(Date.now() / 1000) + 86400; // 預設 1 天
}

function soleKid() {
  const pems = existsSync(KEYS_DIR) ? readdirSync(KEYS_DIR).filter((f) => f.endsWith('.pem')) : [];
  if (pems.length === 1) return pems[0].slice(0, -4);
  return die(
    pems.length
      ? `tools/keys/ 有多把私鑰（${pems.join('、')}），用 --kid 指定`
      : '沒有私鑰——先跑 make-code.mjs keygen'
  );
}
const kid = flags.kid ?? soleKid();
const pemPath = new URL(`${kid}.pem`, KEYS_DIR);
if (!existsSync(pemPath)) die(`找不到私鑰 ${pemPath.pathname}——先跑 make-code.mjs keygen ${kid}`);

const jti = randomUUID();
const payload = { jti, effect, ...(exp !== undefined && { exp }) };
const signingInput = `${b64url(JSON.stringify({ alg: 'ES256', kid }))}.${b64url(JSON.stringify(payload))}`;
// ieee-p1363 = raw r‖s 64 bytes，即 JWT ES256 規定的簽章格式
const signature = sign('sha256', Buffer.from(signingInput), {
  key: createPrivateKey(readFileSync(pemPath)),
  dsaEncoding: 'ieee-p1363',
});
const token = `${signingInput}.${b64url(signature)}`;

console.log(
  `效果：${effect.type === 'coins' ? `金幣 +${effect.amount}` : `解鎖至第 ${effect.id} 關`}` +
    `　期限：${exp ? new Date(exp * 1000).toISOString() : '無'}　jti：${jti}`
);
console.log(`\n${token}\n`);
console.log(
  `兌換連結：在遊戲網址後加 ?code=${encodeURIComponent(token).slice(0, 40)}…（完整 token）`
);
