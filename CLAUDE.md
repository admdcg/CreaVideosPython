# CLAUDE.md — Orientación para agentes

App web Flask que genera un **vídeo slideshow MP4** desde fotos, con transiciones
y música de fondo. Frontend SPA en JS vanilla; backend de un solo archivo;
despliegue en Railway con gunicorn. **Documentación completa en `README.md`** —
léelo para detalle funcional/técnico; esto es el resumen accionable.

## Mapa del código (todo importa, no hay sorpresas escondidas)
- `app.py` — **todo el backend**: rutas Flask, render con MoviePy en un hilo,
  biblioteca de música, helpers de imagen/EXIF. ~550 líneas.
- `templates/index.html` — UI completa (una página).
- `static/js/main.js` — estado de cliente, llamadas a la API, drag&drop, preview.
- `static/css/style.css` — estilos (tema oscuro glassmorphism).
- `Procfile` — `web: gunicorn app:app` (Railway).
- `requirements.txt` — Flask, moviepy, Pillow, proglog, gunicorn.
- No hay BD, tests, linters ni CI. Estado en memoria + archivos efímeros.

## Comandos
```bash
pip install -r requirements.txt
python app.py          # dev local, http://localhost:5000
gunicorn app:app       # igual que producción (Railway)
```
Validación rápida tras cambios: `python -m py_compile app.py`. Necesita ffmpeg
(lo trae moviepy) para renderizar.

## Convenciones
- Mensajes/UI en **español**; código y nombres en inglés.
- Frontend **sin framework ni build** — JS vanilla directo. No introducir
  bundlers/React sin que lo pidan.
- Mantener el estilo del archivo que tocas (densidad de comentarios, naming).

## Gotchas críticos (no romper esto)
1. **`if __name__ == '__main__'` NO corre bajo gunicorn.** Lo que deba ejecutarse
   en producción al arrancar va a **nivel de módulo** (así está el prefetch de
   música: `threading.Thread(target=download_default_tracks, ...).start()`).
2. **Estado en memoria → 1 solo worker.** El dict global `tasks` no se comparte
   entre procesos. No añadir `--workers N` al Procfile: rompería el polling de
   `/api/status` (Task not found). Para escalar haría falta Redis/DB.
3. **MoviePy 2.x** (no 1.x): `with_duration`, `with_effects`, `subclipped`,
   `with_audio`, `vfx.CrossFadeIn`, `afx.AudioLoop`, `afx.AudioFadeOut`.
4. **Filesystem efímero en Railway:** `uploads/`, `default_music/` y los MP4
   generados se pierden al redesplegar. Nada de persistencia en disco.
5. **Música:** `*.mp3` están gitignored; las pistas se descargan en runtime
   (`DEFAULT_TRACKS` en `app.py`). Descarga atómica (temporal + `os.replace`).
6. **Preview de música:** asignar siempre `src` antes de reproducir; NO comparar
   por subcadena de la URL (`track1` es prefijo de `track11` → bug).

## Despliegue
- Railway despliega automáticamente al **mergear a `main`** (no hay CI en GitHub).
- Comprobar: panel de Railway → Deployments (logs build/runtime); o `GET
  /api/music_tracks` en la URL pública.

## Git / flujo de trabajo
- Rama por defecto: `main` (es la que despliega Railway).
- Trabaja en una rama `claude/...`, no pushes directo a `main` sin permiso.
- Crea PR solo si lo piden. El repo usa PRs (squash merge).
