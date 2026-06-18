// E2E del proxy (proxy.dotrino.com): identify firmado + envío dirigido por
// pubkey (reply/re-eco de Eco) + cola offline 24h. Replica el signData del vault.
import crypto from 'node:crypto'
import { WebSocketProxyClient } from '@dotrino/proxy-client'

function canonicalStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}'
}
function makeIdentity () {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const pub = JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y })
  const signData = async (data) => crypto.sign('sha256', Buffer.from(canonicalStringify(data), 'utf8'),
    { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')
  return { pub, signData }
}
let failures = 0
const must = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) failures++ }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function identify (client, id) {
  const token = await client.connect()
  const data = { op: 'identify', publickey: id.pub, token, ts: Date.now() }
  const signature = await id.signData(data)
  await client.identify({ data, signature })
  return token
}

async function main () {
  console.log('== PROXY (proxy.dotrino.com) ==')
  const A = makeIdentity(); const B = makeIdentity(); const C = makeIdentity()
  const ca = new WebSocketProxyClient(); const cb = new WebSocketProxyClient()

  let got = null
  cb.on('message', (from, payload, meta) => { got = { from, payload, fromPubkey: meta?.fromPubkey } })

  await identify(ca, A); must(true, 'A connect + identify')
  await identify(cb, B); must(true, 'B connect + identify')

  // 1) A → B dirigido (reply de Eco)
  ca.sendByPubkey([B.pub], { app: 'eco', type: 'eco-reply', refId: 'x1', text: 'hola B' })
  for (let i = 0; i < 30 && !got; i++) await sleep(100)
  must(!!got, 'B recibe el mensaje dirigido de A')
  if (got) {
    must(got.payload?.type === 'eco-reply' && got.payload?.text === 'hola B', `payload íntegro (type=${got.payload?.type})`)
    must(got.fromPubkey === A.pub, 'fromPubkey identifica al emisor (A)')
  }

  // 2) Cola offline: A → C (offline), luego C conecta y recibe
  ca.sendByPubkey([C.pub], { app: 'eco', type: 'eco-repost', refId: 'x2' })
  await sleep(500)
  const cc = new WebSocketProxyClient()
  let gotC = null
  cc.on('message', (from, payload, meta) => { gotC = { payload, fromPubkey: meta?.fromPubkey } })
  await identify(cc, C); must(true, 'C connect + identify (tras el envío)')
  for (let i = 0; i < 40 && !gotC; i++) await sleep(100)
  must(!!gotC, 'C recibe el mensaje encolado offline')
  if (gotC) must(gotC.payload?.type === 'eco-repost', `payload encolado íntegro (type=${gotC.payload?.type})`)

  try { ca.close?.(); cb.close?.(); cc.close?.() } catch (_) {}
  console.log(`\n${failures === 0 ? '🟢 PROXY OK' : '🔴 ' + failures + ' fallos'}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch(e => { console.error('💥', e); process.exit(2) })
