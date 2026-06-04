import os
import sys
import uuid
import threading
import tempfile
import urllib.request
import shutil
from flask import Flask, request, jsonify, send_file, render_template, send_from_directory
from werkzeug.utils import secure_filename
from PIL import Image, ImageOps, ImageFilter

# Imports from moviepy
import moviepy
from moviepy import ImageClip, concatenate_videoclips, AudioFileClip, vfx, afx
from proglog import ProgressBarLogger

app = Flask(__name__, static_folder='static', template_folder='templates')

# Configuration
UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads')
THUMBNAIL_FOLDER = os.path.join(os.getcwd(), '.thumbnails')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(THUMBNAIL_FOLDER, exist_ok=True)

# Allowed extensions
ALLOWED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp'}
ALLOWED_AUDIO_EXTENSIONS = {'.mp3', '.wav', '.m4a', '.ogg'}

# Global state for background video rendering tasks
# key: task_id, value: {status, progress, message, error, output_file}
tasks = {}

def get_photos_list():
    """Scan directory for valid image files, sorted by name."""
    files = []
    for f in os.listdir('.'):
        if os.path.isfile(f):
            ext = os.path.splitext(f)[1].lower()
            if ext in ALLOWED_IMAGE_EXTENSIONS and not f.startswith('.'):
                mtime = os.path.getmtime(f)
                size = os.path.getsize(f)
                files.append({
                    'name': f,
                    'mtime': mtime,
                    'size': size
                })
    return files

def get_or_create_thumbnail(filename, session_id=None):
    """Generate and return cached thumbnail for photo."""
    # If session_id is provided, look in uploads/<session_id>/
    if session_id:
        original_path = os.path.join(UPLOAD_FOLDER, session_id, filename)
        thumb_name = f"{session_id}_{filename}"
    else:
        original_path = os.path.join(os.getcwd(), filename)
        thumb_name = filename
        
    thumb_path = os.path.join(THUMBNAIL_FOLDER, thumb_name)
    if os.path.exists(thumb_path):
        return thumb_path
        
    if not os.path.exists(original_path):
        return None
        
    try:
        with Image.open(original_path) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail((300, 300), Image.Resampling.LANCZOS)
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')
            img.save(thumb_path, 'JPEG', quality=85)
        return thumb_path
    except Exception as e:
        print(f"Error creating thumbnail for {filename}: {e}")
        return None

def process_image(img_path, dest_path, target_width=1920, target_height=1080, mode='blurred_background'):
    """Resizes and pads/crops image to fit target video resolution."""
    with Image.open(img_path) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode != 'RGB':
            img = img.convert('RGB')
            
        orig_w, orig_h = img.size
        target_ratio = target_width / target_height
        orig_ratio = orig_w / orig_h
        
        if mode == 'cropped':
            if orig_ratio > target_ratio:
                new_h = target_height
                new_w = int(orig_w * (target_height / orig_h))
                img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                left = (new_w - target_width) // 2
                img_final = img_resized.crop((left, 0, left + target_width, target_height))
            else:
                new_w = target_width
                new_h = int(orig_h * (target_width / orig_w))
                img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                top = (new_h - target_height) // 2
                img_final = img_resized.crop((0, top, target_width, top + target_height))
        else:
            if orig_ratio > target_ratio:
                fit_w = target_width
                fit_h = int(orig_h * (target_width / orig_w))
            else:
                fit_h = target_height
                fit_w = int(orig_w * (target_height / orig_h))
                
            img_fit = img.resize((fit_w, fit_h), Image.Resampling.LANCZOS)
            
            if mode == 'black_bars':
                img_final = Image.new('RGB', (target_width, target_height), color='black')
                x = (target_width - fit_w) // 2
                y = (target_height - fit_h) // 2
                img_final.paste(img_fit, (x, y))
            else:  # blurred_background
                if orig_ratio > target_ratio:
                    bg_w = int(orig_w * (target_height / orig_h))
                    bg_h = target_height
                    img_bg = img.resize((bg_w, bg_h), Image.Resampling.LANCZOS)
                    left = (bg_w - target_width) // 2
                    img_bg = img_bg.crop((left, 0, left + target_width, target_height))
                else:
                    bg_w = target_width
                    bg_h = int(orig_h * (target_width / orig_w))
                    img_bg = img.resize((bg_w, bg_h), Image.Resampling.LANCZOS)
                    top = (bg_h - target_height) // 2
                    img_bg = img_bg.crop((0, top, target_width, top + target_height))
                    
                img_bg = img_bg.filter(ImageFilter.GaussianBlur(radius=30))
                x = (target_width - fit_w) // 2
                y = (target_height - fit_h) // 2
                img_bg.paste(img_fit, (x, y))
                img_final = img_bg
                
        img_final.save(dest_path, 'JPEG', quality=90)

