# Eco — diseño / design

> **es** · Microblogging efímero y georreferenciado del ecosistema Dotrino.
> Tu voz, en tu zona, bajo tus reglas. Lo que la red sigue tocando sigue vivo;
> lo que nadie toca, muere a las 24 h.
>
> **en** · Ephemeral, georeferenced microblogging for the Dotrino ecosystem.
> Your voice, in your radius, under your rules. What the network keeps touching
> stays alive; what nobody touches dies in 24 h.

`eco.dotrino.com`

---

## 1. Idea en una línea / one-liner

- **es** — Publicás un eco (texto + enlaces + tags) con tu ubicación. Quien esté
  en su radio de escucha lo descubre por `geo.dotrino.com`, lo recibe en su
  cuenta y lo **archiva localmente**. A las 24 h el eco muere en la red (deja de
  descubrirse y no se re-emite); sólo sobrevive la copia local privada de quien
  lo guardó. **Reps y replies rehidratan** el original: resetean su TTL.
- **en** — You post an eco (text + links + tags) with your location. Whoever has
  it in their listening radius discovers it via `geo.dotrino.com`, receives it
  into their account and **archives it locally**. After 24 h the eco dies on the
  network (no longer discoverable, never re-broadcast); only the private local
  copy of whoever saved it survives. **Reposts and replies rehydrate** the
  original: they reset its TTL.

## 2. Por qué encaja en el ecosistema / why it fits

Eco no inventa backend. Es una composición de los cuatro pilares + reputación:

| Pilar | Paquete | Rol en Eco |
|-------|---------|------------|
| Identidad | `@dotrino/identity` | firma cada eco; grafo de afinidad (contactos + ratings) |
| Transporte | `@dotrino/proxy-client` | `sendByPubkey` para reply/repost/mención (cola offline 24 h) |
| Almacenamiento | `@dotrino/store` | tu archivo local durable de ecos (lo único persistente) |
| Descubrimiento geo | `@dotrino/geo` | beacon firmado: publicar/descubrir por radio + tags |
| Reputación | `@dotrino/reputation` | gate anti-spam + boost de orden (web-of-trust) |

**Efímero en la red, durable sólo en local** — igual que el resto del ecosistema:
geo y proxy no guardan; tu store sí. Nada del usuario se indexa ni viaja al
servidor como contenido crawleable.

## 3. Las dos capas (lo importante) / the two layers

El orden del feed **no** es un solo ranking. Hay dos capas distintas:

### Capa 1 — Descubrimiento (qué te llega)
- **Georreferencia (radio):** geo te entrega beacons firmados de autores dentro
  de **tu** radio de escucha (5 / 20 / 100 km / global). Es la puerta de entrada.
- **Reputación (gate anti-spam):** un autor **desconocido** sin aval de tu
  web-of-trust **no entra al feed**; sus reps/replies/menciones caen en una
  **bandeja efímera** (como el messenger). Vos decidís si lo dejás entrar.
- **TTL 24 h:** un eco con beacon expirado ni se descubre ni se re-emite. Muere
  en la red; tu copia local queda como archivo privado (nunca se re-broadcastea).

### Capa 2 — Orden del feed (cómo se muestra lo que ya entró)
Ranking ponderado, **calculado 100 % en tu cliente** sobre tu store local:

| # | Señal | Peso | Por qué este lugar |
|---|-------|------|--------------------|
| 1 | **Recencia** | 0.30 | El feed es efímero; en una ventana de 24 h, frescura manda. Decay exponencial `e^(-edad/τ)`, τ≈8 h. |
| 2 | **Afinidad** | 0.25 | Tu historial real con el autor (contacto, ratings que *vos* diste, reps/replies previos). La señal más personal y la más difícil de spamear. |
| 3 | **Reputación** | 0.20 | Ya filtró en capa 1; acá es **boost de calidad** (web-of-trust), no gate. |
| 4 | **Tags** | 0.15 | Overlap (Jaccard) entre los tags del eco y tus intereses. |
| 5 | **Geo** | 0.10 | **Bajo a propósito:** geo ya pre-filtró en capa 1; como peso es casi un desempate "lo más cerca primero". |

`score = 0.30·recencia + 0.25·afinidad + 0.20·reputación + 0.15·tags + 0.10·geo`
(cada término normalizado 0–1).

**Presets** visibles para el usuario (ajustan los pesos): **Fresco** (casi solo
recencia), **Tu gente** (sube afinidad+reputación), **Cerca** (sube geo),
**Temas** (sube tags). Cronológico puro siempre disponible.

