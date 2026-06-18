// Notificaciones de Eco sobre el paquete compartido del ecosistema
// (@dotrino/notifications). Centraliza el permiso + Web Push y
// agrega preferencias por tipo de aviso (respuestas / re-ecos) con scope 'eco'.
// La bandeja in-app (lista de notificaciones) sigue siendo del feedStore; acá
// solo decidimos permiso, push y si cada tipo debe avisar.
import { createNotifications, createVaultPushProvider } from '@dotrino/notifications'
import { getWebSocketProxyClient } from '@dotrino/proxy-client'
import { getIdentity } from './identity'

// Los `key` coinciden con los `type` de los eventos del proxy (eco-reply / eco-repost).
const CATEGORIES = [
  { key: 'eco-reply', label: { es: 'Respuestas', en: 'Replies' }, hint: { es: 'Cuando responden a tu eco.', en: 'When someone replies to your eco.' } },
  { key: 'eco-repost', label: { es: 'Re-ecos', en: 'Reposts' }, hint: { es: 'Cuando re-ecoan tu eco.', en: 'When someone reposts your eco.' } },
]

// Eco antes auto-activaba push si había permiso (sin flag explícito). Preservamos
// ese opt-in: si ya hay permiso concedido y no existe el flag, lo marcamos on.
function migrateLegacy () {
  try {
    if (localStorage.getItem('cc-push:eco') == null &&
        typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      localStorage.setItem('cc-push:eco', '1')
    }
  } catch (_) {}
}

let _ctrl = null
export function getNotifications () {
  if (_ctrl) return _ctrl
  migrateLegacy()
  _ctrl = createNotifications({
    storageKey: 'eco',
    categories: CATEGORIES,
    sound: false,
    push: createVaultPushProvider({
      proxyClient: () => getWebSocketProxyClient(),
      identity: () => getIdentity(),
      storageKey: 'eco',
    }),
  })
  return _ctrl
}

// ¿Avisar de este tipo de evento? (gatea la bandeja in-app del feedStore).
export function shouldNotifyType (type) { return getNotifications().shouldNotify(type) }

// Re-registra la push subscription tras identify (endpoints rotan). Silencioso.
export function ensurePushSubscribed () {
  const p = getNotifications().push
  return p ? p.ensureSubscribed() : Promise.resolve()
}