def download_default_music(dest_path):
    """Download standard free track from SoundHelix for test/default use."""
    if os.path.exists(dest_path):
        return True
    url = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3"
    try:
        print(f"Downloading default music from {url} to {dest_path}...")
        urllib.request.urlretrieve(url, dest_path)
        print("Default music downloaded successfully.")
        return True
    except Exception as e:
        print(f"Error downloading default music: {e}")
        return False

class MoviePyProgressLogger(ProgressBarLogger):
    def __init__(self, callback):
        super().__init__()
        self.progress_callback = callback
        
    def bars_callback(self, bar, attr, value, old_value=None):
        if bar == 't':
            total = self.bars.get(bar, {}).get('total', 100)
            if total and total > 0:
                percent = int((value / total) * 100)
                self.progress_callback(percent)

def generate_video_thread(task_id, params):
    temp_dir = None
    final_video = None
    audio_clip = None
    session_id = params.get('session_id')
    
    try:
        tasks[task_id]['status'] = 'processing'
        tasks[task_id]['progress'] = 5
        tasks[task_id]['message'] = "Inicializando generación de video..."
        
        duration_per_photo = float(params.get('duration_per_photo', 1.5))
        transition_duration = float(params.get('transition_duration', 0.4))
        transition_type = params.get('transition_type', 'crossfade')
        fit_mode = params.get('fit_mode', 'blurred_background')
        audio_option = params.get('audio_option', 'default')
        audio_filename = params.get('audio_filename', '')
        photo_order = params.get('photo_order', [])
        resolution_str = params.get('resolution', '1280x720')
        
        target_w, target_h = map(int, resolution_str.split('x'))
        
        # Fallback to sorted alphabetical local photos if empty and not in upload session
        if not photo_order and not session_id:
            photo_order = [p['name'] for p in get_photos_list()]
            
        total_photos = len(photo_order)
        if total_photos == 0:
            raise Exception("No se encontraron fotos para procesar.")
            
        # Create temp folder for resized images
        temp_dir = tempfile.mkdtemp(prefix='slideshow_temp_')
        resized_paths = []
        
        for index, photo_name in enumerate(photo_order):
            tasks[task_id]['progress'] = int(5 + (index / total_photos) * 30)
            tasks[task_id]['message'] = f"Optimizando y redimensionando fotos ({index+1}/{total_photos})..."
            
            if session_id:
                src_path = os.path.join(UPLOAD_FOLDER, session_id, photo_name)
            else:
                src_path = os.path.join(os.getcwd(), photo_name)
                
            if not os.path.exists(src_path):
                continue
                
            dest_path = os.path.join(temp_dir, f"frame_{index:04d}.jpg")
            process_image(src_path, dest_path, target_w, target_h, fit_mode)
            resized_paths.append(dest_path)
            
        if not resized_paths:
            raise Exception("Ninguna foto pudo ser procesada correctamente.")
            
        tasks[task_id]['status'] = 'rendering'
        tasks[task_id]['progress'] = 35
        tasks[task_id]['message'] = "Creando clips y transiciones..."
        
        clips = []
        for path in resized_paths:
            clip = ImageClip(path).with_duration(duration_per_photo)
            if transition_type == 'crossfade' and transition_duration > 0:
                if len(clips) > 0:
                    clip = clip.with_effects([vfx.CrossFadeIn(transition_duration)])
            clips.append(clip)
            
        tasks[task_id]['message'] = "Concatenando línea de tiempo..."
        if transition_type == 'crossfade' and transition_duration > 0 and len(clips) > 1:
            final_video = concatenate_videoclips(clips, method="compose", padding=-transition_duration)
        else:
            final_video = concatenate_videoclips(clips, method="compose")
            
        # Handle Audio
        tasks[task_id]['progress'] = 40
        tasks[task_id]['message'] = "Cargando pista de música..."
        
        audio_path = None
        if audio_option == 'default':
            default_music_path = os.path.join(os.getcwd(), 'default_music.mp3')
            if not os.path.exists(default_music_path):
                download_default_music(default_music_path)
            if os.path.exists(default_music_path):
                audio_path = default_music_path
        elif audio_option == 'uploaded' and audio_filename:
            audio_path = os.path.join(UPLOAD_FOLDER, audio_filename)
                
        if audio_path:
            try:
                audio_clip = AudioFileClip(audio_path)
                if audio_clip.duration > final_video.duration:
                    audio_clip = audio_clip.subclipped(0, final_video.duration)
                elif audio_clip.duration < final_video.duration:
                    audio_clip = audio_clip.with_effects([afx.AudioLoop(duration=final_video.duration)])
                
                audio_clip = audio_clip.with_effects([afx.AudioFadeOut(1.5)])
                final_video = final_video.with_audio(audio_clip)
            except Exception as ae:
                print(f"Warning: could not add audio clip: {ae}")
                
        # Setup output path
        output_filename = f"video_fotos_slideshow_{uuid.uuid4().hex[:6]}.mp4"
        output_filepath = os.path.join(os.getcwd(), output_filename)
        
        def update_progress(percent):
            tasks[task_id]['progress'] = int(45 + (percent * 0.50))
            tasks[task_id]['message'] = f"Codificando y guardando video ({percent}%)..."
            
        logger = MoviePyProgressLogger(update_progress)
        
        final_video.write_videofile(
            output_filepath,
            fps=24,
            codec='libx264',
            audio_codec='aac',
            logger=logger,
            threads=4
        )
        
        final_video.close()
        if audio_clip:
            audio_clip.close()
            
        tasks[task_id]['status'] = 'completed'
        tasks[task_id]['progress'] = 100
        tasks[task_id]['message'] = "¡Video generado con éxito!"
        tasks[task_id]['output_file'] = output_filename
        
        # Clean up session directory if uploaded files were used
        if session_id:
            try:
                session_dir = os.path.join(UPLOAD_FOLDER, session_id)
                shutil.rmtree(session_dir)
            except:
                pass
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        tasks[task_id]['status'] = 'failed'
        tasks[task_id]['error'] = str(e)
        tasks[task_id]['message'] = f"Error en el renderizado: {e}"
    finally:
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass

