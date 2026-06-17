// State variables
let photoList = []; // Array of { name, mtime, size, isUploaded: bool }
let currentTaskId = null;
let pollInterval = null;
let uploadedAudioFilename = null;
let currentSessionId = null; // Will be set if user uploads new photos

// DOM Elements
const durationSlider = document.getElementById('duration-slider');
const durationVal = document.getElementById('duration-val');
const transitionSlider = document.getElementById('transition-slider');
const transitionVal = document.getElementById('transition-val');
const fitModeSelect = document.getElementById('fit-mode-select');
const resolutionSelect = document.getElementById('resolution-select');
const audioOptions = document.getElementsByName('audio-option');
const uploadAreaContainer = document.getElementById('upload-area-container');
const audioFileInput = document.getElementById('audio-file-input');
const selectedAudioName = document.getElementById('selected-audio-name');
const musicSelectContainer = document.getElementById('music-select-container');
const musicTrackSelect = document.getElementById('music-track-select');
const btnPreviewMusic = document.getElementById('btn-preview-music');
const musicPreviewPlayer = document.getElementById('music-preview-player');

const btnGenerate = document.getElementById('btn-generate');
const renderProgressContainer = document.getElementById('render-progress-container');
const progressStatusText = document.getElementById('progress-status-text');
const progressPercentText = document.getElementById('progress-percent-text');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressMessageDetail = document.getElementById('progress-message-detail');

const resultVideoCard = document.getElementById('result-video-card');
const resultVideoPlayer = document.getElementById('result-video-player');
const btnDownloadVideo = document.getElementById('btn-download-video');
const btnCloseResult = document.getElementById('btn-close-result');

const photoCountBadge = document.getElementById('photo-count-badge');
const photoCount = document.getElementById('photo-count');
const photosGridContainer = document.getElementById('photos-grid-container');
const photosEmptyDropzone = document.getElementById('photos-empty-dropzone');
const photoFileInput = document.getElementById('photo-file-input');

const btnSortName = document.getElementById('btn-sort-name');
const btnSortDate = document.getElementById('btn-sort-date');
const btnReverseOrder = document.getElementById('btn-reverse-order');
const btnClearAll = document.getElementById('btn-clear-all');

// Toast Helper
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fa-solid ${
        type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info'
    }"></i> <span>${message}</span>`;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4500);
}

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
    loadPhotos();
    loadMusicTracks();
    setupSliders();
    setupAudioOptions();
    setupDropzone();
    setupSortingActions();
    
    btnCloseResult.addEventListener('click', () => {
        resultVideoCard.classList.add('hidden');
        resultVideoPlayer.pause();
    });

    btnGenerate.addEventListener('click', generateVideo);
    btnClearAll.addEventListener('click', clearAllPhotos);
});

// Slider handlers
function setupSliders() {
    durationSlider.addEventListener('input', () => {
        durationVal.textContent = `${durationSlider.value}s`;
    });
    
    transitionSlider.addEventListener('input', () => {
        transitionVal.textContent = `${transitionSlider.value}s`;
        if (parseFloat(transitionSlider.value) >= parseFloat(durationSlider.value)) {
            transitionSlider.value = (parseFloat(durationSlider.value) - 0.2).toFixed(1);
            transitionVal.textContent = `${transitionSlider.value}s`;
            showToast('La transición debe ser menor que la duración de la foto', 'warning');
        }
    });
}

// Audio configuration
function setupAudioOptions() {
    audioOptions.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'uploaded') {
                uploadAreaContainer.classList.remove('hidden');
                musicSelectContainer.classList.add('hidden');
                stopMusicPreview();
            } else {
                uploadAreaContainer.classList.add('hidden');
                musicSelectContainer.classList.remove('hidden');
            }
        });
    });

    audioFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            uploadAudioFile(file);
        }
    });

    // Library track preview controls
    musicTrackSelect.addEventListener('change', () => {
        stopMusicPreview();
        updatePreviewButtonState();
    });

    btnPreviewMusic.addEventListener('click', toggleMusicPreview);
    musicPreviewPlayer.addEventListener('ended', stopMusicPreview);
    updatePreviewButtonState();
}

// Fetch the built-in music library and populate the dropdown
async function loadMusicTracks() {
    try {
        const response = await fetch('/api/music_tracks');
        if (!response.ok) throw new Error('Error al cargar la biblioteca');
        const tracks = await response.json();

        tracks.forEach(track => {
            const opt = document.createElement('option');
            opt.value = track.id;
            opt.textContent = track.name;
            musicTrackSelect.appendChild(opt);
        });
    } catch (error) {
        console.error('No se pudo cargar la biblioteca de música:', error);
    }
}

