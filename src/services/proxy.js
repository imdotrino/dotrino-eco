// Transporte del ecosistema (proxy.dotrino.com). En Eco lo usamos para lo
// dirigido: reply / repost / mención van por sendByPubkey y caen en la cola
// offline 24h del destinatario (su misma identidad del vault). El descubrimiento
// del feed va por geo; esto es el canal punto-a-punto.

import { getWebSocketProxyClient } from '@dotrino/proxy-client'
import { getIdentity, getMyPubkey } from './identity'

let client = null
let identified = false
const handlers = new Set()

async function ensureConnected () {
  if (!client) {
    client = getWebSocketProxyClient()
    // 'message' → (from, payload, meta); el pubkey del remitente va en meta.fromPubkey
    client.on?.('message', (from, payload, meta) => {
      const ev = { from, payload, fromPubkey: meta?.fromPubkey || null }
      for (const h of handlers) { try { h(ev) } catch (_) {} }
    })
  }
  if (identified) return client
  const token = await client.connect()
  const id = await getIdentity()
  const publickey = getMyPubkey()
  if (!publickey) throw new Error('vault sin pubkey; no se puede identificar')
  // Mismo sobre de identify que el messenger/trueque.
  const data = { op: 'identify', publickey, token, ts: Date.now() }
  const { signature } = await id.signData(data)
  await client.identify({ data, signature })
  identified = true
  return client
}

/** Suscribirse a mensajes entrantes (reply/repost/mención de otros). */
export function onMessage (fn) {
  handlers.add(fn)
  return () => handlers.delete(fn)
}

/** Activa Web Push del proxy (reusa el SW propio; requiere permiso concedido). */
export async function enablePush () {
  const c = await ensureConnected()
  const id = await getIdentity()
  const publickey = getMyPubkey()
  if (!publickey) throw new Error('vault sin pubkey')
  await c.enablePush({ publicKey: publickey, sign: (d) => id.signData(d) })
  return true
}

/** Conecta e identifica de forma proactiva (para recibir aunque no publiques). */
export async function connect () {
  try { await ensureConnected(); return true } catch (e) {
    console.warn('[proxy] no se pudo identificar:', e.message); return false
  }
}

/**
 * Envía un evento dirigido (reply / repost / mención) al autor original.
 * @param {string|string[]} toPubkey
 * @param {object} payload  { type:'eco-reply'|'eco-repost'|'eco-mention', eco, refId, ... }
 */
export async function sendEcoEvent (toPubkey, payload) {
  const c = await ensureConnected()
  await c.sendByPubkey(Array.isArray(toPubkey) ? toPubkey : [toPubkey], {
    app: 'eco',
    ...payload,
    ts: Date.now()
  })
}
