// Lo que FIRMA un eco. Es la lista cerrada de campos que el autor respalda: todo lo
// demás (distancia, quién lo reenvió, cuándo venció) lo añade quien lo lee.
//
// `media` está dentro: la imagen forma parte de lo que el autor dijo, y su `cid`
// es lo que hace que nadie pueda cambiarla por otra sin romper la firma. Para los
// ecos sin imagen no cambia nada: `undefined` no aparece en JSON, así que la
// firma de un eco viejo sigue cuadrando.

/** @param {any} eco */
export function canonical (eco) {
  return JSON.stringify({
    id: eco.id,
    author: eco.author,
    authorName: eco.authorName,
    text: eco.text,
    links: eco.links,
    tags: eco.tags,
    createdAt: eco.createdAt,
    repostOf: eco.repostOf,
    replyTo: eco.replyTo,
    quoted: eco.quoted,
    media: eco.media || undefined
  })
}

export default canonical
