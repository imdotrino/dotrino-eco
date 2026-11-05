// Lo que los pilares no declaran (o declaran distinto de lo que hace su código), con la
// forma que tiene su código. SOLO lo que usa Eco.

import '@dotrino/identity'

// @dotrino/identity 0.126.2: `profileActa()` existe en src/index.js pero no en su index.d.ts
// (versiones posteriores ya lo declaran).
declare module '@dotrino/identity' {
  interface Identity {
    profileActa (): Promise<{ acta?: { profileId?: string } } | null>
  }
}
