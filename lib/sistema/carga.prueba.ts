import { POLITICA_DE_CARGA, TAREAS_CRON, alcanzaPorLaCarga, conRegistro, estadoDeLaCarga, reiniciarLaCargaParaPruebas } from './cron'
import { anotarMuestra, vaciarMuestras } from './presion'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL GUARDIÁN DE LA CARGA DENTRO DE LOS PROCESOS DE FONDO.
 *
 * Lo que se vigila: que con la base normal todo corra, que con la base lenta se aplace lo de fondo y NUNCA lo esencial, que las pesadas no coincidan, que una pesada en marcha se vea y
 * deje de verse al acabar, y que cada proceso del código tenga su política (si no, uno nuevo se quedaría sin decidir cuánto importa).
 */

const limpio = () => {
  reiniciarLaCargaParaPruebas()
  vaciarMuestras()
}
const lentas = (n: number, ms = 3_000) => {
  for (let i = 0; i < n; i++) anotarMuestra(ms, false)
}
const MIN = 60_000

async function main() {
  const aviso = console.warn
  console.warn = () => undefined

  console.log('\n=== cada proceso tiene su política ===')
  {
    ok('todos los procesos del registro tienen prioridad', TAREAS_CRON.every((t) => ['esencial', 'normal', 'baja'].includes(POLITICA_DE_CARGA[t.id]?.prioridad)))
    const esenciales = TAREAS_CRON.filter((t) => POLITICA_DE_CARGA[t.id].prioridad === 'esencial').map((t) => t.id).sort()
    ok('lo esencial es lo que no se puede dejar de hacer: llamadas, correo, seguimientos, agenda y precios', esenciales.join(',') === 'calendario,correo-secuencias,correo-sync,entrais-precios,rinkel-llamadas,rinkel-transcribir', esenciales.join(','))
    const pesadas = TAREAS_CRON.filter((t) => POLITICA_DE_CARGA[t.id].pesada).map((t) => t.id).sort()
    ok('las pesadas son las que duran minutos: catálogo, trabajos, auditor, cumplimiento y remesas', pesadas.join(',') === 'amazon-jobs,amazon-sync,auditor-stock,cumplimiento,fba-remesas', pesadas.join(','))
    ok('ninguna pesada es esencial (aplazarla nunca deja el ERP parado)', pesadas.every((id) => POLITICA_DE_CARGA[id as keyof typeof POLITICA_DE_CARGA].prioridad === 'baja'))
  }

  console.log('\n=== con la base normal corre todo ===')
  {
    limpio()
    ok('un proceso esencial, uno normal y uno de fondo', alcanzaPorLaCarga('correo-sync', 0).toca && alcanzaPorLaCarga('ciclo-leads', 0).toca && alcanzaPorLaCarga('ubicacion-leads', 0).toca)
    for (let i = 0; i < 12; i++) anotarMuestra(250, false)
    ok('también con muchas muestras buenas', alcanzaPorLaCarga('cumplimiento', 10 * MIN).toca)
  }

  console.log('\n=== una pesada a la vez ===')
  {
    limpio()
    const primera = alcanzaPorLaCarga('amazon-sync', Number.POSITIVE_INFINITY)
    ok('la primera pesada corre', primera.toca)
    const segunda = alcanzaPorLaCarga('auditor-stock', 40 * MIN)
    ok('otra pesada que les toque en el mismo minuto espera, y dice por quién', !segunda.toca && segunda.motivo?.includes('amazon-sync') === true, JSON.stringify(segunda))
    ok('lo que no es pesado no espera por ello', alcanzaPorLaCarga('correo-sync', 0).toca && alcanzaPorLaCarga('ubicacion-leads', 0).toca && alcanzaPorLaCarga('ciclo-leads', 0).toca)
    ok('la misma pesada, si vuelve a preguntar, no se bloquea a sí misma', alcanzaPorLaCarga('amazon-sync', 20 * MIN).toca)
  }
  {
    limpio()
    let soltar: () => void = () => undefined
    const larga = conRegistro('amazon-sync', null, () => new Promise<void>((resolve) => (soltar = resolve)))
    await new Promise((r) => setTimeout(r, 30))
    ok('una pesada con su registro abierto cuenta como en marcha y se ve en Sistema', estadoDeLaCarga().pesadasEnMarcha.join() === 'amazon-sync')
    ok('y mientras dura, las demás pesadas esperan', !alcanzaPorLaCarga('amazon-jobs', 30 * MIN).toca)
    soltar()
    await larga
    ok('al acabar deja de contar y las demás pueden entrar', estadoDeLaCarga().pesadasEnMarcha.length === 0 && alcanzaPorLaCarga('amazon-jobs', 30 * MIN).toca)
    const conFallo = conRegistro('auditor-stock', null, async () => {
      throw new Error('falló')
    })
    await conFallo.catch(() => undefined)
    ok('una pesada que FALLA también se suelta (si no, bloquearía a las demás hasta reiniciar)', estadoDeLaCarga().pesadasEnMarcha.length === 0)
  }

  console.log('\n=== con la base lenta se aplaza el trabajo de fondo, no lo esencial ===')
  {
    limpio()
    for (let i = 0; i < 8; i++) anotarMuestra(250, false)
    lentas(3)
    ok('tres consultas lentas seguidas ponen la presión en «alta»', estadoDeLaCarga().nivel === 'alta', JSON.stringify(estadoDeLaCarga()))
    ok('lo de fondo pesado espera', !alcanzaPorLaCarga('amazon-sync', 15 * MIN).toca && !alcanzaPorLaCarga('ubicacion-leads', 5 * MIN).toca)
    ok('y dice por qué', alcanzaPorLaCarga('amazon-sync', 15 * MIN).motivo?.includes('presión alta') === true)
    ok('lo esencial y lo normal corren igual', alcanzaPorLaCarga('rinkel-llamadas', 0).toca && alcanzaPorLaCarga('correo-secuencias', 0).toca && alcanzaPorLaCarga('ciclo-leads', 0).toca && alcanzaPorLaCarga('notas-gemini', 0).toca)
    ok('un proceso de fondo que lleva más de su ayuno sin correr SÍ corre (no se queda horas sin catálogo)', alcanzaPorLaCarga('amazon-sync', 46 * MIN).toca && !alcanzaPorLaCarga('amazon-jobs', 59 * MIN).toca)
  }
  {
    limpio()
    anotarMuestra(8_000, true)
    anotarMuestra(8_000, true)
    ok('dos consultas que se agotan: presión crítica', estadoDeLaCarga().nivel === 'critica')
    ok('lo normal también espera', !alcanzaPorLaCarga('ciclo-leads', 5 * MIN).toca && !alcanzaPorLaCarga('notas-gemini', 5 * MIN).toca)
    ok('lo pesado no corre ni en ayunas', !alcanzaPorLaCarga('amazon-sync', 24 * 60 * MIN).toca)
    ok('LO ESENCIAL SIGUE CORRIENDO con la base casi muerta', ['rinkel-llamadas', 'rinkel-transcribir', 'correo-sync', 'correo-secuencias', 'calendario', 'entrais-precios'].every((t) => alcanzaPorLaCarga(t as never, 0).toca))
  }

  console.log('\n=== al recuperarse la base, vuelve todo ===')
  {
    limpio()
    anotarMuestra(8_000, true)
    anotarMuestra(8_000, true)
    ok('con la presión crítica espera', !alcanzaPorLaCarga('amazon-jobs', 10 * MIN).toca)
    vaciarMuestras()
    for (let i = 0; i < 6; i++) anotarMuestra(220, false)
    ok('con muestras buenas (las malas ya son viejas) vuelve a correr', estadoDeLaCarga().nivel === 'normal' && alcanzaPorLaCarga('amazon-jobs', 10 * MIN).toca)
  }

  console.warn = aviso
  limpio()
  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
