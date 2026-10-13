# Liquidador de Nómina

Aplicación web multiusuario para administrar empleados, roles laborales y liquidaciones individuales. Usa Node.js/Express, PostgreSQL y el motor de cálculo existente. El administrador gestiona usuarios y empleados; el liquidador consulta el directorio y registra liquidaciones, sin permisos para editar datos de empleados.

## Requisitos

- Node.js 22 o superior y npm
- PostgreSQL 13 o superior
- Cuenta Google Workspace y contraseña de aplicación para habilitar el envío SMTP de comprobantes

## Guía paso a paso para arrancar el proyecto

Sigue estos pasos en orden para iniciar la aplicación correctamente desde cero:

### Paso 1. Clonar el repositorio e instalar dependencias

```bash
npm install
```

### Paso 2. Preparar la base de datos PostgreSQL

Asegúrate de tener PostgreSQL en ejecución y crea la base de datos:

```bash
# Opción A (rápida): Con el usuario del sistema o postgres
sudo -u postgres createdb liquidador_nomina

# Opción B (recomendada en producción): Usuario dedicado con permisos
sudo -u postgres psql -c "CREATE USER liquidador WITH PASSWORD 'tu_clave_segura';"
sudo -u postgres psql -c "CREATE DATABASE liquidador_nomina OWNER liquidador;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE liquidador_nomina TO liquidador;"
```

### Paso 3. Configurar variables de entorno (`.env`)

Copia la plantilla de configuración:

```bash
cp -n .env.example .env
```

Abre el archivo `.env` y define los parámetros obligatorios:

- `DATABASE_URL`: Cadena de conexión a PostgreSQL (ej. `postgres://liquidador:tu_clave_segura@localhost:5432/liquidador_nomina`).
- `SESSION_SECRET`: Secreto aleatorio de **mínimo 32 caracteres** (ej. generado con `openssl rand -hex 20`).
- **Credenciales iniciales de Administrador**:
  - `ADMIN_EMAIL`: Correo del administrador (ej. `admin@empresa.com`).
  - `ADMIN_PASSWORD`: Contraseña inicial de **mínimo 12 caracteres** (ej. `lmao090908!!!`).
  - `ADMIN_NAME`: Nombre del administrador (ej. `Administrador`).
- **Credenciales iniciales de Liquidador**:
  - `LIQUIDATOR_EMAIL`: Correo del liquidador (ej. `liquidador@empresa.com`).
  - `LIQUIDATOR_PASSWORD`: Contraseña inicial de **mínimo 12 caracteres** (ej. `lmao090908!!!`).
  - `LIQUIDATOR_NAME`: Nombre del liquidador (ej. `Liquidador`).

> [!NOTE]
> **Dos perfiles y dos vistas independientes de acceso:**
> El sistema siembra (*bootstrap*) ambas cuentas directamente al arrancar, permitiendo evaluar de inmediato ambas vistas sin pasos manuales previos:
> 1. **Vista de Administrador** (`admin@empresa.com`):
>    - Gestión integral de empleados: creación, edición, eliminación y carga masiva desde Excel/CSV.
>    - Gestión de usuarios del sistema (crear y desactivar administradores y liquidadores).
>    - Gestión de roles laborales y tarifas por hora.
>    - Configuración de reglas generales de cálculo de nómina.
>    - Liquidación de nómina y seguimiento de entregas.
> 2. **Vista de Liquidador** (`liquidador@empresa.com`):
>    - **Consulta de empleados**: búsqueda por nombre, cédula, teléfono, correo o filtro por rol (estrictamente en modo lectura, sin formularios de creación/edición ni eliminación).
>    - **Liquidar horas**: selección de empleado, captura de horas trabajadas, recargos y deducciones, cálculo y envío de comprobantes de pago por correo.
>    - **Seguimiento de entregas**: trazabilidad del estado de envío y confirmación del comprobante.
>    - **Mi cuenta**: gestión de contraseña propia.
>    - *Bloqueo de seguridad*: los módulos de usuarios, roles laborales, reglas y creación/edición de empleados están ocultos en la interfaz y bloqueados en el backend (`HTTP 403`).

### Paso 4. Arrancar el servidor

- **Modo desarrollo** (con recarga automática ante cambios):
  ```bash
  npm run dev
  ```
- **Modo estándar / producción**:
  ```bash
  npm start
  ```

Al arrancar, el servidor:
1. Crea automáticamente el esquema de tablas en PostgreSQL y la extensión `pgcrypto`.
2. Inserta los roles laborales predeterminados (`Gerente`, `Admin`, `Operario`) y las reglas de cálculo base.
3. Registra las cuentas iniciales de **Administrador** y **Liquidador** con sus contraseñas configuradas.
4. Si el directorio está vacío, inserta empleados de ejemplo para pruebas de liquidación.
5. Queda escuchando en <http://localhost:8080> (o en el `PORT` configurado).

### Paso 5. Acceso al sistema según el rol

1. Abre en tu navegador <http://localhost:8080>.
2. **Para ingresar como Administrador**:
   - Correo: `admin@empresa.com` (o el valor de `ADMIN_EMAIL`).
   - Contraseña: Tu contraseña configurada en `ADMIN_PASSWORD`.
   - Visualizarás el **Portal Administrador** con acceso completo al directorio, roles, reglas y usuarios.
