# Eco

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Misión: aplicaciones que resuelven problemas comunes, respetando tu privacidad — sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

**Microblogging efímero y georreferenciado del ecosistema Dotrino.**
Tu voz, en tu zona, bajo tus reglas. → `https://eco.dotrino.com/`

Publicás un **eco** (texto + enlaces + tags) con tu ubicación. Quien lo tenga en
su **radio de escucha** lo descubre por `geo.dotrino.com`, lo recibe en su
cuenta y lo **archiva localmente** en su store. A las **24 h** el eco muere en la
red: deja de descubrirse y **nunca se re-emite**; sólo sobrevive la copia local
privada de quien lo guardó. **Reps y replies rehidratan** el original y le
resetean el TTL — *lo que la red sigue tocando, sigue vivo*.

## No reimplementa nada: compone el ecosistema

Eco es una composición de los pilares compartidos, sin backend propio:

| Pilar | Paquete | Rol en Eco |
|-------|---------|------------|
| Identidad | `@dotrino/identity` | firma cada eco; grafo de afinidad |
| Transporte | `@dotrino/proxy-client` | `sendByPubkey` para reply/repost/mención (cola 24 h) |
| Almacenamiento | `@dotrino/store` | tu archivo local durable (lo único persistente) |
| Descubrimiento geo | `@dotrino/geo` | beacon firmado: publicar/descubrir por radio + tags |
| Reputación | `@dotrino/reputation` | gate anti-spam + boost de orden (web-of-trust) |

## Las dos capas

1. **Descubrimiento (qué te llega):** geo por radio + gate de reputación
   (desconocido sin aval → bandeja efímera) + TTL 24 h.
2. **Orden del feed (cómo se muestra):** ranking ponderado **100 % en el
   cliente** — recencia · afinidad · reputación · tags · geo. Presets: Fresco /
   Tu gente / Cerca / Temas / Cronológico.

Detalle completo en [`DESIGN.md`](./DESIGN.md).

## Privacidad

- Efímero en la red, durable sólo en tu store local; **nada se indexa**.
- Geohash grueso para descubrir; coords finas nunca en el payload.
- Ranking y grafo de afinidad sólo en tu cliente; el server nunca ve tu orden.
- Sin trackers de terceros. Analítica: GoatCounter cookieless, sólo producción.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:3120
npm run build    # dist/
```

Requiere el vault `id.dotrino.com` para publicar (firma). Sin vault, Eco abre en
**modo archivo local** (solo lectura de lo ya guardado).

---

Parte del ecosistema **Dotrino** — *tu información, en tu servidor, bajo tus
reglas*. Soporte: [Ko-fi](https://ko-fi.com/dotrino) ·
[Discord](https://discord.gg/D648uq7cth).
