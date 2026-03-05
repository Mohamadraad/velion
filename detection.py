import os
import sys
import pickle
import types as _types
import threading
import time
import cv2
import numpy as np
import torch
from concurrent.futures import ThreadPoolExecutor

import settings_store

from config import (
    MODELS_FOLDER,
    INFER_W_GPU, INFER_H_GPU, INFER_W_CPU, INFER_H_CPU,
    VEHICLE_IDS, PERSON_ID,
)

# DEVICE
# ─────────────────────────────────────────────────────────────────────
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f'[Velion] Compute device: {DEVICE.upper()}', flush=True)
if DEVICE == 'cuda':
    print(f'[Velion] GPU: {torch.cuda.get_device_name(0)}', flush=True)
else:
    torch.set_num_threads(os.cpu_count() or 4)
    print(f'[Velion] CPU threads: {torch.get_num_threads()}', flush=True)

# LAZY MODEL CACHE
# ─────────────────────────────────────────────────────────────────────
_model_cache: dict[str, object] = {}
_model_lock  = threading.Lock()
_infer_pool  = ThreadPoolExecutor(max_workers=4)

_PALETTE = [
    (0, 200, 200),
    (0, 180, 80),
    (200, 160, 0),
    (160, 80, 220),
    (220, 120, 0),
    (180, 0, 180),
    (80, 200, 160),
    (200, 80, 80),
]

class NoModelError(RuntimeError):
    pass

# CUSTOM UNPICKLER  — absorbs missing YOLOv5 modules
# ─────────────────────────────────────────────────────────────────────

class _SafeObj:
    def __init__(self, *a, **kw): pass
    def __setstate__(self, state):
        if isinstance(state, dict):
            self.__dict__.update(state)
    def __call__(self, *a, **kw): return None
    def __repr__(self):
        return f'<SafeObj {list(self.__dict__.keys())}>'


class _PatchedUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        try:
            return super().find_class(module, name)
        except (ModuleNotFoundError, AttributeError, ImportError):
            return _SafeObj


def _make_fake_pickle():
    fp = _types.ModuleType('_velion_pickle')
    fp.Unpickler        = _PatchedUnpickler
    fp.UnpicklingError  = pickle.UnpicklingError
    fp.dump             = pickle.dump
    fp.dumps            = pickle.dumps
    fp.load             = pickle.load
    fp.loads            = pickle.loads
    fp.HIGHEST_PROTOCOL = pickle.HIGHEST_PROTOCOL
    return fp


def _torch_load_safe(path: str):
    return torch.load(path, map_location='cpu',
                      pickle_module=_make_fake_pickle(),
                      weights_only=False)


# YOLOV5 RESULT ADAPTERS
# ─────────────────────────────────────────────────────────────────────

class _V5Box:
    __slots__ = ('xyxy', 'conf', 'cls')

    def __init__(self, x1, y1, x2, y2, conf, cls):
        self.xyxy = [torch.tensor([x1, y1, x2, y2])]
        self.conf = [torch.tensor(float(conf))]
        self.cls  = [torch.tensor(float(cls))]


class _V5Results:
    def __init__(self, detections: list, names: dict):
        self.names = names
        self.boxes = [
            _V5Box(d['x1'], d['y1'], d['x2'], d['y2'], d['conf'], d['cls'])
            for d in detections
        ] if detections else None

    def __getitem__(self, idx): return self
    def __bool__(self): return bool(self.boxes)
    def __len__(self): return 1

# YOLOV5 DIRECT INFERENCE WRAPPER
# ─────────────────────────────────────────────────────────────────────

def _xywh2xyxy(x):
    y = np.copy(x)
    y[..., 0] = x[..., 0] - x[..., 2] / 2
    y[..., 1] = x[..., 1] - x[..., 3] / 2
    y[..., 2] = x[..., 0] + x[..., 2] / 2
    y[..., 3] = x[..., 1] + x[..., 3] / 2
    return y