3. **Para ingresar como Liquidador**:
   - Cierra sesión o abre una ventana privada.
   - Correo: `liquidador@empresa.com` (o el valor de `LIQUIDATOR_EMAIL`).
   - Contraseña: Tu contraseña configurada en `LIQUIDATOR_PASSWORD`.
   - Visualizarás el **Portal Liquidador** con menú específico para consulta de empleados, captura y liquidación de horas trabajadas, y entregas.

### Paso 6. Gestión de usuarios adicionales (Opcional)

Desde la vista de Administrador puedes ir a la sección **Gestión de Usuarios** para crear nuevas cuentas asignando el rol de Administrador o Liquidador según las necesidades de la empresa.

---

### Configuración opcional: Envío de correos (Gmail / Google Workspace)

El envío usa SMTP de Gmail mediante Nodemailer. Para activarlo:

1. Usa una cuenta de Google Workspace con acceso a Gmail y habilita la verificación en dos pasos.
2. Genera una contraseña de aplicación en la cuenta remitente. Si la organización bloquea las contraseñas de aplicación, el administrador de Workspace debe permitir este método o se debe integrar un proveedor SMTP/OAuth diferente.
3. Configura `GMAIL_USER` con la cuenta remitente, `GMAIL_APP_PASSWORD` con la contraseña de aplicación y `GMAIL_FROM` con un remitente autorizado para esa cuenta/dominio.
4. Configura `APP_BASE_URL` con la dirección HTTPS del servidor, accesible desde el dispositivo del empleado. No uses `localhost` en un despliegue compartido: el enlace de confirmación se abre desde el equipo del destinatario.
5. Permite conexiones salientes al SMTP de Google desde el servidor y verifica la entrega con un buzón de prueba. Para mejorar la entregabilidad del dominio, configura SPF, DKIM y DMARC según las instrucciones de Google Workspace.

Si estas variables no están configuradas, la aplicación seguirá funcionando, pero no enviará comprobantes. El dashboard registra la confirmación cuando el empleado pulsa el enlace; no puede demostrar que leyó el mensaje solo por haberlo abierto. El adjunto contiene información salarial sensible: limita quién puede acceder al correo y evita enviar nóminas a direcciones no verificadas.

Inicia la aplicación:

```bash
npm run dev
```

Abre <http://localhost:8080> e inicia sesión con el correo y la contraseña configurados como administrador inicial. Para ejecutar sin reinicio automático, usa `npm start`.

## Puesta en servidor interno

Despliega la aplicación en un equipo accesible por los administradores y liquidadores, instala PostgreSQL y define las variables de `.env` en el entorno del servicio. Configura `NODE_ENV=production`, un `SESSION_SECRET` aleatorio de al menos 32 caracteres y `APP_BASE_URL` con la URL HTTPS interna. Coloca TLS en el proxy inverso o balanceador de la empresa y limita el acceso a la red autorizada.

No subas `.env` ni credenciales al repositorio. `.env.example` contiene valores ficticios que debes reemplazar en `.env`. El `.gitignore` excluye secretos, dependencias instaladas, logs, artefactos temporales y archivos locales del sistema; no excluye archivos necesarios de la aplicación o del despliegue, como `package-lock.json`. La inicialización requiere permisos para crear las tablas de aplicación en la base de datos.

## Funciones

- **Administrador:** crear y editar empleados (nombre, cédula, teléfono, correo, rol e hijos), eliminarlos, importarlos desde Excel/CSV, gestionar usuarios, crear o eliminar roles laborales y mantener las reglas compartidas.
- **Contraseñas:** la contraseña inicial y las contraseñas temporales de nuevas cuentas deben cambiarse en “Mi cuenta” antes de utilizar las demás funciones.
- **Liquidador:** buscar y filtrar empleados por rol, liquidar individualmente horas y recargos, guardar el comprobante y enviarlo por correo.
- **Seguimiento:** el dashboard registra envíos y confirmaciones explícitas. El empleado confirma con el enlace incluido en el correo; una apertura del mensaje no se presenta como lectura verificada.
- **Importación:** requiere encabezados para nombre, cédula y rol. Teléfono, correo e hijos son opcionales. La cédula identifica el registro: si ya existe, se actualiza. Se omiten filas sin cédula, rol no existente o con nombre iniciado por `Ejemplo`.
- **Roles laborales:** cada rol tiene una tarifa por hora, que se usa en el cálculo. No se puede eliminar un rol asignado a empleados.
- **WhatsApp:** no está habilitado en esta versión. Para enviar mensajes y registrar respuestas entrantes se requiere WhatsApp Business Platform o un proveedor compatible, además de credenciales, URL pública/webhook y configuración empresarial. Un número móvil común, por sí solo, no ofrece esa integración desde la aplicación.

## Comandos

| Comando | Acción |
| --- | --- |
| `npm run dev` | Arranca la aplicación con reinicio automático al modificar archivos del servidor. |
| `npm start` | Arranca la aplicación sin modo de observación. |
| `npm test` | Ejecuta las pruebas de cálculo y del pipeline Excel. |
| `npm run build` | Genera `Liquidador_Nomina.html` con los archivos de interfaz incluidos. El backend y PostgreSQL siguen siendo necesarios para iniciar sesión y usar las funciones multiusuario. |
| `npm run ejemplos` | Genera archivos de prueba en `ejemplos/`. |

Las pruebas del pipeline escriben `ejemplos/muestra_extracto_salida.xlsx`.
