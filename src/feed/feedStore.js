// Orquestador de Eco. Compone identidad + geo + proxy + store + reputación.
// No reimplementa protocolo: cada servicio usa su paquete del ecosistema.
import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import {
  initIdentity, getMyPubkey, isReady, isContact, affinityOf, signData, nameOf, getMyName, setMyName
} from '../services/identity'
import { publishEco, removeEco, discover } from '../services/geo'
import { connect as proxyConnect, onMessage, sendEcoEvent } from '../services/proxy'
import { shouldNotifyType, ensurePushSubscribed } from '../services/notifications'
import {
  saveEco, saveMine, loadAllEcos, pushInbox, loadInbox, clearInbox, muteAuthor,
  saveArchived, loadArchived, removeArchived,
  savePublicRef, loadPublicRefs
} from '../services/store'
import {
  getContent, retry as retryContent, archiveEco, readEco, forgetEco, buildUrl, parseRef
} from '../services/content'
import { repOf, isEndorsed, warmRep } from '../services/reputation'
import { rankFeed, isAlive, survives, PRESETS } from './ranking'
import { canonical } from './canonical'
import { TTL_24H } from './constants'
import { attachImage, publishPublicCopy, pinPublic, mediaOf } from '../services/publicEco'
import { getClient as getProxyClient } from '../services/proxy'
import { setLocalMedia } from '../services/media-app'
import { fetchPublic } from '@dotrino/content-client/public'

const POLL_MS = 60_000
const RADII = [5000, 20000, 100000, 0] // 5km, 20km, 100km, global(0)

