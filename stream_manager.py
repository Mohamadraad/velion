import os
import time
import threading
import cv2
import platform
import subprocess
from config import STREAM_INTERVAL, STREAM_JPEG_Q
from detection import draw_detections, remove_accident_state
from stream_persistence import save_streams
import recorder   # ← NEW
import json
import re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

active_streams = {}
stream_counter = 0
streams_lock   = threading.Lock()

slot_map: dict[int, int] = {}
slot_map_lock = threading.Lock()

_SYSTEM = platform.system()

# SLOT MAP HELPERS  
# ─────────────────────────────────────────────────────────────────────

def register_slot(slot: int, stream_id: int):
    with slot_map_lock:
        slot_map[slot] = stream_id
    _persist()

def unregister_slot(slot: int):
    with slot_map_lock:
        slot_map.pop(slot, None)
    _persist()

def get_slot_for_stream(stream_id: int) -> int | None:
    with slot_map_lock:
        for slot, sid in slot_map.items():
            if sid == stream_id:
                return slot
    return None

def get_stream_for_slot(slot: int) -> int | None:
    with slot_map_lock:
        return slot_map.get(slot)

def _persist():
    with streams_lock:
        _streams_snapshot = dict(active_streams)
    with slot_map_lock:
        _slot_snapshot = dict(slot_map)
    save_streams(_streams_snapshot, _slot_snapshot)

# DEVICE ENUMERATION  
# ─────────────────────────────────────────────────────────────────────

def list_cameras() -> list[dict]:
    raw = []
    try:
        if _SYSTEM == "Linux":
            raw = _list_linux()
        elif _SYSTEM == "Windows":
            raw = _list_windows()
        elif _SYSTEM == "Darwin":
            raw = _list_macos()
    except Exception:
        pass

    if not raw:
        raw = _list_probe_fallback()

    with streams_lock:
        used = {}
        for s in active_streams.values():
            if s.get("source_type") == "camera":
                try:
                    idx = int(s["source"])
                    used[idx] = s["label"]
                except (ValueError, KeyError):
                    pass

    for cam in raw:
        name = cam.get("name") or cam.get("label") or f"Camera {cam.get('index', '?')}"
        cam["name"]  = name
        cam["label"] = name
        cam.setdefault("index", None)
        if cam["index"] in used:
            cam["in_use"]  = True
            cam["used_by"] = used[cam["index"]]
        else:
            cam["in_use"]  = False
            cam["used_by"] = None

    return raw


def _list_linux() -> list[dict]:
    import fcntl, struct
    VIDIOC_QUERYCAP        = 0x80685600
    V4L2_CAP_VIDEO_CAPTURE = 0x00000001
    cameras = []
    for dev_path in sorted(Path("/dev").glob("video*")):
        try:
            index = int(re.search(r"\d+$", dev_path.name).group())
            with open(dev_path, "rb") as f:
                buf    = b"\x00" * 104
                result = fcntl.ioctl(f.fileno(), VIDIOC_QUERYCAP, buf)
                caps   = struct.unpack_from("<I", result, 96)[0]
                card   = result[16:48].rstrip(b"\x00").decode("utf-8", errors="replace").strip()
                if caps & V4L2_CAP_VIDEO_CAPTURE:
                    cameras.append({"index": index, "name": card or f"Camera {index}", "path": str(dev_path), "backend": "v4l2"})
        except Exception:
            pass
    return cameras


def _list_windows() -> list[dict]:
    ps_script = ("Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Camera' -or $_.PNPClass -eq 'Image' } | Select-Object Name, DeviceID | ConvertTo-Json")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, text=True, timeout=8)
        if not out.stdout.strip():
            raise ValueError("empty output")
        devices = json.loads(out.stdout)
        if isinstance(devices, dict):
            devices = [devices]
        return [{"index": i, "name": d.get("Name") or f"Camera {i}", "device_id": d.get("DeviceID", ""), "backend": "dshow"} for i, d in enumerate(devices)]
    except Exception:
        return _list_windows_fallback()


