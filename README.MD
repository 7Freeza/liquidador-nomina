# Liquidador de Nómina

Aplicación web multiusuario para administrar empleados, roles laborales y liquidaciones individuales. Usa Node.js/Express, PostgreSQL y el motor de cálculo existente. El administrador gestiona usuarios y empleados; el liquidador consulta el directorio y registra liquidaciones, sin permisos para editar datos de empleados.

## Requisitos

- Node.js 22 o superior y npm
- PostgreSQL 13 o superior
- Cuenta Google Workspace y contraseña de aplicación para habilitar el envío SMTP de comprobantes

## Instalación local

Crea una base de datos PostgreSQL vacía, instala dependencias y prepara la configuración:

```bash
createdb liquidador_nomina
npm install
cp -n .env.example .env
```

Edita `.env` y configura `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`. La contraseña del primer administrador debe tener al menos 12 caracteres; el secreto de sesión debe ser aleatorio y tener al menos 32 caracteres. Al iniciar, el servidor crea las tablas, agrega los roles laborales iniciales y registra al administrador si su correo todavía no existe.

### Correo electrónico

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
