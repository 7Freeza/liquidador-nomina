/* Empaqueta la app en UN solo archivo HTML (libs + css + js embebidos).
   node test/empaquetar.mjs  →  Liquidador_Nomina.html */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const leer = p => fs.readFileSync(path.join(raiz, p), 'utf8');

let html = leer('index.html');

const css = leer('styles.css');
const js = ['libs/xlsx.full.min.js', 'libs/jszip.min.js', 'logica.js', 'app.js']
  .map(leer)
  .join('\n;\n');

html = html.replace(
  /<link rel="stylesheet" href="styles.css">/,
  () => '<style>\n' + css + '\n</style>'
);

html = html.replace(
  /<script src="libs\/xlsx\.full\.min\.js"><\/script>\s*<script src="libs\/jszip\.min\.js"><\/script>\s*<script src="logica\.js"><\/script>\s*<script src="app\.js"><\/script>/,
  () => '<script>\n' + js + '\n</script>'
);

if (/<script src=|href="styles\.css"/.test(html)) {
  console.error('ERROR: quedaron referencias externas sin embebir.');
  process.exit(1);
}

const salida = path.join(raiz, 'Liquidador_Nomina.html');
fs.writeFileSync(salida, html, 'utf8');
const kb = (fs.statSync(salida).size / 1024).toFixed(0);
console.log('Empaquetado:', salida);
console.log('Tamaño:', kb, 'KB');
