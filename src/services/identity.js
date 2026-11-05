// Integración con el vault id.dotrino.com (única fuente de identidad).
// Expone adaptadores para el cliente geo (espera signData(data)->string y
// getPublicKeyJwk()->string) y el grafo de afinidad/ratings para el ranking.
// Patrón tomado de trueque/ y gridgame/: no reimplementa nada del vault.

import { Identity } from '@dotrino/identity'

/** @type {Identity | null} */
let identity = null
/** @type {string | null} */
let myPubkey = null

/** @returns {Promise<Identity | null>} */
export async function initIdentity () {
  if (identity) return identity
  try {
    identity = await Identity.connect()
    // MI IDENTIDAD ES EL `profileId`, no la llave de ESTE aparato.
    //
    // `me.publickey` es la llave del aparato, y solo coincide con la cuenta en el que la
    // fundó. Usarla como identidad hacía que publicar desde el teléfono y desde el PC
    // quedara a nombre de dos personas distintas: dos autores en el mapa, y la
    // reputación repartida entre ellos en vez de acumularse. Sin error, en silencio.
    myPubkey = (await identity.profileActa().catch(() => null))?.acta?.profileId
      || identity.me?.publickey || null
  } catch (e) {
    console.warn('[identity] vault unreachable, standalone mode:', e instanceof Error ? e.message : e)
    identity = null
  }
  return identity
}

/** @returns {Promise<Identity | null>} */
export async function getIdentity () {
  if (!identity) await initIdentity()
  return identity
}

/** @returns {string | null} */
export function getMyPubkey () { return myPubkey }
export function isReady () { return identity !== null && !!myPubkey }

// --- nombre legible desde el vault (nunca un placeholder) ---
/** @type {Map<string, string | null>} */
const nameCache = new Map() // pk → nickname|null

/** @returns {string | null} */
export function getMyName () { return identity?.me?.nickname || null }

/**
 * Define mi nombre visible en el vault (firma mis ecos). Devuelve true si ok.
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function setMyName (name) {
  const id = await getIdentity()
  if (!id) return false
  const n = String(name || '').trim()
  if (!n) return false
  try { await id.setMyNickname(n); return !!getMyName() } catch (_) { return false }
}

/**
 * Resuelve el nombre de un autor por su pubkey (peer book del vault).
 * @param {string | null | undefined} pk
 * @returns {Promise<string | null>}
 */
export async function nameOf (pk) {
  if (!pk) return null
  if (pk === myPubkey) return getMyName()
  const cached = nameCache.get(pk)
  if (cached !== undefined) return cached
  let n = null
  try {
    const id = await getIdentity()
    const peer = await id?.getPeer?.(pk)
    n = peer?.nickname || null
  } catch (_) { /* best-effort */ }
  nameCache.set(pk, n)
  return n
}

// --- adaptadores para createGeoClient ---
// El geo-client arma `data` y pide la firma. El vault devuelve el PAQUETE
// —{ signature, publickey, profileId, chain }— y hay que pasarlo ENTERO: sin
// `chain` el servidor no puede comprobar que este aparato habla por esta
// identidad, y con la verificación nueva rechaza el sobre.
/**
 * @param {string | object} data  un eco firma su forma canónica (texto); un pin, un objeto
 * @returns {Promise<{ signature: string, publickey: string } | null>}  null sin bóveda
 */
export async function signData (data) {
  const id = await getIdentity()
  if (!id) return null
  return id.signData(data)
}

/** @returns {Promise<string>} */
export async function getPublicKeyJwk () {
  if (!myPubkey) await initIdentity()
  // Sin identidad no hay con qué firmar un pin: se para y se dice, no se manda `null`.
  if (!myPubkey) throw Object.assign(new Error('identity not available'), { code: 'no-identity' })
  return myPubkey
}

// --- afinidad (señal de ranking, capa 2) ---
// afinidad(pk) ∈ [0,1]: cuánto interactuaste con el autor. Se calcula SÓLO en el
// cliente (el server nunca ve tu grafo). Combina: es contacto, rating que vos le
// diste, y un contador de interacciones que lleva el feedStore (reps/replies).
/** @type {{ v: Set<string> | null, exp: number }} */
const contactsCache = { v: null, exp: 0 }
const CONTACTS_MS = 60_000

/** @returns {Promise<Set<string>>} */
async function getContactPubkeys () {
  const now = Date.now()
  if (contactsCache.v && contactsCache.exp > now) return contactsCache.v
  const id = await getIdentity()
  /** @type {Set<string>} */
  let set = new Set()
  try {
    const list = (await id?.listContacts?.()) || []
    // Un contacto viejo puede venir como `{ pubkey }` o como la llave suelta.
    set = new Set(list.map((c) => /** @type {string} */ (c.publickey || /** @type {{ pubkey?: string }} */ (c).pubkey || c)).filter(Boolean))
  } catch (_) { /* sin contactos accesibles */ }
  contactsCache.v = set
  contactsCache.exp = now + CONTACTS_MS
  return set
}

/**
 * @param {string | null | undefined} pk
 * @returns {Promise<boolean>}
 */
export async function isContact (pk) {
  if (!pk) return false
  return (await getContactPubkeys()).has(pk)
}

/**
 * Afinidad subjetiva con un autor.
 * @param {string} pk pubkey
 * @param {number} interactions nº de interacciones locales (reps/replies dados)
 * @param {number} reactionNet net de likes(+1)/dislikes(-1) que le di
 * @returns {Promise<number>}
 */
export async function affinityOf (pk, interactions = 0, reactionNet = 0) {
  if (!pk) return 0
  if (pk === myPubkey) return 1
  let a = 0
  if (await isContact(pk)) a += 0.5
  try {
    const id = await getIdentity()
    const r = await id?.getRatingsForSubject?.(pk)
    if (r?.mine && typeof r.mine.rating === 'number') a += (r.mine.rating / 5) * 0.3
  } catch (_) { /* best-effort */ }
  // saturación suave por interacciones: 0..0.2
  a += 0.2 * (1 - Math.exp(-interactions / 3))
  // like/dislike: pequeño nudge por reacción, acotado a ±0.2
  a += Math.max(-0.2, Math.min(0.2, reactionNet * 0.05))
  return Math.max(0, Math.min(1, a))
}

// --- sellado extremo a extremo (CONVENCIONES §4.1) ---------------------------
//
// El proxio NO cifra: lo que se manda con `sendByPubkey` lo puede leer quien lo opere.
// Los eventos dirigidos (respuestas, re-ecos) llevan contenido del usuario y dicen
// quién le responde a quién, así que van sellados.
//
// La privada de cifrado vive en el VAULT, no aquí: la app no la toca. El puente lo pone
// el pilar (`identitySealing` de @dotrino/proxy-client, en proxy.js). Hasta 2026-11 había
// aquí una copia propia que pasaba los destinatarios como cadenas (la bóveda espera
// `{ encryptionPubkey }`, así que el sobre no envolvía a nadie) y hacía `JSON.parse` del
// `{ plaintext }` que devuelve `decrypt`: ninguna respuesta ni re-eco sellado se podía abrir.

/**
 * Mi pública de cifrado. Va en el beacon, firmada, para que puedan escribirme.
 * @returns {Promise<string | null>}
 */
export async function getEncryptionPubkey () {
  const id = await getIdentity()
  return id ? id.getEncryptionPubkey() : null
}
