/* Pipeline completo en Node: leer Excel → detectar → liquidar → generar extracto
   → releer el extracto y cuadrar los totales.  node test/pipeline.mjs */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const XLSX = require('../libs/xlsx.full.min.js');
const L = require('../logica.js');

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const carpeta = path.join(raiz, 'ejemplos');

let pass = 0, fail = 0;
function ok(desc, cond, detalle) {
  if (cond) { pass++; console.log('  ok  ' + desc); }
  else { fail++; console.log('FAIL  ' + desc + (detalle ? '\n      ' + detalle : '')); }
}

function procesarComoApp(ruta, reglas, mapeoManual) {
  const wb = XLSX.read(fs.readFileSync(ruta), { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],
    { header: 1, raw: true, blankrows: false, defval: null });
  const det = L.detectarTabla(aoa);
  const mapeo = Object.assign({}, det.mapeo, mapeoManual || {});
  const faltantes = ['nombre', 'rol'].filter(c => mapeo[c] === undefined);
  if (faltantes.length) return { error: 'faltan: ' + faltantes.join(','), det };
  const res = L.procesarFilas(aoa.slice(det.filaEncabezado + 1), mapeo, reglas || L.REGLAS_POR_DEFECTO);
  return Object.assign({ det }, res);
}

console.log('\n— 1) nomina_marzo_2026.xlsx (encabezados estándar) —');
{
  const r = procesarComoApp(path.join(carpeta, 'nomina_marzo_2026.xlsx'));
  ok('sin error', !r.error);
  ok('8 trabajadores (9 filas - 1 ejemplo)', r.empleados && r.empleados.length === 8,
    r.error || ('real: ' + (r.empleados || []).length));
  ok('fila EJEMPLO ignorada', r.omitidas === 1, 'omitidas=' + r.omitidas);
  ok('observación de sin cédula', r.observaciones.some(o => /sin cédula/i.test(o.mensaje)),
    JSON.stringify(r.obs));

  const ana = r.empleados.find(e => e.nombre.startsWith('Ana'));
  ok('Ana: 160h gerente = 16.000.000 base', ana && ana.base === 16000000, 'base=' + (ana && ana.base));
  ok('Ana: extras 4h+25% = 500.000', ana && ana.extras === 500000, 'extras=' + (ana && ana.extras));
  ok('Ana: 1 domingo = 1.200.000', ana && ana.dominicales === 1200000, 'dom=' + (ana && ana.dominicales));

  const laura = r.empleados.find(e => e.nombre.startsWith('Laura'));
  ok('Laura: horas como TEXTO "160" interpretadas', laura && laura.horas === 160, 'horas=' + (laura && laura.horas));

  const pedro = r.empleados.find(e => e.nombre.startsWith('Pedro'));
  ok('Pedro: rol ADMINISTRATIVO reconocido', pedro && pedro.rol === 'admin');
  ok('Pedro: 5 hijos → tope 600.000', pedro && pedro.subsidio === 600000);

  // genera el extracto y releelo
  const aoa = L.hojaSalida(r.empleados, { origen: 'prueba', fecha: '01/01/2026' });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = L.anchosColumnas();
  const wbOut = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbOut, ws, 'Nómina');
  const buf = XLSX.write(wbOut, { bookType: 'xlsx', type: 'buffer' });
  fs.writeFileSync(path.join(carpeta, 'muestra_extracto_salida.xlsx'), buf);

  const wb2 = XLSX.read(buf, { type: 'buffer' });
  const aoa2 = XLSX.utils.sheet_to_json(wb2.Sheets['Nómina'], { header: 1, defval: null });
  const filaTot = aoa2.find(f => f[0] === 'TOTALES');
  ok('el extracto releído tiene fila TOTALES', !!filaTot);
  const resumen = L.resumen(r.empleados);
  ok('neto del extracto = resumen', filaTot && filaTot[22] === resumen.neto,
    'extracto=' + (filaTot && filaTot[22]) + ' resumen=' + resumen.neto);
  ok('ingresos del extracto = resumen', filaTot && filaTot[14] === resumen.ingresos);
}

console.log('\n— 2) banco_enero_2026.xlsx (encabezados de banco) —');
{
  const r = procesarComoApp(path.join(carpeta, 'banco_enero_2026.xlsx'));
  ok('sin error', !r.error, r.error);
  ok('detectó encabezados en fila 0', r.det.filaEncabezado === 0, 'fila=' + r.det.filaEncabezado);
  ok('columnas: EMPLEADO→nombre', r.det.mapeo.nombre === 0, JSON.stringify(r.det.mapeo));
  ok('columnas: IDENTIFICACIÓN→cc', r.det.mapeo.cc === 1);
  ok('columnas: CARGO→rol', r.det.mapeo.rol === 2);
  ok('columnas: HRS LABORADAS→horas', r.det.mapeo.horas === 3);
  ok('columnas: HIJOS A CARGO→hijos', r.det.mapeo.hijos === 4);
  ok('columnas: HORAS EXTRAS→extras', r.det.mapeo.extras === 5);
  ok('4 trabajadores (el "Jefe de área" no es rol válido)', r.empleados && r.empleados.length === 4,
    r.error || ('real: ' + (r.empleados || []).length));

  const oscar = r.empleados.find(e => e.nombre.startsWith('Óscar'));
  ok('Óscar: rol Operario de mantenimiento → operario', oscar && oscar.rol === 'operario');
  ok('Óscar: 16h extras = 16×60.000×1,25 = 1.200.000', oscar && oscar.extras === 1200000,
    'extras=' + (oscar && oscar.extras));
  ok('Óscar: libranza 120.000', oscar && oscar.libranza === 120000);

  const jefe = r.empleados.find(e => e.nombre.startsWith('Alfonso'));
  ok('Alfonso: "Jefe de área" NO es rol válido → se omite', !jefe);
  ok('observación por rol desconocido', r.observaciones.some(o => /no reconocido/i.test(o.mensaje)),
    JSON.stringify(r.obs));
  ok('quedan 4 liquidados si se omite el jefe',
    r.empleados.every(e => ['gerente', 'admin', 'operario'].includes(e.rol)));
}

console.log('\n— 3) reporte_caja_no_es_nomina.xlsx (archivo equivocado) —');
{
  const r = procesarComoApp(path.join(carpeta, 'reporte_caja_no_es_nomina.xlsx'));
  ok('rechazado con mensaje de columnas faltantes', !!r.error && /faltan/.test(r.error), r.error);
}

console.log('\n— 4) mapeo manual de respaldo —');
{
  const ruta = path.join(carpeta, 'reporte_caja_no_es_nomina.xlsx');
  const wb = XLSX.read(fs.readFileSync(ruta), { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const det = L.detectarTabla(aoa);
  const mm = L.mapeoManualAIndice({ nombre: 'Concepto', rol: 'Valor', horas: 'Fecha' }, det.headers);
  ok('mapeo manual encuentra las 3 columnas', Object.keys(mm.mapeo).length === 3,
    JSON.stringify(mm.mapeo));
}

console.log('\n' + (fail === 0 ? 'TODO OK' : 'FALLAS: ' + fail) + ' · pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
