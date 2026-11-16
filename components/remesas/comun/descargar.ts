/**
 * BAJAR AL DISCO LO QUE HA DEVUELTO UNA RUTA.
 *
 * El nombre del fichero lo propone la ruta en `Content-Disposition` —ya limpio y en
 * ASCII— y aquí solo se usa. Si no lo trae (un proxy que se lo come, una ruta nueva
 * que se olvidó), sale con `nombreSiFalta`: un fichero sin nombre se llama «download» y
 * cuesta encontrarlo en Descargas.
 *
 * Es la misma jugada que hacía PlantillasAmazon por su cuenta; está aquí aparte para que
 * el Excel de la propuesta y lo que venga después no la copien una vez más.
 *
 * API
 *   bajarRespuesta(res, nombreSiFalta)   baja el cuerpo de una respuesta con el nombre de Content-Disposition
 *   bajarBlob(blob, nombre)              baja un Blob hecho en el navegador (CSV, PNG de un gráfico…)
 */
export async function bajarRespuesta(res: Response, nombreSiFalta: string): Promise<void> {
  const blob = await res.blob()
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? nombreSiFalta
  bajarBlob(blob, nombre)
}

export function bajarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Safari empieza la descarga después del clic: si la URL se revoca en el acto, a veces baja un fichero vacío
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
