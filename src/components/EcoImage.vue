<script setup>
// La imagen de un eco. Pide la URL al resolvedor (URL del bucket, o bytes por la
// red) y, mientras llega o si no llega, no ocupa el sitio con un error: el eco es
// el texto; la imagen es un extra que aparece cuando el node del dueño contesta.
import { ref, watch, onMounted } from 'vue'
import { resolveMedia, invalidateMedia } from '../services/media-app'

const props = defineProps({
  media: { type: Object, required: true },
  alt: { type: String, default: '' }
})

const src = ref(null)
const state = ref('loading')   // loading | ready | missing
let retried = false

async function load () {
  state.value = 'loading'
  const url = await resolveMedia(props.media)
  if (url) { src.value = url; state.value = 'ready' } else { src.value = null; state.value = 'missing' }
}

/** La URL del bucket falló (borrada, bucket caído): se vuelve a pedir por la red. */
async function onError () {
  if (retried) { state.value = 'missing'; return }
  retried = true
  invalidateMedia(props.media.cid)
  await load()
}

onMounted(load)
watch(() => props.media?.cid, load)
</script>

<template>
  <figure class="eco-media" :class="state" :data-cid="media.cid" data-testid="eco-image">
    <img v-if="src" :src="src" :alt="alt" loading="lazy" decoding="async" @error="onError" />
    <span v-else-if="state === 'loading'" class="ph" aria-hidden="true"></span>
  </figure>
</template>

<style scoped>
.eco-media { margin: 8px 0 0; border-radius: 12px; overflow: hidden; max-width: 100%; }
.eco-media img { display: block; max-width: 100%; max-height: 60vh; object-fit: contain; border-radius: 12px; background: #0d1521; }
.eco-media.missing { display: none; }
.ph { display: block; height: 120px; border-radius: 12px; background: linear-gradient(90deg, #10203a, #162a4a, #10203a); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
@keyframes shimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
</style>
