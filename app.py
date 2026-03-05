import os
import json as _json
import urllib.request
import urllib.parse
import threading
import time
from flask import Flask, render_template, request, jsonify, Response, send_from_directory
import recorder
from config import (
    UPLOAD_FOLDER, EXPORT_FOLDER, MODELS_FOLDER,
    MAX_CONTENT_LENGTH, MAX_URL_BYTES, MAX_MODEL_BYTES,
    ALLOWED_MODEL_EXTENSIONS,
)
from utils import allowed_file, allowed_video_url, filename_from_url
from analysis_jobs import (
    analysis_jobs, jobs_lock,
    mjpeg_generator, start_analysis_job,
)
from stream_manager import (
    active_streams, streams_lock,
    stream_mjpeg_generator,
    add_stream_url, add_stream_device, remove_stream,
    list_cameras,
    slot_map, slot_map_lock,
    register_slot, unregister_slot,
    get_slot_for_stream, get_stream_for_slot,
)
import settings_store
from stream_persistence import load_streams

settings_store.init()
app = Flask(__name__)
app.config['UPLOAD_FOLDER']      = UPLOAD_FOLDER
app.config['EXPORT_FOLDER']      = EXPORT_FOLDER
app.config['MODELS_FOLDER']      = MODELS_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
app.config['RECORDINGS_FOLDER'] = 'recordings'

for folder in (UPLOAD_FOLDER, EXPORT_FOLDER, MODELS_FOLDER, 'recordings'):
    os.makedirs(folder, exist_ok=True)

def _startup_restore():
    import time
    time.sleep(1.5)  

    active_models = settings_store.get_all_active_models()
    if active_models:
        from detection import _load_model
        for m in active_models:
            try:
                _load_model(m['filename'])
                print(f'[Velion] Pre-loaded model: {m["filename"]}', flush=True)
            except Exception as e:
                print(f'[Velion] Could not pre-load {m["filename"]}: {e}', flush=True)
    else:
        print('[Velion] No active models to pre-load.', flush=True)

    from stream_persistence import load_streams
    from stream_manager import add_stream_url, add_stream_device
    saved = load_streams()
    if not saved:
        print('[Velion] No saved streams to restore.', flush=True)
        return
    for record in saved:
        source      = record.get('source', '').strip()
        source_type = record.get('source_type', 'rtsp')
        label       = record.get('label', 'Camera')
        print(f'[Velion] Restoring stream: {label} ({source})', flush=True)
        if source_type == 'camera':
            try:
                sid, err = add_stream_device(int(source), label)
            except Exception as e:
                print(f'[Velion] Restore failed for {label}: {e}', flush=True)
                continue
        else:
            sid, err = add_stream_url(source, label)
        if err:
            print(f'[Velion] Could not restore {label}: {err}', flush=True)
        else:
            print(f'[Velion] Restored stream {label} as id={sid}', flush=True)

threading.Thread(target=_startup_restore, daemon=True).start()

# PAGE ROUTES
# ─────────────────────────────────────────────────────────────────────
@app.errorhandler(404)
def page_not_found(e):
    return render_template('404.html'), 404

@app.route('/')
def index(): return render_template('index.html')

@app.route('/dashboard')
def dashboard(): return render_template('dashboard.html')

@app.route('/upload')
def upload(): return render_template('upload.html')

@app.route('/models')
def models_page(): return render_template('models.html')

@app.route('/analytics')
def analytics():
    return render_template('analytics.html')

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.after_request
def set_security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data: blob:; "
        "media-src 'self' blob:; "
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
        "font-src https://fonts.gstatic.com; "
        "script-src 'self' 'unsafe-inline'; "

        "connect-src 'self' ws: wss:; "
        "frame-ancestors 'none';"
    )
    response.headers["X-Content-Type-Options"]  = "nosniff"
    response.headers["X-Frame-Options"]         = "DENY"
    response.headers["Referrer-Policy"]         = "strict-origin-when-cross-origin"
    return response