// Preview cannot play the "random" option (no concrete track yet)
function updatePreviewButtonState() {
    btnPreviewMusic.disabled = (musicTrackSelect.value === 'random');
}

function setPreviewPlayingState(playing) {
    const icon = btnPreviewMusic.querySelector('i');
    if (playing) {
        btnPreviewMusic.classList.add('playing');
        icon.className = 'fa-solid fa-pause';
    } else {
        btnPreviewMusic.classList.remove('playing');
        icon.className = 'fa-solid fa-play';
    }
}

function stopMusicPreview() {
    musicPreviewPlayer.pause();
    musicPreviewPlayer.currentTime = 0;
    setPreviewPlayingState(false);
}

function toggleMusicPreview() {
    const trackId = musicTrackSelect.value;
    if (trackId === 'random') return;

    if (!musicPreviewPlayer.paused) {
        stopMusicPreview();
        return;
    }

    const src = `/api/music/${encodeURIComponent(trackId)}`;
    if (musicPreviewPlayer.src.indexOf(src) === -1) {
        musicPreviewPlayer.src = src;
    }
    musicPreviewPlayer.play().then(() => {
        setPreviewPlayingState(true);
    }).catch(err => {
        console.error('Error al reproducir la pista:', err);
        showToast('No se pudo reproducir la pista', 'error');
        setPreviewPlayingState(false);
    });
}

// Photo file inputs drag and drop
function setupDropzone() {
    photoFileInput.addEventListener('change', (e) => {
        uploadPhotoFiles(e.target.files);
    });

    // Make empty dropzone clickable
    photosEmptyDropzone.addEventListener('click', () => {
        photoFileInput.click();
    });

    // Make entire window receptive to photo drops if workspace is empty
    window.addEventListener('dragover', (e) => e.preventDefault(), false);
    window.addEventListener('drop', (e) => e.preventDefault(), false);

    // Dropzone actions
    ['dragenter', 'dragover'].forEach(eventName => {
        photosEmptyDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            photosEmptyDropzone.classList.add('drag-active');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        photosEmptyDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            photosEmptyDropzone.classList.remove('drag-active');
        }, false);
    });

    photosEmptyDropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        uploadPhotoFiles(dt.files);
    });
}

// Upload custom photos to server API (for cloud deploys)
async function uploadPhotoFiles(files) {
    if (!files || files.length === 0) return;
    
    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) {
        showToast('Selecciona solo archivos de imagen', 'error');
        return;
    }

    const formData = new FormData();
    validFiles.forEach(file => {
        formData.append('photos', file);
    });

    showToast(`Subiendo ${validFiles.length} fotos al servidor...`, 'info');

    try {
        let url = '/api/upload_photos';
        if (currentSessionId) {
            url += `?session_id=${currentSessionId}`;
        }
        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Fallo en la subida');

        const newPhotos = result.files.map(f => ({
            name: f.name,
            originalName: f.original_name || f.name,
            size: f.size,
            mtime: f.mtime || Date.now(),
            isUploaded: true
        }));

        if (currentSessionId && currentSessionId === result.session_id) {
            photoList = [...photoList, ...newPhotos];
        } else {
            currentSessionId = result.session_id;
            photoList = newPhotos;
        }

        updateUIState();
        showToast('Fotos subidas y listas', 'success');
        
    } catch (err) {
        console.error(err);
        showToast(`Error al subir fotos: ${err.message}`, 'error');
    }
}

// Fetch directory photos from server API
async function loadPhotos() {
    try {
        const response = await fetch('/api/photos');
        if (!response.ok) throw new Error('Error al conectar');
        photoList = await response.json();
        
        photoList.forEach(p => {
            p.originalName = p.original_name || p.name;
        });
        
        // Sort alphabetical
        photoList.sort((a, b) => a.originalName.localeCompare(b.originalName, undefined, {numeric: true, sensitivity: 'base'}));
        
        updateUIState();
    } catch (error) {
        console.error(error);
        showToast('Error al conectar con el servidor', 'error');
        // Treat as empty/server-only
        updateUIState();
    }
}

