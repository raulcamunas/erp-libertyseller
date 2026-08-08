/**
 * PROPUESTA DE DISEÑO «CLARO Y NÍTIDO».
 *
 * Todo autocontenido en esta carpeta: no toca app/globals.css, ni el layout, ni
 * ningún componente del ERP. Para verla, basta con montar `Propuesta` dentro de
 * una ruta:
 *
 *   import Propuesta from '@/components/disenos/claro'
 *   export default function Page() { return <Propuesta /> }
 *
 * La memoria de la propuesta —idea, escala, paleta, ratios medidos, filas por
 * pantalla y el balance honesto— está en README.md y en memoria.ts, y la
 * pantalla «La ficha del diseño» la pinta desde ahí.
 */

export { default } from './Propuesta'
export { default as Propuesta } from './Propuesta'
export { Marco, Estilos, type Modo } from './Marco'
export { PantallaInicio } from './PantallaInicio'
export { PantallaColdCalling } from './PantallaColdCalling'
export { PantallaPerfil } from './PantallaPerfil'
export { Ficha } from './Ficha'
export { CSS } from './estilos'
export * from './memoria'
