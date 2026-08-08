/**
 * PROPUESTA DE DISEÑO «DENSO Y SOBRIO».
 *
 * Punto de entrada único. La app de comparación puede montar `DisenoDenso`
 * entera (trae su propio conmutador de pantalla, tema y altura de ventana) o
 * cada pantalla por separado si quiere poner las tres propuestas una al lado de
 * la otra.
 *
 * Todo lo de esta carpeta es autónomo: los estilos se inyectan desde
 * `estilos.ts` con el prefijo `dz-` y no se toca app/globals.css, ni el layout,
 * ni ningún componente del ERP.
 *
 * Para montarla en una ruta nueva basta con:
 *
 *   'use client'
 *   import { DisenoDenso } from '@/components/disenos/denso'
 *   export default function Pagina() { return <DisenoDenso /> }
 */

export { DisenoDenso, type PantallaDenso } from './DisenoDenso'
export { PantallaInicio } from './PantallaInicio'
export { PantallaColdCalling } from './PantallaColdCalling'
export { PantallaPerfil } from './PantallaPerfil'
export { useEstilosDenso, BarraLateral, BarraSuperior, Estado, Pildora, type Tema } from './Marco'
export { ESTILOS_DENSO } from './estilos'
export * as MEMORIA from './memoria'
