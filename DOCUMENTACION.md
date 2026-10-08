# Liquidador de Nómina Administrativa

**Documentación técnica y de solución — v1.2**

> Sistema local para automatizar la liquidación de nómina de una empresa financiera:
> recibe uno o varios Excel con la información de los trabajadores, aplica las reglas
> de negocio del cliente y entrega extractos de nómina listos para revisar, descargar
> y enviar por correo a cada trabajador. Corre íntegramente en el navegador, sin servidor.

---

## 1. Resumen ejecutivo

El cliente necesita liquidar la nómina administrativa de su empresa financiera de forma
automática. El sistema resuelve el problema con un flujo por lotes:

```
 Excel del banco (uno o varios)
        │
        ▼
 Lectura y reconocimiento de columnas
        │
        ▼
 Validación de cada fila (nombre, rol, horas)
        │
        ▼
 Liquidación por empleado (reglas configurables)
        │
        ▼
 Extracto .xlsx por archivo + fila de totales
        │
        ▼
 Vista previa · descarga individual o total · envío por correo
```

**Características clave**

- Procesamiento de varios archivos a la vez (cola con 3 en paralelo).
- Detección automática de encabezados (con tolerancia a mayúsculas, tildes y nombres distintos) o mapeo manual de respaldo.
- Reglas de negocio **editable en pantalla** y persistentes: tarifas, recargos, descuentos y cesantías.
- Vista previa en pantalla con observaciones antes de descargar; fila de TOTALES al final.
- Extracto individual por trabajador y envío automatizado por correo (Outlook) con solo su nómina.
- Signos visuales: subsidios con `+` y descuentos con `−`.
- Cálculo 100 % local: los datos no salen del equipo.

---

## 2. El problema

**Enunciado del cliente**

Calcular la nómina administrativa de una empresa financiera. La empresa tiene 3 roles:

| Rol      | Tarifa        |
|----------|---------------|
| Gerente  | $100.000 / hora |
| Admin    | $80.000 / hora |
| Operario | $60.000 / hora |

Reglas del enunciado:

- El salario se liquida en base a las **horas trabajadas** del mes.
- **Subsidio por hijos**: 1 hijo = $200.000 · 2 hijos = $400.000 · 3 o más = $600.000.
- *"A esta liquidación también se le hacen descuentos de seguridad social"* (descuentos sobre el **total liquidado**).
- Datos de identificación: nombre completo, cédula (CC), rol y número de hijos.

**Requisitos funcionales agregados por el cliente**

1. Signo `+` en subsidios y `−` en descuentos para identificarlos.
2. Vista individual de la nómina de cada trabajador (clic en su nombre).
3. Envío automatizado del extracto por correo, individual, a cada trabajador.

---

## 3. Análisis y diseño de la solución

### 3.1 Entrada → Proceso → Salida

| Entrada                                   | Proceso                                        | Salida                                    |
|-------------------------------------------|------------------------------------------------|-------------------------------------------|
| Excel por archivo con una fila por trabajador | Reconocer columnas → validar → liquidar → totalizar | `.xlsx` por archivo con fila TOTALES |
| Columnas: nombre, cédula, rol, hijos, horas, extras, domingos, festivos, nocturnas, primas, vivienda, libranza, otros descuentos, correo | Aplicar reglas de negocio del §4 | Vista previa en pantalla · descarga individual o `.zip` · paquete de envío por correo |

### 3.2 Decisiones de diseño

| Decisión | Alternativa descartada | Motivo |
|----------|------------------------|--------|
| **Recibir el Excel y liquidar en lote** | Buscar rol a mano, elegir trabajador y digitar horas | El plan manual es lento y propenso a error; el banco ya entrega la información en Excel |
| **Múltiples archivos a la vez** | Procesar de a uno | El liquidador puede arrastrar todos los archivos y recibir todo en una sola pasada |
| **Reglas configurables en pantalla** | Valores fijos en el código | Cambiar una tarifa o un porcentaje no debe requerir programación |
| **Cálculo en el navegador, sin servidor** | Backend + base de datos | Datos sensibles de nómina no salen del equipo; instalación = doble clic |
| **Signos como formato de presentación** | Valores negativos/positivos reales | Los totales deben cuadrar: el signo es visual, el valor subyacente sigue siendo positivo |
| **Envío por correo vía Outlook (COM)** | SMTP embebido / API de terceros | No hay credenciales ni servidor de correo en la arquitectura local; Outlook ya está en los equipos corporativos |

