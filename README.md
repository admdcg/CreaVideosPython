# FotoStream Studio (CreaVideosPython)

Aplicación web que genera un **vídeo slideshow en MP4** a partir de un conjunto
de fotos, con transiciones de _crossfade_ y música de fondo. El usuario sube sus
fotos, las ordena, ajusta parámetros (duración, transición, encuadre,
resolución), elige música y descarga el vídeo resultante.

- **Frontend:** una sola página (`templates/index.html`) con JS _vanilla_.
- **Backend:** Flask de un solo archivo (`app.py`) que renderiza el vídeo con
  MoviePy en un hilo en segundo plano y expone una API REST con _polling_ de
  progreso.
- **Despliegue:** Railway, vía `Procfile` con gunicorn.

> Nombre de marca en la UI: **FotoStream Studio**. Nombre del repositorio:
> **CreaVideosPython** (`admdcg/CreaVideosPython`).

---

## 1. Documentación funcional

### Flujo del usuario
1. **Añadir fotos.** Arrastrar/soltar o seleccionar imágenes. Se suben al
   servidor (`POST /api/upload_photos`) y quedan en una _sesión_ identificada por
   un `session_id` de 8 caracteres.
2. **Ordenar.** Reordenar por _drag & drop_, o con los botones: orden
   alfabético, por fecha (fecha de captura EXIF si existe), o invertir orden.
3. **Ajustar el vídeo** (panel "Ajustes de Video"):
   - **Duración por foto:** 1.0 s – 2.5 s (por defecto 1.5 s).
   - **Duración de transición:** 0.0 s – 0.8 s (por defecto 0.4 s). Si es 0, no
     hay _crossfade_. Debe ser menor que la duración por foto (la UI lo fuerza).
   - **Ajuste de aspecto** (cómo encajan fotos verticales/panorámicas):
     - `blurred_background` — Fondo borroso cinemático (por defecto).
     - `black_bars` — Barras negras, imagen original sin recortar.
     - `cropped` — Recorta para llenar la pantalla.
   - **Resolución:** `1920x1080` (Full HD, por defecto en la UI) o `1280x720`.
4. **Elegir música** (panel "Música de Fondo"):
   - **Música de la biblioteca:** desplegable con pistas integradas + opción
     **🎲 Aleatoria** (comportamiento por defecto). Botón ▶ de **preview** para
     escuchar la pista en el navegador antes de generar (deshabilitado en modo
     Aleatoria, porque aún no hay pista concreta).
   - **Subir mi propio audio:** MP3, WAV, M4A u OGG (`POST /api/upload_audio`).
5. **Generar.** `POST /api/generate` arranca el render en un hilo y devuelve un
   `task_id`. El frontend hace _polling_ a `GET /api/status/<task_id>` cada 1 s y
   muestra una barra de progreso.
6. **Descargar.** Al completarse, se reproduce el vídeo y se ofrece descarga
   desde `/video/<filename>`.

### Tratamiento del audio durante el render
- Si la pista es **más larga** que el vídeo → se recorta.
- Si es **más corta** → se repite en bucle (`AudioLoop`) hasta cubrir el vídeo.
- Siempre se aplica un **fade out de 1.5 s** al final.
- Si el audio falla por cualquier motivo, el vídeo se genera **sin música** (no
  aborta el render).

