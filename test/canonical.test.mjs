// La firma cubre la imagen, y los ecos viejos (sin imagen) siguen firmando igual.
import test from 'node:test'
import assert from 'node:assert/strict'
import { canonical } from '../src/feed/canonical.js'

const base = {
  id: 'e1', author: 'PK', authorName: 'ana', text: 'hola', links: [], tags: ['x'],
  createdAt: 1, repostOf: null, replyTo: null, quoted: null
}

test('un eco sin imagen canoniza igual que antes (compatibilidad de firmas)', () => {
  const before = JSON.stringify({
    id: 'e1', author: 'PK', authorName: 'ana', text: 'hola', links: [], tags: ['x'],
    createdAt: 1, repostOf: null, replyTo: null, quoted: null
  })
  assert.equal(canonical(base), before)
  assert.equal(canonical({ ...base, media: null }), before)
})

test('la imagen entra en lo firmado: cambiarla rompe la firma', () => {
  const a = canonical({ ...base, media: { owner: 'O', cid: 'sha256-' + '1'.repeat(64) } })
  const b = canonical({ ...base, media: { owner: 'O', cid: 'sha256-' + '2'.repeat(64) } })
  assert.notEqual(a, b)
  assert.notEqual(a, canonical(base))
})

test('lo que añade quien lee (distancia, vencimiento) NO entra en la firma', () => {
  assert.equal(canonical({ ...base, distanceMeters: 12, expiresAt: 99 }), canonical(base))
})
