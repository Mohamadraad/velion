# Velion — AI Surveillance Platform

Velion is an intelligent surveillance platform that uses pluggable computer vision models (YOLO, ONNX) to monitor live camera streams and uploaded video footage for real-time event detection.

**Bring your own model. Velion handles the rest.**

---

## Features

- **Live stream monitoring** — connect up to 4 IP cameras via RTSP/HTTP simultaneously
- **Video file analysis** — upload MP4, AVI, MOV, MKV files up to 500MB for retrospective analysis
- **Pluggable AI models** — upload any YOLOv8/v9/v10, YOLOv5, or ONNX model; Velion auto-detects classes
- **Incident detection** — configurable confidence thresholds, cooldown periods, and alert hold frames
- **Per-camera recording** — automatic 1-hour segment rotation with configurable retention
- **Stream persistence** — cameras reconnect automatically on restart, preserving their slot positions
- **Analytics dashboard** — per-stream incident counts, detection class breakdowns
- **Security headers** — CSP, X-Frame-Options, nosniff out of the box

**Use cases:** Road accidents · Construction safety · PPE compliance · Patient falls · Theft detection · Fire & smoke · Crowd monitoring · Any YOLO model

---

## Quick Start (without Docker)

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/velion.git
cd velion
```

### 2. Create a virtual environment
```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

### 4. Run the app
```bash
python app.py
```

Open **http://localhost:5000** in your browser.

---

## Quick Start (with Docker) — Recommended

Docker is the easiest way to run Velion. Everything is pre-configured — you don't need Python or any libraries installed.

### 1. Install Docker
Download from [https://docs.docker.com/get-docker/](https://docs.docker.com/get-docker/)

### 2. Clone and start
```bash
git clone https://github.com/YOUR_USERNAME/velion.git
cd velion
docker compose up -d
```

Open **http://localhost:5000**. That's it.

### Useful Docker commands
```bash
# See live logs
docker compose logs -f

# Stop Velion
docker compose down

# Restart
docker compose restart

# Check if it's running
docker compose ps
```

---

## Updating Velion (Docker)

When you change code or add new features, update with **two commands**:

```bash
# 1. Pull latest code (or just edit your files locally)
git pull

# 2. Rebuild the image and restart the container
docker compose up -d --build
```

Your data (models, recordings, uploads, settings) lives in folders on your **host machine** (`./models`, `./recordings`, etc.) — they are mounted as volumes and **never wiped** during a rebuild. Only the application code gets updated.

### When do you need to rebuild?
| Change | Need rebuild? |
|--------|--------------|
| Edit Python files (`.py`) | Yes — `docker compose up -d --build` |
| Edit HTML/JS/CSS templates | Yes — `docker compose up -d --build` |
| Add a new pip package to `requirements.txt` | Yes — `docker compose up -d --build` |
| Upload a new AI model via the UI | **No** — volumes are live |
| Change settings in the UI | **No** — saved to `data/` volume |
| Add/remove cameras in the UI | **No** — saved to `data/` volume |

---

## Project Structure

```
velion/
├── app.py                  # Flask app, all API routes
├── config.py               # All constants and thresholds
├── detection.py            # Model loading + inference engine
├── stream_manager.py       # Live RTSP/HTTP stream workers
├── stream_persistence.py   # Save/restore stream config on restart
├── analysis_jobs.py        # Uploaded video analysis workers
├── recorder.py             # Per-camera recording with segment rotation
├── settings_store.py       # Persistent settings & model metadata
├── templates/
│   ├── base.html           # Shared layout & sidebar
│   ├── index.html          # Overview / landing page
│   ├── dashboard.html      # Live monitor (4-camera grid)
│   ├── upload.html         # Video upload & analysis
│   ├── models.html         # Model management
│   ├── recordings.html     # Recording browser
│   ├── analytics.html      # Analytics dashboard
│   └── 404.html
├── static/
│   ├── css/
│   └── js/
├── models/                 # User-uploaded AI models (gitignored)
├── uploads/                # Temporary video uploads (gitignored)
├── exports/                # Annotated video exports (gitignored)
├── recordings/             # Camera recordings (gitignored)
├── data/                   # App state & settings (gitignored)
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

---

## Configuration

Key settings are in `config.py`:

| Constant | Default | Description |
|----------|---------|-------------|
| `GENERAL_CONF` | 0.40 | Detection confidence threshold |
| `CONFIRM_FRAMES` | 4 | Frames to confirm an incident |
| `INCIDENT_COOLDOWN_SEC` | 900 | Cooldown between same-source alerts (15 min) |
| `STREAM_FPS` | 15 | Streaming frame rate |
| `MAX_CONTENT_LENGTH` | 500 MB | Max upload size |

Runtime settings (confidence, retention days, etc.) are also configurable through the Settings UI and saved to `data/settings.json`.

---

## Supported Model Formats

| Format | Support |
|--------|---------|
| YOLOv8 / v9 / v10 (Ultralytics `.pt`) | ✅ Full |
| YOLOv5 old-style `.pt` | ✅ Via pickle fallback |
| ONNX (with metadata) | ✅ Full |
| YAML sidecar (`.yaml` next to `.pt`) | ✅ Fallback |

Upload models via the **Models** page. Velion auto-detects class names.

---

## GPU Support

By default Velion runs on CPU. For GPU inference:

1. Uncomment the `nvidia` deploy block in `docker-compose.yml`
2. Swap the base image in `Dockerfile` to the CUDA image (instructions in the file)
3. Install [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
4. Rebuild: `docker compose up -d --build`

---

## Roadmap / Planned Features

- [ ] WebSocket-based real-time alerts (replace polling)
- [ ] Email / webhook notifications on incidents
- [ ] Multi-user authentication
- [ ] Cloud storage integration for recordings
- [ ] More analytics: heatmaps, timeline views
- [ ] Mobile-responsive UI improvements

---

## Author

Built by [Mohamad Raad](https://github.com/YOUR_USERNAME)

---

## License

MIT