def _list_windows_fallback() -> list[dict]:
    try:
        from pygrabber.dshow_graph import FilterGraph
        return [{"index": i, "name": n or f"Camera {i}", "backend": "dshow"} for i, d in enumerate(FilterGraph().get_input_devices())]
    except Exception:
        return []


def _list_macos() -> list[dict]:
    try:
        out = subprocess.run(["system_profiler", "SPCameraDataType", "-json"], capture_output=True, text=True, timeout=8)
        data    = json.loads(out.stdout)
        devices = data.get("SPCameraDataType", [])
        return [{"index": i, "name": d.get("_name") or f"Camera {i}", "model_id": d.get("spcamera_model-id", ""), "uid": d.get("spcamera_uid", ""), "backend": "avfoundation"} for i, d in enumerate(devices)]
    except Exception:
        return _list_macos_fallback()


def _list_macos_fallback() -> list[dict]:
    try:
        import AVFoundation
        session = AVFoundation.AVCaptureDeviceDiscoverySession.discoverySessionWithDeviceTypes_mediaType_position_(
            [AVFoundation.AVCaptureDeviceTypeBuiltInWideAngleCamera, AVFoundation.AVCaptureDeviceTypeExternalUnknown],
            AVFoundation.AVMediaTypeVideo, AVFoundation.AVCaptureDevicePositionUnspecified,
        )
        return [{"index": i, "name": d.localizedName(), "backend": "avfoundation"} for i, d in enumerate(session.devices())]
    except Exception:
        return []

def _list_probe_fallback(max_index: int = 9) -> list[dict]:
    os.environ["OPENCV_LOG_LEVEL"] = "SILENT"
    def _probe(i: int):
        try:
            cap = cv2.VideoCapture(i, cv2.CAP_V4L2) if _SYSTEM == "Linux" else cv2.VideoCapture(i)
            if cap.isOpened():
                ok, _ = cap.read()
                cap.release()
                if ok:
                    return {"index": i, "name": f"Camera {i}", "backend": "opencv"}
            else:
                cap.release()
        except Exception:
            pass
        return None
    with ThreadPoolExecutor(max_workers=max_index + 1) as ex:
        results = [r for r in ex.map(_probe, range(max_index + 1)) if r]
    os.environ["OPENCV_LOG_LEVEL"] = "WARNING"
    return sorted(results, key=lambda x: x["index"])

# CAPTURE HELPERS  
# ─────────────────────────────────────────────────────────────────────

def open_capture_url(url: str) -> cv2.VideoCapture:
    if url.startswith("rtsp://"):
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


def open_capture_device(device_index: int) -> cv2.VideoCapture:
    if _SYSTEM == "Linux":
        cap = cv2.VideoCapture(device_index, cv2.CAP_V4L2)
    elif _SYSTEM == "Windows":
        cap = cv2.VideoCapture(device_index, cv2.CAP_DSHOW)
    else:
        cap = cv2.VideoCapture(device_index, cv2.CAP_AVFOUNDATION)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap

# BACKGROUND INFERENCE WORKER  — now calls recorder.push_frame()
# ─────────────────────────────────────────────────────────────────────

_DEAD_THRESHOLD = 30

