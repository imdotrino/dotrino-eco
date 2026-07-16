import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
// La moneda de support ya no se importa aquí: la trae <dotrino-topbar> (§5/§6).
import '@dotrino/profile'
import '@dotrino/install'
import { createBackNav } from '@dotrino/nav'
import './style.css'

// Navegación "volver" unificada del ecosistema: el botón físico de Android / el
// gesto de iOS / el atrás del navegador y el chevron del header comparten la
// misma cascada (modal → vista anterior → página anterior → dotrino.com).
createBackNav()

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