### Biblioteca de música integrada
Pistas _royalty-free_ de [SoundHelix](https://www.soundhelix.com), definidas en
`DEFAULT_TRACKS` (`app.py`). Se **descargan bajo demanda** (no se versionan en el
repo; los `*.mp3` están en `.gitignore`) y se guardan en `default_music/`.

| id        | Nombre              | Origen (SoundHelix)   |
|-----------|---------------------|-----------------------|
| `track1`  | Energía Pop         | SoundHelix-Song-1     |
| `track3`  | Ritmo Alegre        | SoundHelix-Song-3     |
| `track8`  | Acústica Suave      | SoundHelix-Song-8     |
| `track9`  | Melodía Épica       | SoundHelix-Song-9     |
| `track11` | Ambiente Relajado   | SoundHelix-Song-11    |
| `track15` | Aventura            | SoundHelix-Song-15    |

Los nombres son etiquetas descriptivas elegidas para la UI; SoundHelix son
pistas genéricas de demostración, no instrumentales temáticas reales.

Para **añadir/cambiar pistas**: edita la lista `DEFAULT_TRACKS`. Cada entrada
necesita `id` (único, usado como nombre de archivo `<id>.mp3`), `name`
(mostrado en la UI) y `url` (descarga directa del MP3).

---

## 2. Documentación técnica

### Stack
- **Python 3** + **Flask** (servidor web y API).
- **MoviePy 2.x** (render de vídeo; ojo: API 2.x, ver _gotchas_).
- **Pillow** (procesado de imágenes, EXIF, miniaturas).
- **proglog** (callback de progreso de MoviePy).
- **gunicorn** (servidor WSGI en producción).
- **ffmpeg** (lo trae MoviePy/`imageio-ffmpeg`; necesario para codificar MP4).
- Frontend: HTML + CSS + **JavaScript vanilla** (sin framework ni _build_).

### Estructura del proyecto
```
.
├── app.py                  # TODO el backend: rutas, render, música, helpers
├── Procfile                # Railway/gunicorn: web: gunicorn app:app
├── requirements.txt        # Dependencias Python
├── templates/
│   └── index.html          # Única página (UI completa)
├── static/
│   ├── css/style.css       # Estilos (tema glassmorphism oscuro)
│   └── js/main.js          # Lógica de cliente (estado, API, drag&drop, preview)
├── default_music/          # Pistas descargadas en runtime (gitignored)
├── uploads/                # Fotos/audio subidos en runtime (gitignored)
├── .thumbnails/            # Miniaturas cacheadas en runtime (gitignored)
└── README.md / CLAUDE.md   # Documentación
```
**No hay base de datos.** Todo el estado vive en memoria del proceso y en el
sistema de archivos efímero.

### Backend: piezas clave en `app.py`
- **Estado de tareas:** diccionario global en memoria `tasks` (`task_id` →
  `{status, progress, message, error, output_file}`). Estados: `idle` →
  `processing` → `rendering` → `completed` | `failed`.
- **Render:** `generate_video_thread()` corre en un `threading.Thread` por
  petición. Redimensiona cada foto a un temporal (`process_image`), crea
  `ImageClip`s, aplica `CrossFadeIn`, concatena con `padding` negativo para
  solapar las transiciones, añade audio y escribe el MP4 con
  `write_videofile(codec='libx264', audio_codec='aac', fps=24, threads=4)`.
- **Progreso:** `MoviePyProgressLogger` (subclase de `ProgressBarLogger`) traduce
  el progreso de codificación a porcentaje. El reparto aproximado del progreso
  es: 5–35 % optimización de fotos, 35–45 % montaje, 45–95 % codificación.
- **Imágenes:** `process_image()` implementa los 3 modos de encuadre; usa
  `ImageOps.exif_transpose` para respetar la orientación EXIF.
- **Fechas:** `get_image_capture_time()` lee `DateTimeOriginal` (EXIF) con
  _fallback_ a `mtime`. Permite ordenar por fecha de captura real.
- **Música:** `download_track` (descarga **atómica**: a temporal + `os.replace`),
  `download_default_tracks` (prefetch), `resolve_default_track` (resuelve
  `random` o un `id` concreto, descargando si falta).

### Dos orígenes de fotos
1. **Sesión subida** (caso real en Railway): `session_id` presente → las fotos
   están en `uploads/<session_id>/`.
2. **Archivos locales** (caso dev/local): sin `session_id`, `get_photos_list()`
   escanea imágenes en el **directorio de trabajo** (cwd). En Railway el cwd no
   tiene fotos, así que este modo solo aplica en local si dejas imágenes junto a
   `app.py`.

### API REST
| Método | Ruta                          | Descripción |
|--------|-------------------------------|-------------|
| GET    | `/`                           | Sirve la SPA (`index.html`). |
| GET    | `/api/photos`                 | Lista imágenes del cwd (modo local). |
| POST   | `/api/upload_photos`          | Sube fotos a `uploads/<session_id>/`. Devuelve `session_id` + `files[]`. Acepta `?session_id=` para añadir a una sesión existente. |
| GET    | `/api/photo/<filename>`       | Sirve la imagen original (`?session_id=` opcional). |
| GET    | `/api/thumbnail/<filename>`   | Miniatura 300px cacheada (`?session_id=` opcional). |
| POST   | `/api/upload_audio`           | Sube audio del usuario a `uploads/`. Devuelve `filename`. |
| GET    | `/api/music_tracks`           | Lista la biblioteca: `[{id, name, available}]`. |
| GET    | `/api/music/<track_id>`       | _Stream_ de una pista para preview (descarga bajo demanda). |
| POST   | `/api/generate`               | Arranca el render. Devuelve `{task_id}`. (Payload abajo.) |
| GET    | `/api/status/<task_id>`       | Estado/progreso de la tarea. |
| GET    | `/video/<filename>`           | Descarga el MP4 generado (cwd). |

**Payload de `POST /api/generate`:**
```json
{
  "duration_per_photo": 1.5,
  "transition_duration": 0.4,
  "transition_type": "crossfade",          // o "none"
  "fit_mode": "blurred_background",         // black_bars | cropped
  "resolution": "1920x1080",               // o 1280x720
  "audio_option": "default",               // o "uploaded"
  "audio_track": "random",                 // id de pista o "random" (si default)
  "audio_filename": "",                    // nombre devuelto por upload_audio (si uploaded)
  "photo_order": ["abcd_foto1.jpg", "..."],// orden final de archivos
  "session_id": "a1b2c3d4"                 // si las fotos vienen de una subida
}
```

### Frontend (`static/js/main.js`)
- Estado en variables de módulo: `photoList`, `currentSessionId`,
  `uploadedAudioFilename`, `currentTaskId`, `pollInterval`.
- Inicialización en `DOMContentLoaded`: `loadPhotos`, `loadMusicTracks`,
  `setupSliders`, `setupAudioOptions`, `setupDropzone`, `setupSortingActions`.
- Preview de música: `toggleMusicPreview` asigna **siempre** el `src` antes de
  reproducir (los previews arrancan en 0). _No_ usar comprobación por subcadena
  de la URL: ids como `track1`/`track11` comparten prefijo y darían falsos
  positivos (bug ya corregido).

---

## 3. Despliegue en Railway

### Cómo funciona
- **`Procfile`:** `web: gunicorn app:app`. Railway detecta el proyecto Python
  (Nixpacks), instala `requirements.txt` y arranca ese proceso.
- **Puerto:** Railway inyecta la variable `PORT`. ⚠️ El `Procfile` actual es
  `web: gunicorn app:app` **sin** `--bind`, y gunicorn por defecto escucha en
  `:8000` (no lee `PORT`). Si en algún momento el deploy arranca pero la URL no
  responde / falla el healthcheck, el primer sospechoso es este: la forma robusta
  es `web: gunicorn app:app --bind 0.0.0.0:$PORT`. El bloque
  `if __name__ == '__main__'` (que sí lee `PORT`) **solo** aplica a
  `python app.py` en local, no bajo gunicorn.
- **Despliegue:** automático al hacer **push/merge a `main`** (rama conectada en
  el panel de Railway). No hay GitHub Actions ni CI en el repo.

### Prefetch de música y gunicorn (importante)
Como `if __name__ == '__main__'` no corre bajo gunicorn, el _prefetch_ de la
biblioteca se lanza a **nivel de módulo** (`app.py`, justo antes del `__main__`):
```python
threading.Thread(target=download_default_tracks, daemon=True).start()
```
Así las pistas se descargan en segundo plano también en producción, sin bloquear
el arranque. Aunque una pista no esté lista, `resolve_default_track` y
`/api/music/<id>` la descargan **bajo demanda**, así que nunca falla por _timing_.

### Sistema de archivos efímero
Railway reinicia/redespliega en contenedores efímeros. **Se pierde todo lo
escrito en disco** en cada reinicio:
- `uploads/` (fotos y audio subidos),
- `default_music/` (se vuelve a descargar al arrancar),
- los MP4 generados (guardados en cwd y servidos por `/video/<filename>`).

Implicación: un vídeo generado debe descargarse pronto; no es almacenamiento
persistente. Para persistencia real haría falta un _volume_ de Railway o
almacenamiento externo (S3/R2).

### Comprobar el despliegue
- En el panel de Railway: pestaña **Deployments** → logs de _build_ y _runtime_.
- Si arranca bien verás en logs `Downloading '<pista>'...` (prefetch).
- Salud rápida: abrir la URL pública (sirve `/`) y `GET /api/music_tracks`
  (debe responder JSON con las 6 pistas).

---

## 4. Desarrollo local

```bash
pip install -r requirements.txt
python app.py                 # arranca en http://localhost:5000 (debug=False)
# Producción/igual que Railway:
gunicorn app:app              # respeta el Procfile; usa PORT si está definido
```
Requiere **ffmpeg** disponible (lo aporta `imageio-ffmpeg` vía MoviePy).
No hay tests ni linters configurados en el repo.

---

## 5. Limitaciones y _gotchas_ (leer antes de tocar)

- **Estado en memoria + 1 worker.** `tasks` es un dict en memoria del proceso. Si
  se escala gunicorn a **varios workers**, `/api/generate` puede ejecutarse en un
  worker y `/api/status` consultarse en otro → "Task not found" y barra de
  progreso rota. **Mantener 1 worker** (no añadir `--workers N` al Procfile) o
  migrar el estado a un store compartido (Redis/DB) antes de escalar.
- **MoviePy 2.x.** La API cambió respecto a 1.x: `with_duration`, `with_effects`,
  `subclipped`, `with_audio`, efectos `vfx.CrossFadeIn`, `afx.AudioLoop`,
  `afx.AudioFadeOut`. No mezclar con sintaxis de MoviePy 1.x.
- **Render bloqueante por CPU.** La codificación es intensiva; en un plan
  pequeño de Railway, muchos vídeos a la vez o muchas fotos pueden agotar
  CPU/RAM. `threads=4` en `write_videofile`.
- **Sin autenticación ni límites de tamaño/tasa.** Cualquiera con la URL puede
  subir y generar. Considerar límites si se expone públicamente.
- **`.gitignore` excluye multimedia** (`*.jpg/png/mp3/mp4`, `uploads/`,
  `.thumbnails/`). No esperes ver media en el repo; todo es _runtime_.
- **Pinear Python (opcional).** No hay `runtime.txt`/`.python-version`; Railway
  elige la versión por defecto de Nixpacks. Añade uno si necesitas fijarla.

---

## 6. Tareas comunes (recetas)

- **Añadir una pista de música:** añade un dict a `DEFAULT_TRACKS` en `app.py`
  (`id` único, `name`, `url` directa al MP3). El desplegable y el preview la
  recogen automáticamente vía `/api/music_tracks`.
- **Cambiar resoluciones:** opciones en `templates/index.html` (`#resolution-
  select`); el backend parsea `"WxH"` directamente, no hay lista cerrada.
- **Nuevo modo de encuadre:** añade la rama en `process_image()` y la `<option>`
  correspondiente en `#fit-mode-select`.
- **Cambiar fps/codec/calidad:** parámetros de `write_videofile()` en
  `generate_video_thread()`.
- **Ajustar el fade de audio o el bucle:** bloque "Handle Audio" en
  `generate_video_thread()`.
