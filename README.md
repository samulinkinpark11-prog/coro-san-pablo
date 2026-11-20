# 🎶 Coro San Pablo · Lista y reparto

App web (PWA) del coro de villancicos de la parroquia de San Pablo (Sevilla): pasar lista en cada quedada y repartir el botín según el tiempo que ha estado cada uno. Funciona en iPhone y Android.

## Quién puede hacer qué
- **Súper usuarios**: pasan lista, cierran quedadas, gestionan la gente, aceptan registros, nombran a otros súper usuarios, cambian reglas y mueven el bote.
- **Usuarios**: solo ven **Mis asistencias** (día, tiempo, lo ganado y el total acumulado) y el saldo del bote.
- El **primero que se registra** se convierte en súper usuario automáticamente.

## Registro y acceso
1. La persona se registra con nombre completo, usuario y contraseña → queda **pendiente**.
2. Llega un correo de aviso (EmailJS) y aparece la solicitud en la pestaña **Coro**.
3. Un súper usuario la acepta y la **asocia** a su nombre de la lista.
4. Si alguien olvida la contraseña, un súper usuario le pone una nueva desde su ficha.

## Reparto
- Botín − gastos del día = lo que se reparte.
- **Proporcional al tiempo** o **por tramos** (Ajustes), con margen de cortesía.
- Lo de cada uno se redondea **hacia abajo** (0,50 € por defecto); lo que sobra va al **bote común**.
- Al cerrar cada quedada se guarda una **copia automática** completa en la base de datos (se conservan las 60 últimas).

## Archivos
- `index.html`, `app.js` – la app.
- `config.js` – claves de Supabase y EmailJS (públicas por diseño).
- `supabase.sql` – estructura y permisos de la base de datos. Se pega en *Supabase → SQL Editor* y se ejecuta.
- `sw.js`, `manifest.webmanifest`, `icon-*.png` – instalación en el móvil.

## Puesta en marcha (una sola vez)
1. Supabase → **SQL Editor** → pegar `supabase.sql` → **Run**.
2. Supabase → **Authentication → Sign In / Providers → Email** → desactivar **Confirm email** → Save.
3. Poner la URL y la clave *anon/publishable* en `config.js`.
4. GitHub → Settings → Pages → rama `main`, carpeta `/ (root)`.
5. El responsable se registra el primero.

## Instalar en el móvil
- **iPhone (Safari)**: Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome)**: menú ⋮ → *Instalar app*.
