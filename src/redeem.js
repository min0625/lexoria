// 兌換碼驗證（.local.feature-evaluation.md §2）：JWT + ES256 非對稱簽章。
// 私鑰只在開發者本機（tools/make-code.mjs 簽發），前端持公鑰離線驗簽——
// 發新碼不用重新部署。演算法寫死 ES256、kid 必須命中下方白名單，
// token 自帶的 alg 欄位一律忽略（防 alg confusion）。
// 單次使用、有效期限都只是前端層級的防護（清 localStorage / 調時鐘可繞過），
// 沿用「不防技術玩家」的既有取捨。

// kid → 公鑰 JWK 白名單。移除一把 key＝該 key 簽過的所有碼整批作廢（離線唯一撤銷手段）。
export const PUBLIC_KEYS = {
  eb0807: {
    kty: 'EC',
    crv: 'P-256',
    x: 'YWlPvm7wGAMIrHo7ZCWF2-4mGsX9bLJc4K-7pVDXpOc',
    y: 'hd9h9ti3PZz0hHEhSleyvffUA0moE_FNKIHg-m-V4io',
  },
};

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0)
  );
}

// token → { header, payload, signature, signedData }；任何格式問題回 null
function decode(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object')
      return null;
    return {
      header,
      payload,
      signature: b64urlToBytes(parts[2]),
      signedData: new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    };
  } catch {
    return null;
  }
}

// 效果只有兩種（評估文件 §2 定案），不預先擴充
const isValidEffect = (e) =>
  !!e &&
  ((e.type === 'coins' && Number.isInteger(e.amount) && e.amount > 0) ||
    (e.type === 'level' && Number.isInteger(e.id) && e.id > 0));

// 驗證兌換碼 → { ok: true, jti, effect } 或 { ok: false, reason: 'invalid' | 'expired' | 'used' }。
// keys / now / redeemed 可注入，測試用；正式呼叫端只帶 redeemed（已兌換 jti 清單）。
export async function verifyCode(
  token,
  { keys = PUBLIC_KEYS, now = Date.now() / 1000, redeemed = [] } = {}
) {
  if (!globalThis.crypto?.subtle) return { ok: false, reason: 'invalid' }; // 非 secure context（評估文件 §3-4）
  const t = decode(token);
  // Object.hasOwn：擋 __proto__/constructor 之類撈到原型鏈的 kid
  const jwk = t && Object.hasOwn(keys, t.header.kid) ? keys[t.header.kid] : null;
  if (!jwk) return { ok: false, reason: 'invalid' };
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  // ES256 的 JWT 簽章本來就是 raw r‖s 64 bytes，與 WebCrypto 格式一致，免 DER 轉換
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    t.signature,
    t.signedData
  );
  if (!valid) return { ok: false, reason: 'invalid' };
  const { jti, exp, effect } = t.payload;
  if (typeof jti !== 'string' || !isValidEffect(effect)) return { ok: false, reason: 'invalid' };
  if (exp !== undefined && !(Number.isFinite(exp) && now <= exp))
    return { ok: false, reason: 'expired' };
  if (redeemed.includes(jti)) return { ok: false, reason: 'used' };
  return { ok: true, jti, effect };
}