# Routing
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/photos')
def api_photos():
    photos = get_photos_list()
    return jsonify(photos)

@app.route('/api/thumbnail/<path:filename>')
def api_thumbnail(filename):
    session_id = request.args.get('session_id')
    thumb_path = get_or_create_thumbnail(filename, session_id)
    if thumb_path and os.path.exists(thumb_path):
        return send_file(thumb_path, mimetype='image/jpeg')
    return "Not Found", 404

@app.route('/api/photo/<path:filename>')
def api_photo(filename):
    session_id = request.args.get('session_id')
    if session_id:
        original_path = os.path.join(UPLOAD_FOLDER, session_id, filename)
    else:
        original_path = os.path.join(os.getcwd(), filename)
        
    if os.path.exists(original_path):
        return send_file(original_path)
    return "Not Found", 404

@app.route('/api/upload_photos', methods=['POST'])
def api_upload_photos():
    if 'photos' not in request.files:
        return jsonify({'error': 'No photos uploaded'}), 400
    files = request.files.getlist('photos')
    uploaded_files = []
    
    session_id = request.args.get('session_id') or request.form.get('session_id')
    if not session_id or not session_id.isalnum() or len(session_id) != 8:
        session_id = uuid.uuid4().hex[:8]
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    os.makedirs(session_dir, exist_ok=True)
    
    for file in files:
        if file.filename == '':
            continue
        ext = os.path.splitext(file.filename)[1].lower()
        if ext in ALLOWED_IMAGE_EXTENSIONS:
            filename = secure_filename(file.filename)
            # Avoid naming collisions
            filename = f"{uuid.uuid4().hex[:4]}_{filename}"
            file_path = os.path.join(session_dir, filename)
            file.save(file_path)
            
            # Get size
            size = os.path.getsize(file_path)
            uploaded_files.append({
                'name': filename,
                'size': size
            })
            
    return jsonify({
        'session_id': session_id,
        'files': uploaded_files
    })

@app.route('/api/upload_audio', methods=['POST'])
def api_upload_audio():
    if 'audio' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    ext = os.path.splitext(file.filename)[1].lower()
    if ext in ALLOWED_AUDIO_EXTENSIONS:
        filename = secure_filename(file.filename)
        filename = f"{uuid.uuid4().hex[:6]}_{filename}"
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(file_path)
        return jsonify({'filename': filename})
    else:
        return jsonify({'error': 'Unsupported audio format'}), 400

@app.route('/api/generate', methods=['POST'])
def api_generate():
    data = request.json or {}
    task_id = uuid.uuid4().hex
    tasks[task_id] = {
        'status': 'idle',
        'progress': 0,
        'message': 'Inicializando...',
        'error': None,
        'output_file': None
    }
    
    thread = threading.Thread(target=generate_video_thread, args=(task_id, data))
    thread.daemon = True
    thread.start()
    
    return jsonify({'task_id': task_id})

@app.route('/api/status/<task_id>')
def api_status(task_id):
    task = tasks.get(task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    return jsonify(task)

@app.route('/video/<path:filename>')
def download_video(filename):
    return send_from_directory(os.getcwd(), filename, as_attachment=True)

if __name__ == '__main__':
    default_music_path = os.path.join(os.getcwd(), 'default_music.mp3')
    threading.Thread(target=download_default_music, args=(default_music_path,), daemon=True).start()
    
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Flask application on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