def stream_inference_worker(stream_id):
    tracker_key      = f"stream_{stream_id}"
    last_stream_push = 0.0
    fail_streak      = 0

    while True:
        with streams_lock:
            stream = active_streams.get(stream_id)
            if stream is None or not stream.get("running"):
                break
            cap = stream["cap"]

        ok, frame = cap.read()

        if not ok or frame is None or frame.size == 0:
            fail_streak += 1
            if fail_streak >= _DEAD_THRESHOLD:
                with streams_lock:
                    if stream_id in active_streams:
                        active_streams[stream_id]["health"]  = "dead"
                        active_streams[stream_id]["running"] = False
                break
            time.sleep(0.05)
            continue

        fail_streak = 0

        with streams_lock:
            if stream_id in active_streams and active_streams[stream_id].get("health") != "ok":
                active_streams[stream_id]["health"] = "ok"

        small_frame = cv2.resize(frame, (640, 360))
        annotated_frame, new_incident, counts_by_model = draw_detections(small_frame, tracker_key)

        recorder.push_frame(stream_id, annotated_frame)

        now = time.time()
        if (now - last_stream_push) >= STREAM_INTERVAL:
            last_stream_push = now
            _, buf = cv2.imencode(".jpg", annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, STREAM_JPEG_Q])
            with streams_lock:
                s = active_streams.get(stream_id)
                if s is None:
                    break
                s["frame"]           = buf.tobytes()
                s["counts_by_model"] = counts_by_model
                if new_incident:
                    s["incident_count"] = s.get("incident_count", 0) + 1

    remove_accident_state(tracker_key)

    if recorder.is_recording(stream_id):
        recorder.stop_recording(stream_id)
        print(f'[Recorder] Auto-stopped recording for stream {stream_id} (stream ended)', flush=True)

# MJPEG GENERATOR 
# ─────────────────────────────────────────────────────────────────────

def stream_mjpeg_generator(stream_id):
    last_fb = None
    while True:
        with streams_lock:
            stream = active_streams.get(stream_id)
            if stream is None:
                break
            health  = stream.get("health", "ok")
            running = stream.get("running", True)
            fb      = stream.get("frame")

        if health in ("reconnecting", "dead") or not running:
            break

        if fb and fb is not last_fb:
            last_fb = fb
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + fb + b"\r\n"

        time.sleep(0.033)


# ADD / REMOVE STREAM 
# ─────────────────────────────────────────────────────────────────────

def add_stream_url(url: str, label: str, slot: int = None):
    cap = open_capture_url(url)
    if not cap.isOpened():
        return None, "Could not connect to URL"
    ok, _ = cap.read()
    if not ok:
        cap.release()
        return None, "No frames from stream URL"
    return _register_stream(cap, source=url, source_type="rtsp", label=label, slot=slot)


def add_stream_device(device_index: int, label: str, slot: int = None):
    cap = open_capture_device(device_index)
    if not cap.isOpened():
        return None, f"Could not open camera at index {device_index}"
    deadline = time.time() + 3.0
    ok = False
    while time.time() < deadline:
        ok, _ = cap.read()
        if ok:
            break
        time.sleep(0.05)
    if not ok:
        cap.release()
        return None, f"No frames from camera at index {device_index}"
    return _register_stream(cap, source=str(device_index), source_type="camera", label=label, slot=slot)


def _register_stream(cap: cv2.VideoCapture, source: str, source_type: str, label: str, slot: int = None):
    global stream_counter
    with streams_lock:
        stream_counter += 1
        sid = stream_counter
        active_streams[sid] = {
            "source":          source,
            "source_type":     source_type,
            "label":           label,
            "cap":             cap,
            "frame":           None,
            "running":         True,
            "health":          "ok",
            "incident_count":  0,
            "counts_by_model": {},
        }

    if slot is not None:
        with slot_map_lock:
            slot_map[slot] = sid

    _persist()

    t = threading.Thread(target=stream_inference_worker, args=(sid,), daemon=True)
    t.start()
    with streams_lock:
        active_streams[sid]["thread"] = t

    return sid, None


def remove_stream(stream_id):
    if recorder.is_recording(stream_id):
        recorder.stop_recording(stream_id)

    with streams_lock:
        s = active_streams.get(stream_id)
        if s:
            s["running"] = False
            s["cap"].release()
            active_streams.pop(stream_id)

    with slot_map_lock:
        slots_to_remove = [slot for slot, sid in slot_map.items() if sid == stream_id]
        for slot in slots_to_remove:
            slot_map.pop(slot, None)

    _persist()