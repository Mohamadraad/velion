import json
import os
import threading

STREAM_STATE_FILE = 'data/stream_state.json'
_lock = threading.Lock()


def _ensure_dir():
    os.makedirs('data', exist_ok=True)


def save_streams(active_streams: dict, slot_map: dict = None):
    _ensure_dir()
    records = []

    if slot_map:
        for slot, sid in sorted(slot_map.items()):
            s = active_streams.get(sid)
            if s:
                records.append({
                    'slot':        slot,
                    'source':      s['source'],
                    'source_type': s['source_type'],
                    'label':       s['label'],
                })
    else:
        for sid, s in active_streams.items():
            records.append({
                'slot':        None,
                'source':      s['source'],
                'source_type': s['source_type'],
                'label':       s['label'],
            })

    with _lock:
        try:
            with open(STREAM_STATE_FILE, 'w') as f:
                json.dump(records, f, indent=2)
        except Exception as e:
            print(f'[Velion] Could not save stream state: {e}', flush=True)


def load_streams() -> list[dict]:
    if not os.path.exists(STREAM_STATE_FILE):
        return []
    with _lock:
        try:
            with open(STREAM_STATE_FILE) as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
        except Exception as e:
            print(f'[Velion] Could not load stream state: {e}', flush=True)
    return []


def clear_streams():
    _ensure_dir()
    with _lock:
        try:
            with open(STREAM_STATE_FILE, 'w') as f:
                json.dump([], f)
        except Exception:
            pass