# UPLOAD / ANALYSIS ROUTES
# ─────────────────────────────────────────────────────────────────────
@app.route('/analysis-feed/<job_id>')
def analysis_feed(job_id):
    with jobs_lock:
        if job_id not in analysis_jobs:
            return jsonify({'success': False, 'message': 'Job not found'}), 404
    return Response(mjpeg_generator(job_id),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/api/analysis-status/<job_id>')
def analysis_status(job_id):
    with jobs_lock:
        job = analysis_jobs.get(job_id)
    if not job:
        return jsonify({'success': False, 'message': 'Job not found'}), 404

    start = job.get('process_start_time')
    if start and job['state'] == 'running':
        elapsed = int(time.time() - start)
    elif start:
        elapsed = int((job.get('process_end_time') or time.time()) - start)
    else:
        elapsed = 0

    return jsonify({
        'success':        True,
        'state':          job['state'],
        'current_frame':  job.get('current_frame', 0),
        'total_frames':   job.get('total_frames', 0),
        'fps':            job.get('fps', 25),
        'incident_count': job.get('incident_count', 0),
        'export_ready':   job.get('export_ready', False),
        'elapsed_sec':    elapsed,
    })


@app.route('/api/analysis-control/<job_id>', methods=['POST'])
def analysis_control(job_id):
    data   = request.get_json(silent=True) or {}
    action = data.get('action')
    with jobs_lock:
        if job_id not in analysis_jobs:
            return jsonify({'success': False, 'message': 'Job not found'}), 404
        if action == 'pause':
            analysis_jobs[job_id]['state'] = 'paused'
        elif action == 'resume':
            analysis_jobs[job_id]['state'] = 'running'
        elif action == 'stop':
            analysis_jobs[job_id]['state'] = 'stopped'
        elif action == 'seek':
            analysis_jobs[job_id]['seek_to'] = int(data.get('frame', 0))
            analysis_jobs[job_id]['state']   = 'running'
        else:
            return jsonify({'success': False, 'message': f'Unknown action: {action}'}), 400
    return jsonify({'success': True, 'action': action})


@app.route('/api/download-export/<job_id>')
def download_export(job_id):
    with jobs_lock:
        job = analysis_jobs.get(job_id)
    if not job:
        return jsonify({'success': False, 'message': 'Job not found'}), 404
    if not job.get('export_ready'):
        return jsonify({'success': False, 'message': 'Export not ready yet'}), 400
    return send_from_directory(
        app.config['EXPORT_FOLDER'],
        job['export_filename'],
        as_attachment=True,
        download_name=f'velion_analysis_{job_id}.mp4',
    )


@app.route('/api/upload-video', methods=['POST'])
def upload_video():
    if not settings_store.get_all_active_models():
        return jsonify({
            'success':  False,
            'no_model': True,
            'message':  'No active model. Please activate a model in Settings first.',
        }), 400

    if 'video' not in request.files:
        return jsonify({'success': False, 'message': 'No file part'}), 400
    file = request.files['video']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify({'success': False, 'message': 'File type not allowed'}), 400
    save_path = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    file.save(save_path)
    job_id = start_analysis_job(save_path)
    return jsonify({
        'success': True, 'message': 'Analysis started',
        'filename': file.filename, 'job_id': job_id,
        'feed_url':    f'/analysis-feed/{job_id}',
        'status_url':  f'/api/analysis-status/{job_id}',
        'control_url': f'/api/analysis-control/{job_id}',
    })


@app.route('/api/upload-video-url', methods=['POST'])
def upload_video_url():
    if not settings_store.get_all_active_models():
        return jsonify({
            'success':  False,
            'no_model': True,
            'message':  'No active model. Please activate a model in Settings first.',
        }), 400

    data = request.get_json(silent=True) or {}
    url  = (data.get('url') or '').strip()
    if not url:
        return jsonify({'success': False, 'message': 'No URL provided'}), 400
    if not allowed_video_url(url):
        return jsonify({'success': False, 'message': 'Not a valid video URL'}), 400
    filename  = filename_from_url(url)
    save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Velion/1.0'})
        with urllib.request.urlopen(req, timeout=60) as resp:
            downloaded = 0
            with open(save_path, 'wb') as f:
                while True:
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    downloaded += len(chunk)
                    if downloaded > MAX_URL_BYTES:
                        os.remove(save_path)
                        return jsonify({'success': False, 'message': 'File too large'}), 400
                    f.write(chunk)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    job_id = start_analysis_job(save_path)
    return jsonify({
        'success': True, 'message': 'Analysis started',
        'filename': filename, 'job_id': job_id,
        'feed_url':    f'/analysis-feed/{job_id}',
        'status_url':  f'/api/analysis-status/{job_id}',
        'control_url': f'/api/analysis-control/{job_id}',
    })


# LIVE STREAM ROUTES
# ─────────────────────────────────────────────────────────────────────
@app.route('/api/cameras')
def api_list_cameras():
    cameras = list_cameras()
    
    if not cameras:
        import os, platform
        in_docker = os.path.exists('/.dockerenv')
        system    = platform.system()
        
        if in_docker and system == 'Linux':
            from pathlib import Path
            dev_videos = list(Path('/dev').glob('video*'))
            if not dev_videos:
                hint = ('docker_no_devices'
                        ' — no /dev/video* found inside container.'
                        ' Add "privileged: true" and "group_add: [video]"'
                        ' to docker-compose.yml and restart.')
            else:
                hint = 'scan_failed — devices exist but could not be opened'
        elif system == 'Linux':
            hint = 'no_cameras — no video devices found on this Linux host'
        else:
            hint = 'no_cameras'
        
        return jsonify({'success': True, 'cameras': [], 'hint': hint})
    
    return jsonify({'success': True, 'cameras': cameras})


@app.route('/api/cameras/debug')
def api_cameras_debug():
    """Returns raw device info — useful for diagnosing Docker camera issues."""
    import os, platform
    from pathlib import Path
    
    system    = platform.system()
    in_docker = os.path.exists('/.dockerenv')
    
    dev_videos = []
    if system == 'Linux':
        dev_videos = [str(p) for p in sorted(Path('/dev').glob('video*'))]
    
    opencv_probe = []
    for path in dev_videos:
        try:
            idx = int(path.replace('/dev/video', ''))
            cap = cv2.VideoCapture(idx, cv2.CAP_V4L2)
            opened = cap.isOpened()
            if opened:
                ok, _ = cap.read()
                opencv_probe.append({'index': idx, 'path': path, 'opened': True, 'readable': ok})
            else:
                opencv_probe.append({'index': idx, 'path': path, 'opened': False, 'readable': False})
            cap.release()
        except Exception as e:
            opencv_probe.append({'index': idx, 'path': path, 'error': str(e)})
    
    return jsonify({
        'success':     True,
        'system':      system,
        'in_docker':   in_docker,
        'dev_videos':  dev_videos,
        'opencv_probe': opencv_probe,
        'privileged_hint': (
            'If dev_videos is empty while running in Docker, add '
            '"privileged: true" and "group_add: [video]" to docker-compose.yml'
        ) if in_docker and not dev_videos else None,
    })


@app.route('/api/add-stream', methods=['POST'])
def api_add_stream():
    data  = request.get_json()
    url   = data.get('url', '').strip()
    label = data.get('label', 'Camera').strip() or 'Camera'
    slot  = data.get('slot')                        
    if slot is not None:
        try:
            slot = int(slot)
        except (TypeError, ValueError):
            slot = None

    if not url:
        return jsonify({'success': False, 'message': 'No URL provided'}), 400
    sid, err = add_stream_url(url, label, slot=slot)  
    if err:
        return jsonify({'success': False, 'message': err}), 400
    return jsonify({'success': True, 'stream_id': sid,
                    'message': f'Stream "{label}" connected'})


@app.route('/api/add-camera', methods=['POST'])
def api_add_camera():
    data         = request.get_json()
    device_index = data.get('device_index')
    label        = data.get('label', '').strip()
    slot         = data.get('slot')                  
    if slot is not None:
        try:
            slot = int(slot)
        except (TypeError, ValueError):
            slot = None

    if device_index is None:
        return jsonify({'success': False, 'message': 'No device_index provided'}), 400
    try:
        device_index = int(device_index)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'device_index must be an integer'}), 400
    if not label:
        label = f'Camera {device_index} ({"integrated" if device_index == 0 else "USB"})'

    sid, err = add_stream_device(device_index, label, slot=slot)  
    if err:
        return jsonify({'success': False, 'message': err}), 400
    return jsonify({'success': True, 'stream_id': sid,
                    'message': f'Camera "{label}" connected'})


