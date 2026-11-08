'use client'

import { PanelNoValido } from '@/components/tareas-clientes/portal/PanelPublico'

/** Si la página se cae (la base no contesta): la pantalla con la marca, no la del framework. Lo que falló no se enseña. */
export default function ErrorDelPanelDelCliente() {
  return <PanelNoValido texto="Ha habido un fallo por nuestra parte. Vuelve a probar en un momento; si sigue igual, avisa a Liberty Seller." />
}
