// Almacén del usuario (store.dotrino.com) — el ÚNICO dato durable de Eco.
// Thread-based: usamos un thread por autor (key = 'eco:'+pubkey) para acumular,
// dedup y mutear; 'eco:mine' para mis ecos; 'eco:inbox' para la bandeja efímera.
// No montamos backend propio: usamos el paquete del ecosistema.

import { Store } from '@dotrino/store'
import { getIdentity } from './identity.js'
/** @import { Eco, ArchivedPtr, PublicRef, InboxItem } from '../types.js' */

const MINE = 'eco:mine'
const INBOX = 'eco:inbox'
// Índice de lo ARCHIVADO en el node del usuario. Aquí van los PUNTEROS (qué eco es
// qué `cid`), no los ecos: el content guarda versiones inmutables y no sabe cuál es
// "la actual" de nada; saber eso es del store. Y tiene que estar disponible aunque
// el node esté apagado, que es la regla de entrada del store (CONVENCIONES §4).
const ARCHIVE = 'eco:archive'
// Punteros a lo PÚBLICO de mis ecos en el content (copia en claro + imagen): el
// índice va en el store —que siempre está— y los bytes en el node.
const PUBLIC = 'eco:public'
/** @param {string} pk */
const authorKey = (pk) => 'eco:' + pk

/** @type {Store | null} */
let store = null

/** @returns {Promise<Store>} */
export async function getStore () {
  if (store) return store
  // Atado al PERFIL (respaldo en la bóveda, sin mezclar cuentas). Hasta 2026-09-30 conectaba
  // sin identidad y todo quedaba en el espacio común del navegador; `adoptCommon` lo trae al
  // perfil una vez, sin borrar el original.
  const identity = await getIdentity()
  if (!identity) throw Object.assign(new Error('identity not available'), { code: 'no-identity' })
  store = await Store.connect({ identity, adoptCommon: ['eco:'] })
  return store
}

// El store viaja por postMessage (structured clone) al iframe del vault, que NO
// puede clonar Proxies reactivos de Vue (DataCloneError). Aplanamos a objeto
// plano JSON antes de mandarlo. Los ecos son JSON-safe (strings/nums/arrays/null).
/**
 * @param {object} v
 * @returns {import('@dotrino/store').ThreadEntry}
 */
const plain = (v) => JSON.parse(JSON.stringify(v))

/**
 * Guarda/actualiza un eco bajo el thread de su autor (dedup por id).
 * @param {Eco} eco
 * @returns {Promise<boolean>}
 */
export async function saveEco (eco) {
  const s = await getStore()
  const key = eco.author ? authorKey(eco.author) : MINE
  const existing = await s.listThread(key, { limit: 500 }).catch(() => [])
  if (existing.some((e) => (e.eco?.id || e.id) === eco.id)) return false
  await s.appendMessage(key, plain({ kind: 'eco', eco }))
  return true
}

/** @param {Eco} eco */
export async function saveMine (eco) {
  const s = await getStore()
  await s.appendMessage(MINE, plain({ kind: 'eco', eco }))
}

/**
 * Devuelve todos los ecos guardados (mis threads de autores + los míos).
 * @returns {Promise<Eco[]>}
 */
export async function loadAllEcos () {
  const s = await getStore()
  const summaries = await s.getThreadSummaries().catch(() => ({}))
  const keys = Object.keys(summaries).filter((k) => k.startsWith('eco:') && k !== INBOX)
  /** @type {Eco[]} */
  const all = []
  for (const k of keys) {
    const entries = await s.listThread(k, { limit: 500 }).catch(() => [])
    for (const e of entries) { if (e.eco) all.push(e.eco) }
  }
  // dedup por id (por si un eco se vio por geo y por proxy)
  /** @type {Map<string, Eco>} */
  const byId = new Map()
  for (const eco of all) byId.set(eco.id, eco)
  return [...byId.values()]
}

// --- archivo en el node propio (opt-in por eco) ---

/**
 * Anota que este eco quedó guardado en mi node, y con qué referencia.
 * @param {{ ecoId: string, cid: string, key?: string|null, owner?: string|null, createdAt?: number }} ptr
 */
export async function saveArchived ({ ecoId, cid, key = null, owner = null, createdAt = 0 }) {
  const s = await getStore()
  const entry = await s.appendMessage(ARCHIVE, plain({
    kind: 'archived', ecoId, cid, key, owner, createdAt: createdAt || Date.now()
  }))
  return entry
}

/**
 * Punteros de todo lo archivado (entradas que escribió `saveArchived`).
 * @returns {Promise<ArchivedPtr[]>}
 */
export async function loadArchived () {
  const s = await getStore()
  return /** @type {Promise<ArchivedPtr[]>} */ (s.listThread(ARCHIVE, { limit: 500 }).catch(() => []))
}

/**
 * Quita el puntero (quien borra los bytes es el node, aparte).
 * @param {string} entryId
 */
export async function removeArchived (entryId) {
  const s = await getStore()
  await s.removeMessage(ARCHIVE, entryId).catch(() => {})
}

/**
 * Puntero a la copia pública de un eco (y su imagen) en mi node.
 * @param {{ ecoId: string, cid: string, owner: string, mediaCid?: string | null, expiresAt?: number }} ref
 */
export async function savePublicRef ({ ecoId, cid, owner, mediaCid = null, expiresAt = 0 }) {
  const s = await getStore()
  return s.appendMessage(PUBLIC, plain({ kind: 'public', ecoId, cid, owner, mediaCid, expiresAt, createdAt: Date.now() }))
}

/**
 * Las entradas que escribió `savePublicRef`.
 * @returns {Promise<PublicRef[]>}
 */
export async function loadPublicRefs () {
  const s = await getStore()
  return /** @type {Promise<PublicRef[]>} */ (s.listThread(PUBLIC, { limit: 500 }).catch(() => []))
}

/** @param {string} entryId */
export async function removePublicRef (entryId) {
  const s = await getStore()
  await s.removeMessage(PUBLIC, entryId).catch(() => {})
}

/**
 * Bandeja efímera: eventos de desconocidos avalados pendientes de aceptar.
 * @param {InboxItem} item
 */
export async function pushInbox (item) {
  const s = await getStore()
  await s.appendMessage(INBOX, plain(item))
}

/** @returns {Promise<InboxItem[]>} las entradas que escribió `pushInbox` */
export async function loadInbox () {
  const s = await getStore()
  return /** @type {Promise<InboxItem[]>} */ (s.listThread(INBOX, { limit: 200 }).catch(() => []))
}

export async function clearInbox () {
  const s = await getStore()
  await s.removeThread(INBOX).catch(() => {})
}

/**
 * Mutear a un autor: borra su thread acumulado.
 * @param {string} pk
 */
export async function muteAuthor (pk) {
  const s = await getStore()
  await s.removeThread(authorKey(pk)).catch(() => {})
}
