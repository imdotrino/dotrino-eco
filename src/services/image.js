// Preparar una imagen para un eco: encogerla hasta que quepa por el plano de
// control del node (IMAGE_MAX_BYTES), sin pedirle al usuario que sepa de tamaños.
//
// Solo navegador (canvas). Se prueba en el navegador, no aquí; lo que decide qué
// entra y qué no (tipo, tope) vive en publicEco.js, que sí es puro.

import { IMAGE_MAX_BYTES } from './publicEco.js'

const MAX_SIDE = 1280

/**
 * Dibuja el bitmap a `w`×`h` y lo saca en JPEG. OffscreenCanvas si lo hay (y entonces
 * `convertToBlob`); si no, un `<canvas>` con `toBlob`.
 * @param {ImageBitmap} bitmap
 * @param {number} w
 * @param {number} h
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
async function drawJpeg (bitmap, w, h, quality) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('the canvas gave no image')
  return blob
}

/**
 * @param {File|Blob} file
 * @param {{ maxSide?: number, maxBytes?: number }} [opts]
 * @returns {Promise<{ bytes: Uint8Array<ArrayBuffer>, mime: string, width: number, height: number }>}
 */
export async function shrinkImage (file, { maxSide = MAX_SIDE, maxBytes = IMAGE_MAX_BYTES } = {}) {
  if (!/^image\//.test(file?.type || '')) throw Object.assign(new Error('not an image'), { code: 'bad-image' })
  // Un GIF se deja tal cual si ya cabe: re-encodarlo perdería la animación.
  if (file.type === 'image/gif' && file.size <= maxBytes) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { bytes, mime: 'image/gif', width: 0, height: 0 }
  }
  const bitmap = await createImageBitmap(file)
  try {
    let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    let quality = 0.85
    // Baja calidad primero y tamaño después, hasta que quepa. Termina siempre.
    for (let i = 0; i < 8; i++) {
      const w = Math.max(1, Math.round(bitmap.width * scale))
      const h = Math.max(1, Math.round(bitmap.height * scale))
      const blob = await drawJpeg(bitmap, w, h, quality)
      if (blob.size <= maxBytes || i === 7) {
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', width: w, height: h }
      }
      if (quality > 0.5) quality -= 0.15
      else scale *= 0.75
    }
  } finally {
    bitmap.close?.()
  }
  throw new Error('unreachable')
}

export default { shrinkImage }
