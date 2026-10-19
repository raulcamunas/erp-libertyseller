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
 */
export async function bajarRespuesta(res: Response, nombreSiFalta: string): Promise<void> {
  const blob = await res.blob()
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? nombreSiFalta
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}
