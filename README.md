# 🎶 Coro San Pablo · Lista y reparto

App web (PWA) para pasar lista en el coro de villancicos de la parroquia de San Pablo (Sevilla) y repartir el botín de cada día según el tiempo que ha estado cada uno. Funciona en iPhone y Android, también sin conexión.

## Qué hace
- **Coro**: lista de la gente apuntada (se puede pegar una lista de nombres de golpe).
- **Hoy**: se abre la sesión con la hora de quedada y se pasa lista:
  - ✓ **Llegó** → apunta la hora actual (y marca si llega tarde).
  - ✗ **No viene** (enfermo, etc.) → ese día no cobra.
  - **Se va** → apunta la hora a la que se marcha antes.
  - ✎ para corregir horas a mano.
- **Terminar y repartir**: se pone la hora de fin y el botín, y calcula lo que le toca a cada uno. Se comparte por WhatsApp.
- **Historial**: sesiones cerradas y acumulado por persona.
- **Ajustes**: margen de cortesía, modo de reparto y copia de seguridad.

## Reglas del reparto
- **Margen de cortesía** (5 min por defecto): llegar o irse dentro de ese margen no penaliza.
- **Proporcional al tiempo**: cada uno pesa según los minutos que ha estado. Sesión de 3 h → quien está 1,5 h cobra media parte.
- **Por tramos**: se suman los minutos perdidos (tarde + irse antes) y se aplica el % del tramo (por defecto: hasta 10 min 100 %, hasta 30 min 75 %, hasta 60 min 50 %, más de 60 min 25 %).
- El botín se reparte **entero** entre los que vinieron, en proporción a su parte. Los céntimos sobrantes se ajustan para que cuadre exacto.

## Publicarla con GitHub Pages
1. En el repositorio: **Settings → Pages**.
2. En *Source* elige **Deploy from a branch**, rama `main`, carpeta `/ (root)` y guarda.
3. En un par de minutos estará en `https://<usuario>.github.io/<repositorio>/`.

## Instalarla en el móvil
- **iPhone (Safari)**: abrir el enlace → botón Compartir → **Añadir a pantalla de inicio**.
- **Android (Chrome)**: abrir el enlace → menú ⋮ → **Instalar app** / Añadir a pantalla de inicio.

## Importante: dónde se guardan los datos
Los datos se guardan **en el móvil de quien pasa lista** (no en un servidor). Recomendado:
- Que pase lista siempre la misma persona (o pasaros el archivo con *Exportar / Importar*).
- Exportar una copia de vez en cuando (Ajustes → Exportar datos).

## Actualizar
Al subir cambios al repo, la app se actualiza sola la próxima vez que se abra con conexión. Si cambias archivos, sube la versión de `CACHE` en `sw.js`.
