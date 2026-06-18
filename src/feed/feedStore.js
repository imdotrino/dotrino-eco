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
  saveEco, saveMine, loadAllEcos, pushInbox, loadInbox, clearInbox, muteAuthor
} from '../services/store'
import { repOf, isEndorsed, warmRep } from '../services/reputation'
import { rankFeed, isAlive, PRESETS } from './ranking'

const TTL_24H = 24 * 60 * 60 * 1000
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
    interactions: new Map(),  // authorPk → nº interacciones (afinidad)
    reactions: {},            // authorPk → net likes(+1)/dislikes(-1) (persistente)
    myReaction: {},           // ecoId → 'like' | 'dislike' (persistente, para el highlight)
    muted: {},                // authorPk → true (mute personal persistente)
    notifications: [],        // respuestas/re-ecos a MIS ecos (persistente)
    busy: false,
    locating: false,
    _poll: null,
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
    unread: (s) => s.notifications.filter((n) => !n.read).length
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
      if (!this.standalone) {
        await proxyConnect()
        this._off = onMessage((m) => this._onProxy(m))
        // Re-registra la push subscription si el usuario optó (paquete compartido).
        ensurePushSubscribed().catch(() => {})
      }
      await this.rebuild()   // muestra el archivo local enseguida
      this.ready = true
      this.locate()          // NO bloquea: al primer fix arranca el descubrimiento
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
        if (Array.isArray(p.notifications)) this.notifications = p.notifications
      } catch (_) { /* prefs corruptas → defaults */ }
    },
    _savePrefs () {
      try {
        localStorage.setItem('eco:prefs', JSON.stringify({
          radius: this.radiusMeters, preset: this.preset, tags: this.myTags,
          reactions: this.reactions, myReaction: this.myReaction, muted: this.muted,
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
    async publish ({ text, context = null }) {
      if (this.standalone || !this.pos) { this.geoError = 'necesitás vault y ubicación para publicar'; return null }
      this.busy = true
      try {
        const now = Date.now()
        const body = String(text || '').slice(0, 280)
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
          repostOf: null, replyTo: null, quoted: null
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
        await saveMine(eco)
        this.posts.set(eco.id, eco)
        this._learn(eco.tags)
        if (target) { this._learn(target.tags); this._bumpAffinity(target.author) }
        await publishEco(eco, this.pos.lat, this.pos.lng, TTL_24H)
        // avisar al original por proxy → rehidrata su beacon y le notifica.
        // Mandamos el eco (plano) para que pueda mostrar preview e ingerirlo
        // aunque no lo descubra por geo (entrega directa al destinatario).
        if (target && target.author !== this.myPubkey) {
          const plainEco = JSON.parse(JSON.stringify(eco))
          try { await sendEcoEvent(target.author, { type: context.mode === 'reply' ? 'eco-reply' : 'eco-repost', refId: target.id, eco: plainEco }) } catch (_) {}
        }
        await this.rebuild()
        return eco
      } finally { this.busy = false }
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
      } catch (e) { console.warn('[feed] discover falló', e.message) }
    },

    // --- Reconstruir el feed rankeado (capa 2) ---
    async rebuild () {
      const now = Date.now()
      // Un eco reaccionado (like/dislike) se conserva aunque haya expirado.
      const kept = (e) => isAlive(e, now) || !!this.myReaction[e.id]
      const others = [...this.posts.values()].filter((e) => kept(e) && e.author !== this.myPubkey && !this.muted[e.author])
      const mine = [...this.posts.values()].filter((e) => e.author === this.myPubkey && isAlive(e, now))
      // enriquecer con señales de ctx
      const items = await Promise.all(others.map(async (eco) => ({
        eco,
        ctx: {
          name: await nameOf(eco.author),
          affinity: await affinityOf(eco.author, this.interactions.get(eco.author) || 0, this.reactions[eco.author] || 0),
          reputation: await repOf(eco.author),
          reaction: this.myReaction[eco.id] || null,
          keep: !!this.myReaction[eco.id],
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
        await saveEco({ ...eco })           // like o dislike: persistir en local
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

      // ¿tocaron un eco mío? → rehidrato mi beacon (resetea TTL)
      if ((type === 'eco-reply' || type === 'eco-repost') && aboutMyEco) {
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
function canonical (eco) {
  return JSON.stringify({
    id: eco.id, author: eco.author, authorName: eco.authorName, text: eco.text, links: eco.links,
    tags: eco.tags, createdAt: eco.createdAt, repostOf: eco.repostOf, replyTo: eco.replyTo, quoted: eco.quoted
  })
}

// El payload del pin geo ES el eco; el server ya verificó la firma del sobre,
// así que el author autoritativo es el pubkey del pin.
function pinToEco (pin) {
  const e = pin.payload
  if (!e || !e.id || !e.text) return null
  return {
    ...e,
    author: pin.publickey || e.author,
    lat: pin.lat ?? e.lat, lng: pin.lng ?? e.lng,
    distanceMeters: pin.distanceMeters,
    expiresAt: e.expiresAt || (pin.expiresAt ? new Date(pin.expiresAt).getTime() : (e.createdAt + TTL_24H))
  }
}
