import { promises as dns } from 'node:dns'
import type { ResolvedorDeDominio } from './dominio'

/**
 * EL DNS DE VERDAD PARA COMPROBAR DOMINIOS — SOLO SERVIDOR.
 * Los errores conservan su `code` (ENOTFOUND, ENODATA, ESERVFAIL…): es lo que lee dominio.ts para distinguir «no existe» de «no contesta».
 */
export const resolvedorDeProduccion: ResolvedorDeDominio = {
  resolverMx: (dominio) => dns.resolveMx(dominio),
  async resolverDirecciones(dominio) {
    const [v4, v6] = await Promise.allSettled([dns.resolve4(dominio), dns.resolve6(dominio)])
    const direcciones = [...(v4.status === 'fulfilled' ? v4.value : []), ...(v6.status === 'fulfilled' ? v6.value : [])]
    if (direcciones.length > 0) return direcciones
    // Si no hay ninguna, el error que cuenta es el de la primera consulta (con su código)
    if (v4.status === 'rejected') throw v4.reason
    return []
  },
}