@app.route('/api/remove-stream/<int:stream_id>', methods=['DELETE'])
def api_remove_stream(stream_id):
    remove_stream(stream_id)           
    return jsonify({'success': True})


@app.route('/video-feed/<int:stream_id>')
def video_feed(stream_id):
    with streams_lock:
        if stream_id not in active_streams:
            return jsonify({'success': False, 'message': 'Stream not found'}), 404
    return Response(stream_mjpeg_generator(stream_id),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/api/stream-status/<int:stream_id>')
def stream_status(stream_id):
    with streams_lock:
        s = active_streams.get(stream_id)
    if not s:
        return jsonify({'success': False, 'message': 'Stream not found'}), 404
    return jsonify({
        'success':            True,
        'stream_id':          stream_id,
        'label':              s['label'],
        'running':            s.get('running', False),
        'health':             s.get('health', 'ok'),          
        'reconnect_attempt':  s.get('reconnect_attempt'),    
        'incident_count':     s.get('incident_count', 0),
    })

@app.route('/api/streams/status')
def streams_status():
    with streams_lock:
        streams_snapshot = dict(active_streams)
    with slot_map_lock:
        slot_snapshot = dict(slot_map)

    sid_to_slot = {sid: slot for slot, sid in slot_snapshot.items()}

    data = [
        {
            'id':             sid,
            'slot':           sid_to_slot.get(sid),  
            'label':          s['label'],
            'source':         s['source'],
            'source_type':    s['source_type'],
            'incident_count': s.get('incident_count', 0),
            'running':        s.get('running', False),
        }
        for sid, s in streams_snapshot.items()
    ]
    return jsonify({'success': True, 'streams': data})

@app.route('/api/analysis-history')
def api_analysis_history():
    history = settings_store.get_analysis_history()
    return jsonify({'success': True, 'history': history})

@app.route('/recordings')
def recordings_page():
    return render_template('recordings.html')

@app.route('/recordings/<path:filepath>')
def serve_recording(filepath):
    from flask import abort

    safe = os.path.normpath(os.path.join('recordings', filepath))
    if not safe.startswith(os.path.normpath('recordings')):
        abort(403)
    directory = os.path.dirname(safe)
    filename  = os.path.basename(safe)
    return send_from_directory(directory, filename)


@app.route('/api/recording/start/<int:stream_id>', methods=['POST'])
def api_start_recording(stream_id):
    with streams_lock:
        s = active_streams.get(stream_id)
    if not s:
        return jsonify({'success': False, 'message': 'Stream not found'}), 404

    if recorder.is_recording(stream_id):
        return jsonify({'success': False, 'message': 'Already recording'}), 400

    fps = s.get('fps', 15) or 15
    ok  = recorder.start_recording(stream_id, s['label'], fps=fps)
    if ok:
        return jsonify({'success': True, 'message': f'Recording started for "{s["label"]}"'})
    return jsonify({'success': False, 'message': 'Could not start recording'}), 500


@app.route('/api/recording/stop/<int:stream_id>', methods=['POST'])
def api_stop_recording(stream_id):
    ok = recorder.stop_recording(stream_id)
    if ok:
        return jsonify({'success': True, 'message': 'Recording stopped'})
    return jsonify({'success': False, 'message': 'Not recording'}), 400


@app.route('/api/recording/start-all', methods=['POST'])
def api_start_all_recording():
    with streams_lock:
        snapshot = dict(active_streams)
    started = []
    for sid, s in snapshot.items():
        if not recorder.is_recording(sid):
            fps = s.get('fps', 15) or 15
            recorder.start_recording(sid, s['label'], fps=fps)
            started.append(sid)
    return jsonify({'success': True, 'started': started,
                    'message': f'Started recording {len(started)} stream(s)'})


@app.route('/api/recording/stop-all', methods=['POST'])
def api_stop_all_recording():
    ids = recorder.get_all_recording_ids()
    for sid in ids:
        recorder.stop_recording(sid)
    return jsonify({'success': True, 'stopped': ids,
                    'message': f'Stopped {len(ids)} recording(s)'})


@app.route('/api/recording/status')
def api_recording_status():
    """Returns which stream_ids are currently recording."""
    return jsonify({'success': True, 'recording': recorder.get_all_recording_ids()})


@app.route('/api/recordings')
def api_list_recordings():
    stream_id = request.args.get('stream_id', type=int)
    files     = recorder.list_recordings(stream_id)
    return jsonify({'success': True, 'recordings': files})


@app.route('/api/recordings/delete', methods=['DELETE'])
def api_delete_recording():
    data     = request.get_json(silent=True) or {}
    cam_dir  = data.get('cam_dir', '')
    filename = data.get('filename', '')
    if not cam_dir or not filename:
        return jsonify({'success': False, 'message': 'cam_dir and filename required'}), 400
    ok = recorder.delete_recording(cam_dir, filename)
    if ok:
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'File not found'}), 404


