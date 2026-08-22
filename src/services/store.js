// Almacén del usuario (store.dotrino.com) — el ÚNICO dato durable de Eco.
// Thread-based: usamos un thread por autor (key = 'eco:'+pubkey) para acumular,
// dedup y mutear; 'eco:mine' para mis ecos; 'eco:inbox' para la bandeja efímera.
// No montamos backend propio: usamos el paquete del ecosistema.

import { Store } from '@dotrino/store'

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
const authorKey = (pk) => 'eco:' + pk

let store = null

export async function getStore () {
  if (!store) store = await Store.connect()
  return store
}

// El store viaja por postMessage (structured clone) al iframe del vault, que NO
// puede clonar Proxies reactivos de Vue (DataCloneError). Aplanamos a objeto
// plano JSON antes de mandarlo. Los ecos son JSON-safe (strings/nums/arrays/null).
const plain = (v) => JSON.parse(JSON.stringify(v))

/** Guarda/actualiza un eco bajo el thread de su autor (dedup por id). */
export async function saveEco (eco) {
  const s = await getStore()
  const key = eco.author ? authorKey(eco.author) : MINE
  const existing = await s.listThread(key, { limit: 500 }).catch(() => [])
  if (existing.some((e) => (e.eco?.id || e.id) === eco.id)) return false
  await s.appendMessage(key, plain({ kind: 'eco', eco }))
  return true
}

export async function saveMine (eco) {
  const s = await getStore()
  await s.appendMessage(MINE, plain({ kind: 'eco', eco }))
}

/** Devuelve todos los ecos guardados (mis threads de autores + los míos). */
export async function loadAllEcos () {
  const s = await getStore()
  const summaries = await s.getThreadSummaries().catch(() => ({}))
  const keys = Object.keys(summaries).filter((k) => k.startsWith('eco:') && k !== INBOX)
  const all = []
  for (const k of keys) {
    const entries = await s.listThread(k, { limit: 500 }).catch(() => [])
    for (const e of entries) { if (e.eco) all.push(e.eco) }
  }
  // dedup por id (por si un eco se vio por geo y por proxy)
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

/** Punteros de todo lo archivado. @returns {Promise<any[]>} */
export async function loadArchived () {
  const s = await getStore()
  return s.listThread(ARCHIVE, { limit: 500 }).catch(() => [])
}

/** Quita el puntero (quien borra los bytes es el node, aparte). */
export async function removeArchived (entryId) {
  const s = await getStore()
  await s.removeMessage(ARCHIVE, entryId).catch(() => {})
}

/** Puntero a la copia pública de un eco (y su imagen) en mi node. */
export async function savePublicRef ({ ecoId, cid, owner, mediaCid = null, expiresAt = 0 }) {
  const s = await getStore()
  return s.appendMessage(PUBLIC, plain({ kind: 'public', ecoId, cid, owner, mediaCid, expiresAt, createdAt: Date.now() }))
}

/** @returns {Promise<any[]>} */
export async function loadPublicRefs () {
  const s = await getStore()
  return s.listThread(PUBLIC, { limit: 500 }).catch(() => [])
}

export async function removePublicRef (entryId) {
  const s = await getStore()
  await s.removeMessage(PUBLIC, entryId).catch(() => {})
}

/** Bandeja efímera: eventos de desconocidos avalados pendientes de aceptar. */
export async function pushInbox (item) {
  const s = await getStore()
  await s.appendMessage(INBOX, plain(item))
}

export async function loadInbox () {
  const s = await getStore()
  return s.listThread(INBOX, { limit: 200 }).catch(() => [])
}

export async function clearInbox () {
  const s = await getStore()
  await s.removeThread(INBOX).catch(() => {})
}

/** Mutear a un autor: borra su thread acumulado. */
export async function muteAuthor (pk) {
  const s = await getStore()
  await s.removeThread(authorKey(pk)).catch(() => {})
}
