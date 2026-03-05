import os
import re
import urllib.parse
from config import ALLOWED_EXTENSIONS

VIDEO_EXT_RE  = re.compile(r'\.(mp4|avi|mov|mkv|webm)(\?|#|$)', re.IGNORECASE)
VIDEO_PATH_RE = re.compile(r'/(video|videos|media|stream|clip|footage)', re.IGNORECASE)


def allowed_file(fn):
    return '.' in fn and fn.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def allowed_video_url(url):
    try:
        p = urllib.parse.urlparse(url)
        if p.scheme not in ('http', 'https'):
            return False
        return bool(VIDEO_EXT_RE.search(p.path) or VIDEO_PATH_RE.search(p.path))
    except Exception:
        return False

def filename_from_url(url):
    path = urllib.parse.urlparse(url).path
    base = os.path.basename(path)
    base = re.sub(r'[?#].*$', '', base)
    base = re.sub(r'[^\w.\-]', '_', base)
    return base if base and '.' in base else 'video_from_url.mp4'

