// Resolver la imagen de un eco: por URL del bucket, por bytes de la red, o nada
// (sin node del dueño) — y en ese último caso el eco se sigue viendo.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMediaResolver } from '../src/services/media.js'

const CID = 'sha256-' + 'cd'.repeat(32)
const media = { owner: 'OWNER', cid: CID, mime: 'image/jpeg' }
const objectUrl = (bytes, mime) => `blob:${mime}:${bytes.length}`

test('con bucket: la URL que da el node es el atajo y se usa tal cual', async () => {
  let calls = 0
  const r = createMediaResolver({ fetchPublic: async () => { calls++; return { url: 'https://c.example.com/' + CID, bytes: null } }, makeObjectUrl: objectUrl })
  assert.equal(await r.resolve(media), 'https://c.example.com/' + CID)
  assert.equal(await r.resolve(media), 'https://c.example.com/' + CID)
  assert.equal(calls, 1, 'inmutable: se resuelve una vez por cid')
})

test('sin bucket: los bytes vienen por la red y se envuelven en una URL local', async () => {
  const r = createMediaResolver({ fetchPublic: async () => ({ url: null, bytes: new Uint8Array(5), mime: 'image/png' }), makeObjectUrl: objectUrl })
  assert.equal(await r.resolve(media), 'blob:image/png:5')
})

test('sin ningún node del dueño: null (la imagen no aparece, el eco sí), y no se insiste en cada repintado', async () => {
  let calls = 0
  let t = 1000
  const r = createMediaResolver({
    fetchPublic: async () => { calls++; throw Object.assign(new Error('no node'), { code: 'no-node' }) },
    makeObjectUrl: objectUrl,
    now: () => t
  })
  assert.equal(await r.resolve(media), null)
  assert.equal(await r.resolve(media), null)
  assert.equal(calls, 1, 'el fallo se recuerda un rato')
  t += 61_000
  assert.equal(await r.resolve(media), null)
  assert.equal(calls, 2, 'y pasado ese rato se vuelve a intentar (el dueño pudo encender su node)')
})

test('diez ecos con la misma imagen a la vez = una sola consulta', async () => {
  let calls = 0
  const r = createMediaResolver({
    fetchPublic: () => new Promise((res) => setTimeout(() => { calls++; res({ url: 'https://x/' + CID }) }, 5)),
    makeObjectUrl: objectUrl
  })
  const all = await Promise.all(Array.from({ length: 10 }, () => r.resolve(media)))
  assert.ok(all.every((u) => u === 'https://x/' + CID))
  assert.equal(calls, 1)
})

test('mi propia imagen no se pide a nadie: ya tengo los bytes', async () => {
  let calls = 0
  const r = createMediaResolver({ fetchPublic: async () => { calls++; return {} }, makeObjectUrl: objectUrl })
  r.setLocal(CID, new Uint8Array(9), 'image/jpeg')
  assert.equal(await r.resolve(media), 'blob:image/jpeg:9')
  assert.equal(calls, 0)
})

test('si la URL del bucket falla al cargar, invalidar la hace pedir por la red', async () => {
  let n = 0
  const r = createMediaResolver({
    fetchPublic: async () => (++n === 1 ? { url: 'https://caido/' + CID } : { bytes: new Uint8Array(2), mime: 'image/jpeg' }),
    makeObjectUrl: objectUrl
  })
  assert.equal(await r.resolve(media), 'https://caido/' + CID)
  r.invalidate(CID)
  assert.equal(await r.resolve(media), 'blob:image/jpeg:2')
})

test('una referencia rota no llega a la red', async () => {
  let calls = 0
  const r = createMediaResolver({ fetchPublic: async () => { calls++; return {} } })
  assert.equal(await r.resolve(null), null)
  assert.equal(await r.resolve({ cid: CID }), null)
  assert.equal(calls, 0)
})
