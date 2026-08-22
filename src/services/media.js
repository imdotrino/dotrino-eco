// Resolver la IMAGEN de un eco: de la referencia `{ owner, cid }` que viaja en el
// eco a algo que un `<img>` pueda cargar.
//
// El orden es el del pilar (DISENO §15.13 y §16): se le pregunta al node del dueño
// por la red; si contesta con URL (tiene bucket), esa URL es el atajo y se usa tal
// cual; si contesta con bytes, se envuelven en una URL de objeto local. Si no hay
// ningún node de ese dueño encendido, no hay imagen — y el eco se sigue viendo, con
// su texto, porque la imagen nunca fue condición de nada.
//
// Se recuerda por `cid` (inmutable: lo resuelto no caduca) y se junta lo concurrente
// (diez ecos del mismo autor no son diez consultas). Un fallo se recuerda un rato
// para no machacar la red con cada repintado, y se reintenta después.
//
// Puro: recibe `fetchPublic` y `makeObjectUrl` inyectados, así se prueba sin navegador.

const FAIL_TTL_MS = 60 * 1000

/**
 * @param {{
 *   fetchPublic: (ref: { owner: string, cid: string }) => Promise<{ url?: string|null, bytes?: Uint8Array|null, mime?: string }>,
 *   makeObjectUrl?: (bytes: Uint8Array, mime: string) => string,
 *   now?: () => number
 * }} deps
 */
export function createMediaResolver ({ fetchPublic, makeObjectUrl, now = () => Date.now() }) {
  if (typeof fetchPublic !== 'function') throw new Error('createMediaResolver: fetchPublic is required')
  const toUrl = makeObjectUrl || ((bytes, mime) => URL.createObjectURL(new Blob([/** @type {BlobPart} */ (bytes)], { type: mime })))
  /** cid → url resuelta */
  const urls = new Map()
  /** cid → promesa en vuelo */
  const inflight = new Map()
  /** cid → cuándo falló */
  const failed = new Map()

  async function resolveNow (media) {
    const r = await fetchPublic({ owner: media.owner, cid: media.cid })
    if (r?.url) return r.url
    if (r?.bytes?.length) return toUrl(r.bytes, r.mime || media.mime || 'application/octet-stream')
    throw Object.assign(new Error('the node answered without url or bytes'), { code: 'empty' })
  }

  return {
    /** Lo ya resuelto, sin provocar nada (para pintar sin esperar). */
    peek (cid) { return urls.get(cid) || null },

    /** Mis propias imágenes: ya tengo los bytes, no hay nada que pedir. */
    setLocal (cid, bytes, mime) {
      if (!urls.has(cid)) urls.set(cid, toUrl(bytes, mime))
      return urls.get(cid)
    },

    /**
     * @param {{ owner: string, cid: string, mime?: string }} media
     * @returns {Promise<string|null>} la URL para el `<img>`, o null si no se pudo
     */
    async resolve (media) {
      if (!media?.cid || !media?.owner) return null
      const hit = urls.get(media.cid)
      if (hit) return hit
      const when = failed.get(media.cid)
      if (when && now() - when < FAIL_TTL_MS) return null
      if (inflight.has(media.cid)) return inflight.get(media.cid)
      const p = resolveNow(media)
        .then((url) => { urls.set(media.cid, url); failed.delete(media.cid); return url })
        .catch(() => { failed.set(media.cid, now()); return null })
        .finally(() => inflight.delete(media.cid))
      inflight.set(media.cid, p)
      return p
    },

    /** La URL falló al cargar (bucket caído, borrada): se olvida para pedirla por la red. */
    invalidate (cid) { urls.delete(cid); failed.delete(cid) },

    /** Para las pruebas y para liberar `blob:` al salir. */
    size () { return urls.size }
  }
}

export default { createMediaResolver }