export const useFeed = defineStore('feed', {
  state: () => ({
    ready: false,
    standalone: false,        // vault inalcanzable: modo solo-lectura local
    myPubkey: null,
    myName: null,             // nick del vault (espejo reactivo)
    pos: null,                // { lat, lng }
    geoError: null,
    radiusMeters: 0,          // global por defecto
    preset: 'balanced',
    myTags: [],               // intereses para tags/discover
    posts: new Map(),         // id → eco (cache en memoria)
    feed: [],                 // [{ eco, ctx, score }]
    inbox: [],
    // Ecos abiertos por ENLACE en esta sesión. Un enlace se comparte precisamente para que
    // siga abriendo cuando el eco ya murió en la red —por eso su copia pública va pineada—,
    // así que el filtro de vivos no puede tragárselo: quien llega por el enlace vería la
    // app como si no hubiera pasado nada.
    opened: {},
    // Qué eco de los míos está AHORA en mi beacon. Geo guarda UN pin por identidad
    // (`ON CONFLICT (pubkey_id) DO UPDATE`, y es una decisión de privacidad: varios pins
    // por persona serían un rastro de por dónde anduvo), así que publicar cualquier otro
    // PISA este. Sin saber cuál es, rehidratar un eco viejo borraba el de hoy.
    myPinId: null,
    // --- archivo en el node propio (opt-in por eco, DISENO §3.2 de content) ---
    // Eco es efímero: el beacon dura 24 h y lo demás es tu copia local. Guardar un
    // eco en tu node añade TU propia copia, y por eso se pide eco a eco en vez de
    // hacerse por detrás — publicar creyendo que se borra solo y toparte el enlace
    // vivo un año después es justo lo que no hacemos.
    hasNode: false,           // ¿hay un content node mío en línea?
    nodeChecked: false,       // ya se miró (para no pintar el interruptor a ciegas)
    keepNext: false,          // el interruptor del composer, para el PRÓXIMO eco
    archived: [],             // punteros { ecoId, cid, key, owner } desde el store
    // --- lo PÚBLICO en el node (copia en claro + imagen, con la vida del beacon) ---
    // Es lo que hace que un enlace mío se abra en manos de otro y que mis imágenes se
    // vean: el índice vive en el store, los bytes en el node. Sin node no existe y
    // el eco sale solo con texto, como siempre.
    publicRefs: [],           // punteros { ecoId, cid, owner, mediaCid, expiresAt }
    nodeError: null,          // lo último que falló al guardar, para decirlo
    interactions: new Map(),  // authorPk → nº interacciones (afinidad)
    reactions: {},            // authorPk → net likes(+1)/dislikes(-1) (persistente)
    myReaction: {},           // ecoId → 'like' | 'dislike' (persistente, para el highlight)
    muted: {},                // authorPk → true (mute personal persistente)
    notifications: [],        // respuestas/re-ecos a MIS ecos (persistente)
    busy: false,
    locating: false,
    _poll: null,
    _ownerId: null,           // mi ownerId en el content (huella de la maestra), cacheado
    _off: null,
    _watch: null
  }),

  getters: {
    presets: () => PRESETS,
    radii: () => RADII,
    aliveCount: (s) => s.feed.length,
    hasNick: (s) => !!s.myName,
    mutedList: (s) => Object.keys(s.muted),
    allEcos: (s) => [...s.posts.values()],  // para armar hilos (incluye expirados que tengamos)
    unread: (s) => s.notifications.filter((n) => !n.read).length,
    /** ecoId → puntero, para saber de un vistazo cuáles están guardados. */
    archivedById: (s) => Object.fromEntries(s.archived.map((a) => [a.ecoId, a])),
    /** ecoId → puntero público vigente (los vencidos ya no sirven para enlazar). */
    publicById: (s) => Object.fromEntries(s.publicRefs.filter((p) => !p.expiresAt || p.expiresAt > Date.now()).map((p) => [p.ecoId, p]))
  },

  actions: {
    async init () {
      this._loadPrefs()   // radio/orden/intereses persistidos (prefs de UI)
      await initIdentity()
      this.myPubkey = getMyPubkey()
      this.myName = getMyName()
      this.standalone = !isReady()
      // cargar archivo local primero (funciona aunque no haya red)
      for (const eco of await loadAllEcos()) this.posts.set(eco.id, eco)
      this.inbox = await loadInbox()
      // El índice de lo archivado sale del STORE, así que está aunque el node esté
      // apagado: se ve qué guardaste sin depender de que la máquina esté encendida.
      this.archived = (await loadArchived()).filter((a) => a?.cid)
      this.publicRefs = (await loadPublicRefs()).filter((p) => p?.cid)
      if (!this.standalone) {
        await proxyConnect()
        this._off = onMessage((m) => this._onProxy(m))
        // Re-registra la push subscription si el usuario optó (paquete compartido).
        ensurePushSubscribed().catch(() => {})
      }
      await this.rebuild()   // muestra el archivo local enseguida
      this.ready = true
      this.locate()          // NO bloquea: al primer fix arranca el descubrimiento
      this.checkNode()       // tampoco bloquea: Eco funciona igual sin node
    },

    // Ubicación robusta: getCurrentPosition para el caso inmediato + watchPosition,
    // que entrega la posición en cuanto el permiso pasa a "concedido" — así no hay
    // que refrescar la página tras aceptar el prompt.
    locate () {
      if (!('geolocation' in navigator)) { this.geoError = 'sin geolocalización en este navegador'; return }
      this.locating = true
      const onPos = (p) => {
        const first = !this.pos
        this.pos = { lat: p.coords.latitude, lng: p.coords.longitude }
        this.geoError = null
        this.locating = false
        if (first) this.startPolling()   // dispara discoverNow dentro
        else this.discoverNow()
      }
      const onErr = (e) => {
        this.locating = false
        if (!this.pos) this.geoError = e.code === 1 ? 'permiso de ubicación denegado' : (e.message || 'ubicación no disponible')
      }
      navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 })
      // watch SIN timeout: queda a la espera y entrega en cuanto se concede el permiso.
      if (this._watch == null) {
        this._watch = navigator.geolocation.watchPosition(onPos, () => {}, { enableHighAccuracy: false, maximumAge: 30000 })
      }
    },

    async setMyName (name) {
      const ok = await setMyName(name)
      if (ok) { this.myName = getMyName(); await this.rebuild() }
      return ok
    },

    setRadius (m) { this.radiusMeters = m; this._savePrefs(); this.discoverNow() },
    setPreset (p) { this.preset = p; this._savePrefs(); this.rebuild() },

    // --- Intereses (temas que suben en tu orden) ---
    // Se aprenden solos (al publicar/repostear/responder) y se gestionan en el
    // panel aparte. El buscador también los genera. Cap 40, más recientes primero.
    addInterest (tag) {
      const t = String(tag || '').trim().toLowerCase().replace(/^#/, '')
      if (!t) return
      this.myTags = [t, ...this.myTags.filter((x) => x !== t)].slice(0, 40)
      this._savePrefs(); this.rebuild()
    },
    removeInterest (tag) {
      this.myTags = this.myTags.filter((x) => x !== tag)
      this._savePrefs(); this.rebuild()
    },
    _learn (tags) {
      if (!tags || !tags.length) return
      const norm = tags.map((t) => String(t).trim().toLowerCase().replace(/^#/, '')).filter(Boolean)
      if (!norm.length) return
      this.myTags = [...new Set([...norm, ...this.myTags])].slice(0, 40)
      this._savePrefs(); this.rebuild()
    },

    // Preferencias de UI persistentes (localStorage; NO contenido del usuario).
    _loadPrefs () {
      try {
        const p = JSON.parse(localStorage.getItem('eco:prefs') || '{}')
        if (RADII.includes(p.radius)) this.radiusMeters = p.radius
        if (PRESETS[p.preset]) this.preset = p.preset
        if (Array.isArray(p.tags)) this.myTags = p.tags
        if (p.reactions && typeof p.reactions === 'object') this.reactions = p.reactions
        if (p.myReaction && typeof p.myReaction === 'object') this.myReaction = p.myReaction
        if (p.muted && typeof p.muted === 'object') this.muted = p.muted
        if (typeof p.myPinId === 'string') this.myPinId = p.myPinId
        if (Array.isArray(p.notifications)) this.notifications = p.notifications
      } catch (_) { /* prefs corruptas → defaults */ }
    },
    _savePrefs () {
      try {
        localStorage.setItem('eco:prefs', JSON.stringify({
          radius: this.radiusMeters, preset: this.preset, tags: this.myTags,
          reactions: this.reactions, myReaction: this.myReaction, muted: this.muted,
          myPinId: this.myPinId,
          notifications: this.notifications.slice(0, 50)
        }))
      } catch (_) { /* sin localStorage */ }
    },

    startPolling () {
      if (this._poll || this.standalone) return
      this.discoverNow()
      this._poll = setInterval(() => this.discoverNow(), POLL_MS)
    },
    stopPolling () { if (this._poll) { clearInterval(this._poll); this._poll = null } },

    // --- Publicar ---
    // Solo se introduce texto (enlaces y tags se extraen del propio texto).
    // context opcional: { mode:'reply'|'reeco', target } — reply crea un eco
    // HERMANO (replyTo) y re-eco crea un eco que CITA al original (repostOf+quoted).
    async publish ({ text, context = null, keep = null, image = null }) {
      if (this.standalone || !this.pos) { this.geoError = 'necesitas bóveda y ubicación para publicar'; return null }
      this.busy = true
      try {
        const now = Date.now()
        const body = String(text || '').slice(0, 280)
        // La IMAGEN va al node ANTES de firmar: su `cid` forma parte de lo firmado.
        // Sin node no hay imagen y se dice; si el node falla, el eco sale sin ella y
        // también se dice — nunca se deja de publicar por la imagen.
        let media = null
        if (image) {
          const cc = await getContent()
          if (!cc) {
            this.nodeError = 'no tienes ninguna máquina tuya encendida: el eco sale sin la imagen'
          } else {
            try {
              media = await attachImage({ cc, image, ttlMs: TTL_24H })
              if (media) setLocalMedia(media.cid, image.bytes, media.mime)
            } catch (e) {
              this.nodeError = `no se pudo subir la imagen (${e.message}): el eco sale sin ella`
            }
          }
        }
        const eco = {
          id: uuidv4(),
          author: this.myPubkey,
          authorName: this.myName,   // self-nick: viaja firmado con el eco
          text: body,
          links: extractLinks(body),
          tags: extractTags(body),
          lat: this.pos.lat, lng: this.pos.lng,
          createdAt: now,
          expiresAt: now + TTL_24H,
          repostOf: null, replyTo: null, quoted: null,
          media
        }
        const target = context?.target
        if (context?.mode === 'reply' && target) {
          eco.replyTo = { author: target.author, id: target.id, name: await nameOf(target.author), authorName: target.authorName, text: target.text }
        } else if (context?.mode === 'reeco' && target) {
          eco.repostOf = { author: target.author, id: target.id }
          eco.quoted = { // copia interna del original para mostrarlo citado
            author: target.author, name: await nameOf(target.author), authorName: target.authorName,
            text: target.text, links: target.links || [], tags: target.tags || [], createdAt: target.createdAt
          }
        }
        eco.sig = (await signData(canonical(eco))) || null
        // La COPIA PÚBLICA en mi node (si lo hay): es lo que abre mi enlace en manos de
        // otro, con la vida del beacon. Va ANTES del beacon para que el beacon lleve la
        // referencia (`pub`, fuera de lo firmado: el cid es el hash del eco ya firmado) y
        // quien lo vea pueda compartir ESTE eco. Si no hay node, no existe y no pasa nada;
        // si falla, se dice y el eco sale igual, solo sin enlace propio.
        try {
          const cc = await getContent()
          const ref = await publishPublicCopy({ cc, eco, ttlMs: TTL_24H })
          if (ref) {
            eco.pub = { owner: ref.owner, cid: ref.cid }
            const entry = await savePublicRef({ ecoId: eco.id, cid: ref.cid, owner: ref.owner, mediaCid: media?.cid || null, expiresAt: eco.expiresAt })
            this.publicRefs = [{ ...entry, ecoId: eco.id, cid: ref.cid, owner: ref.owner, mediaCid: media?.cid || null, expiresAt: eco.expiresAt }, ...this.publicRefs]
            if (keep ?? this.keepNext) await pinPublic({ cc, eco, ref })
          }
        } catch (e) {
          this.nodeError = `el eco sale, pero sin copia pública (${e.message})`
        }
        await saveMine(eco)
        this.posts.set(eco.id, eco)
        this._learn(eco.tags)
        if (target) { this._learn(target.tags); this._bumpAffinity(target.author) }
        await publishEco(eco, this.pos.lat, this.pos.lng, TTL_24H)
        this.myPinId = eco.id   // el beacon es único: este acaba de ocupar el sitio
        this._savePrefs()
        // avisar al original por proxy → rehidrata su beacon y le notifica.
        // Mandamos el eco (plano) para que pueda mostrar preview e ingerirlo
        // aunque no lo descubra por geo (entrega directa al destinatario).
        if (target && target.author !== this.myPubkey) {
          const plainEco = JSON.parse(JSON.stringify(eco))
          try { await sendEcoEvent(target.author, target.encPub, { type: context.mode === 'reply' ? 'eco-reply' : 'eco-repost', refId: target.id, eco: plainEco }) } catch (_) {}
        }
        // ARCHIVAR en mi node, si el usuario lo pidió para ESTE eco. Va después de
        // publicar y nunca antes: que tu node esté apagado no puede impedir que
        // publiques. Y si falla, se dice — un "guardado" que no guardó es peor que
        // no ofrecerlo.
        if (keep ?? this.keepNext) {
          try {
            const ref = await archiveEco(eco)
            if (ref) {
              const entry = await saveArchived({ ecoId: eco.id, cid: ref.cid, key: ref.key, owner: ref.owner })
              this.archived = [{ ...entry, ecoId: eco.id, cid: ref.cid, key: ref.key, owner: ref.owner }, ...this.archived]
            } else {
              this.nodeError = 'no hay ningún node tuyo encendido: el eco se publicó, pero no se guardó'
            }
          } catch (e) {
            this.nodeError = `el eco se publicó, pero no se pudo guardar en tu máquina (${e.message})`
          }
        }
        await this.rebuild()
        return eco
      } finally { this.busy = false }
    },

    // --- Archivo en el node propio ---

    /**
     * ¿Tengo un content node en línea? Sin bloquear nada: Eco funciona igual sin
     * él, y esto solo decide si se ofrece el interruptor de guardar.
     */
    async checkNode () {
      try { this.hasNode = !!(await getContent()) } catch (_) { this.hasNode = false }
      this.nodeChecked = true
      return this.hasNode
    },

    /** Otro intento (el usuario acaba de encender su node). */
    async retryNode () {
      this.nodeChecked = false
      try { this.hasNode = !!(await retryContent()) } finally { this.nodeChecked = true }
      return this.hasNode
    },

    /** El interruptor del composer: se decide eco a eco y no se recuerda. */
    setKeepNext (on) { this.keepNext = !!on },

    /** Guardar en mi node un eco YA publicado (me arrepentí al revés). */
    async keepEco (eco) {
      if (!eco || eco.author !== this.myPubkey) return false
      if (this.archivedById[eco.id]) return true
      try {
        const ref = await archiveEco(eco)
        if (!ref) { this.nodeError = 'no hay ningún node tuyo encendido'; return false }
        const entry = await saveArchived({ ecoId: eco.id, cid: ref.cid, key: ref.key, owner: ref.owner })
        this.archived = [{ ...entry, ecoId: eco.id, cid: ref.cid, key: ref.key, owner: ref.owner }, ...this.archived]
        return true
      } catch (e) {
        this.nodeError = e.message
        return false
      }
    },

    /**
     * Dejar de guardarlo: borra los bytes del node Y el puntero del store. Las dos
     * cosas, porque un puntero a algo que ya no está es una promesa rota, y unos
     * bytes sin puntero son basura que ocupa cuota.
     */
    async unkeepEco (ecoId) {
      const ptr = this.archivedById[ecoId]
      if (!ptr) return false
      try { await forgetEco(ptr.cid) } catch (_) { /* si el node no está, al menos suelto el puntero */ }
      await removeArchived(ptr.id)
      this.archived = this.archived.filter((a) => a.ecoId !== ecoId)
      return true
    },

    /**
     * Abrir un eco desde el `#fragment` de un enlace (`#<dueño>/<cid>/<llave>`).
     *
     * Hoy esto solo resuelve **lo tuyo**: leer los bytes exige sesión con un
     * aparato de tu misma acta, así que un enlace de otra persona todavía no se
     * puede abrir aquí — llegará con el transporte entre aparatos. Devuelve null
     * sin ruido en todos los demás casos, porque el fragmento se usa para muchas
     * cosas y la mayoría no son referencias.
     */
    async openRef (fragment) {
      const r = parseRef(fragment ?? location.hash)
      if (!r) return null
      try {
        // Con llave es una copia CIFRADA: solo la abre un aparato de su dueño (la mía).
        // Sin llave es una copia PÚBLICA: se le pide al node del dueño por la red,
        // sea quien sea — si está encendido. Lo mío se intenta primero en mi node.
        let eco = null
        if (r.key || (this.myPubkey && r.owner === (await this.myOwnerId()))) {
          eco = await readEco(r).catch((e) => { if (r.key) throw e; return null })
        }
        if (!eco) eco = await this.readPublic(r)
        if (!eco?.id) return null
        this.posts.set(eco.id, eco)
        this.opened[eco.id] = true
        await this.rebuild()
        return eco
      } catch (e) {
        this.nodeError = e?.code === 'no-node'
          ? 'la máquina de esa persona no está encendida ahora mismo: inténtalo más tarde'
          : `no se pudo abrir ese enlace (${e.message})`
        return null
      }
    },

    /** Mi `ownerId` (la huella de mi maestra), tal como lo usa el content. */
    async myOwnerId () {
      if (this._ownerId) return this._ownerId
      const cc = await getContent()
      this._ownerId = cc?.owner || null
      return this._ownerId
    },

    /**
     * Leer la copia pública de un eco por la red de Dotrino: el node del dueño
     * contesta solo lo marcado público, y los bytes vuelven verificados por el cid.
     * @param {{ owner: string, cid: string }} r
     */
    async readPublic (r) {
      const client = await getProxyClient()
      const res = await fetchPublic({ client, owner: r.owner, cid: r.cid, full: true })
      let bytes = res.bytes
      if (!bytes && res.url) bytes = new Uint8Array(await (await fetch(res.url)).arrayBuffer())
      if (!bytes) throw Object.assign(new Error('sin contenido'), { code: 'empty' })
      const eco = JSON.parse(new TextDecoder().decode(bytes))
      if (!eco?.id || !eco.author) throw Object.assign(new Error('eso no es un eco'), { code: 'bad-eco' })
      if (eco.media && !mediaOf(eco)) eco.media = null
      return eco
    },

    /** El enlace compartible de un eco archivado (la referencia va en el #fragment). */
    linkFor (ecoId) {
      // La copia cifrada (guardada) tiene prioridad: dura. Si no, la pública mientras viva.
      // Y para un eco AJENO, la referencia que su autor puso en el beacon (`pub`).
      const ptr = this.archivedById[ecoId] || this.publicById[ecoId] || this.posts.get(ecoId)?.pub
      return ptr?.cid && ptr?.owner ? buildUrl(ptr, location.origin + location.pathname) : null
    },

    // --- Descubrir (poll geo) ---
    async discoverNow () {
      if (this.standalone || !this.pos) return
      try {
        // Sin filtro duro por tags: siempre ves tu zona (capa 1). Los intereses
        // solo afectan el ORDEN (señal tags, capa 2), no qué te llega.
        // radio 0 = global → radio que cubre la Tierra.
        const r = this.radiusMeters || 20_000_000
        const pins = await discover(this.pos.lat, this.pos.lng, r)
        let changed = false
        const seenAuthors = []
        for (const pin of pins) {
          const eco = pinToEco(pin)
          if (!eco) continue
          if (this.muted[eco.author]) continue // silenciado: no entra
          seenAuthors.push(eco.author)
          if (this.posts.has(eco.id)) continue
          this.posts.set(eco.id, eco)
          await saveEco(eco)
          changed = true
        }
        await warmRep(seenAuthors)
        if (changed) await this.rebuild()
      } catch (e) { console.warn('[feed] discover failed', e.message) }
    },

    // --- Reconstruir el feed rankeado (capa 2) ---
    async rebuild () {
      const now = Date.now()
      // Un eco al que diste 👍 se conserva aunque haya expirado. El 👎 no: baja la
      // afinidad y lo deja morir a su hora (fijarlo era justo lo contrario de lo pedido).
      const kept = (e) => survives(e, { now, liked: this.myReaction[e.id] === 'like', opened: this.opened[e.id] })
      const others = [...this.posts.values()].filter((e) => kept(e) && e.author !== this.myPubkey && !this.muted[e.author])
      const mine = [...this.posts.values()].filter((e) => e.author === this.myPubkey && survives(e, { now, opened: this.opened[e.id] }))
      // enriquecer con señales de ctx
      const items = await Promise.all(others.map(async (eco) => ({
        eco,
        ctx: {
          name: await nameOf(eco.author),
          affinity: await affinityOf(eco.author, this.interactions.get(eco.author) || 0, this.reactions[eco.author] || 0),
          reputation: await repOf(eco.author),
          reaction: this.myReaction[eco.id] || null,
          keep: this.myReaction[eco.id] === 'like',
          opened: !!this.opened[eco.id],
          myTags: this.myTags,
          radiusMeters: this.radiusMeters
        }
      })))
      const ranked = rankFeed(items, this.preset, now)
      // mis ecos vivos van arriba como "tuyos", fuera del ranking
      this.feed = [
        ...mine.sort((a, b) => b.createdAt - a.createdAt).map((eco) => ({ eco, ctx: { mine: true, name: this.myName }, score: Infinity })),
        ...ranked
      ]
    },

    // Reply y re-eco se publican vía publish({ text, context }) desde el composer.
    _bumpAffinity (pk) { this.interactions.set(pk, (this.interactions.get(pk) || 0) + 1) },

    // --- Like / Dislike ---
    // Nudgean la afinidad con el autor (±). Y el LIKE además persiste el eco en
    // tu archivo local: sobrevive a la muerte de la red como copia tuya.
    async react (eco, type) { // type: 'like' | 'dislike'
      const id = eco.id, author = eco.author
      if (!author || author === this.myPubkey) return
      const prev = this.myReaction[id]
      if (prev === 'like') this._addReaction(author, -1)
      else if (prev === 'dislike') this._addReaction(author, +1)
      if (prev === type) {
        delete this.myReaction[id]          // toggle off
      } else {
        this.myReaction[id] = type
        this._addReaction(author, type === 'like' ? 1 : -1)
        // Solo el 👍 se queda una copia: es «esto lo quiero conservar». El 👎 dice lo
        // contrario, y guardarlo era fijarlo en el feed para siempre.
        if (type === 'like') await saveEco({ ...eco })
      }
      this._savePrefs()
      await this.rebuild()
    },
    _addReaction (pk, d) { this.reactions[pk] = (this.reactions[pk] || 0) + d },

    // --- Entrada por proxy (eventos dirigidos de otros) ---
    async _onProxy (msg) {
      const p = msg?.payload
      if (!p || p.app !== 'eco') return
      const from = msg.fromPubkey || p.author
      const type = p.type
      const incoming = p.eco
      const aboutMyEco = p.refId && this.posts.get(p.refId)?.author === this.myPubkey

      // ¿tocaron el eco que tengo EN EL BEACON? → lo rehidrato (resetea TTL).
      //
      // Solo ese. El pin es UNO por identidad y publicar otro lo pisa, así que rehidratar
      // un eco mío más antiguo era republicarlo BORRANDO el de hoy: alguien respondía a
      // algo de la semana pasada y mi eco de esta mañana desaparecía del radio de todos,
      // sin que yo tocara nada. Un eco que ya no está en mi pin no vuelve por una
      // reacción: quien quiera traerlo lo re-eco, que es un eco suyo citando el mío
      // (`repostOf` + `quoted`) y gasta SU beacon, no el mío.
      if ((type === 'eco-reply' || type === 'eco-repost') && aboutMyEco && p.refId === this.myPinId) {
        const mineEco = this.posts.get(p.refId)
        mineEco.expiresAt = Date.now() + TTL_24H
        if (this.pos) await publishEco(mineEco, this.pos.lat, this.pos.lng, TTL_24H)
      }

      // Gate del remitente. Si me responde a MÍ, siempre pasa (me está hablando);
      // contacto pasa; avalado → bandeja; desconocido → descarto.
      let allow = aboutMyEco
      if (!allow && from && from !== this.myPubkey) {
        if (await isContact(from)) allow = true
        else if (await isEndorsed(from)) {
          await pushInbox({ from, type, eco: incoming || null, refId: p.refId, ts: Date.now() })
          this.inbox = await loadInbox()
          return
        } else return
      }

      // Ingerir el eco entrante (la respuesta/re-eco en sí), aunque no llegue por geo.
      if (incoming && incoming.id && incoming.author && incoming.author !== this.myPubkey && !this.muted[incoming.author]) {
        if (!this.posts.has(incoming.id)) { this.posts.set(incoming.id, incoming); await saveEco(incoming) }
      }

      // Notificación si fue sobre un eco mío.
      if (aboutMyEco && from && from !== this.myPubkey) {
        this._notify({ type, from, fromName: incoming?.authorName || null, preview: incoming?.text || '', refId: p.refId, ecoId: incoming?.id || null })
      }
      await this.rebuild()
    },

    _notify (n) {
      if (!shouldNotifyType(n.type)) return   // pref por tipo (paquete compartido)
      const id = (n.ecoId || n.refId || '') + ':' + n.type
      if (this.notifications.some((x) => x.id === id)) return
      this.notifications = [{ ...n, id, ts: Date.now(), read: false }, ...this.notifications].slice(0, 50)
      this._savePrefs()
    },
    markNotifsRead () { this.notifications = this.notifications.map((n) => ({ ...n, read: true })); this._savePrefs() },
    clearNotifs () { this.notifications = []; this._savePrefs() },

    async acceptInbox () {
      // aceptar la bandeja entera: ya están guardados; sólo limpiamos el flag
      await clearInbox(); this.inbox = []
      await this.rebuild()
    },
    async dismissInbox () { await clearInbox(); this.inbox = [] },

    // Borrar un eco propio: lo saco del feed local y retiro mi beacon del índice
    // geo (deja de descubrirse). El archivo local append-only puede conservarlo.
    async deleteMine (eco) {
      this.posts.delete(eco.id)
      try { await removeEco() } catch (_) {}
      // El beacon queda vacío: si no, una reacción tardía rehidrataría un eco retirado.
      if (this.myPinId === eco.id) { this.myPinId = null; this._savePrefs() }
      await this.rebuild()
    },

    // Mute PERSONAL y persistente (no es un ban global): oculta a ese autor de TU
    // feed y no vuelve a entrar por el sondeo de geo hasta que lo quites.
    async mute (pk) {
      if (!pk) return
      this.muted = { ...this.muted, [pk]: true }
      await muteAuthor(pk)
      for (const [id, eco] of this.posts) if (eco.author === pk) this.posts.delete(id)
      this._savePrefs()
      await this.rebuild()
    },
    async unmute (pk) {
      const m = { ...this.muted }; delete m[pk]; this.muted = m
      this._savePrefs()
      await this.discoverNow() // vuelve a poder descubrir sus ecos
    },

    async unpublishMine () { try { await removeEco() } catch (_) {} },

    dispose () {
      this.stopPolling()
      if (this._off) this._off()
      if (this._watch != null) { navigator.geolocation.clearWatch(this._watch); this._watch = null }
    }
  }
})

// --- helpers ---
// Enlaces: URLs http/https Y dominios desnudos (dotrino.com, eco.dotrino.com/x).
// Exige al menos un punto y un TLD de 2+ letras (no agarra "v1.2" ni "#tag").
const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>()]*)?)/gi
// Extensiones de archivo que NO son dominios (evita linkificar "index.html").
const FILE_EXT = new Set(['html', 'htm', 'js', 'mjs', 'css', 'json', 'md', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'zip', 'xml', 'yml', 'yaml', 'ts', 'vue'])
function extractLinks (text) {
  const out = []
  let m
  while ((m = URL_RE.exec(String(text))) !== null) {
    let u = m[1].replace(/[.,;:!?)]+$/, '')           // quita puntuación de cierre
    const hadScheme = /^https?:\/\//i.test(u)
    if (!hadScheme) {
      const tld = u.split('/')[0].split('.').pop().toLowerCase()
      if (FILE_EXT.has(tld)) continue                 // "index.html" no es un link
      u = 'https://' + u                              // dominio desnudo → https
    }
    out.push(u)
  }
  return [...new Set(out)].slice(0, 4)
}

// Tags: #hashtag (letras/números/_ unicode), normalizados sin '#'.
const TAG_RE = /(?:^|[\s(])#([\p{L}\p{N}_]{1,30})/gu
function extractTags (text) {
  const tags = []
  let m
  while ((m = TAG_RE.exec(String(text))) !== null) tags.push(m[1])
  return [...new Set(tags.map((t) => t.toLowerCase()))].slice(0, 6)
}

// Serialización canónica mínima para firmar (orden estable de claves de contenido).

// El payload del pin geo ES el eco; el server ya verificó la firma del sobre,
// así que el author autoritativo es el pubkey del pin.
function pinToEco (pin) {
  const e = pin.payload
  if (!e || !e.id || !e.text) return null
  return {
    ...e,
    author: pin.publickey || e.author,
    media: mediaOf(e),
    lat: pin.lat ?? e.lat, lng: pin.lng ?? e.lng,
    distanceMeters: pin.distanceMeters,
    expiresAt: e.expiresAt || (pin.expiresAt ? new Date(pin.expiresAt).getTime() : (e.createdAt + TTL_24H))
  }
}
