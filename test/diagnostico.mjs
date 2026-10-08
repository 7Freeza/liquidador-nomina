/* Diagnóstico: compara la salida REAL de logica.js contra un cálculo manual
   independiente (hecho a mano, sin reusar la lógica). node test/diagnostico.mjs */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const XLSX = require('../libs/xlsx.full.min.js');
const L = require('../logica.js');

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ---------- valores esperados, calculados A MANO del enunciado ---------- */
/* reglas: gerente 100k/h · admin 80k/h · operario 60k/h
   subsidio: min(hijos,3)×200k
   descuentos de seguridad social: 4% + 4% SOBRE EL TOTAL LIQUIDADO
   ("a esta liquidez también se le hacen descuentos") + vivienda/libranza/otros fijos
   recargos por defecto: extra 25% · domingo 50% (8h) · festivo 100% (8h) · noct 35% */

const ESPERADO = {
  'nomina_marzo_2026.xlsx': [
    { nombre: 'Ana Lucía Pérez',    base: 16000000, extras: 500000,  dominicales: 1200000, festivos: 0, nocturnas: 0,      subsidio: 200000, prima: 0,      ingresos: 17900000, desc: 1432000, neto: 16468000 },
    { nombre: 'Carlos Andrés Gómez',base: 14080000, extras: 0,       dominicales: 0,       festivos: 1280000, nocturnas: 1080000, subsidio: 600000, prima: 150000, ingresos: 17190000, desc: 1925200, neto: 15264800 },
    { nombre: 'Marta Ruiz',         base: 9600000,  extras: 600000,  dominicales: 1440000, festivos: 0, nocturnas: 1620000, subsidio: 600000, prima: 0,      ingresos: 13860000, desc: 1158800, neto: 12701200 },
    { nombre: 'Jorge Iván Castro',  base: 9120000,  extras: 0,       dominicales: 0,       festivos: 0, nocturnas: 0,       subsidio: 0,     prima: 0,      ingresos: 9120000,  desc: 729600,  neto: 8390400 },
    { nombre: 'Diana Marcela Ortiz',base: 16800000, extras: 1500000, dominicales: 1200000, festivos: 1600000, nocturnas: 4050000, subsidio: 400000, prima: 200000, ingresos: 25750000, desc: 2060000, neto: 23690000 },
    { nombre: 'Pedro Nel Sánchez',  base: 12800000, extras: 0,       dominicales: 0,       festivos: 0, nocturnas: 0,       subsidio: 600000, prima: 0,      ingresos: 13400000, desc: 1072000, neto: 12328000 },
    { nombre: 'Laura Sofía Mejía',  base: 9600000,  extras: 300000,  dominicales: 720000,  festivos: 0, nocturnas: 0,      subsidio: 400000, prima: 0,      ingresos: 11020000, desc: 881600,  neto: 10138400 },
    { nombre: 'Sin Cédula Aquí',    base: 4800000,  extras: 0,       dominicales: 0,       festivos: 0, nocturnas: 0,       subsidio: 200000, prima: 0,      ingresos: 5000000,  desc: 400000,  neto: 4600000 }
  ],
  'banco_enero_2026.xlsx': [
    { nombre: 'Roberto Fuentes',  base: 16000000, extras: 750000,  dominicales: 1200000, festivos: 1600000, nocturnas: 1080000, subsidio: 400000, prima: 0,      ingresos: 21030000, desc: 1682400, neto: 19347600 },
    { nombre: 'Claudia Herrera',  base: 14080000, extras: 0,       dominicales: 0,       festivos: 0, nocturnas: 0,       subsidio: 200000, prima: 0,      ingresos: 14280000, desc: 1322400, neto: 12957600 },
    { nombre: 'Óscar Villalba',   base: 9600000,  extras: 1200000, dominicales: 1440000, festivos: 0, nocturnas: 3240000, subsidio: 0,     prima: 0,      ingresos: 15480000, desc: 1388400, neto: 14091600 },
    { nombre: 'Patricia Díaz',    base: 8640000,  extras: 0,       dominicales: 0,       festivos: 960000, nocturnas: 0,       subsidio: 600000, prima: 90000, ingresos: 10290000, desc: 823200,  neto: 9466800 }
  ]
};

function procesar(nombre) {
  const ruta = path.join(raiz, 'ejemplos', nombre);
  const wb = XLSX.read(fs.readFileSync(ruta), { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],
    { header: 1, raw: true, blankrows: false, defval: null });
  const det = L.detectarTabla(aoa);
  const res = L.procesarFilas(aoa.slice(det.filaEncabezado + 1), det.mapeo, L.REGLAS_POR_DEFECTO);
  return res;
}

let fallos = 0, checks = 0;
const fmt = n => (typeof n === 'number' ? n.toLocaleString('es-CO') : String(n));

for (const [archivo, esperados] of Object.entries(ESPERADO)) {
  console.log('\n=== ' + archivo + ' ===');
  const real = procesar(archivo);
  console.log('empleados procesados: ' + real.empleados.length + ' (esperados: ' + esperados.length + ')');
  if (real.empleados.length !== esperados.length) fallos++;

  for (const esp of esperados) {
    const emp = real.empleados.find(e => e.nombre === esp.nombre);
    if (!emp) { console.log('  FALTA: ' + esp.nombre); fallos++; continue; }
    const campos = ['base', 'extras', 'dominicales', 'festivos', 'nocturnas', 'subsidio', 'prima', 'ingresos', 'desc', 'neto'];
    const mapaReal = { ingresos: emp.totalIngresos, desc: emp.totalDescuentos };
    for (const c of campos) {
      checks++;
      const r = c in mapaReal ? mapaReal[c] : emp[c];
      if (r !== esp[c]) {
        fallos++;
        console.log('  DIFERENCIA · ' + esp.nombre + ' · ' + c +
          ': esperado ' + fmt(esp[c]) + ' ≠ real ' + fmt(r) +
          '  (' + (r - esp[c] > 0 ? '+' : '') + fmt(r - esp[c]) + ')');
      }
    }
  }

  // totales
  const res = L.resumen(real.empleados);
  const espIng = esperados.reduce((a, e) => a + e.ingresos, 0);
  const espDesc = esperados.reduce((a, e) => a + e.desc, 0);
  const espNeto = esperados.reduce((a, e) => a + e.neto, 0);
  checks += 3;
  if (res.ingresos !== espIng) { fallos++; console.log('  TOTALES · ingresos: esperado ' + fmt(espIng) + ' ≠ real ' + fmt(res.ingresos) + ' (dif ' + fmt(res.ingresos - espIng) + ')'); }
  if (res.descuentos !== espDesc) { fallos++; console.log('  TOTALES · descuentos: esperado ' + fmt(espDesc) + ' ≠ real ' + fmt(res.descuentos)); }
  if (res.neto !== espNeto) { fallos++; console.log('  TOTALES · neto: esperado ' + fmt(espNeto) + ' ≠ real ' + fmt(res.neto) + ' (dif ' + fmt(res.neto - espNeto) + ')'); }
  console.log('  ingresos ' + fmt(res.ingresos) + ' | descuentos ' + fmt(res.descuentos) + ' | neto ' + fmt(res.neto));
}

console.log('\n' + (fallos === 0 ? 'CÁLCULOS CUADRAN ✓' : 'HAY ' + fallos + ' DIFERENCIAS') + ' · checks=' + checks + ' fallos=' + fallos);
process.exit(fallos === 0 ? 0 : 1);
