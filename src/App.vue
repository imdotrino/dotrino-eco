<script setup>
import { ref, computed, onMounted, onBeforeUnmount, reactive } from 'vue'
import { useFeed } from './feed/feedStore'
import { createVaultProfileProvider } from '@dotrino/profile'
import '@dotrino/notifications'
import { getNotifications } from './services/notifications'
import { getIdentity } from './services/identity'
import { getReputation } from './services/reputation'
import { useBackLayer } from '@dotrino/nav/vue'
import iconUrl from '/icon.svg'

const feed = useFeed()
function initialLang () {
  try { const s = localStorage.getItem('eco:lang'); if (s === 'es' || s === 'en') return s } catch (_) {}
  return (navigator.language || 'es').slice(0, 2) === 'en' ? 'en' : 'es'
}
const lang = ref(initialLang())
function setLang (l) {
  lang.value = l
  try { localStorage.setItem('eco:lang', l) } catch (_) {}
}

const T = {
  es: {
    tagline: 'tu voz · tu zona · 24 h',
    placeholder: '¿Qué resuena cerca de ti?',
    composerHint: 'Los enlaces y #hashtags se detectan solos.',
    publish: 'Publicar eco', radius: 'Radio', global: 'Global',
    sort: 'Orden',
    searchPh: 'Buscar ecos…  (Enter lo guarda como tema)',
    themes: 'Temas', themesTitle: 'Tus temas',
    themesIntro: 'Eco los aprende solo de lo que publicas y respondes; los temas suben en tu orden (preset “Temas”). Aquí los agregas o quitas.',
    addPh: 'Agregar un tema', noThemes: 'Todavía no hay temas. Publica con #hashtags, busca algo, o agrega uno aquí.', close: 'Cerrar',
    inbox: (n) => `${n} en tu bandeja (avalados por tu red)`, accept: 'Ver', dismiss: 'Descartar',
    reply: 'Responder', repost: 'Re-eco', mute: 'Silenciar (ocultar de tu feed)', del: 'Borrar',
    like: 'Me gusta', dislike: 'No me gusta', share: 'Compartir', kept: 'guardado',
    mutedTitle: 'Silenciados', unmute: 'Quitar silencio', mute0: 'Silenciar',
    reputation: 'Reputación', affinity: 'Afinidad', theirEcos: 'Sus ecos', you2: 'Tú',
    shareHeading: 'Compartir eco', copy: 'Copiar enlace', copied: '¡Enlace copiado!',
    replies: 'respuestas', thread: 'Conversación',
    notifications: 'Notificaciones', noNotifs: 'Sin notificaciones todavía.',
    notifReply: 'respondió a tu eco', notifRepost: 're-ecó tu eco',
    clearN: 'Limpiar',
    you: 'tú', install: 'Instalar',
    repostOf: 're-eco de', expires: 'expira en', empty: 'Todavía no hay ecos en tu zona. Publica el primero o amplía el alcance.',
    standalone: 'Vault no disponible: modo archivo local (solo lectura).',
    needLoc: 'Activa la ubicación para publicar y descubrir ecos.',
    locating: 'Obteniendo tu ubicación…', retryLoc: 'Activar ubicación',
    nickTitle: 'Elige tu nombre', nickIntro: 'Tus ecos y acciones se firman con este nombre. Hace falta para participar.',
    nickPh: 'Tu nombre visible', nickSave: 'Guardar', setNick: 'Definir nombre',
    replyingTo: 'Respondiendo a', reecoOf: 'Re-eco de', addComment: 'Agrega un comentario (opcional)', cancel: 'Cancelar'
  },
  en: {
    tagline: 'your voice · your radius · 24 h',
    placeholder: "What's echoing near you?",
    composerHint: 'Links and #hashtags are detected automatically.',
    publish: 'Post eco', radius: 'Radius', global: 'Global',
    sort: 'Sort',
    searchPh: 'Search ecos…  (Enter saves it as a topic)',
    themes: 'Topics', themesTitle: 'Your topics',
    themesIntro: 'Eco learns them automatically from what you post and reply to; topics rank higher (the “Topics” sort). Add or remove them here.',
    addPh: 'Add a topic', noThemes: 'No topics yet. Post with #hashtags, search something, or add one here.', close: 'Close',
    inbox: (n) => `${n} in your inbox (endorsed by your network)`, accept: 'View', dismiss: 'Dismiss',
    reply: 'Reply', repost: 'Re-echo', mute: 'Mute (hide from your feed)', del: 'Delete',
    like: 'Like', dislike: 'Dislike', share: 'Share', kept: 'saved',
    mutedTitle: 'Muted', unmute: 'Unmute', mute0: 'Mute',
    reputation: 'Reputation', affinity: 'Affinity', theirEcos: 'Their ecos', you2: 'You',
    shareHeading: 'Share eco', copy: 'Copy link', copied: 'Link copied!',
    replies: 'replies', thread: 'Thread',
    notifications: 'Notifications', noNotifs: 'No notifications yet.',
    notifReply: 'replied to your eco', notifRepost: 're-echoed your eco',
    clearN: 'Clear',
    you: 'you', install: 'Install',
    repostOf: 're-echo of', expires: 'expires in', empty: 'No ecos in your radius yet. Post the first or widen the radius.',
    standalone: 'Vault unavailable: local-archive mode (read only).',
    needLoc: 'Enable location to post and discover ecos.',
    locating: 'Getting your location…', retryLoc: 'Enable location',
    nickTitle: 'Choose your name', nickIntro: 'Your ecos and actions are signed with this name. Required to take part.',
    nickPh: 'Your visible name', nickSave: 'Save', setNick: 'Set name',
    replyingTo: 'Replying to', reecoOf: 'Re-echo of', addComment: 'Add a comment (optional)', cancel: 'Cancel'
  }
}
const t = computed(() => T[lang.value])

