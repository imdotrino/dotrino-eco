// Cliente del índice geo (geo.dotrino.com) — usa el paquete del ecosistema.
// El beacon (pin) lleva el eco más reciente del autor; uno por identidad con
// overwrite. Los lectores acumulan en su store local lo que ven vivo.

import { createGeoClient } from '@dotrino/geo'
import { signData, getPublicKeyJwk, getEncryptionPubkey } from './identity'

const TTL_24H = 24 * 60 * 60 * 1000

let geo = null

export function getGeo () {
  if (!geo) {
    geo = createGeoClient({ signData, getPublicKeyJwk })
    // baseUrl default = https://geo.dotrino.com
  }
  return geo
}

/**
 * Publica/rehidrata mi beacon con un eco. Overwrite del anterior.
 * @param {object} eco       el eco completo (va en payload)
 * @param {number} lat
 * @param {number} lng
 * @param {number} ttlMs     vida restante hasta expiresAt (cap del server)
 */
export async function publishEco (eco, lat, lng, ttlMs = TTL_24H) {
  const g = getGeo()
  // El payload se firma vía postMessage al vault (structured clone): aplanar a
  // objeto plano para no pasarle Proxies reactivos de Vue (DataCloneError).
  const payload = JSON.parse(JSON.stringify(eco))
  // Mi llave de cifrado va en el beacon, que está firmado: es lo que permite que me
  // respondan sin que el proxio lea la respuesta (CONVENCIONES §4.1). Es una clave
  // PÚBLICA; no revela nada. Si el vault no está, el beacon sigue siendo válido.
  try {
    const encPub = await getEncryptionPubkey()
    if (encPub) payload.encPub = encPub
  } catch { /* sin llave: quien responda verá que no se puede sellar */ }
  return g.publishPin({
    lat,
    lng,
    payload,
    tags: payload.tags || [],
    ttlMs
  })
}

/** Retira mi beacon (deja de descubrirse; mi copia local queda). */
export async function removeEco () {
  return getGeo().removePin()
}

/**
 * Descubre ecos en un radio. Devuelve los pins crudos del índice.
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @param {string[]} tags  filtro opcional (overlap)
 */
export async function discover (lat, lng, radiusMeters, tags = []) {
  const g = getGeo()
  const opts = { lat, lng, radiusMeters }
  if (tags.length) opts.tags = tags
  const { pins } = await g.queryRadius(opts)
  return pins || []
}
