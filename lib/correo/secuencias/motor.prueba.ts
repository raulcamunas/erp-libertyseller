import { nuevaBase } from '@/lib/correo/secuencias/cliente-falso'
import { ejecutarEscenarios } from '@/lib/correo/secuencias/motor.escenarios'
import type { Entorno } from '@/lib/correo/secuencias/mundo-de-pruebas'

/**
 * El motor de punta a punta con la base en memoria. Los mismos escenarios se pasan contra Postgres de verdad (ver motor.escenarios.ts).
 * Con un argumento se pasa solo el escenario cuyo nombre lo contenga: `tsx motor.prueba.ts rebote`.
 */
const entornoEnMemoria: Entorno = {
  async nuevo(reloj) {
    const { base, service } = nuevaBase(reloj)
    // Lo que deja la migración 245
    base.sembrar('correo_secuencias', { nombre: 'Prospección: primer correo y 2 seguimientos', es_base: true, activa: true, pasos: [{ orden: 1, dias: 3 }, { orden: 2, dias: 7 }] })
    base.sembrar('correo_secuencia_ajustes', { id: true, activa: false, modo_ensayo: true })
    return { service, soloEnMemoria: { ausentes: base.ausentes } }
  },
}

ejecutarEscenarios(entornoEnMemoria, process.argv[2]).then((r) => {
  console.log(r.fallos === 0 ? `\nTODO BIEN (${r.comprobaciones} comprobaciones)\n` : `\n${r.fallos} FALLOS de ${r.comprobaciones} comprobaciones\n`)
  process.exit(r.fallos === 0 ? 0 : 1)
})
