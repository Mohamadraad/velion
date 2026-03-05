<div align="center">
  <img src="logo.svg" alt="Velion" width="600"/>
</div>

# Velion — AI Surveillance Platform

Velion is an intelligent surveillance platform that uses pluggable computer vision models (YOLO, ONNX) to monitor live camera streams and uploaded video footage for real-time event detection.

**Bring your own model. Velion handles the rest.**

---

## Features

- **Live stream monitoring** — connect IP cameras via RTSP/HTTP or USB cameras (auto-detected)
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
git clone https://github.com/Mohamadraad/velion.git
cd velion
```

### 2. Create a virtual environment
```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
```

### 3. Install dependencies

**CPU:**
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

**GPU (CUDA 11.8):**
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
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

### 2. Clone the repository
```bash
git clone https://github.com/Mohamadraad/velion.git
cd velion
```

### 3. Pick your version and start

> ⚠️ **CPU mode is slow.** Recommended only for testing or low-FPS use cases (1–2 streams max). For real deployments, use the GPU version.

**GPU (recommended):**
```bash
docker compose -f docker-compose.gpu.yml up -d --build
```
Requires an NVIDIA GPU + [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)

**CPU:**
```bash
docker compose -f docker-compose.cpu.yml up -d --build
```

Open **http://localhost:5000**. That's it.

### Useful Docker commands
```bash
# See live logs
docker compose -f docker-compose.gpu.yml logs -f

# Stop Velion
docker compose -f docker-compose.gpu.yml down

# Restart
docker compose -f docker-compose.gpu.yml restart

# Check if it's running
docker compose -f docker-compose.gpu.yml ps
```

---

## USB Camera Support

| Environment | USB cameras work? | Notes |
|---|---|---|
| `python app.py` on Linux | ✅ Yes | Native, no config needed |
| `python app.py` on Windows | ✅ Yes | Native, no config needed |
| `python app.py` on macOS | ✅ Yes | Native, no config needed |
| Docker on **Linux host** | ✅ Yes | `privileged: true` already set in compose files |
| Docker on **Windows** (Docker Desktop) | ⚠️ Extra step | See below |
| Docker on **macOS** | ❌ Not supported | macOS doesn't expose USB to Docker at all |

### Docker on Windows — USB camera setup

Docker Desktop on Windows runs inside a WSL2 Linux VM, so USB devices aren't visible by default. Use Microsoft's `usbipd` tool to forward your camera into WSL2:

```powershell
# 1. Install usbipd (run PowerShell as Administrator)
winget install usbipd

# 2. List USB devices to find your camera's BUSID
usbipd list

# 3. Bind and attach your camera (replace 2-4 with your actual BUSID)
usbipd bind --busid 2-4
usbipd attach --wsl --busid 2-4
```

Then restart the container — click **Scan Cameras** in the dashboard and your camera will appear.

> **Note:** You need to re-run `usbipd attach` every time you reboot or replug the camera.

### Alternative — use your camera as an IP stream

Apps like [DroidCam](https://www.dev47apps.com/) (Android/iOS) or [IP Webcam](https://play.google.com/store/apps/details?id=com.pas.webcam) expose any camera as an RTSP/HTTP stream. Use the **URL / RTSP** tab in Velion — works through Docker on any OS with no extra setup.

---

## Updating Velion (Docker)

When a new version is released, update with two commands:

```bash
git pull
docker compose -f docker-compose.gpu.yml up -d --build
```

Your data (models, recordings, uploads, settings) is stored in Docker named volumes and is **never wiped** during a rebuild. Only the application code gets updated.

### When do you need to rebuild?
| Change | Need rebuild? |
|--------|--------------|
| Pull new code (`git pull`) | Yes — `docker compose up -d --build` |
| Edit Python / HTML / JS files | Yes — `docker compose up -d --build` |
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
├── stream_manager.py       # Live RTSP/HTTP/USB stream workers
├── stream_persistence.py   # Save/restore stream config on restart
├── analysis_jobs.py        # Uploaded video analysis workers
├── recorder.py             # Per-camera recording with segment rotation
├── settings_store.py       # Persistent settings & model metadata
├── utils.py                # File and URL validation helpers
├── templates/
│   ├── base.html           # Shared layout & sidebar
│   ├── index.html          # Overview / landing page
│   ├── dashboard.html      # Live monitor (camera grid)
│   ├── upload.html         # Video upload & analysis
│   ├── models.html         # Model management & settings
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
├── Dockerfile.gpu
├── Dockerfile.cpu
├── docker-compose.gpu.yml
├── docker-compose.cpu.yml
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

Runtime settings (confidence, resolution, retention days, etc.) are also configurable through the Settings UI and saved to `data/settings.json`.

---

## Supported Model Formats

| Format | Support |
|--------|---------|
| YOLOv8 / v9 / v10 (Ultralytics `.pt`) | ✅ Full |
| YOLOv5 old-style `.pt` | ✅ Via pickle fallback |
| ONNX (with metadata) | ✅ Full |
| YAML sidecar (`.yaml` next to `.pt`) | ✅ Fallback |

Upload models via the **Models** page. Velion auto-detects class names. If detection fails (older custom models), you can enter class names manually in the UI.

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

Built by [Mohamad Raad](https://github.com/Mohamadraad)

---

## License

MIT