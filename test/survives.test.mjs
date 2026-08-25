// Qué se queda en el feed. Lo efímero es efímero —a las 24 h un eco deja de descubrirse—
// pero el ENLACE de un eco se comparte justamente para que abra después, y por eso su copia
// pública va pineada en el node del autor. Filtrar por vencido lo que llegó por enlace hacía
// que abrir el enlace no mostrara nada, sin decir por qué.
import test from 'node:test'
import assert from 'node:assert/strict'
import { survives } from '../src/feed/ranking.js'
import { TTL_24H } from '../src/feed/constants.js'

const now = Date.now()
const vivo = { id: 'a', createdAt: now - 1000, expiresAt: now + TTL_24H }
const muerto = { id: 'b', createdAt: now - 3 * TTL_24H, expiresAt: now - 2 * TTL_24H }

test('vivo: se queda, sin necesitar nada más', () => {
  assert.equal(survives(vivo, { now }), true)
})

test('muerto y ajeno: fuera del feed (lo efímero es efímero)', () => {
  assert.equal(survives(muerto, { now }), false)
})

test('muerto pero ABIERTO POR ENLACE: se queda — para eso está pineada su copia pública', () => {
  assert.equal(survives(muerto, { now, opened: true }), true)
})

test('muerto pero REACCIONADO: se queda', () => {
  assert.equal(survives(muerto, { now, reacted: true }), true)
})

test('sin expiresAt se cuentan 24 h desde que se creó', () => {
  assert.equal(survives({ id: 'c', createdAt: now - 1000 }, { now }), true)
  assert.equal(survives({ id: 'd', createdAt: now - TTL_24H - 1000 }, { now }), false)
})
