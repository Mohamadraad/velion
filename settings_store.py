import json
import os
import threading
import time
from config import MODELS_FOLDER, BUILTIN_MODELS

SETTINGS_FILE       = 'settings.json'
MODELS_META_FILE    = os.path.join(MODELS_FOLDER, '_meta.json')
CLASS_CONFIG_FILE   = os.path.join(MODELS_FOLDER, '_class_config.json')
HISTORY_FILE = 'data/analysis_history.json'

DEFAULTS = {
    'general_conf':               0.40,
    'accident_conf':              0.40,
    'infer_w_gpu':                640,
    'infer_h_gpu':                640,
    'infer_w_cpu':                480,
    'infer_h_cpu':                480,
    'confirm_frames':             4,
    'incident_cooldown_sec':      900,
    'alert_hold_frames':          150,
    'miss_reset_frames':          1,
    'recording_retention_days':   7,       
    'selected_general_model':     None,
    'selected_accident_model':    None,
}

_lock        = threading.Lock()
_meta_lock   = threading.Lock()
_cfg_lock    = threading.Lock()
_current     = {}

# SETTINGS PERSISTENCE
# ─────────────────────────────────────────────────────────────────────
def _load():
    base = dict(DEFAULTS)
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE) as f:
                saved = json.load(f)
            base.update(saved)
        except Exception:
            pass
    return base


def _save(cfg: dict):
    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(cfg, f, indent=2)
    except Exception:
        pass


def init():
    global _current
    with _lock:
        _current = _load()
    os.makedirs(MODELS_FOLDER, exist_ok=True)


def get() -> dict:
    with _lock:
        return dict(_current)


def get_val(key: str, default=None):
    with _lock:
        return _current.get(key, default)


def update(patch: dict) -> dict:
    with _lock:
        for key, val in patch.items():
            if key not in DEFAULTS:
                continue
            if key in ('general_conf', 'accident_conf'):
                val = max(0.05, min(0.99, float(val)))
            elif key in ('infer_w_gpu', 'infer_h_gpu', 'infer_w_cpu', 'infer_h_cpu'):
                val = int(val)
                val = max(128, min(1280, val))
                val = round(val / 32) * 32
            elif key == 'confirm_frames':
                val = max(1, min(30, int(val)))
            elif key == 'incident_cooldown_sec':
                val = max(0, min(86400, int(val)))
            elif key == 'alert_hold_frames':
                val = max(1, min(500, int(val)))
            elif key == 'miss_reset_frames':
                val = max(1, min(60, int(val)))
            elif key in ('selected_general_model', 'selected_accident_model'):
                val = val if isinstance(val, str) and val else None
            elif key == 'recording_retention_days':
                val = max(0, min(365, int(val)))
            _current[key] = val
        _save(_current)
        return dict(_current)


def reset_to_defaults() -> dict:
    with _lock:
        for k, v in DEFAULTS.items():
            _current[k] = v
        _save(_current)
        return dict(_current)

# MODEL METADATA SIDECAR  (models/_meta.json)
# ─────────────────────────────────────────────────────────────────────