@app.route('/api/recordings/delete-all', methods=['DELETE'])
def api_delete_all_recordings():
    """Delete all recordings for a specific stream_id, or all if not specified."""
    stream_id = request.args.get('stream_id', type=int)
    files     = recorder.list_recordings(stream_id)
    count     = 0
    for f in files:
        if recorder.delete_recording(f['cam_dir'], f['filename']):
            count += 1
    return jsonify({'success': True, 'deleted': count})

# MODEL MANAGEMENT ROUTES
# ─────────────────────────────────────────────────────────────────────

@app.route('/api/dashboard-summary')
def api_dashboard_summary():
    with streams_lock:
        streams_snapshot = list(active_streams.values())
    
    history = settings_store.get_analysis_history()
    models  = settings_store.list_models()

    return jsonify({
        'success':      True,
        'stream_count': len(streams_snapshot),
        'streams':      [{'label': s['label'], 'incident_count': s.get('incident_count', 0)} for s in streams_snapshot],
        'video_count':  len(history),
        'total_incidents': (
            sum(s.get('incident_count', 0) for s in streams_snapshot) +
            sum(h.get('incident_count', 0) for h in history)
        ),
        'active_models': [m for m in models if m.get('active')],
    })
    
@app.route('/api/models', methods=['GET'])
def api_list_models():
    models   = settings_store.list_models()
    selected = settings_store.get_selected_models()
    return jsonify({'success': True, 'models': models, 'selected': selected})


