import os
import time
import threading
import uuid
import cv2

from config import STREAM_INTERVAL, STREAM_JPEG_Q, EXPORT_FOLDER
from detection import draw_detections, remove_accident_state, get_accident_state
import settings_store

# JOB REGISTRY
# ─────────────────────────────────────────────────────────────────────
analysis_jobs = {}
jobs_lock     = threading.Lock()

# HELPERS
# ─────────────────────────────────────────────────────────────────────
def is_stopped(job_id):
    with jobs_lock:
        job = analysis_jobs.get(job_id)
        return job is None or job.get('state') == 'stopped'

# ANALYSIS WORKER THREAD
# ─────────────────────────────────────────────────────────────────────
def run_analysis(job_id):
    with jobs_lock:
        job = analysis_jobs.get(job_id)
    if not job:
        return

    cap = cv2.VideoCapture(job['path'])
    if not cap.isOpened():
        with jobs_lock:
            if job_id in analysis_jobs:
                analysis_jobs[job_id]['state'] = 'error'
        return

    fps          = cap.get(cv2.CAP_PROP_FPS) or 25
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    os.makedirs(EXPORT_FOLDER, exist_ok=True)
    export_filename = f'analyzed_{job_id}.mp4'
    export_path     = os.path.join(EXPORT_FOLDER, export_filename)
    fourcc          = cv2.VideoWriter_fourcc(*'mp4v')
    writer          = cv2.VideoWriter(export_path, fourcc, fps, (854, 480))

    with jobs_lock:
        if job_id in analysis_jobs:
            analysis_jobs[job_id].update({
                'cap': cap, 'fps': fps, 'total_frames': total_frames,
                'export_path': export_path, 'export_filename': export_filename,
                'incident_count': 0, 'export_ready': False,
            })

    tracker_key      = f'job_{job_id}'
    frame_idx        = 0
    last_stream_push = 0.0

    while True:
        with jobs_lock:
            if job_id not in analysis_jobs:
                break
            state_val = analysis_jobs[job_id]['state']
            seek_to   = analysis_jobs[job_id].get('seek_to')
            if seek_to is not None:
                cap.set(cv2.CAP_PROP_POS_FRAMES, seek_to)
                analysis_jobs[job_id]['seek_to'] = None
                frame_idx = seek_to
                get_accident_state(tracker_key).reset_streak()

        if state_val == 'stopped':
            break
        if state_val == 'paused':
            time.sleep(0.05)
            continue

        ok, frame = cap.read()
        if not ok:
            break

        frame_idx += 1
        frame = cv2.resize(frame, (854, 480))

        if is_stopped(job_id):
            break

        frame, new_incident, _counts = draw_detections(frame, tracker_key)

        if is_stopped(job_id):
            break

        writer.write(frame)

        now        = time.time()
        push_frame = (now - last_stream_push) >= STREAM_INTERVAL

        with jobs_lock:
            if job_id not in analysis_jobs:
                break
            if analysis_jobs[job_id]['state'] == 'stopped':
                break
            if analysis_jobs[job_id]['process_start_time'] is None:
                analysis_jobs[job_id]['process_start_time'] = now

            if new_incident:
                analysis_jobs[job_id]['incident_count'] += 1
            analysis_jobs[job_id]['current_frame'] = frame_idx
            if push_frame:
                _, buf = cv2.imencode('.jpg', frame,
                                      [cv2.IMWRITE_JPEG_QUALITY, STREAM_JPEG_Q])
                analysis_jobs[job_id]['frame'] = buf.tobytes()

        if push_frame:
            last_stream_push = now

    writer.release()
    cap.release()
    remove_accident_state(tracker_key)

    with jobs_lock:
        if job_id in analysis_jobs and analysis_jobs[job_id]['state'] != 'stopped':
            analysis_jobs[job_id]['state']        = 'done'
            analysis_jobs[job_id]['export_ready'] = True
            settings_store.save_analysis_result(job_id, job)
            analysis_jobs[job_id]['process_end_time'] = time.time()

# MJPEG GENERATOR
# ─────────────────────────────────────────────────────────────────────
def mjpeg_generator(job_id):
    last_fb = None
    while True:
        with jobs_lock:
            job = analysis_jobs.get(job_id)
            if not job:
                break
            fb    = job.get('frame')
            state = job.get('state')

        if fb and fb is not last_fb:
            last_fb = fb
            yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + fb + b'\r\n'
        elif state in ('done', 'stopped', 'error'):
            break

        time.sleep(0.033)

# START JOB
# ─────────────────────────────────────────────────────────────────────
def start_analysis_job(video_path):
    job_id = str(uuid.uuid4())[:8]
    with jobs_lock:
        analysis_jobs[job_id] = {
            'path': video_path, 'filename': os.path.basename(video_path), 'state': 'running', 'frame': None,
            'seek_to': None, 'cap': None, 'total_frames': 0,
            'current_frame': 0, 'fps': 25, 'incident_count': 0,
            'export_ready': False, 'export_filename': None, 'export_path': None,
            'process_start_time': None, 'process_end_time': None,
        }
    t = threading.Thread(target=run_analysis, args=(job_id,), daemon=True)
    t.start()
    with jobs_lock:
        analysis_jobs[job_id]['thread'] = t
    return job_id