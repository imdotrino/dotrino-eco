# Eco

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Dotrino es un ecosistema de aplicaciones centradas en la privacidad de los datos: tu información es tuya, y las decisiones sobre ella también — qué compartes, con quién, cuándo y por qué. Sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

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

## Guardar una copia de tus ecos (opt-in, por eco)

Eco es **efímero**: el beacon geo dura 24 h y lo que sobrevive es la copia local de
quien lo guardó. Con un [content node](https://content.dotrino.com/) propio encendido,
Eco ofrece además **guardar una copia tuya en tu propia máquina** — y eso cambia lo que
la app promete, así que se pide **eco a eco** y nunca se hace por detrás.

- **Lo efímero sigue siendo el default.** El interruptor del composer no se recuerda
  entre un eco y otro: publicar creyendo que se borra solo y toparte el enlace vivo un
  año después es exactamente lo que no hacemos.
- **Va cifrado.** El node guarda bytes que no puede leer; la llave sale en el
  `#fragment` del enlace y nunca llega a un servidor.
- **Sin node, Eco funciona igual.** El interruptor no aparece y ya está. Ninguna app del
  ecosistema puede exigir que tengas una máquina encendida.
- **El reparto con el almacén** (CONVENCIONES §4): en el `@dotrino/store` vive el
  **índice** de lo guardado —qué eco es qué `cid`—, porque tiene que estar disponible
  aunque la máquina esté apagada; en el content viven **los bytes**, que es un objeto
  firmado e inmutable y por eso encaja en el direccionado por hash. La línea de tiempo
  no es un blob: es una lista que crece.