### 3.3 Corrección de regla (hallazgo de auditoría)

En una revisión cruzada campo por campo contra un cálculo manual independiente, se
detectó que los descuentos de seguridad social se aplicaban sobre el **salario base**.
El enunciado dice *"a esta liquidación también se le hacen descuentos"*: la regla se
corrigió para aplicar los porcentajes sobre el **total liquidado** (base + recargos +
primas + subsidio + cesantías). La corrección se verificó con 126 cruces numéricos y
quedó documentada como test (`test/diagnostico.mjs`).

---

## 4. Reglas de negocio

### 4.1 Ingresos

| Concepto              | Fórmula                                                          | Default |
|-----------------------|------------------------------------------------------------------|---------|
| Salario base          | horas trabajadas × tarifa del rol                                | —       |
| Horas extras          | horas × tarifa × (1 + recargo)                                   | 25 %    |
| Domingos trabajados   | jornada(8 h) × tarifa × (1 + recargo) por domingo                | 50 %    |
| Feriados trabajados   | jornada(8 h) × tarifa × (1 + recargo) por feriado                | 100 %   |
| Horas nocturnas       | horas × tarifa × (1 + recargo)                                   | 35 %    |
| Primas                | valor fijo desde el Excel                                        | —       |
| Subsidio de hijos     | mín(hijos, 3) × $200.000 (tope automático)                       | —       |
| Cesantías (por salida)| salario base × 8,33 % — opcional, se suma como ingreso           | off     |

### 4.2 Descuentos

| Concepto                 | Fórmula                                                      | Default |
|--------------------------|--------------------------------------------------------------|---------|
| Salud EPS                | total liquidado × %                                           | 4 %     |
| Pensión                  | total liquidado × %                                           | 4 %     |
| Fondo de solidaridad     | total liquidado × % (opcional)                                | 0 %     |
| Vivienda / libranza / otros | valor fijo columna por columna del Excel                  | —       |

### 4.3 Neto a pagar

```
NETO = total liquidado (ingresos) − total descuentos
```

**Signos visuales (pedido del cliente):**

| Columna                          | Signo |
|----------------------------------|-------|
| Subsidio de hijos                | `+`   |
| Salud EPS · Pensión · Solidaridad · Vivienda · Libranza · Otros · Total descuentos | `−` |
| Neto a pagar                     | sin signo (valor final positivo) |

Los valores subyacentes se mantienen **positivos**: los signos son formato de
presentación (vista previa y Excel con formato numérico `"+"#,##0` / `"−"#,##0`),
por lo que los totales siempre cuadran.

---