const text = ref('')
const composeCtx = ref(null)   // { mode:'reply'|'reeco', eco } cuando respondés/re-ecoás
const composerEl = ref(null)
const search = ref('')
const newInterest = ref('')
const showThemes = ref(false)
const showNotifs = ref(false)
const now = ref(Date.now())
const nickPrompt = ref(false)
const nickDraft = ref('')
let pendingAction = null
let tick

// Guard central: ninguna acción sin nick. Abre el prompt y reanuda la acción.
function withNick (fn) {
  if (feed.hasNick) return fn()
  pendingAction = fn
  nickPrompt.value = true
}
async function saveNick () {
  if (!nickDraft.value.trim()) return
  const ok = await feed.setMyName(nickDraft.value)
  if (!ok) return
  nickPrompt.value = false
  nickDraft.value = ''
  const a = pendingAction; pendingAction = null
  if (a) await a()
}

// Feed visible = filtrado por el buscador (texto / tags / autor). No persiste:
// el buscador es para encontrar ahora; al Enter se guarda como tema.
const visibleFeed = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return feed.feed
  return feed.feed.filter(({ eco, ctx }) =>
    (eco.text || '').toLowerCase().includes(q) ||
    (eco.tags || []).some((t) => t.includes(q)) ||
    (ctx.name || '').toLowerCase().includes(q))
})
function commitSearch () {
  const q = search.value.trim()
  if (q) { feed.addInterest(q); search.value = '' }
}
function addInterest () {
  const v = newInterest.value.trim()
  if (v) { feed.addInterest(v); newInterest.value = '' }
}

function onSWMessage (e) { if (e.data?.type === 'cc-push-ring') feed.discoverNow?.() }

onMounted(async () => {
  navigator.serviceWorker?.addEventListener('message', onSWMessage)
  await feed.init()
  // Sin nick: abrir el popup de nombre directo (si cancela, el guard lo reabre
  // al intentar cualquier acción). Sin banner.
  if (!feed.standalone && !feed.hasNick) nickPrompt.value = true
  tick = setInterval(() => { now.value = Date.now() }, 30_000)
})
onBeforeUnmount(() => {
  clearInterval(tick); feed.dispose()
})

// Re-eco puede ir sin texto (cita sola); reply/eco normal requieren texto.
const canPublish = computed(() => !feed.standalone && feed.pos && !feed.busy &&
  (text.value.trim().length > 0 || composeCtx.value?.mode === 'reeco'))
