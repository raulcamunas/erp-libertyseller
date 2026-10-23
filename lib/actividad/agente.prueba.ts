import { resumenDeAgente } from '@/lib/actividad/agente'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== resumenDeAgente ===')
ok('Chrome en Mac', resumenDeAgente('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36') === 'Chrome · macOS')
ok('Safari en Mac', resumenDeAgente('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15') === 'Safari · macOS')
ok('Edge en Windows (dice Chrome y Safari también)', resumenDeAgente('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0') === 'Edge · Windows')
ok('Firefox en Linux', resumenDeAgente('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0') === 'Firefox · Linux')
ok('Chrome en Android (dice Linux)', resumenDeAgente('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36') === 'Chrome · Android')
ok('Safari en iPhone (dice Mac OS X)', resumenDeAgente('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1') === 'Safari · iOS')
ok('Chrome en iPhone', resumenDeAgente('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1') === 'Chrome · iOS')
ok('Opera', resumenDeAgente('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0') === 'Opera · Windows')
ok('algo desconocido', resumenDeAgente('curl/8.0') === null)
ok('vacío', resumenDeAgente('') === null && resumenDeAgente(null) === null && resumenDeAgente(undefined) === null)

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
