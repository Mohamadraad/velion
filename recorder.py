import os
import re
import time
import threading
import datetime
import cv2

import settings_store

RECORDINGS_FOLDER  = 'recordings'
SEGMENT_SECONDS    = 3600       
CLEANUP_INTERVAL   = 3600       
DEFAULT_RETENTION  = 7         

_recorders: dict[int, 'CameraRecorder'] = {} 
_recorders_lock = threading.Lock()

_cleanup_thread_started = False

def start_recording(stream_id: int, label: str, fps: float = 15.0) -> bool:
    with _recorders_lock:
        if stream_id in _recorders and _recorders[stream_id].is_alive():
            return False
        rec = CameraRecorder(stream_id, label, fps)
        rec.start()
        _recorders[stream_id] = rec
    _ensure_cleanup_thread()
    return True


def stop_recording(stream_id: int) -> bool:
    with _recorders_lock:
        rec = _recorders.pop(stream_id, None)
    if rec:
        rec.stop()
        return True
    return False


def stop_all():
    with _recorders_lock:
        ids = list(_recorders.keys())
    for sid in ids:
        stop_recording(sid)


def push_frame(stream_id: int, frame):
    with _recorders_lock:
        rec = _recorders.get(stream_id)
    if rec and rec.is_alive():
        rec.push(frame)


def is_recording(stream_id: int) -> bool:
    with _recorders_lock:
        rec = _recorders.get(stream_id)
    return rec is not None and rec.is_alive()


def get_all_recording_ids() -> list[int]:
    with _recorders_lock:
        return [sid for sid, rec in _recorders.items() if rec.is_alive()]


def list_recordings(stream_id: int = None) -> list[dict]:
    results = []
    if not os.path.isdir(RECORDINGS_FOLDER):
        return results

    for cam_dir in sorted(os.listdir(RECORDINGS_FOLDER)):
        full_dir = os.path.join(RECORDINGS_FOLDER, cam_dir)
        if not os.path.isdir(full_dir):
            continue

        m = re.match(r'^cam_(\d+)_(.*)$', cam_dir)
        if not m:
            continue
        sid   = int(m.group(1))
        label = m.group(2).replace('_', ' ')

        if stream_id is not None and sid != stream_id:
            continue

        for fname in sorted(os.listdir(full_dir), reverse=True):
            if not fname.endswith('.mp4'):
                continue
            fpath = os.path.join(full_dir, fname)
            try:
                stat     = os.stat(fpath)
                size_mb  = round(stat.st_size / (1024 * 1024), 1)
                created  = datetime.datetime.fromtimestamp(stat.st_ctime).isoformat()
                results.append({
                    'stream_id':     sid,
                    'label':         label,
                    'cam_dir':       cam_dir,
                    'filename':      fname,
                    'path':          fpath,
                    'size_mb':       size_mb,
                    'created_at':    created,
                })
            except OSError:
                pass

    return results


def delete_recording(cam_dir: str, filename: str) -> bool:
    safe_dir  = os.path.basename(cam_dir)
    safe_file = os.path.basename(filename)
    path = os.path.join(RECORDINGS_FOLDER, safe_dir, safe_file)
    if os.path.exists(path):
        try:
            os.remove(path)
            # Remove folder if empty
            folder = os.path.dirname(path)
            if not os.listdir(folder):
                os.rmdir(folder)
            return True
        except OSError:
            return False
    return False


# CAMERA RECORDER
# ─────────────────────────────────────────────────────────────────────

class CameraRecorder:
    def __init__(self, stream_id: int, label: str, fps: float = 15.0):
        self.stream_id  = stream_id
        self.label      = label
        self.fps        = max(1.0, fps)
        self._queue: list = []
        self._lock      = threading.Lock()
        self._running   = False
        self._thread    = None

    def start(self):
        self._running = True
        self._thread  = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=10)

    def is_alive(self) -> bool:
        return self._running and (self._thread is not None and self._thread.is_alive())

    def push(self, frame):
        """Enqueue a frame (shallow copy to avoid race with caller)."""
        with self._lock:
            if len(self._queue) < int(self.fps * 2):
                self._queue.append(frame.copy())

    def _run(self):
        writer   = None
        seg_start = None
        out_path  = None
        frame_w   = None
        frame_h   = None

        while self._running:
            frame = self._dequeue()
            if frame is None:
                time.sleep(0.02)
                continue

            h, w = frame.shape[:2]

            if frame_w is None:
                frame_w, frame_h = w, h

            now = time.time()
            if seg_start is None or (now - seg_start) >= SEGMENT_SECONDS:
                if writer:
                    writer.release()
                out_path  = self._next_path()
                writer    = self._open_writer(out_path, frame_w, frame_h)
                seg_start = now
                print(f'[Recorder] {self.label} → {out_path}', flush=True)

            if writer and frame is not None:
                if frame.shape[1] != frame_w or frame.shape[0] != frame_h:
                    frame = cv2.resize(frame, (frame_w, frame_h))
                writer.write(frame)

        if writer:
            writer.release()
            print(f'[Recorder] {self.label} stopped. Last file: {out_path}', flush=True)

    def _dequeue(self):
        with self._lock:
            if self._queue:
                return self._queue.pop(0)
        return None

    def _next_path(self) -> str:
        slug    = _slugify(self.label)
        cam_dir = os.path.join(RECORDINGS_FOLDER, f'cam_{self.stream_id}_{slug}')
        os.makedirs(cam_dir, exist_ok=True)
        ts      = datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        return os.path.join(cam_dir, f'{ts}.mp4')

    def _open_writer(self, path: str, w: int, h: int) -> cv2.VideoWriter:
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter(path, fourcc, self.fps, (w, h))
        if not writer.isOpened():
            print(f'[Recorder] WARNING: Could not open writer for {path}', flush=True)
        return writer


# CLEANUP THREAD  — deletes recordings older than retention_days
# ─────────────────────────────────────────────────────────────────────

def _ensure_cleanup_thread():
    global _cleanup_thread_started
    if _cleanup_thread_started:
        return
    _cleanup_thread_started = True
    t = threading.Thread(target=_cleanup_loop, daemon=True)
    t.start()


def _cleanup_loop():
    while True:
        try:
            _run_cleanup()
        except Exception as e:
            print(f'[Recorder] Cleanup error: {e}', flush=True)
        time.sleep(CLEANUP_INTERVAL)


def _run_cleanup():
    retention = settings_store.get_val('recording_retention_days', DEFAULT_RETENTION)
    try:
        retention = int(retention)
    except (TypeError, ValueError):
        retention = DEFAULT_RETENTION

    if retention <= 0:
        return  

    cutoff = time.time() - retention * 86400
    if not os.path.isdir(RECORDINGS_FOLDER):
        return

    deleted = 0
    for cam_dir in os.listdir(RECORDINGS_FOLDER):
        full_dir = os.path.join(RECORDINGS_FOLDER, cam_dir)
        if not os.path.isdir(full_dir):
            continue
        for fname in os.listdir(full_dir):
            if not fname.endswith('.mp4'):
                continue
            fpath = os.path.join(full_dir, fname)
            try:
                if os.stat(fpath).st_mtime < cutoff:
                    os.remove(fpath)
                    deleted += 1
            except OSError:
                pass
        try:
            if not os.listdir(full_dir):
                os.rmdir(full_dir)
        except OSError:
            pass

    if deleted:
        print(f'[Recorder] Cleanup removed {deleted} old recording(s) '
              f'(retention={retention}d)', flush=True)


# HELPERS
# ─────────────────────────────────────────────────────────────────────

def _slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_-]+', '_', s)
    return s[:32]