const radiusLabel = (m) => m === 0 ? t.value.global : (m >= 1000 ? `${m / 1000}km` : `${m}m`)

async function doPublish () {
  if (!canPublish.value) return
  const context = composeCtx.value ? { mode: composeCtx.value.mode, target: composeCtx.value.eco } : null
  const eco = await feed.publish({ text: text.value, context })
  if (eco) { text.value = ''; composeCtx.value = null }
}
function startCompose (mode, eco, label) {
  composeCtx.value = { mode, eco, label }
  window.scrollTo({ top: 0, behavior: 'smooth' })
  setTimeout(() => composerEl.value?.focus(), 120)
}
function cancelCompose () { composeCtx.value = null }
// Compartir: modal coherente con el set del Web Component de support
// (WhatsApp / X / Facebook, mismos intents y colores; iconos SVG inline).
const shareCtx = ref(null)
const shareCopied = ref(false)
const SHARE_ICONS = {
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.519 5.26l-.999 3.648 3.969-1.018zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>'
}
const SHARE_URL = 'https://eco.dotrino.com/'
function shareTargets (eco) {
  const u = encodeURIComponent(SHARE_URL)
  const text = encodeURIComponent(eco.text || 'Eco')
  return [
    { key: 'whatsapp', label: 'WhatsApp', color: '#25D366', href: `https://wa.me/?text=${text}%20${u}` },
    { key: 'x', label: 'X', color: '#000000', href: `https://twitter.com/intent/tweet?url=${u}&text=${text}` },
    { key: 'facebook', label: 'Facebook', color: '#1877F2', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` }
  ]
}
function doShare (eco) { shareCopied.value = false; shareCtx.value = eco }

// Perfil de un autor (click en su nick). Datos del propio feed; mute/unmute acá.
const profilePk = ref(null)
const profile = computed(() => {
  const pk = profilePk.value
  if (!pk) return null
  const entries = feed.feed.filter((i) => i.eco.author === pk)
  const ctx = entries[0]?.ctx || {}
  return {
    pk,
    name: ctx.name || null,
    self: entries[0]?.eco.authorName || null,
    isMe: pk === feed.myPubkey,
    reputation: ctx.reputation ?? 0,
    affinity: ctx.affinity ?? 0,
    muted: feed.mutedList.includes(pk),
    ecos: entries.map((e) => e.eco)
  }
})
function openProfile (pk) { profilePk.value = pk }

// Tarjeta de perfil + reputación compartida (<dotrino-profile>): mismo UI
// que el messenger, tematizado al teal de Eco vía --ccp-*. El provider cablea
// los datos al vault + registro (singleton).
let _profileProvider = null
async function ensureProfileProvider () {
  if (_profileProvider) return _profileProvider
  try {
    const [identity, reputation] = await Promise.all([getIdentity(), getReputation()])
    if (reputation) _profileProvider = createVaultProfileProvider({ identity, reputation })
  } catch (_) { /* sin provider el componente muestra "registro no disponible" */ }
  return _profileProvider
}
function bindProfile (el) {
  if (!el) return
  ensureProfileProvider().then((p) => { if (p) el.provider = p })
}
// "Mi perfil": botón del header (a la izquierda de la moneda de soporte) que abre
// el MISMO Web Component compartido en modo self con mi identidad del vault.
const myProfilePk = ref(null)
const myProfileName = ref(null)
async function openMyProfile () {
  try {
    const identity = await getIdentity()
    const pk = identity?.me?.publickey
    if (!pk) return
    myProfileName.value = identity?.me?.nickname || null
    myProfilePk.value = pk
  } catch (_) { /* sin identidad no abre */ }
}
const profileTheme = {
  '--ccp-bg': 'var(--card)',
  '--ccp-bg-2': 'var(--bg2)',
  '--ccp-bg-3': 'var(--bg2)',
  '--ccp-bg-4': 'var(--line)',
  '--ccp-border': 'var(--line)',
  '--ccp-text': 'var(--text)',
  '--ccp-muted': 'var(--muted)',
  '--ccp-accent': 'var(--teal)',
  '--ccp-accent-2': 'var(--teal2)',
  '--ccp-derived': 'var(--teal2)',
  '--ccp-online': 'var(--teal2)',
  '--ccp-affinity': 'var(--teal2)',
  '--ccp-gold': '#d4a72c',
  '--ccp-input-bg': 'var(--bg)',
  '--ccp-radius': '12px',
}
// Mi etiqueta para un pk (de lo que ya está en el feed), para hilos/citas.
function myLabelFor (pk) { return feed.feed.find((i) => i.eco.author === pk)?.ctx?.name || null }

// --- Hilos: ver un mensaje con todas sus respuestas ---
const threadRoot = ref(null)
const replyCountOf = (id) => feed.allEcos.filter((e) => e.replyTo?.id === id).length
function openThread (eco) { threadRoot.value = eco }

// Volver unificado: cada modal abierto pasa a ser una "capa". El botón físico
// de volver / gesto de iOS / atrás del navegador / chevron del header la cierra
// (en vez de salir de la app) gracias a @dotrino/nav.
useBackLayer(showNotifs)
useBackLayer(showThemes)
useBackLayer(nickPrompt)
useBackLayer(threadRoot, { onClose: () => { threadRoot.value = null } })
useBackLayer(profilePk, { onClose: () => { profilePk.value = null } })
useBackLayer(myProfilePk, { onClose: () => { myProfilePk.value = null } })
useBackLayer(shareCtx, { onClose: () => { shareCtx.value = null } })

// Notificaciones
function openNotifs () { showNotifs.value = true; setTimeout(() => feed.markNotifsRead(), 800) }
function openNotif (n) {
  showNotifs.value = false
  openThreadById(n.refId)   // refId = mi eco original → abre el hilo con la respuesta
}
// Panel de notificaciones = Web Component compartido <dotrino-notifications>.
const bindNotif = (el) => { if (el) el.controller = getNotifications() }
const ccnTheme = {
  '--ccn-bg': 'var(--card)', '--ccn-bg-2': 'var(--bg2)', '--ccn-bg-3': 'var(--bg2)',
  '--ccn-bg-4': 'var(--line)', '--ccn-border': 'var(--line)', '--ccn-text': 'var(--text)',
  '--ccn-muted': 'var(--muted)', '--ccn-accent': 'var(--teal)', '--ccn-accent-text': '#04211f',
  '--ccn-radius': '12px', 'margin-bottom': '10px', display: 'block',
}
function openThreadById (id) {
  const e = feed.allEcos.find((x) => x.id === id)
  threadRoot.value = e || null
}
const threadList = computed(() => {
  const start = threadRoot.value
  if (!start) return []
  const all = feed.allEcos
  let root = start, guard = 0
  while (root.replyTo && guard++ < 50) {        // subir hasta la raíz del hilo
    const parent = all.find((e) => e.id === root.replyTo.id)
    if (!parent) break
    root = parent
  }
  const result = [root]; const queue = [root.id]
  while (queue.length) {                         // recolectar todas las respuestas (BFS)
    const pid = queue.shift()
    for (const e of all) {
      if (e.replyTo?.id === pid && !result.some((x) => x.id === e.id)) { result.push(e); queue.push(e.id) }
    }
  }
  return result.sort((a, b) => a.createdAt - b.createdAt)
})
function toggleMuteProfile () {
  const p = profile.value
  if (!p) return
  if (p.muted) feed.unmute(p.pk)
  else { feed.mute(p.pk); profilePk.value = null }
}
async function copyShare (eco) {
  try {
    await navigator.clipboard.writeText((eco.text ? eco.text + ' ' : '') + SHARE_URL)
    shareCopied.value = true; setTimeout(() => { shareCopied.value = false }, 1600)
  } catch (_) {}
}
function isExpired (eco) { return (eco.expiresAt || (eco.createdAt + 86400000)) <= now.value }
// Fecha y hora del post (en vez de "expira en 23h").
function fmtDate (eco) {
  const d = new Date(eco.createdAt || Date.now())
  return d.toLocaleString(lang.value === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const shortPk = (pk) => pk ? pk.replace(/[^a-zA-Z0-9]/g, '').slice(-6) : '??????'
// Nombre a mostrar: MI etiqueta primero; si difiere de cómo SE identifica, su
// self-nick entre paréntesis. Sin etiqueta mía → su self-nick → pubkey corto.
function displayName (author, myLabel, self) {
  if (myLabel && self && self !== myLabel) return `${myLabel} (${self})`
  return myLabel || self || shortPk(author)
}
function ttlText (eco) {
  const exp = eco.expiresAt || (eco.createdAt + 86400000)
  const ms = exp - now.value
  if (ms <= 0) return '·'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h >= 1 ? `${h}h` : `${m}m`
}
</script>

<template>
  <div class="topbar">
    <dotrino-back :lang="lang" class="cc-back"></dotrino-back>
    <div class="brand">
      <img :src="iconUrl" alt="Eco" />
      <span>Eco <small>{{ t.tagline }}</small></span>
    </div>
    <div class="spacer"></div>
    <div class="topbar-controls">
    <dotrino-install class="cc-install" :lang="lang" data-testid="install-btn"></dotrino-install>
    <select class="top-select" :value="feed.radiusMeters"
            @change="feed.setRadius(Number($event.target.value))" :title="t.radius">
      <option v-for="r in feed.radii" :key="r" :value="r">◎ {{ radiusLabel(r) }}</option>
    </select>
    <select class="top-select" :value="feed.preset"
            @change="feed.setPreset($event.target.value)" :title="t.sort">
      <option v-for="(p, k) in feed.presets" :key="k" :value="k">↕ {{ p.label[lang] }}</option>
    </select>
    <button class="chip notif-btn" data-testid="bell" @click="openNotifs" :title="t.notifications">🔔<span v-if="feed.unread" class="notif-badge" data-testid="unread">{{ feed.unread }}</span></button>
    <button class="chip" data-testid="themes" @click="showThemes = true" :title="t.themes">🏷<span v-if="feed.myTags.length"> {{ feed.myTags.length }}</span></button>
    <div class="lang-selector" role="group" aria-label="es / en">
      <button :class="{ on: lang === 'es' }" @click="setLang('es')">ES</button>
      <button :class="{ on: lang === 'en' }" @click="setLang('en')">EN</button>
    </div>
    <button class="profile-btn" data-testid="my-profile" @click="openMyProfile" :title="lang === 'es' ? 'Mi perfil' : 'My profile'" :aria-label="lang === 'es' ? 'Mi perfil' : 'My profile'">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
      </svg>
    </button>
    <dotrino-support
      class="topbar-coin"
      href="https://ko-fi.com/dotrino"
      repo="imdotrino/dotrino-eco"
      discord="https://discord.gg/D648uq7cth"></dotrino-support>
    </div>
  </div>

  <div class="wrap">
    <p v-if="feed.standalone" class="err">{{ t.standalone }}</p>
    <p v-else-if="feed.locating && !feed.pos" class="muted">{{ t.locating }}</p>
    <p v-else-if="feed.geoError" class="err">{{ t.needLoc }} <small>({{ feed.geoError }})</small>
      <button class="chip" style="margin-left:8px" @click="feed.locate()">{{ t.retryLoc }}</button></p>

    <!-- Buscador (filtra ahora; Enter lo guarda como tema) -->
    <input class="search-box" data-testid="search" v-model="search" :placeholder="t.searchPh" @keyup.enter="commitSearch" />

    <!-- Composer -->
    <div class="composer" v-if="!feed.standalone">
      <div v-if="composeCtx" class="compose-ctx">
        <div class="compose-ctx-head">
          <span>{{ composeCtx.mode === 'reply' ? '↳ ' + t.replyingTo : '🔁 ' + t.reecoOf }}
            <span class="pk">@{{ composeCtx.eco.author === feed.myPubkey ? t.you : displayName(composeCtx.eco.author, composeCtx.label, composeCtx.eco.authorName) }}</span></span>
          <button class="ctx-x" @click="cancelCompose">✕</button>
        </div>
        <blockquote class="quoted">
          <p>{{ composeCtx.eco.text || '—' }}</p>
        </blockquote>
      </div>
      <textarea ref="composerEl" v-model="text" :maxlength="280" data-testid="composer"
        :placeholder="composeCtx?.mode === 'reeco' ? t.addComment : t.placeholder"></textarea>
      <div class="composer-row">
        <span class="count">{{ text.length }}/280</span>
        <div class="spacer"></div>
        <button class="btn" data-testid="post-eco" :disabled="!canPublish" @click="withNick(doPublish)">{{ t.publish }}</button>
      </div>
    </div>

    <!-- Bandeja efímera -->
    <div class="inbox-banner" v-if="feed.inbox.length">
      <span>{{ t.inbox(feed.inbox.length) }}</span>
      <div class="spacer"></div>
      <button class="btn ghost" @click="feed.acceptInbox()">{{ t.accept }}</button>
      <button class="btn ghost" @click="feed.dismissInbox()">{{ t.dismiss }}</button>
    </div>

    <!-- Feed -->
    <div v-if="!visibleFeed.length" class="empty">{{ t.empty }}</div>

    <article v-for="item in visibleFeed" :key="item.eco.id" class="eco" :class="{ mine: item.ctx.mine }" data-testid="eco" :data-eco-id="item.eco.id" :data-author="item.eco.authorName || ''">
      <div class="reply-to" v-if="item.eco.replyTo">↳ {{ t.replyingTo }}</div>
      <div class="reply-to" v-else-if="item.eco.repostOf">🔁 {{ t.repostOf }} <span class="pk pk-link" @click="openProfile(item.eco.repostOf.author)">@{{ displayName(item.eco.repostOf.author, item.eco.quoted?.name, item.eco.quoted?.authorName) }}</span></div>
      <div class="eco-head">
        <span class="pk pk-link" @click="openProfile(item.eco.author)">@{{ displayName(item.eco.author, item.ctx.name, item.eco.authorName) }}<small v-if="item.ctx.mine"> · {{ t.you }}</small></span>
        <span class="ttl">{{ fmtDate(item.eco) }}</span>
      </div>
      <blockquote class="quoted" v-if="item.eco.replyTo && item.eco.replyTo.text" @click="openThreadById(item.eco.replyTo.id)" style="cursor:pointer">
        <span class="pk pk-link" @click.stop="openProfile(item.eco.replyTo.author)">@{{ displayName(item.eco.replyTo.author, item.eco.replyTo.name, item.eco.replyTo.authorName) }}</span>
        <p>{{ item.eco.replyTo.text }}</p>
      </blockquote>
      <div class="eco-body" v-if="item.eco.text">{{ item.eco.text }}</div>
      <blockquote class="quoted" v-if="item.eco.quoted">
        <span class="pk pk-link" @click="openProfile(item.eco.quoted.author)">@{{ displayName(item.eco.quoted.author, item.eco.quoted.name, item.eco.quoted.authorName) }}</span>
        <p>{{ item.eco.quoted.text }}</p>
      </blockquote>
      <div class="eco-links" v-if="item.eco.links && item.eco.links.length">
        <a v-for="(l, i) in item.eco.links" :key="i" :href="l" target="_blank" rel="noopener nofollow">{{ l }}</a>
      </div>
      <div class="eco-tags" v-if="item.eco.tags && item.eco.tags.length">
        <span class="tag" v-for="tg in item.eco.tags" :key="tg">#{{ tg }}</span>
      </div>
      <button v-if="replyCountOf(item.eco.id)" class="thread-link" data-testid="open-thread" @click="openThread(item.eco)">💬 {{ replyCountOf(item.eco.id) }} {{ t.replies }}</button>
      <div class="eco-foot" v-if="!item.ctx.mine">
        <button data-testid="act-reply" :title="t.reply" @click="withNick(() => startCompose('reply', item.eco, item.ctx.name))">💬</button>
        <button data-testid="act-reeco" :title="t.repost" @click="withNick(() => startCompose('reeco', item.eco, item.ctx.name))">🔁</button>
        <button data-testid="act-like" :title="t.like" :class="{ liked: item.ctx.reaction === 'like' }" @click="withNick(() => feed.react(item.eco, 'like'))">👍</button>
        <button data-testid="act-dislike" :title="t.dislike" :class="{ disliked: item.ctx.reaction === 'dislike' }" @click="withNick(() => feed.react(item.eco, 'dislike'))">👎</button>
        <button data-testid="act-share" :title="t.share" @click="withNick(() => doShare(item.eco))">🔗</button>
        <span v-if="item.ctx.keep && isExpired(item.eco)" class="kept-tag" :title="t.kept">📌</span>
      </div>
      <div class="eco-foot" v-else>
        <button data-testid="act-reply" :title="t.reply" @click="withNick(() => startCompose('reply', item.eco, item.ctx.name))">💬</button>
        <button data-testid="act-reeco" :title="t.repost" @click="withNick(() => startCompose('reeco', item.eco, item.ctx.name))">🔁</button>
        <button data-testid="act-share" :title="t.share" @click="withNick(() => doShare(item.eco))">🔗</button>
        <button data-testid="act-delete" :title="t.del" @click="withNick(() => feed.deleteMine(item.eco))">🗑</button>
      </div>
    </article>
  </div>

  <!-- Notificaciones (respuestas/re-ecos a tus ecos) -->
  <div v-if="showNotifs" class="modal-back" @click.self="showNotifs = false">
    <div class="modal">
      <div class="modal-head">
        <h3>🔔 {{ t.notifications }}</h3>
        <button class="btn ghost" @click="showNotifs = false">{{ t.close }}</button>
      </div>
      <dotrino-notifications :ref="bindNotif" :style="ccnTheme" :lang="lang"></dotrino-notifications>
      <div v-if="!feed.notifications.length" class="muted">{{ t.noNotifs }}</div>
      <div v-for="n in feed.notifications" :key="n.id" class="notif-item" :class="{ unread: !n.read }" @click="openNotif(n)">
        <div class="notif-line">
          <span class="pk">@{{ displayName(n.from, myLabelFor(n.from), n.fromName) }}</span>
          {{ n.type === 'eco-reply' ? t.notifReply : t.notifRepost }}
        </div>
        <div class="notif-preview" v-if="n.preview">{{ n.preview }}</div>
      </div>
      <button v-if="feed.notifications.length" class="btn ghost" style="margin-top:10px" @click="feed.clearNotifs()">{{ t.clearN }}</button>
    </div>
  </div>

  <!-- Hilo: el mensaje con todas sus respuestas -->
  <div v-if="threadRoot" class="modal-back" @click.self="threadRoot = null">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ t.thread }}</h3>
        <button class="btn ghost" @click="threadRoot = null">{{ t.close }}</button>
      </div>
      <article v-for="(e, i) in threadList" :key="e.id" class="eco thread-item" :class="{ 'thread-root': i === 0 }">
        <div class="reply-to" v-if="e.replyTo && i > 0">↳</div>
        <div class="eco-head">
          <span class="pk pk-link" @click="openProfile(e.author)">@{{ displayName(e.author, myLabelFor(e.author), e.authorName) }}</span>
          <span class="ttl">{{ fmtDate(e) }}</span>
        </div>
        <blockquote class="quoted" v-if="e.quoted">
          <span class="pk">@{{ displayName(e.quoted.author, myLabelFor(e.quoted.author), e.quoted.authorName) }}</span>
          <p>{{ e.quoted.text }}</p>
        </blockquote>
        <div class="eco-body" v-if="e.text">{{ e.text }}</div>
        <button class="thread-link" @click="withNick(() => { startCompose('reply', e, myLabelFor(e.author)); threadRoot = null })">💬 {{ t.reply }}</button>
      </article>
    </div>
  </div>

  <!-- Perfil del autor (click en el nick) -->
  <div v-if="profilePk && profile" class="modal-back" @click.self="profilePk = null">
    <div class="modal">
      <div class="modal-head">
        <h3>@{{ displayName(profile.pk, profile.name, profile.self) }}<small v-if="profile.isMe"> · {{ t.you2 }}</small></h3>
        <button class="btn ghost" @click="profilePk = null">{{ t.close }}</button>
      </div>
      <p v-if="profile.isMe" class="muted" style="font-family:ui-monospace,monospace;word-break:break-all">{{ shortPk(profile.pk) }}</p>
      <dotrino-profile
        v-else
        :ref="bindProfile"
        :style="profileTheme"
        mode="edit"
        :lang="lang"
        :pubkey="profile.pk"
        :name="displayName(profile.pk, profile.name, profile.self)"
      ></dotrino-profile>
      <button v-if="!profile.isMe" class="btn ghost" style="margin-top:4px"
        @click="toggleMuteProfile">🔕 {{ profile.muted ? t.unmute : t.mute0 }}</button>
      <h4 class="muted-head">{{ t.theirEcos }}</h4>
      <div v-if="!profile.ecos.length" class="muted">—</div>
      <article v-for="e in profile.ecos" :key="e.id" class="eco" style="margin-top:8px">
        <div class="eco-body" v-if="e.text">{{ e.text }}</div>
        <div class="eco-tags" v-if="e.tags && e.tags.length">
          <span class="tag" v-for="tg in e.tags" :key="tg">#{{ tg }}</span>
        </div>
      </article>
    </div>
  </div>

  <!-- Mi perfil (botón del header, a la izquierda de la moneda): mismo Web
       Component compartido en modo self con mi identidad del vault. -->
  <dotrino-profile
    v-if="myProfilePk"
    :ref="bindProfile"
    modal
    mode="self"
    :pubkey="myProfilePk"
    :name="myProfileName"
    :lang="lang"
    :style="profileTheme"
    @cc-profile-close="myProfilePk = null"
  ></dotrino-profile>

  <!-- Compartir: modal coherente con el set de support (WhatsApp/X/Facebook) -->
  <div v-if="shareCtx" class="modal-back" @click.self="shareCtx = null">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ t.shareHeading }}</h3>
        <button class="btn ghost" @click="shareCtx = null">{{ t.close }}</button>
      </div>
      <p class="compose-ctx-quote">{{ shareCtx.text }}</p>
      <div class="share-list">
        <a v-for="s in shareTargets(shareCtx)" :key="s.key" class="share-btn"
           :style="{ background: s.color }" :href="s.href" target="_blank" rel="noopener"
           :title="s.label" v-html="SHARE_ICONS[s.key]"></a>
        <button class="share-btn copy" :title="t.copy" @click="copyShare(shareCtx)">🔗</button>
      </div>
      <p class="share-copied" :class="{ show: shareCopied }">{{ t.copied }}</p>
    </div>
  </div>

  <!-- Prompt de nick: ninguna acción sin nombre -->
  <div v-if="nickPrompt" class="modal-back" @click.self="nickPrompt = false">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ t.nickTitle }}</h3>
        <button class="btn ghost" @click="nickPrompt = false">{{ t.close }}</button>
      </div>
      <p class="muted">{{ t.nickIntro }}</p>
      <input class="search-box" data-testid="nick-input" v-model="nickDraft" :placeholder="t.nickPh" :maxlength="40" @keyup.enter="saveNick" />
      <div class="composer-row">
        <div class="spacer"></div>
        <button class="btn" data-testid="nick-save" :disabled="!nickDraft.trim()" @click="saveNick">{{ t.nickSave }}</button>
      </div>
    </div>
  </div>

  <!-- Panel de temas (fuera del home) -->
  <div v-if="showThemes" class="modal-back" @click.self="showThemes = false">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ t.themesTitle }}</h3>
        <button class="btn ghost" @click="showThemes = false">{{ t.close }}</button>
      </div>
      <p class="muted">{{ t.themesIntro }}</p>
      <div class="bar">
        <input class="chip" style="flex:1;min-width:160px" v-model="newInterest" :placeholder="t.addPh" @keyup.enter="addInterest" />
        <button class="chip" @click="addInterest">＋</button>
      </div>
      <p v-if="!feed.myTags.length" class="muted">{{ t.noThemes }}</p>
      <div class="theme-list">
        <span v-for="tg in feed.myTags" :key="tg" class="theme-pill">
          #{{ tg }}<button @click="feed.removeInterest(tg)">×</button>
        </span>
      </div>

      <template v-if="feed.mutedList.length">
        <h4 class="muted-head">🔕 {{ t.mutedTitle }}</h4>
        <div class="theme-list">
          <span v-for="pk in feed.mutedList" :key="pk" class="theme-pill">
            @{{ shortPk(pk) }}<button @click="feed.unmute(pk)" :title="t.unmute">×</button>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
