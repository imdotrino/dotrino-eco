// El resolvedor de imágenes de la app, cableado a la red: usa el MISMO cliente del
// proxio que ya tiene Eco (no se abre otro) y `fetchPublic` del pilar. Lo puro está
// en media.js; esto es solo el enchufe.

import { fetchPublic } from '@dotrino/content-client/public'
import { createMediaResolver } from './media.js'
import { getClient } from './proxy'

const resolver = createMediaResolver({
  fetchPublic: async ({ owner, cid }) => fetchPublic({ client: await getClient(), owner, cid })
})

/** @param {{ owner: string, cid: string, mime?: string }} media */
export const resolveMedia = (media) => resolver.resolve(media)
/** @param {string} cid */
export const peekMedia = (cid) => resolver.peek(cid)
/** @param {string} cid */
export const invalidateMedia = (cid) => resolver.invalidate(cid)
/**
 * @param {string} cid
 * @param {Uint8Array} bytes
 * @param {string} mime
 */
export const setLocalMedia = (cid, bytes, mime) => resolver.setLocal(cid, bytes, mime)