## 4. Anatomía de un eco / anatomy of an eco

```jsonc
{
  "id": "uuid",            // estable; clave de dedup
  "author": "<pubkey-jwk>",// identidad del vault (descubrimiento == transporte)
  "text": "…",             // máx ~280
  "links": ["https://…"],  // enlaces; preview se genera LOCAL (sin JS de terceros)
  "tags": ["barrio", "…"], // se normalizan (geo.normalizeTags)
  "lat": 0, "lng": 0,      // geohash grueso para descubrir; coords finas no se exponen
  "createdAt": 0,          // ms epoch
  "expiresAt": 0,          // createdAt + 24h, o bump por rep/reply
  "repostOf": null,        // pubkey+id del original si es repost
  "replyTo": null,         // pubkey+id del original si es reply
  "sig": "…"               // firma del vault sobre el contenido canónico
}
```

## 5. Flujos / flows

### Publicar / publish
1. Escribir el eco localmente → `store.appendMessage('eco:mine', eco)`.
2. `geo.publishPin({ lat, lng, payload: eco, tags, ttlMs: 24h })` — el **beacon**
   lleva tu eco más reciente (texto+enlaces caben; es metadata de app).
   *Un pin por identidad, overwrite:* tu beacon = tu estado actual.

### Descubrir / discover (poll)
1. Periódicamente `geo.queryRadius({ lat, lng, radiusMeters, tags })`.
2. Por cada beacon nuevo (por `id`): `store.appendMessage('eco:'+author, eco)`.
   Cada lector **acumula** en su store los beacons que vio mientras estaban
   vivos: el índice geo sólo guarda el último, pero tu archivo local crece.
3. Reconstruir el feed: unir todos los threads `eco:*`, rankear (capa 2), mostrar.

### Reply / repost (resetean TTL del original)
1. `proxy.sendByPubkey([authorOriginal], { type:'eco-reply'|'eco-repost', … })`
   → cae en la cola offline 24 h del autor original.
2. Al recibirlo, el cliente del original **rehidrata su beacon**
   (`publishPin` con TTL fresco): el eco tocado vuelve a estar vivo 24 h.
3. El que hace repost publica además **su propio** beacon con el contenido
   citado (crédito al pubkey original), propagándolo a su radio.

### Bandeja efímera / ephemeral inbox
- Mensajes `eco-*` de un pubkey **no contacto**: si está **avalado por tu red**
  → `store.appendMessage('eco:inbox', msg)` y notificación; si no → se descarta.
- Aceptar desde la bandeja agrega el autor (vault contacto) y mueve sus ecos al
  feed; ignorar lo deja morir.

### Muerte / death
- Beacon expirado (24 h sin rehidratar) → fuera del índice; el feed deja de
  mostrarlo (filtro `expiresAt`). La copia en el store queda como **archivo
  privado**: visible sólo para vos, **nunca** se re-emite ni se indexa.

## 6. Privacidad / privacy (no romper la filosofía)

- Geohash grueso para descubrir; **coords finas nunca** en el payload.
- El contenido del usuario **no** se indexa ni se prerenderiza para SEO: el SEO
  describe la cáscara (la herramienta), no los ecos. Share-links, si los hubiera,
  por `#fragment` (no llega al server).
- Ranking y grafo de afinidad **sólo en el cliente**: el server geo/proxy nunca
  ve tu orden ni a quién seguís.
- Sin trackers de terceros. Analítica: GoatCounter cookieless, sólo producción.

## 7. v1 (alcance) / scope

- Texto + enlaces (preview local) + tags. **Sin imágenes** todavía.
- Reply + repost, ambos rehidratan el TTL del original.
- **Like / dislike**: nudgean (±) la afinidad local con el autor y **persisten el
  eco en tu archivo** (sobrevive a la muerte de la red como copia tuya, marcado 📌).
- **Compartir** a redes (Web Share API nativa; fallback a intent sin JS de terceros).
- Acciones solo-iconos. Intereses **auto-aprendidos** (hashtags propios + lo que
  reposteás/respondés) + buscador que los genera + panel de gestión aparte.
- Bandeja efímera para desconocidos avalados.
- El **lector** define su radio.
- Presets de orden + cronológico.

### Después / later
- Imágenes efímeras (blob en el store con TTL).
- Hilos multinivel.
- Alcance definido por el autor (intersección con el radio del lector).
- Descubrimiento de nodos geo vía `nodes.json` (hoy baseUrl por defecto).