@app.route('/api/models/inspect/<filename>', methods=['GET'])
def api_inspect_model(filename):
    import traceback
    import pickle
    import types

    path = os.path.join(MODELS_FOLDER, filename)
    if not os.path.exists(path):
        return jsonify({'success': False, 'message': 'File not found'}), 404

    classes         = {}
    warning         = None
    detected_format = 'ultralytics'  

    if not classes:
        try:
            from ultralytics import YOLO
            model = YOLO(path, task='detect')
            names = model.names
            if isinstance(names, dict):
                classes = {str(k): v for k, v in names.items()}
            elif isinstance(names, (list, tuple)):
                classes = {str(i): n for i, n in enumerate(names)}
            if classes:
                detected_format = 'ultralytics'
                print(f'[Velion] Strategy 1 (Ultralytics) found {len(classes)} classes', flush=True)
        except Exception as e:
            print(f'[Velion] Strategy 1 failed: {e}', flush=True)

    if not classes and filename.endswith('.pt'):
        try:
            import torch

            class _SafeObj:
                def __init__(self, *a, **kw): pass
                def __setstate__(self, state):
                    if isinstance(state, dict):
                        self.__dict__.update(state)
                def __repr__(self):
                    return f'<SafeObj {list(self.__dict__.keys())}>'

            class _PatchedUnpickler(pickle.Unpickler):
                def find_class(self, module, name):
                    try:
                        return super().find_class(module, name)
                    except (ModuleNotFoundError, AttributeError, ImportError):
                        return _SafeObj

            _fake_pickle                  = types.ModuleType('_velion_pickle')
            _fake_pickle.Unpickler        = _PatchedUnpickler
            _fake_pickle.UnpicklingError  = pickle.UnpicklingError
            _fake_pickle.dump             = pickle.dump
            _fake_pickle.dumps            = pickle.dumps
            _fake_pickle.load             = pickle.load
            _fake_pickle.loads            = pickle.loads
            _fake_pickle.HIGHEST_PROTOCOL = pickle.HIGHEST_PROTOCOL

            ckpt = torch.load(path, map_location='cpu',
                              pickle_module=_fake_pickle,
                              weights_only=False)

            def _extract_names(obj):
                if obj is None:
                    return None
                d = getattr(obj, '__dict__', {})
                val = d.get('names')
                if isinstance(val, (dict, list)) and val:
                    return val
                inner = d.get('model')
                if inner is not None:
                    val = _extract_names(inner)
                    if val is not None:
                        return val
                yaml_attr = d.get('yaml')
                if isinstance(yaml_attr, dict):
                    val = yaml_attr.get('names')
                    if isinstance(val, (dict, list)) and val:
                        return val
                module = d.get('module')
                if module is not None:
                    val = _extract_names(module)
                    if val is not None:
                        return val
                return None

            names_raw = None
            if isinstance(ckpt, dict):
                print(f'[Velion] Strategy 2 ckpt keys: {list(ckpt.keys())}', flush=True)
                names_raw = ckpt.get('names')
                if not isinstance(names_raw, (dict, list)):
                    names_raw = None
                if names_raw is None:
                    names_raw = _extract_names(ckpt.get('model'))
                if names_raw is None:
                    names_raw = _extract_names(ckpt.get('ema'))
            elif hasattr(ckpt, '__dict__'):
                names_raw = _extract_names(ckpt)

            if isinstance(names_raw, dict):
                classes = {str(k): v for k, v in names_raw.items()}
            elif isinstance(names_raw, (list, tuple)):
                classes = {str(i): n for i, n in enumerate(names_raw)}

            if classes:
                detected_format = 'yolov5_torch'
                print(f'[Velion] Strategy 2 (pickle_module) found {len(classes)} classes', flush=True)
            else:
                m   = ckpt.get('model') if isinstance(ckpt, dict) else ckpt
                ema = ckpt.get('ema')   if isinstance(ckpt, dict) else None
                print(f'[Velion] Strategy 2: no names. '
                      f'model.__dict__={list(getattr(m,"__dict__",{}).keys())} '
                      f'ema.__dict__={list(getattr(ema,"__dict__",{}).keys())}',
                      flush=True)

        except Exception:
            print(f'[Velion] Strategy 2 failed:\n{traceback.format_exc()}', flush=True)

    if not classes and filename.endswith('.pt'):
        try:
            import yaml
            yaml_path = path.replace('.pt', '.yaml')
            if os.path.exists(yaml_path):
                with open(yaml_path) as f:
                    yaml_data = yaml.safe_load(f)
                names_raw = yaml_data.get('names', [])
                if isinstance(names_raw, dict):
                    classes = {str(k): v for k, v in names_raw.items()}
                elif isinstance(names_raw, (list, tuple)):
                    classes = {str(i): n for i, n in enumerate(names_raw)}
                if classes:
                    detected_format = 'yolov5_yaml'
                    print(f'[Velion] Strategy 3 (YAML sidecar) found {len(classes)} classes', flush=True)
        except Exception as e:
            print(f'[Velion] Strategy 3 failed: {e}', flush=True)

    if not classes and filename.endswith('.onnx'):
        try:
            import onnx
            import ast
            import json as _json2
            model_onnx = onnx.load(path)
            for prop in model_onnx.metadata_props:
                if prop.key in ('names', 'classes', 'class_names'):
                    raw = prop.value
                    try:
                        parsed = _json2.loads(raw)
                    except Exception:
                        try:
                            parsed = ast.literal_eval(raw)
                        except Exception:
                            parsed = None
                    if isinstance(parsed, dict):
                        classes = {str(k): v for k, v in parsed.items()}
                    elif isinstance(parsed, (list, tuple)):
                        classes = {str(i): n for i, n in enumerate(parsed)}
                    if classes:
                        detected_format = 'onnx'
                        print(f'[Velion] Strategy 4 (ONNX metadata) found {len(classes)} classes', flush=True)
                        break
        except Exception as e:
            print(f'[Velion] Strategy 4 failed: {e}', flush=True)

    if classes:
        settings_store.save_model_format(filename, detected_format)
        print(f'[Velion] Saved format "{detected_format}" for {filename}', flush=True)

    if not classes:
        warning = (
            'Could not detect class names automatically — this model may use a '
            'non-standard format (e.g. old YOLOv5). Add classes manually below.'
        )

    return jsonify({
        'success':  True,
        'filename': filename,
        'classes':  classes,
        'warning':  warning,
    })

