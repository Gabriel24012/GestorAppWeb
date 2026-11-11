# Gestión de Captura

Monorepo para el portal Angular, una API Django REST Framework y la aplicación Android React Native con Expo y TypeScript. PostgreSQL es la base compartida. La API Express y las migraciones Supabase se conservan temporalmente como respaldo e importador; los clientes nuevos usan Django.

## Requisitos locales

- Node.js 22.13 o superior (Node 24 recomendado)
- Python 3.11+
- Docker Desktop con Docker Compose
- Para Android: Android Studio con Android SDK, o teléfono Android con Expo Go

## Arrancar API y web en Windows

Desde CMD o PowerShell, en la raíz del repositorio:

Las variables locales pueden guardarse en `.env` (ignorado por Git). El comando `dev:api` carga ese archivo al iniciar; nunca subas `.env` al repositorio.

```powershell
docker compose up -d db
py -3.11 -m venv apps\api-django\.venv
.\apps\api-django\.venv\Scripts\python.exe -m pip install -r apps\api-django\requirements.txt
.\apps\api-django\.venv\Scripts\python.exe apps\api-django\manage.py migrate
.\apps\api-django\.venv\Scripts\python.exe apps\api-django\manage.py bootstrap_admin
```

La base parte vacía, sin usuarios ni registros de ejemplo. `bootstrap_admin` crea únicamente el administrador inicial `Admin` (`admin@gmail.com`) y solicita una contraseña nueva sin mostrarla; puedes cambiar estos valores con `--email` y `--name`. El correo debe poder recibir mensajes porque las cuentas deben verificarlo antes de iniciar sesión. Para producción configura `RESEND_API_KEY` y un `EMAIL_FROM` validado en Resend. Las fotos de perfil se guardan en un bucket compatible con S3 como Cloudflare R2; configura sus credenciales en el `.env` local o en las variables secretas del servicio Django en Render. Conserva esas claves privadas y no las subas a Git. Luego abre dos terminales:

> Si vas a importar la base local ficticia de Supabase, omite `bootstrap_admin` por ahora y sigue la sección de importación primero.

```powershell
npm.cmd run dev:api
```

```powershell
npm.cmd install
npm.cmd run dev:web
```

- Web: http://localhost:4200
- API: http://localhost:8000/api/v1
- Documentación interactiva: http://localhost:8000/api/docs/
- Salud: http://localhost:8000/health/

No se conecta a servicios externos. Si el puerto de PostgreSQL local ya está ocupado, cambia `54329` en `docker-compose.yml` y el puerto en `DATABASE_URL`.

## Conservar datos ficticios de Supabase local

Inicia el stack local Supabase solo si quieres conservar los registros ficticios actuales. Define la URL de conexión directa a la base local (no una service role key) y simula la importación:

```powershell
$env:SUPABASE_SOURCE_DATABASE_URL = "postgresql://postgres:TU_PASSWORD_LOCAL@127.0.0.1:54322/postgres"
apps/api-django/.venv/Scripts/python.exe apps/api-django/manage.py import_supabase_data --dry-run
```

En CMD, define esa misma variable con `set SUPABASE_SOURCE_DATABASE_URL=postgresql://postgres:TU_PASSWORD_LOCAL@127.0.0.1:54322/postgres` y usa `.apps\api-django\.venv\Scripts\python.exe` para ejecutar el importador.

Si los conteos son los esperados, importa:

```powershell
apps/api-django/.venv/Scripts/python.exe apps/api-django/manage.py import_supabase_data
```

El importador conserva IDs/relaciones y crea usuarios con contraseña sin definir. Ejecuta `bootstrap_admin` con el correo del administrador importado para definir su contraseña. No migres datos personales reales al prototipo gratuito.

## Aplicación Android Expo

En otra terminal:

```powershell
Copy-Item apps/mobile/.env.example apps/mobile/.env
npm.cmd run start -w @gestion-captura/mobile
```

En CMD, sustituye la primera línea por `copy apps\mobile\.env.example apps\mobile\.env`.

Para Android Emulator, `10.0.2.2` apunta a `localhost` de Windows. En un teléfono físico usa la IP LAN del PC (por ejemplo `http://192.168.1.40:8000/api/v1`), con ambos equipos en la misma red y puerto 8000 permitido en el firewall. `localhost` en el teléfono se refiere al teléfono mismo.

Android Studio sirve para instalar Android SDK y crear el emulador. Expo Go permite iterar rápidamente. Para compilar un APK de prueba con EAS:

```powershell
npx.cmd eas-cli build --platform android --profile preview
```

Antes del primer build inicia sesión y vincula el proyecto con `npx.cmd eas-cli@latest init`. El perfil `preview` genera APK instalable directamente. `production` genera AAB para una futura publicación. Los builds EAS requieren cuenta Expo; también puedes ejecutar `npx expo prebuild` y abrir `apps/mobile/android` en Android Studio.

La app usa JWT, almacena tokens con Expo SecureStore y tiene pantallas por rol. Requiere conexión; no guarda datos de trabajo offline.

## Despliegue de prototipo en Render

`render.yaml` define PostgreSQL, API Django y web Angular. Conecta el repositorio desde Render y usa el blueprint. La base se crea vacía; configura un secreto aleatorio `BOOTSTRAP_ADMIN_TOKEN`, las variables `AWS_*` del almacenamiento y verifica `APP_URL` y `CORS_ALLOWED_ORIGINS` con los dominios generados. Crea solo el primer administrador (`admin@gmail.com`, `Admin`) llamando `POST /api/v1/auth/bootstrap` con encabezado `X-Bootstrap-Token` y los campos `email`, `full_name` y `password` (elige una contraseña segura); luego quita el token. La cuenta debe verificar el correo antes de iniciar sesión. Configura en `apps/mobile/.env` la URL HTTPS pública de la API como `EXPO_PUBLIC_API_URL` antes de crear el APK.

El build EAS debe tener la variable `EXPO_PUBLIC_API_URL` con la URL HTTPS de la API en su entorno `preview` o `production`; para desarrollo local se define en `apps/mobile/.env`. El nivel gratis es solo para un prototipo ficticio: la API puede dormir y tardar en despertar; Postgres gratuito expira a los 30 días y no tiene respaldos automáticos. Antes de usar información real, migra a infraestructura persistente con respaldos.

## Estructura

- `apps/api-django`: API DRF, modelos, JWT, permisos, importador, exportaciones y OpenAPI
- `apps/web`: portal Angular
- `apps/mobile`: Android con React Native, Expo y TypeScript
- `apps/api`: API Express legado, temporalmente conservada para referencia
- `supabase/migrations`: esquema legado y base del importador
