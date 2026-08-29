// Lo PÚBLICO de un eco va al content (DISENO §16 del pilar): la imagen y una copia
// del eco en claro, para que quien lo lea —por el pin geo o por un enlace— pueda
// resolverlos por la red de Dotrino, o por la URL del bucket si el dueño tiene uno.
//
// Dos reglas que este archivo cumple y que no se negocian:
//
//  1. **El content es una EXTENSIÓN del store, nunca un requisito.** Sin node, el
//     eco se publica igual —solo texto, como siempre— y nada de aquí lanza hacia el
//     camino de publicar: todo devuelve null y dice por qué.
//  2. **Lo efímero sigue siendo efímero.** Lo público se guarda con el MISMO TTL
//     que el beacon (24 h): el content no alarga la vida de un eco por el hecho de
//     tener dónde guardarlo. Solo «guardar una copia» (opt-in por eco) lo retiene,
//     y eso lo hace el archivo cifrado de content.js, no esto.
//
// Puro a propósito: recibe el cliente del node (`cc`) y los bytes ya listos, así
// se prueba en Node sin navegador.

import { TTL_24H } from '../feed/constants.js'

/** Lo que cabe por el plano de control, menos margen para el base64 y el sobre. */
export const IMAGE_MAX_BYTES = 200 * 1024

/**
 * Sube la imagen de un eco como blob PÚBLICO y en claro, con la vida del beacon.
 * @param {{ cc: any, image: { bytes: Uint8Array, mime: string, width?: number, height?: number }|null, ttlMs?: number }} opts
 * @returns {Promise<{ owner: string, cid: string, mime: string, size: number, width?: number, height?: number }|null>}
 *   null si no hay node o no hay imagen. Si el node FALLA, lanza: quien publica decide
 *   si sale sin imagen, pero no puede enterarse por un null mudo.
 */
export async function attachImage ({ cc, image, ttlMs = TTL_24H }) {
  if (!cc || !image?.bytes?.length) return null
  if (!/^image\/(jpeg|png|gif|webp|avif)$/.test(image.mime || '')) {
    throw Object.assign(new Error('solo imágenes (JPEG, PNG, GIF, WebP o AVIF)'), { code: 'bad-image' })
  }
  if (image.bytes.length > IMAGE_MAX_BYTES) {
    throw Object.assign(new Error(`la imagen pesa ${Math.round(image.bytes.length / 1024)} KB y el máximo es ${IMAGE_MAX_BYTES / 1024} KB`), { code: 'too-large' })
  }
  const ref = await cc.put(image.bytes, { encrypt: false, acl: 'public', mime: image.mime, ttlMs })
  const out = { owner: ref.owner, cid: ref.cid, mime: image.mime, size: image.bytes.length }
  if (image.width) out.width = image.width
  if (image.height) out.height = image.height
  return out
}

/**
 * La copia PÚBLICA del eco (ya firmado) en el node: es lo que resuelve un enlace
 * `#owner/cid` en manos de otra persona. Misma vida que el beacon.
 *
 * El `meta` es lo ÚNICO que ve la tarjeta del permalink (`/p/<cid>`): la copia es
 * JSON y el puerto público solo sirve imágenes, así que ahí no puede leer el eco. De
 * ahí que vaya el texto entero —recortarlo a 200 dejaba tarjetas cortadas a mitad de
 * frase, y un eco son 280 caracteres como mucho— y los `links`, que es donde está la
 * fuente de la que habla. Y si el eco lleva imagen, se enlaza como MINIATURA: sin
 * eso la tarjeta cae al og.jpg de la app y enseña el logo en vez del eco.
 * @returns {Promise<{ owner: string, cid: string }|null>} null sin node
 */
export async function publishPublicCopy ({ cc, eco, ttlMs = TTL_24H }) {
  if (!cc || !eco?.id) return null
  const bytes = new TextEncoder().encode(JSON.stringify(eco))
  const ref = await cc.put(bytes, {
    encrypt: false,
    acl: 'public',
    mime: 'application/json',
    ttlMs,
    meta: {
      title: eco.authorName ? `@${eco.authorName}` : 'eco',
      description: String(eco.text || ''),
      links: Array.isArray(eco.links) ? eco.links : []
    }
  })
  const media = mediaOf(eco)
  // Que no se pueda enlazar la miniatura no vale perder la copia: la tarjeta sale
  // con la imagen de la app, que es lo que hacía siempre.
  if (media) { try { await cc.setThumbnail(ref.cid, media.cid) } catch (_) {} }
  return { owner: ref.owner, cid: ref.cid }
}

/**
 * Retener lo público de un eco (el usuario pidió «guardar una copia»): un blob
 * pineado no lo borra el GC ni por cuota ni por TTL.
 */
export async function pinPublic ({ cc, eco, ref }) {
  if (!cc) return false
  const cids = [eco?.media?.cid, ref?.cid].filter(Boolean)
  for (const cid of cids) await cc.pin(cid).catch(() => {})
  return cids.length > 0
}

/** Un eco recibido (por pin o por la red) con la imagen que dice tener, o null. */
export function mediaOf (eco) {
  const m = eco?.media
  if (!m || typeof m !== 'object') return null
  if (typeof m.owner !== 'string' || typeof m.cid !== 'string' || !/^sha256-[0-9a-f]{64}$/.test(m.cid)) return null
  return m
}

export default { attachImage, publishPublicCopy, pinPublic, mediaOf, IMAGE_MAX_BYTES }
