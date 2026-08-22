// El resolvedor de imágenes de la app, cableado a la red: usa el MISMO cliente del
// proxio que ya tiene Eco (no se abre otro) y `fetchPublic` del pilar. Lo puro está
// en media.js; esto es solo el enchufe.

import { fetchPublic } from '@dotrino/content-client/public'
import { createMediaResolver } from './media.js'
import { getClient } from './proxy'

const resolver = createMediaResolver({
  fetchPublic: async ({ owner, cid }) => fetchPublic({ client: await getClient(), owner, cid })
})

export const resolveMedia = (media) => resolver.resolve(media)
export const peekMedia = (cid) => resolver.peek(cid)
export const invalidateMedia = (cid) => resolver.invalidate(cid)
export const setLocalMedia = (cid, bytes, mime) => resolver.setLocal(cid, bytes, mime)
