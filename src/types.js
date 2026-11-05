/**
 * Las formas de datos de Eco, en un solo sitio (JSDoc; no exporta código).
 *
 * @typedef {object} Media  la imagen de un eco: un blob público en el node de su dueño
 * @property {string} owner
 * @property {string} cid
 * @property {string} mime
 * @property {number} size
 * @property {number} [width]
 * @property {number} [height]
 *
 * @typedef {object} EcoRefTo  a quién responde o qué re-eco (`author` + `id`)
 * @property {string} author
 * @property {string} id
 *
 * @typedef {EcoRefTo & { name: string | null, authorName: string | null, text: string }} ReplyTo
 *
 * @typedef {object} Quoted  la copia del original que va citada en un re-eco
 * @property {string} author
 * @property {string | null} name
 * @property {string | null} authorName
 * @property {string} text
 * @property {string[]} links
 * @property {string[]} tags
 * @property {number} createdAt
 *
 * @typedef {object} Eco
 * @property {string} id
 * @property {string} author  la identidad (`profileId`) de quien lo publicó
 * @property {string | null} authorName
 * @property {string} text
 * @property {string[]} links
 * @property {string[]} tags
 * @property {number} lat
 * @property {number} lng
 * @property {number} createdAt
 * @property {number} expiresAt
 * @property {EcoRefTo | null} repostOf
 * @property {ReplyTo | null} replyTo
 * @property {Quoted | null} quoted
 * @property {Media | null} [media]
 * @property {string | null} [sig]
 * @property {string} [signer]  la llave del aparato que firmó
 * @property {{ owner: string, cid: string }} [pub]  su copia pública en el node del autor
 * @property {string} [encPub]  la pública de cifrado del autor (viene en el beacon)
 * @property {number} [distanceMeters]  lo pone quien lo lee, no el autor
 *
 * @typedef {object} FeedCtx  las señales de un eco que no están en el eco
 * @property {string | null} [name]
 * @property {number} [affinity]
 * @property {number} [reputation]
 * @property {'like' | 'dislike' | null} [reaction]
 * @property {boolean} [keep]
 * @property {boolean} [opened]
 * @property {string[]} [myTags]
 * @property {number} [radiusMeters]
 * @property {boolean} [mine]
 *
 * @typedef {{ eco: Eco, ctx: FeedCtx, score: number }} FeedItem
 *
 * @typedef {object} ArchivedPtr  un eco guardado en mi node (el puntero vive en el store)
 * @property {string} [id]  el id de la entrada del store
 * @property {string} ecoId
 * @property {string} cid
 * @property {string | null} key
 * @property {string | null} owner
 * @property {number} [createdAt]
 *
 * @typedef {object} PublicRef  la copia pública de un eco mío en mi node
 * @property {string} [id]
 * @property {string} ecoId
 * @property {string} cid
 * @property {string} owner
 * @property {string | null} mediaCid
 * @property {number} expiresAt
 * @property {number} [createdAt]
 *
 * @typedef {'eco-reply' | 'eco-repost'} EcoEventType
 *
 * @typedef {object} InboxItem  un evento de alguien avalado por mi red, pendiente de aceptar
 * @property {string} from
 * @property {string | undefined} type
 * @property {Eco | null} eco
 * @property {string} [refId]
 * @property {number} ts
 *
 * @typedef {object} Notif  una respuesta o un re-eco a un eco mío
 * @property {string} id
 * @property {string | undefined} type
 * @property {string} from
 * @property {string | null} fromName
 * @property {string} preview
 * @property {string} [refId]
 * @property {string | null} ecoId
 * @property {number} ts
 * @property {boolean} read
 *
 * @typedef {object} ProxyEvent  un mensaje dirigido que llega por el proxio
 * @property {string} from  el token de quien lo manda
 * @property {{ app?: string, type?: string, refId?: string, eco?: Eco, author?: string } | null | undefined} payload
 * @property {string | null} fromPubkey
 *
 * @typedef {object} ImageInput  una imagen ya encogida para subirla (`shrinkImage`)
 * @property {Uint8Array} bytes
 * @property {string} mime
 * @property {number} [width]
 * @property {number} [height]
 */
export {}
