/* eslint-disable no-console */
// deno run tools/vapid-b64-to-jwk.ts
// 输入：Node web-push 风格的 base64url VAPID 公钥/私钥
// 输出：@negrel/webpush 可用的 ExportedVapidKeys (JWK JSON)

const PUB = 'BBNCerCsfhadU6QMbTSHEvKTq006raNlgiQUEcMnmnOLaDA_X5QwEy1T_N_UYPMNp0rS9_e2_7cyoYV90HeaF0Q' // 你的 VAPID_PUBLIC_KEY
const PRIV = '6Hs1FRIqdmFEobH9a2QNBYc0y8uCelMKaqJDrXr0veo' // 你的 VAPID_PRIVATE_KEY

// -- helpers --
function b64urlToBytes(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Node web-push 的 public key 是 65 字节（0x04 || X(32) || Y(32)）
const pubBytes = b64urlToBytes(PUB)
if (pubBytes.length !== 65 || pubBytes[0] !== 0x04)
  throw new Error('Unexpected public key format')

const x = pubBytes.slice(1, 33)
const y = pubBytes.slice(33, 65)

const privBytes = b64urlToBytes(PRIV) // 32 bytes scalar
if (privBytes.length !== 32)
  throw new Error('Unexpected private key length')

// to base64url
function bytesToB64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  const b64 = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return b64
}

// 组装 JWK（P-256）
const jwkPublic: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: bytesToB64url(x),
  y: bytesToB64url(y),
  ext: true,
}

const jwkPrivate: JsonWebKey = {
  ...jwkPublic,
  d: bytesToB64url(privBytes),
}

// 输出为 ExportedVapidKeys JSON
const exported = { publicKey: jwkPublic, privateKey: jwkPrivate }
console.log(JSON.stringify(exported))