def _load_meta() -> dict:
    os.makedirs(MODELS_FOLDER, exist_ok=True)
    if not os.path.exists(MODELS_META_FILE):
        return {}
    try:
        with open(MODELS_META_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_meta(meta: dict):
    os.makedirs(MODELS_FOLDER, exist_ok=True)
    try:
        with open(MODELS_META_FILE, 'w') as f:
            json.dump(meta, f, indent=2)
    except Exception:
        pass

def save_model_format(filename: str, fmt: str):
    with _meta_lock:
        meta = _load_meta()
        if filename not in meta:
            meta[filename] = {}
        meta[filename]['detected_format'] = fmt
        _save_meta(meta)


def get_model_format(filename: str) -> str:
    with _meta_lock:
        meta = _load_meta()
        return meta.get(filename, {}).get('detected_format', 'ultralytics')
    
def save_model_meta(filename: str, display_name: str, description: str,
                    role: str, architecture: str | None):
    with _meta_lock:
        meta = _load_meta()
        meta[filename] = {
            'display_name':     (display_name or '').strip() or filename,
            'description':      (description  or '').strip() or 'User-uploaded model.',
            'role':             role if role in ('general', 'accident', 'custom') else 'custom',
            'architecture':     (architecture or '').strip() or 'Unknown',
            'uploaded_by_user': True,
        }
        _save_meta(meta)


def delete_model_meta(filename: str):
    with _meta_lock:
        meta = _load_meta()
        if filename in meta:
            del meta[filename]
            _save_meta(meta)


def _load_class_config() -> dict:
    os.makedirs(MODELS_FOLDER, exist_ok=True)
    if not os.path.exists(CLASS_CONFIG_FILE):
        return {}
    try:
        with open(CLASS_CONFIG_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_class_config(cfg: dict):
    os.makedirs(MODELS_FOLDER, exist_ok=True)
    try:
        with open(CLASS_CONFIG_FILE, 'w') as f:
            json.dump(cfg, f, indent=2)
    except Exception:
        pass


def get_model_class_config(filename: str) -> dict:
    with _cfg_lock:
        all_cfg = _load_class_config()
        return all_cfg.get(filename, {
            'active':      False,
            'alert_label': 'Alert',
            'classes':     {}
        })


def set_model_class_config(filename: str, config: dict):
    with _cfg_lock:
        all_cfg = _load_class_config()
        all_cfg[filename] = {
            'active':      bool(config.get('active', False)),
            'alert_label': str(config.get('alert_label', 'Alert')).strip() or 'Alert',
            'classes':     config.get('classes', {}),
        }
        _save_class_config(all_cfg)


def delete_model_class_config(filename: str):
    with _cfg_lock:
        all_cfg = _load_class_config()
        if filename in all_cfg:
            del all_cfg[filename]
            _save_class_config(all_cfg)


def get_all_active_models() -> list[dict]:
    os.makedirs(MODELS_FOLDER, exist_ok=True)
    with _cfg_lock:
        all_cfg = _load_class_config()

    active = []
    for filename, cfg in all_cfg.items():
        if not cfg.get('active', False):
            continue
        path = os.path.join(MODELS_FOLDER, filename)
        if not os.path.exists(path):
            continue
        active.append({
            'filename':    filename,
            'alert_label': cfg.get('alert_label', 'Alert'),
            'classes':     cfg.get('classes', {}),
        })
    return active

# MODEL CATALOGUE
# ─────────────────────────────────────────────────────────────────────

def _file_size_mb(path: str) -> float | None:
    try:
        return round(os.path.getsize(path) / (1024 * 1024), 1)
    except Exception:
        return None


def list_models() -> list[dict]:
    os.makedirs(MODELS_FOLDER, exist_ok=True)

    with _meta_lock:
        user_meta = _load_meta()

    with _cfg_lock:
        all_class_cfg = _load_class_config()

    models = []

    for fname in sorted(os.listdir(MODELS_FOLDER)):
        if fname.startswith('_'):
            continue
        ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
        if ext not in ('pt', 'onnx'):
            continue

        path = os.path.join(MODELS_FOLDER, fname)
        fmt  = ext.upper()

        if fname in user_meta:
            m = user_meta[fname]
            info = {
                'filename':         fname,
                'display_name':     m.get('display_name', fname),
                'description':      m.get('description', 'User-uploaded model.'),
                'role':             m.get('role', 'custom'),
                'architecture':     m.get('architecture', 'Unknown'),
                'format':           fmt,
                'size_mb':          _file_size_mb(path),
                'builtin':          False,
                'available':        True,
                'uploaded_by_user': True,
            }
        else:
            info = {
                'filename':         fname,
                'display_name':     fname,
                'description':      'No description provided.',
                'role':             'custom',
                'architecture':     'Unknown',
                'format':           fmt,
                'size_mb':          _file_size_mb(path),
                'builtin':          False,
                'available':        True,
                'uploaded_by_user': True,
            }

        ccfg = all_class_cfg.get(fname, {})
        info['active']      = ccfg.get('active', False)
        info['alert_label'] = ccfg.get('alert_label', 'Alert')
        info['class_count'] = len(ccfg.get('classes', {}))
        info['configured']  = bool(ccfg.get('classes'))

        models.append(info)

    return models


# MODEL SELECTION 
# ─────────────────────────────────────────────────────────────────────

def get_selected_models() -> dict:
    """Legacy: returns active models mapped to general/accident slots for old code."""
    active = get_all_active_models()
    result = {'general': None, 'accident': None}
    for m in active:
        classes   = m.get('classes', {})
        has_alert = any(c.get('alert', False) for c in classes.values())
        if has_alert and not result['accident']:
            result['accident'] = m['filename']
        elif not result['general']:
            result['general'] = m['filename']
    return result


def set_selected_models(general: str | None, accident: str | None) -> dict:
    os.makedirs(MODELS_FOLDER, exist_ok=True)
    available = {
        f for f in os.listdir(MODELS_FOLDER)
        if not f.startswith('_')
        and f.rsplit('.', 1)[-1].lower() in ('pt', 'onnx')
    }

    def _validate(name):
        if not name:
            return None
        if name not in available:
            raise ValueError(f'Model file not found: {name}')
        return name

    return update({
        'selected_general_model':  _validate(general),
        'selected_accident_model': _validate(accident),
    })


def save_analysis_result(job_id: str, job: dict):
    os.makedirs('data', exist_ok=True)
    try:
        history = _load_history()

        active_models_snapshot = []
        try:
            all_cfg = _load_class_config()
            meta    = _load_meta()
            for filename, cfg in all_cfg.items():
                if not cfg.get('active', False):
                    continue
                path = os.path.join(MODELS_FOLDER, filename)
                if not os.path.exists(path):
                    continue
                m_meta = meta.get(filename, {})
                alert_classes = [
                    c.get('name', cls_id)
                    for cls_id, c in cfg.get('classes', {}).items()
                    if c.get('alert', False)
                ]
                draw_classes = [
                    c.get('name', cls_id)
                    for cls_id, c in cfg.get('classes', {}).items()
                    if c.get('draw', False)
                ]
                active_models_snapshot.append({
                    'filename':     filename,
                    'display_name': m_meta.get('display_name', filename),
                    'role':         m_meta.get('role', 'custom'),
                    'architecture': m_meta.get('architecture', 'Unknown'),
                    'alert_label':  cfg.get('alert_label', 'Alert'),
                    'alert_classes': alert_classes,
                    'draw_classes':  draw_classes,
                    'class_count':  len(cfg.get('classes', {})),
                })
        except Exception as me:
            print(f'[Velion] Could not snapshot models: {me}')

        with _lock:
            settings_snapshot = {
                'general_conf':          _current.get('general_conf'),
                'accident_conf':         _current.get('accident_conf'),
                'confirm_frames':        _current.get('confirm_frames'),
                'incident_cooldown_sec': _current.get('incident_cooldown_sec'),
                'alert_hold_frames':     _current.get('alert_hold_frames'),
                'miss_reset_frames':     _current.get('miss_reset_frames'),
            }

        history.append({
            'job_id':           job_id,
            'filename':         job.get('filename', 'unknown'),
            'completed_at':     time.time(),
            'incident_count':   job.get('incident_count', 0),
            'total_frames':     job.get('total_frames', 0),
            'fps':              job.get('fps', 25),
            'export_filename':  job.get('export_filename'),
            'export_ready':     job.get('export_ready', False),
            'process_start_time': job.get('process_start_time'),
            'process_end_time':   job.get('process_end_time') or time.time(),
            'active_models':    active_models_snapshot,
            'settings':         settings_snapshot,
        })
        history = history[-100:]
        with open(HISTORY_FILE, 'w') as f:
            json.dump(history, f, indent=2)
    except Exception as e:
        print(f'[Velion] Failed to save analysis history: {e}')

def get_analysis_history() -> list:
    return _load_history()

def _load_history() -> list:
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE) as f:
            return json.load(f)
    except Exception:
        return []