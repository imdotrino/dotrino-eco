// Guardar ecos en el NODE DEL PROPIO USUARIO (pilar dotrino-content).
//
// Qué cambia esto en Eco, y hay que decirlo en voz alta porque toca su promesa:
// Eco es efímero —el beacon geo dura 24 h y lo demás es la copia local de quien lo
// guardó—. Guardar un eco en tu node añade **tu propia copia**, en tu máquina,
// alcanzable solo con la referencia. Eso no rompe la promesa, la vuelve honesta,
// PERO tiene que ser **opt-in por eco**: publicar creyendo que se borra solo y
// toparte el enlace vivo un año después es exactamente lo que no hacemos. Por eso
// aquí no se guarda nada por defecto y el interruptor es del usuario, eco a eco.
//
// El reparto con el store no es negociable (CONVENCIONES §4): en el **store** vive
// el índice —qué ecos archivé y con qué `cid`—, porque tiene que estar disponible
// aunque el node esté apagado; en el **content** viven los bytes del eco, que es
// un objeto firmado e INMUTABLE y por eso encaja exacto en el direccionado por
// hash. La línea de tiempo no es un blob: es una lista que crece.
//
// Si no hay node encendido, esto NO rompe nada: Eco sigue funcionando igual. Es la
// regla del ecosistema — ninguna app puede exigir un daemon encendido.

import { ContentClient, buildUrl, parseRef } from '@dotrino/content-client'
import { getIdentity } from './identity'

let client = null
let tried = false
let lastError = null

/** El enlace de este dispositivo a su bóveda, como lo arma el resto del ecosistema. */
async function vaultLink () {
  const id = await getIdentity()
  if (!id) return null
  const status = await id.vaultStatus().catch(() => ({ paired: false }))
  if (!status?.paired) return null
  if (status.exp && status.exp <= Date.now()) return null   // cert vencido = no autorizado
  const v = await id.getVaultCert().catch(() => null)
  if (!v?.cert) return null
  return { id, cert: v.cert, iss: status.master, proxy: status.proxy || 'wss://proxy.dotrino.com' }
}

/**
 * Conecta con un node del usuario. Devuelve null si no hay ninguno — que es lo
 * normal y no es un error: la mayoría de la gente no tiene uno, y Eco funciona
 * igual. Se intenta UNA vez por sesión para no castigar cada publicación con una
 * espera; `retry()` fuerza otro intento cuando el usuario acaba de encender uno.
 */
export async function getContent () {
  if (client) return client
  if (tried) return null
  tried = true
  try {
    const link = await vaultLink()
    if (!link) { lastError = 'sin bóveda enlazada'; return null }
    client = await ContentClient.connect({ link })
    lastError = null
    return client
  } catch (e) {
    lastError = e?.code === 'no-node' ? 'no-node' : (e?.message || 'no se pudo conectar')
    return null
  }
}

/** Vuelve a intentarlo (el usuario acaba de encender su node). */
export async function retry () {
  tried = false
  client = null
  return getContent()
}

/** ¿Hay node? Sin efectos: para pintar el interruptor sin provocar una conexión. */
export const hasNode = () => !!client
export const contentError = () => lastError

/**
 * Guarda un eco en el node de su autor y devuelve el puntero que va al store.
 *
 * Va **cifrado**: el eco es del usuario y el node solo tiene por qué guardar
 * bytes. La llave sale en la referencia y de ahí al `#fragment` del enlace, así
 * que ni el node ni ningún relay puede leerlo — y un sembrador ajeno podría
 * sostenerlo sin verlo.
 *
 * Se **retiene** (`pin`) a propósito: el usuario dijo "quiero que esto dure", y un
 * blob sin pin es candidato a que el GC lo desaloje cuando aprieta la cuota.
 *
 * @returns {Promise<{cid:string,key:string|null,owner:string,url:string}|null>}
 *   null si no hay node — el eco ya se publicó igual, esto solo no archivó.
 */
export async function archiveEco (eco) {
  const cc = await getContent()
  if (!cc) return null
  const bytes = new TextEncoder().encode(JSON.stringify(eco))
  const ref = await cc.put(bytes, { mime: 'application/json' })
  await cc.pin(ref.cid).catch(() => {})   // que el GC no se lleve lo que se pidió guardar
  return { ...ref, url: buildUrl(ref, location.origin + location.pathname) }
}

/**
 * Recupera un eco archivado a partir de su puntero (o de un fragmento).
 * `get()` ya comprueba que los bytes cuadren con el `cid`, así que lo que vuelve
 * es lo que se guardó o es un error — nunca algo parecido.
 */
export async function readEco (ref) {
  const cc = await getContent()
  if (!cc) return null
  const r = typeof ref === 'string' ? parseRef(ref) : ref
  if (!r) return null
  const bytes = await cc.get(r)
  return JSON.parse(new TextDecoder().decode(bytes))
}

/** Borra un eco archivado del node (el usuario cambia de opinión). */
export async function forgetEco (cid) {
  const cc = await getContent()
  if (!cc) return false
  await cc.remove(cid)
  return true
}

export { buildUrl, parseRef }