@app.route('/api/stream-count/<int:stream_id>')
def stream_count(stream_id):
    with streams_lock:
        s = active_streams.get(stream_id)
    if not s:
        return jsonify({'success': False, 'message': 'Stream not found'}), 404

    counts_by_model = s.get('counts_by_model', {})
    model_filter    = request.args.get('model', '').strip()

    if model_filter:
        counts = counts_by_model.get(model_filter, {})
    else:
        counts: dict[str, int] = {}
        for model_counts in counts_by_model.values():
            for cls_name, cnt in model_counts.items():
                counts[cls_name] = counts.get(cls_name, 0) + cnt

    return jsonify({'success': True, 'stream_id': stream_id, 'counts': counts})

@app.route('/api/models/class-config/<filename>', methods=['GET'])
def api_get_class_config(filename):
    cfg = settings_store.get_model_class_config(filename)
    return jsonify({'success': True, 'filename': filename, 'config': cfg})


@app.route('/api/models/class-config/<filename>', methods=['POST'])
def api_set_class_config(filename):
    data = request.get_json(silent=True) or {}
    settings_store.set_model_class_config(filename, data)
    return jsonify({'success': True})


@app.route('/api/models/select', methods=['POST'])
def api_select_models():
    """Legacy endpoint — kept for backward compat."""
    data     = request.get_json(silent=True) or {}
    general  = data.get('general')  or None
    accident = data.get('accident') or None
    try:
        updated = settings_store.set_selected_models(general, accident)
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    return jsonify({'success': True, 'selected': settings_store.get_selected_models()})


