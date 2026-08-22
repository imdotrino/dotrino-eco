// Lo público de un eco en el content, CON y SIN node. La regla que estas pruebas
// vigilan: el content es una extensión del store, nunca un requisito — sin node
// todo devuelve null y el eco sale igual; con node, sale con imagen y copia pública,
// ambas en claro, públicas y con la vida del beacon.
import test from 'node:test'
import assert from 'node:assert/strict'
import { attachImage, publishPublicCopy, pinPublic, mediaOf, IMAGE_MAX_BYTES } from '../src/services/publicEco.js'
import { TTL_24H } from '../src/feed/constants.js'

const CID = 'sha256-' + 'ab'.repeat(32)

/** Un node de mentira que recuerda lo que le pidieron. */
function fakeNode () {
  const puts = []
  const pins = []
  return {
    puts,
    pins,
    async put (bytes, opts) { puts.push({ bytes, opts }); return { owner: 'OWNER', cid: CID, size: bytes.length } },
    async pin (cid) { pins.push(cid) }
  }
}

const png = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), mime: 'image/png', width: 10, height: 5 }

test('SIN node: nada se sube, nada lanza, el eco sale como siempre', async () => {
  assert.equal(await attachImage({ cc: null, image: png }), null)
  assert.equal(await publishPublicCopy({ cc: null, eco: { id: 'e1', text: 'hola' } }), null)
  assert.equal(await pinPublic({ cc: null, eco: {}, ref: null }), false)
})

test('CON node: la imagen sube pública, en claro y con el TTL del beacon', async () => {
  const cc = fakeNode()
  const media = await attachImage({ cc, image: png })
  assert.deepEqual(media, { owner: 'OWNER', cid: CID, mime: 'image/png', size: 7, width: 10, height: 5 })
  const { opts } = cc.puts[0]
  assert.equal(opts.encrypt, false, 'en claro: una imagen pública cifrada no la vería nadie')
  assert.equal(opts.acl, 'public')
  assert.equal(opts.ttlMs, TTL_24H, 'lo efímero sigue siendo efímero: vive lo que el beacon')
  assert.equal(opts.mime, 'image/png')
})

test('la copia pública del eco va en claro, pública, con TTL y con su tarjeta', async () => {
  const cc = fakeNode()
  const eco = { id: 'e1', authorName: 'ana', text: 'un eco con imagen', media: { owner: 'OWNER', cid: CID } }
  const ref = await publishPublicCopy({ cc, eco })
  assert.deepEqual(ref, { owner: 'OWNER', cid: CID })
  const { bytes, opts } = cc.puts[0]
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)), eco, 'los bytes son el eco tal cual (firmado)')
  assert.equal(opts.acl, 'public'); assert.equal(opts.encrypt, false); assert.equal(opts.ttlMs, TTL_24H)
  assert.equal(opts.meta.title, '@ana'); assert.equal(opts.meta.description, 'un eco con imagen')
})

test('un node que FALLA lanza (quien publica decide salir sin imagen, pero enterado)', async () => {
  const cc = { async put () { throw new Error('node apagado a media subida') } }
  await assert.rejects(attachImage({ cc, image: png }), /node apagado/)
})

test('lo que no es imagen o pesa de más se rechaza ANTES de tocar el node', async () => {
  const cc = fakeNode()
  await assert.rejects(attachImage({ cc, image: { bytes: new Uint8Array(3), mime: 'image/svg+xml' } }), { code: 'bad-image' })
  await assert.rejects(attachImage({ cc, image: { bytes: new Uint8Array(IMAGE_MAX_BYTES + 1), mime: 'image/jpeg' } }), { code: 'too-large' })
  assert.equal(cc.puts.length, 0)
})

test('«guardar una copia» retiene la imagen y la copia pública (pin), y sin node no hace nada', async () => {
  const cc = fakeNode()
  const ok = await pinPublic({ cc, eco: { media: { cid: 'sha256-' + '11'.repeat(32) } }, ref: { cid: CID } })
  assert.equal(ok, true)
  assert.deepEqual(cc.pins, ['sha256-' + '11'.repeat(32), CID])
})

test('mediaOf solo acepta una referencia bien formada (lo que llega por el pin no se fía)', () => {
  assert.equal(mediaOf({ text: 'sin imagen' }), null)
  assert.equal(mediaOf({ media: { owner: 'x', cid: 'no-es-un-cid' } }), null)
  assert.equal(mediaOf({ media: 'javascript:alert(1)' }), null)
  assert.deepEqual(mediaOf({ media: { owner: 'x', cid: CID } }), { owner: 'x', cid: CID })
})