// Update UI structure based on photoList content
function updateUIState() {
    const count = photoList.length;
    photoCount.textContent = count;
    photoCountBadge.textContent = count;
    
    if (count > 0) {
        photosEmptyDropzone.classList.remove('hidden');
        photosEmptyDropzone.classList.add('compact');
        photosGridContainer.classList.remove('hidden');
        btnGenerate.disabled = false;
        btnSortName.disabled = false;
        btnReverseOrder.disabled = false;
        btnClearAll.disabled = false;
        
        // Allow date sorting always (since EXIF capture date is returned by the server)
        btnSortDate.disabled = false;
        
        renderPhotosGrid();
    } else {
        photosEmptyDropzone.classList.remove('hidden');
        photosEmptyDropzone.classList.remove('compact');
        photosGridContainer.classList.add('hidden');
        btnGenerate.disabled = true;
        btnSortName.disabled = true;
        btnSortDate.disabled = true;
        btnReverseOrder.disabled = true;
        btnClearAll.disabled = true;
        photosGridContainer.innerHTML = '';
    }
}

// Render Photos Grid
function renderPhotosGrid() {
    photosGridContainer.innerHTML = '';
    
    photoList.forEach((photo, index) => {
        const item = document.createElement('div');
        item.className = 'photo-item';
        item.setAttribute('draggable', 'true');
        item.setAttribute('data-name', photo.name);
        
        const sizeKB = (photo.size / 1024).toFixed(0);
        const sizeFormatted = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
        
        let thumbUrl = `/api/thumbnail/${encodeURIComponent(photo.name)}`;
        if (currentSessionId) {
            thumbUrl += `?session_id=${currentSessionId}`;
        }
        
        item.innerHTML = `
            <span class="photo-index">${index + 1}</span>
            <button class="btn-delete-photo" title="Eliminar foto"><i class="fa-solid fa-trash"></i></button>
            <img src="${thumbUrl}" class="photo-thumbnail" alt="${photo.originalName}" loading="lazy">
            <div class="photo-overlay">
                <span class="photo-filename">${photo.originalName}</span>
                <span class="photo-size">${sizeFormatted}</span>
            </div>
        `;
        
        item.querySelector('.btn-delete-photo').addEventListener('click', (e) => {
            e.stopPropagation();
            removePhoto(photo.name);
        });
        
        addDragAndDropHandlers(item);
        photosGridContainer.appendChild(item);
    });
}

function removePhoto(name) {
    const index = photoList.findIndex(p => p.name === name);
    if (index !== -1) {
        photoList.splice(index, 1);
        updateUIState();
    }
}

// Drag and drop event logic
let draggedItem = null;

function addDragAndDropHandlers(item) {
    item.addEventListener('dragstart', (e) => {
        draggedItem = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        document.querySelectorAll('.photo-item').forEach(el => el.classList.remove('drag-over'));
        draggedItem = null;
        updatePhotoOrderFromDOM();
    });

    item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (item !== draggedItem) {
            item.classList.add('drag-over');
        }
    });

    item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
    });

    item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        
        if (item !== draggedItem) {
            const rect = item.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            
            if (e.clientX < midpoint) {
                item.parentNode.insertBefore(draggedItem, item);
            } else {
                item.parentNode.insertBefore(draggedItem, item.nextSibling);
            }
        }
    });
}

function updatePhotoOrderFromDOM() {
    const items = photosGridContainer.querySelectorAll('.photo-item');
    const newOrder = [];
    
    items.forEach((item, index) => {
        const name = item.getAttribute('data-name');
        const photoObj = photoList.find(p => p.name === name);
        if (photoObj) {
            newOrder.push(photoObj);
        }
        item.querySelector('.photo-index').textContent = index + 1;
    });
    
    photoList = newOrder;
}

// Sorting logic
function setupSortingActions() {
    btnSortName.addEventListener('click', () => {
        photoList.sort((a, b) => a.originalName.localeCompare(b.originalName, undefined, {numeric: true, sensitivity: 'base'}));
        renderPhotosGrid();
        showToast('Fotos ordenadas alfabéticamente', 'info');
    });
    
    btnSortDate.addEventListener('click', () => {
        photoList.sort((a, b) => a.mtime - b.mtime);
        renderPhotosGrid();
        showToast('Fotos ordenadas por fecha', 'info');
    });
    
    btnReverseOrder.addEventListener('click', () => {
        photoList.reverse();
        renderPhotosGrid();
        showToast('Orden invertido', 'info');
    });
}