## 5. Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  Liquidador de Nómina — navegador (sin servidor)             │
│                                                              │
│  index.html        estructura y vistas                       │
│  styles.css        estilos (herramienta de oficina)          │
│  logica.js         núcleo puro de cálculo (sin DOM)          │
│  app.js            interfaz: cola, vistas, descargas, envío  │
│  libs/xlsx.full.min.js   lectura/escritura Excel (SheetJS)   │
│  libs/jszip.min.js       descargas .zip                      │
│                                                              │
│  Entrega única: Liquidador_Nomina.html (todo embebido,       │
│  doble clic y funciona) / modo desarrollo: npm run dev       │
└─────────────────────────────────────────────────────────────┘
```

**Separación de responsabilidades**

- `logica.js`: reglas, fórmulas, detección de columnas, liquidación y hoja de salida.
  Funciones puras, sin dependencias → testeables en Node.
- `app.js`: estado de la sesión, cola de procesamiento (3 simultáneos), render de
  vistas, descargas y paquete de correo.
- Los datos viven solo en memoria durante la sesión; las preferencias de reglas se
  guardan en `localStorage` del navegador.

**Modo desarrollo** (`npm run dev`, con `concurrently`):

```
[srv]   live-server → http://127.0.0.1:8080  (recarga automática)
[tests] node --watch → corre los tests al tocar la lógica
[pack]  watch de fuentes → regenera Liquidador_Nomina.html
```

---

## 6. Flujo del proceso

```
               ┌─────────────┐
               │   INICIO    │
               └──────┬──────┘
                      ▼
      ╔═════════════════════════════╗
      ║ ENTRADA: subir uno o varios ║
      ║ Excel con los empleados     ║
      ╚═══════════════════════╤═════╝
                              ▼
                     ◇ ¿Quedan        ◇
                     ◇ archivos?       ◇
                     ╰───────┬────────┬╯
              NO ────────────┘        └──────── SÍ
               ▼                              ▼
  ┌──────────────────────┐     ┌──────────────────────────┐
  │ SALIDA: vista previa │     │ Leer encabezados y       │
  │ en pantalla          │     │ mapear columnas (auto/   │
  └──────────┬───────────┘     │ manual)                  │
             ▼                 └────────────┬─────────────┘
  ┌──────────────────────┐                 ▼
  │ SALIDA: descarga     │        ◇ ¿Reconoce ◇
  │ individual / todo en │        ◇ las columnas? ◇
  │ .zip / envío correo  │        ╰──────┬────────┬──╯
  └──────────┬───────────┘    NO ───────┘        └────── SÍ
             ▼                  │                        ▼
      ┌─────────────┐  ┌──────────────────┐  ┌───────────────────────┐
      │     FIN     │  │ Marcar ERROR: ese │  │ Recorrer fila por     │
      └─────────────┘  │ archivo no se     │  │ fila: validar +       │
                       │ procesa          │  │ liquidar (reglas §4)  │
                       └───────┬──────────┘  └──────────┬────────────┘
                               └──────(vuelve por el    │
                                     costado, sigue el  ▼
                                     siguiente archivo) Generar .xlsx
                                      hasta terminar    con TOTALES
```

**Validación por fila** (decisión con dos salidas):

```
 ◇ ¿Fila válida? ◇   (nombre + rol reconocido + horas)
        │
    NO ─┴─ SÍ
    │        │
    ▼        ▼
 observación   LIQUIDAR (fórmulas §4): base → subsidio → ingresos
 y se omite           → descuentos → neto → acumular totales
