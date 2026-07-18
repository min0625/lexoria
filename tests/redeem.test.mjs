// 兌換碼驗證測試（.local.feature-evaluation.md §2、§5-2）。
// 測試現場生金鑰對簽 token（node:crypto 的 ieee-p1363 = JWT ES256 的 raw r‖s 格式），
// 不依賴 src/redeem.js 內嵌的正式公鑰。

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { verifyCode } from '../src/redeem.js';
import { defaultSave, normalizeSave } from '../src/storage.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
const keys = { test: { kty, crv, x, y } };

const b64url = (s) => Buffer.from(s).toString('base64url');
function makeToken(payload, { kid = 'test', key = privateKey } = {}) {
  const input = `${b64url(JSON.stringify({ alg: 'ES256', kid }))}.${b64url(JSON.stringify(payload))}`;
  const sig = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}

const coinsPayload = { jti: 'jti-1', effect: { type: 'coins', amount: 50 } };

test('redeem：有效的金幣碼', async () => {
  const r = await verifyCode(makeToken(coinsPayload), { keys });
  assert.deepEqual(r, { ok: true, jti: 'jti-1', effect: { type: 'coins', amount: 50 } });
});

test('redeem：有效的跳關碼', async () => {
  const r = await verifyCode(makeToken({ jti: 'jti-2', effect: { type: 'level', id: 7 } }), {
    keys,
  });
  assert.deepEqual(r, { ok: true, jti: 'jti-2', effect: { type: 'level', id: 7 } });
});

test('redeem：payload 被竄改 → invalid', async () => {
  const [h, , s] = makeToken(coinsPayload).split('.');
  const forged = `${h}.${b64url(JSON.stringify({ ...coinsPayload, effect: { type: 'coins', amount: 99999 } }))}.${s}`;
  assert.deepEqual(await verifyCode(forged, { keys }), { ok: false, reason: 'invalid' });
});

test('redeem：kid 不在白名單 → invalid（移除 key＝整批撤銷）', async () => {
  for (const kid of ['removed', '__proto__', 'constructor']) {
    const r = await verifyCode(makeToken(coinsPayload, { kid }), { keys });
    assert.deepEqual(r, { ok: false, reason: 'invalid' }, kid);
  }
});

test('redeem：別把私鑰簽的 token → invalid', async () => {
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  const r = await verifyCode(makeToken(coinsPayload, { key: other }), { keys });
  assert.deepEqual(r, { ok: false, reason: 'invalid' });
});

test('redeem：exp 過期 → expired；期限內 → ok', async () => {
  const token = makeToken({ ...coinsPayload, exp: 1000 });
  assert.deepEqual(await verifyCode(token, { keys, now: 1001 }), { ok: false, reason: 'expired' });
  assert.equal((await verifyCode(token, { keys, now: 1000 })).ok, true); // 邊界：now === exp 仍有效
});

test('redeem：jti 已兌換過 → used', async () => {
  const r = await verifyCode(makeToken(coinsPayload), { keys, redeemed: ['jti-1'] });
  assert.deepEqual(r, { ok: false, reason: 'used' });
});

test('redeem：格式壞掉的輸入一律 invalid、不噴錯', async () => {
  for (const bad of ['', 'abc', 'a.b', 'a.b.c', `${b64url('null')}.${b64url('null')}.AA`]) {
    assert.deepEqual(await verifyCode(bad, { keys }), { ok: false, reason: 'invalid' }, bad);
  }
});

test('redeem：effect 不合法或缺 jti → invalid（簽章正確也擋）', async () => {
  for (const payload of [
    { jti: 'x', effect: { type: 'coins', amount: -5 } },
    { jti: 'x', effect: { type: 'coins', amount: 1.5 } },
    { jti: 'x', effect: { type: 'level', id: 0 } },
    { jti: 'x', effect: { type: 'jackpot' } },
    { jti: 'x' },
    { effect: { type: 'coins', amount: 5 } },
  ]) {
    assert.deepEqual(await verifyCode(makeToken(payload), { keys }), {
      ok: false,
      reason: 'invalid',
    });
  }
});

// ---- 存檔欄位（redeemedCodes）----

test('存檔：舊存檔沒有 redeemedCodes → 補空陣列、不重置', () => {
  const { redeemedCodes: _, ...old } = defaultSave();
  old.coins = 123;
  const s = normalizeSave(old);
  assert.deepEqual(s.redeemedCodes, []);
  assert.equal(s.coins, 123);
});

test('存檔：redeemedCodes 不是陣列 → 整份重置', () => {
  const s = normalizeSave({ ...defaultSave(), redeemedCodes: 'garbage' });
  assert.deepEqual(s, defaultSave());
});
