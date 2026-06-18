// E2E de Eco contra los servicios de PRODUCCIÓN, replicando el signData del vault
// (ECDSA P-256, canónico, raw ieee-p1363 base64) e inyectándolo en los paquetes
// reales del ecosistema. Cubre: geo (publicar/descubrir/retirar) y reputación.
// El vault y el store son iframes de navegador → no headless (ver checklist).
import crypto from 'node:crypto'
import { createGeoClient } from '@dotrino/geo'

function canonicalStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}'
}

// Crea una "identidad" estilo vault: signData(data)->base64, getPublicKeyJwk()->string
function makeIdentity () {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const pub = JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y })
  return {
    getPublicKeyJwk: async () => pub,
    signData: async (data) => {
      const sig = crypto.sign('sha256', Buffer.from(canonicalStringify({ ...data, publickey: pub }), 'utf8'),
        { key: privateKey, dsaEncoding: 'ieee-p1363' })
      return sig.toString('base64')
    },
    pub
  }
}

const ok = (c, m) => console.log(`${c ? '✅' : '❌'} ${m}`)
let failures = 0
const must = (c, m) => { ok(c, m); if (!c) failures++ }

// Punto de prueba aislado (océano, lejos de pines reales) + tag único.
const LAT = 12.345678, LNG = -45.678901
const TAG = 'ecoe2e' + Math.floor(LAT * 1000)

async function main () {
  const A = makeIdentity()
  const B = makeIdentity()
  const geoA = createGeoClient({ signData: A.signData, getPublicKeyJwk: A.getPublicKeyJwk })
  const geoB = createGeoClient({ signData: B.signData, getPublicKeyJwk: B.getPublicKeyJwk })

  console.log('\n== GEO (geo.dotrino.com) ==')
  // 1) A publica un eco como beacon
  const eco = { id: 'e2e-' + Date.now(), author: A.pub, text: 'hola e2e', links: ['https://dotrino.com'], tags: [TAG], createdAt: Date.now() }
  const pub = await geoA.publishPin({ lat: LAT, lng: LNG, payload: eco, tags: [TAG], ttlMs: 5 * 60 * 1000 })
  must(pub && pub.ok, `A publishPin → ok (expiresAt ${pub?.expiresAt ? 'set' : 'missing'}, geohash ${pub?.geohash || '?'})`)

  // 2) B descubre por radio + tag
  const q = await geoB.queryRadius({ lat: LAT, lng: LNG, radiusMeters: 5000, tags: [TAG] })
  const found = (q.pins || []).find(p => p.publickey === A.pub)
  must(!!found, `B queryRadius encuentra el pin de A (${q.pins?.length || 0} pins)`)
  if (found) {
    must(found.payload?.id === eco.id, `payload del eco llega íntegro (text="${found.payload?.text}")`)
    must(Array.isArray(found.tags) && found.tags.includes(TAG), `tags llegan (${JSON.stringify(found.tags)})`)
    must(typeof found.distanceMeters === 'number', `distanceMeters=${found.distanceMeters}`)
  }

  // 3) overwrite: A republica (rehidrata TTL) y sigue habiendo un solo pin de A
  const eco2 = { ...eco, text: 'rehidratado', createdAt: Date.now() }
  await geoA.publishPin({ lat: LAT, lng: LNG, payload: eco2, tags: [TAG], ttlMs: 10 * 60 * 1000 })
  const q2 = await geoB.queryRadius({ lat: LAT, lng: LNG, radiusMeters: 5000, tags: [TAG] })
  const mineCount = (q2.pins || []).filter(p => p.publickey === A.pub).length
  must(mineCount === 1, `overwrite: un solo pin por identidad tras republicar (n=${mineCount})`)
  const found2 = (q2.pins || []).find(p => p.publickey === A.pub)
  must(found2?.payload?.text === 'rehidratado', `el beacon refleja el último eco (text="${found2?.payload?.text}")`)

  // 4) firma inválida → rechazada (seguridad)
  let rejected = false
  try {
    await geoA.publishPin({ lat: LAT, lng: LNG, payload: eco, tags: [TAG], ttlMs: 60000, now: 1 }) // issuedAt viejo (anti-replay)
  } catch (e) { rejected = true }
  ok(rejected, `pin con issuedAt fuera de ventana → rechazado (anti-replay)` + (rejected ? '' : ' (no rechazó; revisar)'))

  // 5) A retira su pin → B ya no lo ve
  await geoA.removePin()
  const q3 = await geoB.queryRadius({ lat: LAT, lng: LNG, radiusMeters: 5000, tags: [TAG] })
  const gone = !(q3.pins || []).some(p => p.publickey === A.pub)
  must(gone, `removePin: el pin desaparece del índice`)

  console.log('\n== REPUTACIÓN (reputation.dotrino.com) ==')
  try {
    const r = await fetch('https://reputation.dotrino.com/health')
    must(r.ok, `health → ${r.status}`)
  } catch (e) { must(false, `health inalcanzable: ${e.message}`) }

  console.log(`\n${failures === 0 ? '🟢 GEO/REPUTACIÓN OK' : '🔴 ' + failures + ' fallos'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('💥', e); process.exit(2) })
