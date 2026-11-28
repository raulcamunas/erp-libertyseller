/** Los avisos de un cliente en un panel de «Todos los clientes»: el más grave va de principal (rojo antes que ámbar, y en el orden en que se añadieron) y el resto debajo. PURO */
export type AvisoDelPanel = { texto: string; tono: 'rojo' | 'ambar' }

export function repartirAvisos(lista: ReadonlyArray<AvisoDelPanel | null | undefined | false | '' | 0>): { aviso: AvisoDelPanel | null; masAvisos: AvisoDelPanel[] } {
  const todos = lista.filter((a): a is AvisoDelPanel => Boolean(a))
  const orden = [...todos.filter((a) => a.tono === 'rojo'), ...todos.filter((a) => a.tono === 'ambar')]
  return { aviso: orden[0] ?? null, masAvisos: orden.slice(1) }
}