function clearAllPhotos() {
    if (confirm('¿Estás seguro de que quieres eliminar todas las fotos de la lista?')) {
        photoList = [];
        currentSessionId = null;
        updateUIState();
        
        // Hide result video card and reset player
        resultVideoCard.classList.add('hidden');
        resultVideoPlayer.pause();
        resultVideoPlayer.src = '';
        
        showToast('Se limpiaron todas las fotos', 'info');
    }
}

// Upload custom audio track
async function uploadAudioFile(file) {
    const formData = new FormData();
    formData.append('audio', file);
    
    selectedAudioName.textContent = 'Subiendo archivo...';
    
    try {
        const response = await fetch('/api/upload_audio', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Error al subir audio');
        
        uploadedAudioFilename = result.filename;
        selectedAudioName.textContent = `${file.name} (Listo)`;
        showToast('Música subida correctamente', 'success');
    } catch (error) {
        console.error(error);
        selectedAudioName.textContent = 'Error al subir';
        showToast(`Error al subir audio: ${error.message}`, 'error');
        uploadedAudioFilename = null;
    }
}

// Trigger video generation
async function generateVideo() {
    let audioOptionValue = 'default';
    audioOptions.forEach(radio => {
        if (radio.checked) audioOptionValue = radio.value;
    });
    
    if (audioOptionValue === 'uploaded' && !uploadedAudioFilename) {
        showToast('Por favor, selecciona y sube un archivo de música primero', 'warning');
        return;
    }
    
    if (photoList.length === 0) {
        showToast('No hay fotos para procesar', 'warning');
        return;
    }
    
    const payload = {
        duration_per_photo: parseFloat(durationSlider.value),
        transition_duration: parseFloat(transitionSlider.value),
        transition_type: parseFloat(transitionSlider.value) > 0 ? 'crossfade' : 'none',
        fit_mode: fitModeSelect.value,
        resolution: resolutionSelect.value,
        audio_option: audioOptionValue,
        audio_filename: audioOptionValue === 'uploaded' ? uploadedAudioFilename : '',
        audio_track: audioOptionValue === 'default' ? musicTrackSelect.value : '',
        photo_order: photoList.map(p => p.name)
    };

    stopMusicPreview();
    
    // Add session_id if they uploaded photos
    if (currentSessionId) {
        payload.session_id = currentSessionId;
    }
    
    btnGenerate.disabled = true;
    resultVideoCard.classList.add('hidden');
    renderProgressContainer.classList.remove('hidden');
    
    updateProgressBar(0, 'Inicializando...', 'Enviando petición de renderizado...');
    
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Error al iniciar la renderización');
        
        currentTaskId = result.task_id;
        showToast('Renderizado de video iniciado', 'info');
        
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(checkProgress, 1000);
        
    } catch (error) {
        console.error(error);
        showToast(`Error: ${error.message}`, 'error');
        resetUIProgressState();
    }
}

// Poll status
async function checkProgress() {
    if (!currentTaskId) return;
    
    try {
        const response = await fetch(`/api/status/${currentTaskId}`);
        if (!response.ok) throw new Error('Error al consultar estado');
        
        const task = await response.json();
        
        let statusTitle = 'Procesando...';
        if (task.status === 'processing') statusTitle = 'Optimizando Fotos';
        if (task.status === 'rendering') statusTitle = 'Codificando Video';
        if (task.status === 'completed') statusTitle = '¡Completado!';
        if (task.status === 'failed') statusTitle = 'Fallo en renderizado';
        
        updateProgressBar(task.progress, statusTitle, task.message || '');
        
        if (task.status === 'completed') {
            clearInterval(pollInterval);
            showToast('¡Video generado correctamente!', 'success');
            
            resultVideoPlayer.src = `/video/${task.output_file}`;
            btnDownloadVideo.href = `/video/${task.output_file}`;
            resultVideoCard.classList.remove('hidden');
            resultVideoCard.scrollIntoView({ behavior: 'smooth' });
            
            resetUIProgressState();
        } else if (task.status === 'failed') {
            clearInterval(pollInterval);
            showToast(`Fallo en renderizado: ${task.error}`, 'error');
            resetUIProgressState();
        }
        
    } catch (error) {
        console.error('Polling error:', error);
    }
}

function updateProgressBar(percent, statusText, detailText) {
    progressBarFill.style.width = `${percent}%`;
    progressPercentText.textContent = `${percent}%`;
    progressStatusText.textContent = statusText;
    progressMessageDetail.textContent = detailText;
}

function resetUIProgressState() {
    btnGenerate.disabled = false;
    renderProgressContainer.classList.add('hidden');
    currentTaskId = null;
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}
