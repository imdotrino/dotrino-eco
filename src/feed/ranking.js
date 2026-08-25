// Capa 2 — orden del feed. Ranking ponderado, 100% en el cliente.
// score = wR·recencia + wA·afinidad + wRep·reputación + wT·tags + wG·geo
// Cada término normalizado 0..1. Ver DESIGN.md §3.

const TTL_MS = 24 * 60 * 60 * 1000
const TAU_MS = 8 * 60 * 60 * 1000 // vida media del decay de recencia (~8h)

// Pesos por preset. "balanced" es el default del diseño.
export const PRESETS = {
  balanced: { rec: 0.30, aff: 0.25, rep: 0.20, tag: 0.15, geo: 0.10, label: { es: 'Equilibrado', en: 'Balanced' } },
  fresh:    { rec: 0.62, aff: 0.13, rep: 0.10, tag: 0.10, geo: 0.05, label: { es: 'Fresco', en: 'Fresh' } },
  people:   { rec: 0.20, aff: 0.42, rep: 0.28, tag: 0.05, geo: 0.05, label: { es: 'Tu gente', en: 'Your people' } },
  near:     { rec: 0.22, aff: 0.13, rep: 0.10, tag: 0.10, geo: 0.45, label: { es: 'Cerca', en: 'Nearby' } },
  topics:   { rec: 0.22, aff: 0.10, rep: 0.13, tag: 0.50, geo: 0.05, label: { es: 'Temas', en: 'Topics' } },
  chrono:   { rec: 1.00, aff: 0, rep: 0, tag: 0, geo: 0, label: { es: 'Cronológico', en: 'Chronological' } }
}

/** Recencia: decay exponencial sobre la edad del eco. now-createdAt. */
function recency (eco, now) {
  const age = Math.max(0, now - (eco.createdAt || 0))
  return Math.exp(-age / TAU_MS)
}

/** Tags: solapamiento Jaccard entre los tags del eco y mis intereses. */
function tagMatch (ecoTags, myTags) {
  if (!myTags?.length || !ecoTags?.length) return 0
  const a = new Set(ecoTags)
  const b = new Set(myTags)
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

/** Geo: proximidad normalizada dentro del radio de escucha. */
function geoScore (distanceMeters, radiusMeters) {
  if (distanceMeters == null || !radiusMeters) return 0.5 // sin dato → neutro
  return Math.max(0, 1 - distanceMeters / radiusMeters)
}

/** ¿Sigue vivo en la red? (para filtrar; el archivo local igual lo guarda) */
export function isAlive (eco, now) {
  const exp = eco.expiresAt || ((eco.createdAt || 0) + TTL_MS)
  return exp > now
}

/**
 * ¿Se queda en el feed? Un eco muere en la red a las 24 h, pero hay DOS razones para
 * seguir enseñándolo:
 *   · `liked` — le diste 👍: es tuyo, se queda como copia tuya.
 *   · `opened` — llegaste por su ENLACE. Un enlace se comparte justamente para que abra
 *     cuando el eco ya no se descubre —por eso su copia pública va pineada—, así que
 *     filtrarlo por vencido dejaba la app como si el enlace no hubiera hecho nada.
 *
 * **El 👎 NO lo conserva**, y esto era un fallo: se miraba «hay reacción» sin mirar
 * cuál, así que marcar un eco con 👎 te lo fijaba en el feed para siempre — lo contrario
 * de lo que pide quien lo marca. Un 👎 baja la afinidad con su autor y deja que el eco se
 * muera a su hora, que es lo que hace cualquier otro.
 */
export const survives = (eco, { now = Date.now(), liked = false, opened = false } = {}) =>
  isAlive(eco, now) || !!liked || !!opened

/**
 * Puntúa un eco. ctx aporta las señales que no están en el eco:
 *   { affinity:0..1, reputation:0..1, myTags:[], radiusMeters }
 */
export function scoreEco (eco, ctx, presetKey, now) {
  const w = PRESETS[presetKey] || PRESETS.balanced
  const rec = recency(eco, now)
  const aff = ctx.affinity ?? 0
  const rep = ctx.reputation ?? 0
  const tag = tagMatch(eco.tags, ctx.myTags)
  const geo = geoScore(eco.distanceMeters, ctx.radiusMeters)
  return w.rec * rec + w.aff * aff + w.rep * rep + w.tag * tag + w.geo * geo
}

/**
 * Ordena una lista de ecos ya enriquecidos con su ctx.
 * @param {Array<{eco, ctx}>} items
 */
export function rankFeed (items, presetKey, now = Date.now()) {
  return items
    .filter(({ eco, ctx }) => survives(eco, { now, liked: ctx?.keep, opened: ctx?.opened }))
    .map((it) => ({ ...it, score: scoreEco(it.eco, it.ctx, presetKey, now) }))
    .sort((a, b) => b.score - a.score)
}
