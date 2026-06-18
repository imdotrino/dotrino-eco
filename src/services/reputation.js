// Puente al registro de reputación compartido (reputation.dotrino.com).
// Reusa el web-of-trust local del vault para ponderar (anti-sybil). En Eco:
// (1) gate anti-spam en capa 1 (desconocido avalado → bandeja, no avalado →
// descartar) y (2) boost de orden en capa 2. NO inventamos score propio.

import { createVaultReputation } from '@dotrino/reputation'
import { getIdentity, getMyPubkey } from './identity'

let _rep = null
const cache = new Map() // pk → { v, exp }
const CACHE_MS = 30_000

async function getRep () {
  if (_rep) return _rep
  const id = await getIdentity()
  if (!id) return null
  try { _rep = createVaultReputation(id) } catch (_) { _rep = null }
  return _rep
}

/** Instancia compartida de reputación (para el provider de <dotrino-profile>). */
export async function getReputation () { return getRep() }

/** reputación(pk) ∈ [0,1] ponderada por mi web-of-trust. 0 si desconocido. */
export async function repOf (pk) {
  if (!pk) return 0
  const myPk = getMyPubkey()
  if (pk === myPk) return 1
  const now = Date.now()
  const c = cache.get(pk)
  if (c && c.exp > now) return c.v
  let v = 0
  try {
    const rep = await getRep()
    if (rep) {
      const r = await rep.reputationOf(pk)
      if (r && r.score != null) v = r.score
    }
  } catch (_) { /* best-effort */ }
  cache.set(pk, { v, exp: now + CACHE_MS })
  return v
}

/** Versión cacheada sincrónica para el render (hot path). */
export function repOfSync (pk) {
  if (!pk) return 0
  if (pk === getMyPubkey()) return 1
  return cache.get(pk)?.v ?? 0
}

/**
 * ¿Está avalado por mi red? Gate de capa 1 para desconocidos.
 * Avalado = score ≥ umbral. Default 0.15 (bajo: basta una atestación de tu red).
 */
export async function isEndorsed (pk, threshold = 0.15) {
  return (await repOf(pk)) >= threshold
}

export async function warmRep (pks) {
  await Promise.all([...new Set(pks)].filter(Boolean).map(repOf))
}