@app.route('/api/models/upload', methods=['POST'])
def api_upload_model():
    if 'model' not in request.files:
        return jsonify({'success': False, 'message': 'No file provided'}), 400

    file = request.files['model']
    if not file.filename:
        return jsonify({'success': False, 'message': 'Empty filename'}), 400

    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if ext not in ALLOWED_MODEL_EXTENSIONS:
        return jsonify({
            'success': False,
            'message': f'Only .pt and .onnx files are allowed. Got: .{ext}',
        }), 400

    display_name = (request.form.get('display_name') or '').strip()
    description  = (request.form.get('description')  or '').strip()
    role         = (request.form.get('role')          or 'custom').strip()
    architecture = (request.form.get('architecture')  or '').strip() or 'Unknown'

    if not display_name:
        return jsonify({'success': False, 'message': 'Model name is required.'}), 400
    if not description:
        return jsonify({'success': False, 'message': 'Description is required.'}), 400
    if role not in ('general', 'accident', 'custom'):
        role = 'custom'

    save_path = os.path.join(MODELS_FOLDER, file.filename)
    os.makedirs(MODELS_FOLDER, exist_ok=True)

    written = 0
    try:
        with open(save_path, 'wb') as f:
            while True:
                chunk = file.stream.read(256 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_MODEL_BYTES:
                    f.close()
                    os.remove(save_path)
                    return jsonify({'success': False, 'message': 'Model file exceeds 500 MB limit'}), 400
                f.write(chunk)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

    settings_store.save_model_meta(
        filename     = file.filename,
        display_name = display_name,
        description  = description,
        role         = role,
        architecture = architecture,
    )

    size_mb = round(written / (1024 * 1024), 1)
    return jsonify({
        'success':      True,
        'message':      f'"{display_name}" uploaded successfully ({size_mb} MB)',
        'filename':     file.filename,
        'size_mb':      size_mb,
        'display_name': display_name,
    })


@app.route('/api/models/delete/<filename>', methods=['DELETE'])
def api_delete_model(filename):
    path = os.path.join(MODELS_FOLDER, filename)
    if not os.path.exists(path):
        return jsonify({'success': False, 'message': 'File not found'}), 404

    from detection import unload_model
    unload_model(filename)

    settings_store.delete_model_meta(filename)
    settings_store.delete_model_class_config(filename)

    try:
        os.remove(path)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

    return jsonify({'success': True, 'message': f'Model "{filename}" deleted'})

# MODEL STATUS
# ─────────────────────────────────────────────────────────────────────
@app.route('/api/model-status')
def api_model_status():
    active = settings_store.get_all_active_models()
    return jsonify({
        'success':      True,
        'active_count': len(active),
        'any_selected': len(active) > 0,
        # Legacy fields
        'general':  active[0]['filename'] if active else None,
        'accident': None,
    })

# SETTINGS ROUTES
# ─────────────────────────────────────────────────────────────────────
@app.route('/api/settings', methods=['GET'])
def api_get_settings():
    import torch
    cfg    = settings_store.get()
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    system_info = {
        'device':      device.upper(),
        'gpu_name':    torch.cuda.get_device_name(0) if device == 'cuda' else None,
        'cpu_threads': torch.get_num_threads()        if device == 'cpu'  else None,
    }
    return jsonify({'success': True, 'settings': cfg, 'system': system_info})


@app.route('/api/settings', methods=['POST'])
def api_update_settings():
    patch = request.get_json(silent=True) or {}
    if not patch:
        return jsonify({'success': False, 'message': 'No data provided'}), 400
    updated = settings_store.update(patch)
    return jsonify({'success': True, 'settings': updated})


@app.route('/api/settings/reset', methods=['POST'])
def api_reset_settings():
    defaults = settings_store.reset_to_defaults()
    return jsonify({'success': True, 'settings': defaults})


@app.route('/api/alerts')
def get_alerts():
    return jsonify({'success': True, 'alerts': []})

@app.route('/api/streams/restore', methods=['POST'])
def api_restore_streams():
    saved = load_streams()
    if not saved:
        return jsonify({'success': True, 'restored': [], 'failed': []})

    with streams_lock:
        active_sources = {s['source'] for s in active_streams.values()}

    restored = []
    failed   = []

    for record in saved:
        source      = record.get('source', '').strip()
        source_type = record.get('source_type', 'rtsp')
        label       = record.get('label', 'Camera')
        slot        = record.get('slot')             
        if slot is not None:
            try:
                slot = int(slot)
            except (TypeError, ValueError):
                slot = None

        if source in active_sources:
            with streams_lock:
                existing_id = next(
                    (sid for sid, s in active_streams.items()
                     if s['source'] == source),
                    None
                )
            if existing_id is not None:
                if slot is not None:
                    with slot_map_lock:
                        if slot not in slot_map:
                            slot_map[slot] = existing_id
                restored.append({
                    'stream_id':       existing_id,
                    'slot':            slot,
                    'label':           label,
                    'source':          source,
                    'source_type':     source_type,
                    'already_running': True,
                })
            continue

        if source_type == 'camera':
            try:
                device_index = int(source)
            except (ValueError, TypeError):
                failed.append({'label': label, 'source': source, 'slot': slot,
                               'error': 'Invalid device index'})
                continue
            sid, err = add_stream_device(device_index, label, slot=slot)
        else:
            sid, err = add_stream_url(source, label, slot=slot)

        if err:
            failed.append({'label': label, 'source': source, 'slot': slot, 'error': err})
        else:
            restored.append({
                'stream_id':       sid,
                'slot':            slot,
                'label':           label,
                'source':          source,
                'source_type':     source_type,
                'already_running': False,
            })

    return jsonify({
        'success':  True,
        'restored': restored,
        'failed':   failed,
    })

# ENTRYPOINT
# ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000, threaded=True)