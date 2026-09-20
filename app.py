import os
import uuid
import threading
from flask import Flask, request, jsonify, send_file, render_template, after_this_request
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
CORS(app)

DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), 'downloads')
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# ─── Progress tracking store ────────────────────────────────────────────────
progress_store = {}


def make_progress_hook(job_id):
    def hook(d):
        if d['status'] == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
            downloaded = d.get('downloaded_bytes', 0)
            pct = int(downloaded / total * 100) if total else 0
            speed = d.get('_speed_str', '—')
            eta = d.get('_eta_str', '—')
            progress_store[job_id] = {
                'status': 'downloading',
                'percent': pct,
                'speed': speed,
                'eta': eta,
            }
        elif d['status'] == 'finished':
            progress_store[job_id] = {'status': 'processing', 'percent': 99}
    return hook


# ─── Routes ─────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/info', methods=['POST'])
def info():
    """Fetch video metadata without downloading."""
    data = request.get_json(silent=True) or {}
    url = (data.get('url') or '').strip()
    if not url:
        return jsonify({'error': 'No URL provided.'}), 400

    ydl_opts = {'quiet': True, 'no_warnings': True, 'skip_download': True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=False)
        duration_sec = info_dict.get('duration', 0)
        minutes, seconds = divmod(duration_sec, 60)
        return jsonify({
            'title':     info_dict.get('title', 'Unknown Title'),
            'thumbnail': info_dict.get('thumbnail', ''),
            'duration':  f'{int(minutes)}:{int(seconds):02d}',
            'uploader':  info_dict.get('uploader', ''),
            'platform':  info_dict.get('extractor_key', ''),
            'view_count': info_dict.get('view_count', 0),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/download', methods=['POST'])
def download():
    """Download video/audio and stream the file back to the client."""
    data = request.get_json(silent=True) or {}
    url    = (data.get('url') or '').strip()
    fmt    = data.get('format', 'mp4').lower()   # mp4 | mp3 | webm
    quality = data.get('quality', '1080')         # 2160 | 1080 | 720 | 480 | 360

    if not url:
        return jsonify({'error': 'No URL provided.'}), 400

    job_id   = str(uuid.uuid4())
    out_path = os.path.join(DOWNLOAD_DIR, f'{job_id}.%(ext)s')
    progress_store[job_id] = {'status': 'starting', 'percent': 0}

    # ── Build yt-dlp options ────────────────────────────────────────────────
    if fmt == 'mp3':
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': out_path,
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [make_progress_hook(job_id)],
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        }
    elif fmt == 'webm':
        ydl_opts = {
            'format': f'bestvideo[height<={quality}][ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best',
            'outtmpl': out_path,
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [make_progress_hook(job_id)],
            'merge_output_format': 'webm',
        }
    else:  # mp4 (default)
        ydl_opts = {
            'format': f'bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<={quality}][ext=mp4]/best',
            'outtmpl': out_path,
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [make_progress_hook(job_id)],
            'merge_output_format': 'mp4',
        }

    # ── Download (blocking — okay for a private server / small traffic) ─────
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=True)
            title     = info_dict.get('title', 'video')
    except Exception as e:
        progress_store[job_id] = {'status': 'error', 'message': str(e)}
        return jsonify({'error': str(e)}), 400

    # ── Locate the output file ───────────────────────────────────────────────
    ext      = 'mp3' if fmt == 'mp3' else ('webm' if fmt == 'webm' else 'mp4')
    filepath = os.path.join(DOWNLOAD_DIR, f'{job_id}.{ext}')

    if not os.path.exists(filepath):
        # fallback: find any file matching the job_id
        for f in os.listdir(DOWNLOAD_DIR):
            if f.startswith(job_id):
                filepath = os.path.join(DOWNLOAD_DIR, f)
                ext = f.rsplit('.', 1)[-1]
                break

    if not os.path.exists(filepath):
        return jsonify({'error': 'Downloaded file not found on server.'}), 500

    progress_store[job_id] = {'status': 'done', 'percent': 100}

    safe_title = "".join(c for c in title if c.isalnum() or c in ' -_').strip()[:80]
    download_name = f'{safe_title}.{ext}'

    @after_this_request
    def cleanup(response):
        def _delete():
            try:
                os.remove(filepath)
            except Exception:
                pass
        threading.Timer(5, _delete).start()
        return response

    mime_map = {'mp4': 'video/mp4', 'mp3': 'audio/mpeg', 'webm': 'video/webm'}
    return send_file(
        filepath,
        mimetype=mime_map.get(ext, 'application/octet-stream'),
        as_attachment=True,
        download_name=download_name,
    )


@app.route('/progress/<job_id>')
def progress(job_id):
    return jsonify(progress_store.get(job_id, {'status': 'unknown'}))


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 8080)), debug=False)