def _nms_numpy(boxes, scores, iou_thresh=0.45):
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep  = []
    while order.size:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0, xx2 - xx1)
        h = np.maximum(0, yy2 - yy1)
        inter = w * h
        iou   = inter / (areas[i] + areas[order[1:]] - inter + 1e-9)
        order = order[np.where(iou <= iou_thresh)[0] + 1]
    return keep


def _postprocess_v5(pred_raw, conf_thresh=0.25, iou_thresh=0.45):
    pred = pred_raw[0] if isinstance(pred_raw, (tuple, list)) else pred_raw
    if pred.dim() == 3:
        pred = pred[0]

    pred = pred.cpu().float().numpy()

    obj_conf   = pred[:, 4]
    class_conf = pred[:, 5:]
    cls_ids    = class_conf.argmax(axis=1)
    cls_scores = class_conf[np.arange(len(class_conf)), cls_ids]
    scores     = obj_conf * cls_scores

    mask = scores >= conf_thresh
    pred    = pred[mask]
    scores  = scores[mask]
    cls_ids = cls_ids[mask]

    if len(pred) == 0:
        return []

    boxes_xywh = pred[:, :4]
    boxes_xyxy = _xywh2xyxy(boxes_xywh)

    try:
        from torchvision.ops import nms as tv_nms
        keep = tv_nms(
            torch.from_numpy(boxes_xyxy),
            torch.from_numpy(scores),
            iou_thresh,
        ).numpy()
    except Exception:
        keep = _nms_numpy(boxes_xyxy, scores, iou_thresh)

    results = []
    for i in keep:
        x1, y1, x2, y2 = boxes_xyxy[i]
        results.append({
            'x1': float(x1), 'y1': float(y1),
            'x2': float(x2), 'y2': float(y2),
            'conf': float(scores[i]),
            'cls':  int(cls_ids[i]),
        })
    return results


