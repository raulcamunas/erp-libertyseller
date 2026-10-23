import { analizarDireccion, type AnalisisDeDireccion, type ProblemaDeDireccion } from './direccion'
import { comprobarDominio, type OpcionesDeDominio, type ResolvedorDeDominio, type ResultadoDeDominio } from './dominio'

/**
 * EL VEREDICTO DE UNA DIRECCIÓN: BUENA, DUDOSA O MALA, Y POR QUÉ.
 * ================================================================
 * SOLO SERVIDOR (usa el DNS y la memoria de direcciones). Se comprueba con verificar.prueba.ts.
 *
 * Junta tres cosas, de la más barata a la más cara, y para en cuanto una dice «mala»:
 *   1. cómo está escrita (direccion.ts): sintaxis, erratas de proveedores, desechables, direcciones que no lee nadie;
 *   2. si ya rebotó antes (la memoria de direcciones malas del ERP, que aprende de cada rebote);
 *   3. si su dominio existe y recibe correo (dominio.ts, por DNS).
 *
 * Un veredicto «dudosa» NO bloquea: avisa (una errata probable de gmail.com, una dirección que parece de relleno) y propone la corrección. Un
 * «mala» sí pide confirmar: enviar ahí es sumar un rebote al buzón, y los rebotes son lo que más daña la reputación de un buzón.
 */

export type NivelDeDireccion = 'buena' | 'dudosa' | 'mala'

export interface RebotePrevio {
  motivo: string | null
  veces: number
}

export interface VeredictoDeDireccion {
  direccion: string
  nivel: NivelDeDireccion
  /** La frase para la persona: por qué es mala o dudosa, o «parece correcta» */
  motivo: string
  /** La dirección corregida, si el problema es una errata clara */
  sugerencia: string | null
  problemas: ProblemaDeDireccion[]
  dominio: ResultadoDeDominio | null
  rebotada: RebotePrevio | null
  /** No se ha podido comprobar el dominio (el DNS no contestó): se da por buena en ese punto */
  sinComprobar: boolean
}

export interface DependenciasDeVerificacion {
  resolvedor: ResolvedorDeDominio
  /** Las que de estas direcciones ya rebotaron antes (en minúsculas). Si no se puede consultar, devuelve un mapa vacío */
  memoria: (direcciones: readonly string[]) => Promise<ReadonlyMap<string, RebotePrevio>>
  dominios?: OpcionesDeDominio
}

function frase(a: AnalisisDeDireccion, nivel: NivelDeDireccion): string {
  const de = a.problemas.filter((p) => p.gravedad === (nivel === 'mala' ? 'mala' : 'dudosa'))
  return de[0]?.texto ?? 'Parece una dirección correcta.'
}

export async function verificarDirecciones(textos: readonly string[], deps: DependenciasDeVerificacion): Promise<VeredictoDeDireccion[]> {
  const analisis = textos.map(analizarDireccion)
  const rebotadas = await deps.memoria(analisis.map((a) => a.direccion).filter((d) => d !== ''))

  // Los dominios, una vez cada uno y a la vez; solo los de direcciones que hasta aquí no son malas
  const aComprobar = [...new Set(analisis.filter((a) => a.dominio !== '' && !a.problemas.some((p) => p.gravedad === 'mala') && !rebotadas.has(a.direccion)).map((a) => a.dominio))]
  const dominios = new Map<string, ResultadoDeDominio>()
  await Promise.all(
    aComprobar.map(async (d) => {
      dominios.set(d, await comprobarDominio(d, deps.resolvedor, deps.dominios))
    })
  )

  return analisis.map((a): VeredictoDeDireccion => {
    const problemas = [...a.problemas]
    const rebote = rebotadas.get(a.direccion) ?? null
    const dominio = dominios.get(a.dominio) ?? null

    if (rebote) {
      problemas.unshift({
        codigo: 'sintaxis',
        gravedad: 'mala',
        texto: `Esa dirección ya rebotó antes${rebote.veces > 1 ? ` (${rebote.veces} veces)` : ''}${rebote.motivo ? `: ${rebote.motivo}` : ': el servidor dijo que no existe'}.`,
      })
    }
    if (dominio?.estado === 'no_existe') problemas.push({ codigo: 'dominio_no_valido', gravedad: 'mala', texto: `El dominio «${a.dominio}» no existe: el correo rebotaría.` })
    else if (dominio?.estado === 'sin_correo') problemas.push({ codigo: 'dominio_no_valido', gravedad: 'mala', texto: `El dominio «${a.dominio}» no recibe correo.` })

    const nivel: NivelDeDireccion = problemas.some((p) => p.gravedad === 'mala') ? 'mala' : problemas.some((p) => p.gravedad === 'dudosa') ? 'dudosa' : 'buena'
    const motivo = problemas.find((p) => p.gravedad === (nivel === 'mala' ? 'mala' : 'dudosa'))?.texto ?? frase(a, nivel)
    return {
      direccion: a.direccion,
      nivel,
      motivo: nivel === 'buena' && dominio?.estado === 'sin_comprobar' ? 'No se ha podido comprobar el dominio ahora mismo; la dirección está bien escrita.' : motivo,
      sugerencia: a.sugerencia,
      problemas,
      dominio,
      rebotada: rebote,
      sinComprobar: dominio?.estado === 'sin_comprobar',
    }
  })
}