```

**Procesamiento de cada archivo**

1. Leer la primera hoja del Excel (valor crudo de las celdas).
2. Detectar la fila de encabezados (puntuación por sinónimos) y mapear columnas.
   Si el usuario configuró mapeo manual, este manda sobre el automático.
3. Verificar columnas obligatorias: `nombre` y `rol`. Si faltan → error accionable
   que indica qué columnas se leyeron y dónde asignarlas.
4. Por cada fila: omitir vacías y las `EJEMPLO`; validar nombre y rol; registrar
   observaciones (sin cédula, rol no reconocido, sin columna de horas); liquidar.
5. Generar el .xlsx con fila de TOTALES (no se suman tarifas: la columna "Valor hora"
   queda vacía en totales).

---

## 7. Funcionalidades detalladas

### 7.1 Carga y procesamiento en lote

- Arrastrar o seleccionar **múltiples** `.xlsx / .xls / .csv` a la vez.
- Cola con estados por archivo: *En espera → Procesando → Listo / Con error*.
- Fuerza de trabajo de 3 archivos simultáneos; un archivo con error no detiene a los demás.
- Al terminar el lote, aviso con la cantidad de extractos generados.

### 7.2 Lectura tolerante de Excel y mapeo

- Sinónimos por campo (`Cargo`→rol, `HRS LABORADAS`→horas, `APELLIDOS Y NOMBRES`→nombre,
  `Correo electrónico`→correo, etc.), sin sensibilidad a mayúsculas ni tildes.
- Valores monetarios en formato colombiano: `$200.000`, `1.500.000`, `350.000,50`, negativos `(50.000)`.
- Mapeo manual de respaldo en *Reglas → Columnas del Excel* (persistente por equipo).

### 7.3 Vista previa y resultados

- Tarjetas de totales: extractos listos, empleados, neto a pagar y descuentos.
- Tabla por archivo con todas las columnas del extracto, fila de **TOTALES** y
  observaciones visibles.
- **Signos** según §4.3 y formato de pesos es-CO.

### 7.4 Ficha individual del trabajador (nueva)

- Clic sobre el **nombre** en la vista previa → vista individual con:
  - datos del trabajador (archivo, rol, cédula, hijos, horas, fecha de liquidación);
  - tarjetas de **Ingresos** (con `+`) y **Descuentos** (con `−`);
  - total de ingresos, total de descuentos y **NETO A PAGAR** destacado;
  - botón *Descargar extracto de este trabajador* (solo su nómina).
- Botón *← Volver a resultados* mantiene el flujo sin perder el archivo.

### 7.5 Descargas

- **Individual**: extracto completo del archivo (`.xlsx`).
- **Total**: todos los extractos en un solo `.zip` con un clic.
- **Individual por trabajador**: desde la ficha, su extracto únicamente.

### 7.6 Envío automatizado por correo (nueva)

El navegador no puede enviar correos directamente; la solución genera un **paquete
de envío** que automatiza la entrega vía **Outlook** (COM), instalado en los equipos
corporativos:

```
Envio_Nomina_<archivo>_<fecha>.zip
├── extractos/            un .xlsx por trabajador (SÓLO su nómina)
├── correos.csv           destinatarios: nombre, correo, adjunto
├── enviar_correos.ps1    script PowerShell (Outlook)
├── enviar_correos.bat    ejecutable de doble clic
└── LEEME.txt             instrucciones
```

- Cada correo se envía **únicamente al trabajador** con **solo su extracto** adjunto.
- Trabajadores sin correo se omiten y se informa la cantidad.
- Modo seguro: `$modo = 'borrador'` abre cada correo en Outlook sin enviar (revisión).
- Si el archivo no tiene columna Correo, el botón lo explica y orienta al mapeo.

### 7.7 Reglas de cálculo configurables

- Tarifas por rol, subsidio por hijo (valor y tope), jornada diaria, recargos,
  porcentajes de seguridad social y cesantías se editan en *Reglas de cálculo*.
- Persisten en el equipo y un botón **Reprocesar** recalcula los archivos ya subidos
  sin volver a cargarlos.
- *Valores del problema* restaura los defaults del enunciado.

---

## 8. Formato de datos

### 8.1 Entrada (una fila por trabajador, primera hoja)

| Columna             | Obligatoria | Contenido |
|---------------------|-------------|-----------|
| Nombre completo     | Sí          | Nombre y apellidos |
| Cédula              | Recomendada | Identificación |
| Rol                 | Sí          | Gerente / Admin / Operario (o variantes reconocidas) |
| Hijos               | No          | Cantidad de hijos |
| Horas               | Sí          | Horas del mes |
| Horas extras        | No          | Horas extra (días/horas según columna) |
| Domingos / Festivos | No          | Días trabajados |
| Nocturnas           | No          | Horas nocturnas |
| Primas              | No          | Valor monetario |
| Vivienda / Libranza / Otros | No | Valores de descuento |
| Correo              | Para envío  | Habilita el envío por correo |

La plantilla descargable (`Plantilla_Nomina.xlsx`) trae este formato con filas `EJEMPLO`
que el sistema ignora al procesar.

### 8.2 Salida (23 columnas)

Nombre completo · Cédula · Rol · Hijos · Horas · Valor hora · Salario base ·
Horas extras · Dominicales · Festivos · Nocturnas · Primas · **Subsidio hijos (+)** ·
Cesantías · Total ingresos · **Salud EPS (−)** · **Pensión (−)** · **Solidaridad (−)** ·
**Vivienda (−)** · **Libranza (−)** · **Otros (−)** · **Total descuentos (−)** · **Neto a pagar**

Con fila de **TOTALES** (sin sumar la columna Valor hora) y formato de miles + signos.

---

## 9. Ejemplo numérico verificado

**María Camila Torres** — Gerente, 160 h, 1 hijo, 1 feriado, 5 h nocturnas, primas $250.000.

```
Salario base    = 160 × $100.000            = $16.000.000
Feriado         = 8 h × $100.000 × 2,00     =  $1.600.000
Nocturnas       = 5 h × $100.000 × 1,35     =    $675.000
Subsidio        = 1 hijo × $200.000         =    $200.000
Primas          =                            =    $250.000
TOTAL LIQUIDADO                             = $18.725.000
Salud (4 %)     = $18.725.000 × 4 %         =    $749.000   ← sobre el total liquidado
Pensión (4 %)   = $18.725.000 × 4 %         =    $749.000
Total descuentos                            =  $1.498.000
NETO A PAGAR     = $18.725.000 − $1.498.000 = $17.227.000
```

Valor confirmado por el sistema (ver `test/diagnostico.mjs`, 126 cruces).

---

## 10. Calidad y verificación

| Suite                       | Alcance                                                          | Resultado |
|-----------------------------|------------------------------------------------------------------|-----------|
| `test/test-logica.mjs`      | subsidio/tope, roles, números es-CO, recargos, cesantías, signos, correo, detección de columnas | 70 / 70 |
| `test/pipeline.mjs`         | leer Excel → liquidar → generar extracto → releer y cuadrar totales | 30 / 30 |
| `test/diagnostico.mjs`      | cruce campo a campo contra cálculo manual independiente (12 empleados + totales) | 126 / 126 |
| `e2e` (Edge headless)       | subir, procesar, signos, ficha individual, descargas, `.zip` total, paquete de correo, error controlado, cambio de tarifa | 36 / 36 |
| E2E sobre archivo único     | idéntico sobre `Liquidador_Nomina.html`                          | 35 / 35 |

Los tests cubren los casos de rendición del enunciado (subsidio 1/2/3+, tope),
los descuentos sobre el total liquidado, la fila de TOTALES y los flujos nuevos
(signos, ficha individual y paquete de envío con 8 extractos y 8 destinatarios).

---

## 11. Guías de uso

### 11.1 Usuario final (liquidador)

1. Abrir `Liquidador_Nomina.html` (doble clic; no requiere instalación ni internet).
2. *Cargar archivos* → arrastrar el/los Excel.
3. Esperar que cada archivo pase a **Listo**.
4. *Resultados* → abrir una tarjeta → revisar la tabla y observaciones → descargar
   (individual, todo en `.zip`) o **Enviar por correo** (abrir el `.zip` y ejecutar
   `enviar_correos.bat`).
5. Clic en el nombre de un trabajador → ficha individual → descargar su extracto.

### 11.2 Desarrollador

```
git clone https://github.com/7Freeza/liquidador-nomina.git
cd liquidador-nomina
npm install
npm run dev        # servidor 8080 + tests en watch + reempaquetado automático
npm test           # suite completa de lógica + pipeline
npm run build      # regenera Liquidador_Nomina.html
npm run ejemplos   # regenera los Excel de prueba
```

---

## 12. Estado y próximos pasos

**Entregado en v1.2:** reglas de negocio del enunciado (+ corrección de descuentos
sobre el total liquidado), lote multi-archivo, reglas configurables, vista previa con
observaciones, signos, ficha individual, descargas y envío automatizado por Outlook,
documentación y suite de verificación.

**Pendiente / ideas:** subir la v1.2 al repositorio público
(`https://github.com/7Freeza/liquidador-nomina`, actualmente con la v1.0),
pantalla de ajuste manual de correos antes de armar el paquete, certificado/aplicación
firmada para evitar el aviso de SmartScreen al ejecutar el `.bat`, y plantilla de
asunto/mensaje del correo configurable desde la interfaz.