class _YoloV5DirectWrapper:
    def __init__(self, path: str):
        self._path = path
        self.names: dict = {}
        self._nn    = None
        self._stride = 32
        self._load()

    def _load(self):
        print(f'[Velion] YOLOv5 direct load: {self._path}', flush=True)
        ckpt = _torch_load_safe(self._path)

        if not isinstance(ckpt, dict):
            raise RuntimeError('Checkpoint is not a dict — unsupported format.')

        names_raw = self._find_names(ckpt)
        if isinstance(names_raw, dict):
            self.names = {int(k): v for k, v in names_raw.items()}
        elif isinstance(names_raw, (list, tuple)):
            self.names = {i: v for i, v in enumerate(names_raw)}

        raw_model = ckpt.get('model') or ckpt.get('ema')
        if raw_model is None:
            raise RuntimeError('No "model" key in checkpoint.')

        if isinstance(raw_model, torch.nn.Module):
            nn_model = raw_model
        else:
            inner = getattr(raw_model, 'model', None)
            if isinstance(inner, torch.nn.Module):
                nn_model = inner
            else:
                raise RuntimeError(
                    'Could not extract a real nn.Module from this checkpoint. '
                    'The model architecture classes (models.yolo) are not available '
                    'on this machine. Install them with: pip install yolov5'
                )

        nn_model = nn_model.float().eval()
        try:
            nn_model.to(DEVICE)
        except Exception:
            pass

        stride = getattr(nn_model, 'stride', None)
        if stride is not None:
            try:
                self._stride = int(stride.max())
            except Exception:
                self._stride = 32

        self._nn = nn_model
        print(f'[Velion] YOLOv5 direct ready, classes={self.names}', flush=True)

    @staticmethod
    def _find_names(ckpt):
        def _from_obj(obj):
            if obj is None:
                return None
            d = getattr(obj, '__dict__', {})
            val = d.get('names')
            if isinstance(val, (dict, list)) and val:
                return val
            for key in ('model', 'module'):
                sub = d.get(key)
                if sub is not None:
                    val = _from_obj(sub)
                    if val is not None:
                        return val
            yaml_attr = d.get('yaml')
            if isinstance(yaml_attr, dict):
                val = yaml_attr.get('names')
                if isinstance(val, (dict, list)) and val:
                    return val
            return None

        val = ckpt.get('names')
        if isinstance(val, (dict, list)) and val:
            return val
        for key in ('model', 'ema'):
            val = _from_obj(ckpt.get(key))
            if val is not None:
                return val
        return None

    def _preprocess(self, frame_bgr, imgsz=640):
        img = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        h0, w0 = img.shape[:2]
        r = imgsz / max(h0, w0)
        if r != 1:
            interp = cv2.INTER_LINEAR if r > 1 else cv2.INTER_AREA
            img = cv2.resize(img, (int(w0 * r), int(h0 * r)), interpolation=interp)
        h, w = img.shape[:2]
        pad_h = (self._stride - h % self._stride) % self._stride
        pad_w = (self._stride - w % self._stride) % self._stride
        img = cv2.copyMakeBorder(img, 0, pad_h, 0, pad_w,
                                 cv2.BORDER_CONSTANT, value=(114, 114, 114))
        img = img.transpose(2, 0, 1)
        img = np.ascontiguousarray(img, dtype=np.float32) / 255.0
        tensor = torch.from_numpy(img).unsqueeze(0)
        return tensor.to(DEVICE), (h0, w0), (h + pad_h, w + pad_w)

    def _run_inference(self, frame, conf_thresh):
        tensor, (h0, w0), (ph, pw) = self._preprocess(frame)
        with torch.no_grad():
            try:
                pred = self._nn(tensor)
            except Exception as e:
                print(f'[Velion] YOLOv5 forward() error: {e}', flush=True)
                return []

        dets = _postprocess_v5(pred, conf_thresh=conf_thresh)

        sx = w0 / pw
        sy = h0 / ph
        for d in dets:
            d['x1'] *= sx; d['y1'] *= sy
            d['x2'] *= sx; d['y2'] *= sy
        return dets

    def track(self, frame, persist=True, verbose=False, conf=0.4, device=None):
        return self(frame, conf=conf)

    def __call__(self, frame, verbose=False, conf=0.4, device=None):
        try:
            dets = self._run_inference(frame, conf_thresh=conf)
            return _V5Results(dets, self.names)
        except Exception as e:
            print(f'[Velion] YOLOv5 direct inference error: {e}', flush=True)
            return _V5Results([], self.names)

    def to(self, device):
        if self._nn is not None:
            try:
                self._nn.to(device)
            except Exception:
                pass
        return self

# FORMAT-AWARE MODEL LOADER
# ─────────────────────────────────────────────────────────────────────

def _load_model(filename: str):
    with _model_lock:
        if filename in _model_cache:
            return _model_cache[filename]

        path = os.path.join(MODELS_FOLDER, filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f'Model file not found: {path}')

        fmt = settings_store.get_model_format(filename)
        print(f'[Velion] Loading "{filename}" (format={fmt})', flush=True)

        if fmt in ('yolov5_torch', 'yolov5_yaml'):
            model = _YoloV5DirectWrapper(path)

        elif fmt == 'onnx' or filename.endswith('.onnx'):
            from ultralytics import YOLO
            model = YOLO(path, task='detect')

        else:
            try:
                from ultralytics import YOLO
                model = YOLO(path, task='detect')
                if path.endswith('.pt'):
                    model.to(DEVICE)
            except Exception as e:
                print(f'[Velion] Ultralytics load failed ({e}), '
                      f'trying direct YOLOv5 loader', flush=True)
                model = _YoloV5DirectWrapper(path)

        _model_cache[filename] = model
        print(f'[Velion] Model ready: {filename}', flush=True)
        return model


def _get_infer_size():
    cfg = settings_store.get()
    if DEVICE == 'cuda':
        return cfg.get('infer_w_gpu', INFER_W_GPU), cfg.get('infer_h_gpu', INFER_H_GPU)
    return cfg.get('infer_w_cpu', INFER_W_CPU), cfg.get('infer_h_cpu', INFER_H_CPU)


def models_ready() -> dict:
    active = settings_store.get_all_active_models()
    return {
        'general':  active[0]['filename'] if active else None,
        'accident': None,
        'any':      len(active) > 0,
    }


def unload_model(filename: str):
    with _model_lock:
        _model_cache.pop(filename, None)

# ACCIDENT STATE MACHINE  (one per tracker_key)
# ─────────────────────────────────────────────────────────────────────
class AccidentState:
    def __init__(self):
        self._lock              = threading.Lock()
        self.consecutive        = 0
        self.miss_streak        = 0
        self.confirmed          = False
        self.alert_hold         = 0
        self.last_incident_time = 0.0
        self.incident_count     = 0

    def push(self, detected: bool):
        cfg               = settings_store.get()
        confirm_frames    = cfg.get('confirm_frames',        4)
        alert_hold_frames = cfg.get('alert_hold_frames',     150)
        miss_reset_frames = cfg.get('miss_reset_frames',     1)
        cooldown_sec      = cfg.get('incident_cooldown_sec', 900)

        with self._lock:
            new_incident = False
            if detected:
                self.miss_streak  = 0
                self.consecutive += 1
                if self.consecutive >= confirm_frames and not self.confirmed:
                    self.confirmed  = True
                    self.alert_hold = alert_hold_frames
                    now = time.time()
                    if now - self.last_incident_time >= cooldown_sec:
                        self.last_incident_time = now
                        self.incident_count    += 1
                        new_incident            = True
                elif self.confirmed:
                    self.alert_hold = alert_hold_frames
            else:
                self.miss_streak += 1
                if self.miss_streak >= miss_reset_frames:
                    self.consecutive = 0
                    self.confirmed   = False
                    self.miss_streak = 0

            if self.alert_hold > 0:
                self.alert_hold -= 1
                return True, new_incident
            return False, new_incident

    def reset_streak(self):
        with self._lock:
            self.consecutive = 0
            self.confirmed   = False
            self.alert_hold  = 0
            self.miss_streak = 0

    @property
    def streak(self):
        with self._lock:
            return self.consecutive

    @property
    def total(self):
        with self._lock:
            return self.incident_count


accident_states: dict[str, AccidentState] = {}
as_lock = threading.Lock()


def get_accident_state(key: str) -> AccidentState:
    with as_lock:
        if key not in accident_states:
            accident_states[key] = AccidentState()
        return accident_states[key]


def remove_accident_state(key: str):
    with as_lock:
        accident_states.pop(key, None)


# INFERENCE HELPERS
# ─────────────────────────────────────────────────────────────────────

def _run_model(model, small_frame, conf, tracker_key):
    try:
        return model.track(small_frame, persist=True, verbose=False,
                           conf=conf, device=DEVICE)
    except Exception:
        try:
            return model(small_frame, verbose=False, conf=conf, device=DEVICE)
        except Exception as e:
            print(f'[Velion] Inference failed: {e}', flush=True)
            return None


def _unpack_results(results):
    if results is None:
        return None, {}

    try:
        r = results[0]
    except (IndexError, TypeError):
        r = results

    if r is None:
        return None, {}

    boxes = getattr(r, 'boxes', None)
    names = getattr(r, 'names', {}) or {}

    if boxes is None:
        return None, names

    try:
        if len(boxes) == 0:
            return None, names
    except TypeError:
        pass

    return boxes, names

# ─────────────────────────────────────────────────────────────────────
# MAIN DRAW FUNCTION
# Returns (annotated_frame, new_incident_triggered, counts_by_model)
# counts_by_model = { model_filename: { class_name: int, ... }, ... }
# ─────────────────────────────────────────────────────────────────────

def draw_detections(frame, tracker_key: str):
    if not tracker_key:
        tracker_key = '__live__'

    cfg              = settings_store.get()
    conf_thresh      = cfg.get('general_conf', 0.40)
    infer_w, infer_h = _get_infer_size()
    active_models    = settings_store.get_all_active_models()

    h, w  = frame.shape[:2]
    state = get_accident_state(tracker_key)

    counts_by_model: dict[str, dict[str, int]] = {}

    if not active_models:
        overlay = frame.copy()
        frame = cv2.addWeighted(overlay, 0.75, frame, 0.25, 0)
        return frame, False, {}

    small = cv2.resize(frame, (infer_w, infer_h))
    sx    = w / infer_w
    sy    = h / infer_h

    any_alert_this_frame = False

    for model_def in active_models:
        filename  = model_def['filename']
        class_cfg = model_def.get('classes', {})

        draw_ids  = set()
        alert_ids = set()
        for cid_str, ccfg in class_cfg.items():
            try:
                cid = int(cid_str)
            except ValueError:
                continue
            if ccfg.get('draw', True):
                draw_ids.add(cid)
            if ccfg.get('alert', False):
                alert_ids.add(cid)

        try:
            model = _load_model(filename)
        except Exception as e:
            print(f'[Velion] Could not load {filename}: {e}', flush=True)
            continue

        fmt = settings_store.get_model_format(filename)
        is_v5_direct = fmt in ('yolov5_torch', 'yolov5_yaml') and isinstance(model, _YoloV5DirectWrapper)

        if is_v5_direct:
            raw = model(frame, conf=conf_thresh)
            boxes, names = _unpack_results(raw)
            scale_x, scale_y = 1.0, 1.0
        else:
            raw = _run_model(model, small.copy(), conf_thresh, tracker_key)
            boxes, names = _unpack_results(raw)
            scale_x, scale_y = sx, sy

        if boxes is None:
            counts_by_model[filename] = {}
            continue

        model_counts: dict[str, int] = {}

        for box in boxes:
            try:
                cls      = int(box.cls[0])
                conf_val = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
            except Exception:
                continue

            x1, y1 = int(x1 * scale_x), int(y1 * scale_y)
            x2, y2 = int(x2 * scale_x), int(y2 * scale_y)
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(w, x2), min(h, y2)

            cc       = class_cfg.get(str(cls), {})
            cls_name = (cc.get('name') or
                        (names.get(cls) if names else None) or
                        f'cls_{cls}')

            model_counts[cls_name] = model_counts.get(cls_name, 0) + 1

            if cls in alert_ids:
                any_alert_this_frame = True

            if draw_ids and cls not in draw_ids:
                continue

            color = (30, 30, 220) if cls in alert_ids else _PALETTE[cls % len(_PALETTE)]

            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            lbl = f'{cls_name} {conf_val:.0%}'
            (lw, lh), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
            cv2.rectangle(frame, (x1, y1 - lh - 6), (x1 + lw + 6, y1), color, -1)
            cv2.putText(frame, lbl, (x1 + 3, y1 - 3),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1)

        counts_by_model[filename] = model_counts

    is_alert, new_incident = state.push(any_alert_this_frame)

    overlay = frame.copy()
    cv2.rectangle(overlay, (0, h - 40), (w, h), (0, 0, 0), -1)
    frame = cv2.addWeighted(overlay, 0.55, frame, 0.45, 0)

    if is_alert:
        alert_lbl = 'ALERT'
        for m in active_models:
            if any(c.get('alert', False) for c in m.get('classes', {}).values()):
                alert_lbl = m.get('alert_label', 'Alert').upper()
                break

        cv2.rectangle(frame, (0, 0), (w, 52), (0, 0, 180), -1)
        top_txt = f'!! {alert_lbl} CONFIRMED  |  incidents: {state.total}'
        (tw, _), _ = cv2.getTextSize(top_txt, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)
        cv2.putText(frame, top_txt, ((w - tw) // 2, 34),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
        bot_txt   = alert_lbl
        bot_color = (0, 40, 220)
    else:
        bot_txt   = f'MONITORING'
        bot_color = (0, 160, 60)

    cv2.putText(frame, bot_txt, (10, h - 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.46, bot_color, 1)

    return frame, new_incident, counts_by_model