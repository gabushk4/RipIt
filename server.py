"""
Audio Batch Converter — Backend Flask
Requiert : pip install flask flask-cors
Requiert : ffmpeg installé sur le système
"""

import subprocess, tempfile, shutil, os, yt_dlp, queue, threading, sqlite3, uuid, json, sys
from pathlib import Path
from flask import Flask, request, send_file, jsonify, json, Response, stream_with_context
from flask_cors import CORS


app = Flask(__name__)
DB_FILE = "data/ripit.db"
progress_queues = {}
job_results = {}

CORS(app, expose_headers=["Content-Disposition"])  # Permet les requêtes depuis le frontend

# ── Config ────────────────────────────────────────────────────────────────────
SUPPORTED_INPUTS  = {'.flac', '.wav', '.aiff', '.ogg', '.m4a', '.mp3', '.aac', '.wma', '.opus', '.ape'}
SUPPORTED_OUTPUTS = {'mp3', 'flac', 'aac', 'ogg'}
SUPPORTED_BITRATES    = {'320k', '256k', '192k', '128k'}
SUPPORTED_SAMPLERATES = {'44100', '48000', '96000'}
SUPPORTED_CHANNELS    = {'1', '2'}

CODEC_MAP = {
    'mp3':  'libmp3lame',
    'flac': 'flac',
    'aac':  'aac',
    'ogg':  'libvorbis',
}


# ── Utils ─────────────────────────────────────────────────────────────────────
def check_ffmpeg():
    """Vérifie que FFmpeg est installé et accessible."""
    # Mode PyInstaller freezé
    if getattr(sys, 'frozen', False):
        name = 'ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg'
        path = os.path.join(sys._MEIPASS, name)
        if os.path.exists(path):
            return path
        raise EnvironmentError("FFmpeg introuvable dans l'application.")
    # Mode dev normal
    result = shutil.which('ffmpeg')
    if result is None:
        raise EnvironmentError("FFmpeg introuvable. Installe-le avec : brew install ffmpeg (Mac) | sudo apt install ffmpeg (Linux) | https://www.gyan.dev/ffmpeg/builds/ (Windows)")
    return result

def build_ffmpeg_cmd(input_path: str, output_path: str, fmt: str, bitrate: str, samplerate: str, channels: str) -> list:
    """Construit la commande FFmpeg."""
    codec = CODEC_MAP[fmt]
    cmd = [
        check_ffmpeg(),
        '-y',
        '-i', input_path,
        '-vn',
        '-ar', samplerate,
        '-ac', channels,
        '-c:a', codec,
    ]
    if fmt != 'flac':
        cmd += ['-b:a', bitrate]
    cmd.append(output_path)
    return cmd
def get_db():
    db = sqlite3.connect(DB_FILE) 
    db.row_factory = sqlite3.Row
    return db 

def init_db():
    with get_db() as db:
        cur = db.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS  history(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ytb_id TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ''')
        db.commit()

def download_worker(job_id, url, fmt, bitrate, samplerate, channels, output_dir):
    tmp_dir = tempfile.mkdtemp()
    try:
        raw_path = f"{tmp_dir}/downloaded.%(ext)s"

        def download_progress_hook(d):
            if d['status'] == 'downloading':
                progress_queues[job_id].put({
                    'phase': 'downloading',
                    'percent': d.get('_percent_str', '0%').strip(),
                    'speed': d.get('_speed_str', '').strip(),
                    'eta': d.get('_eta_str', '').strip(),
                })
            elif d['status'] == 'finished':
                progress_queues[job_id].put({
                    'phase': 'converting',
                    'percent': '0%',
                })


        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': raw_path,
            'quiet': True,
            'no_warnings': True,
            # On télécharge le fichier brut sans post-traitement yt-dlp,
            # on laisse FFmpeg faire la conversion ensuite
            'postprocessors': [],
            'progress_hooks':[download_progress_hook]
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get('title', 'audio')
            downloaded_ext = info.get('ext', 'webm')

        # Chemin réel du fichier téléchargé
        input_path = os.path.join(tmp_dir, f'downloaded.{downloaded_ext}')
        if not os.path.exists(input_path):
            return jsonify({'error': 'Fichier téléchargé introuvable'}), 500

        # Nom du fichier de sortie basé sur le titre de la vidéo
        safe_title = "".join(c for c in title if c.isalnum() or c in (' ', '-', '_')).strip()
        safe_title = safe_title[:100] or 'audio'
        output_filename = f"{safe_title}.{fmt}"
        output_path = os.path.join(tmp_dir, output_filename)

        # Conversion
        cmd = build_ffmpeg_cmd(input_path, output_path, fmt, bitrate, samplerate, channels)
        print(f"[FFmpeg] {' '.join(cmd)}")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600  # 10 min pour les longues vidéos
        )

        if result.returncode != 0:
            print(f"[FFmpeg ERROR] {result.stderr}")
            return jsonify({'error': f'FFmpeg a échoué : {result.stderr[-300:]}'}), 500

        # Copy in selected output
        try:
            os.makedirs(output_dir, exist_ok=True)
            dest = os.path.join(output_dir, output_filename)
            shutil.copy2(output_path, dest)
            print(f"[Saved] {dest}")
        except Exception as e:
            print(f"[Warning] Impossible de sauvegarder dans {output_dir} : {e}")
            return jsonify({"error": f"[Warning] Impossible de sauvegarder dans {output_dir} : {e}"}), 500

        # Insert into downloaded videos history
        try:
            with get_db() as db:
                cur = db.cursor()
                cur.execute('''
                    INSERT INTO history (ytb_id, title)
                        VALUES (?, ?)
                        ON CONFLICT(ytb_id) DO UPDATE SET
                            downloaded_at = CURRENT_TIMESTAMP
                ''', [info.get("id"), info.get('title')])
                db.commit()
        except sqlite3.IntegrityError:
            # Video alr in history
            pass
        except sqlite3.Error as e:
            print(f"[DB ERROR] {e}")
            return jsonify({'error': f'Erreur à l\'insertion dans l\'historique : {str(e)}'}), 500

        job_results[job_id] = {
            'status': 'done',
            'path': output_path,
            'filename': output_filename,
            'fmt': fmt,
            'tmp_dir': tmp_dir  # pour cleanup après send_file
        }
        progress_queues[job_id].put({'phase': 'done', 'done': True})
    
    except Exception as e:
        job_results[job_id] = {'status': 'error', 'error': str(e)}
        progress_queues[job_id].put({'error': str(e), 'done': True})
        shutil.rmtree(tmp_dir, ignore_errors=True)

# ── Routes ────────────────────────────────────────────────────────────────────
@app.route('/health', methods=['GET'])
def health():
    """Vérifie que le backend et FFmpeg sont opérationnels."""
    try:
        ffmpeg_path = check_ffmpeg()
        version_result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True, text=True
        )
        version_line = version_result.stdout.split('\n')[0]
        return jsonify({'status': 'ok', 'ffmpeg': ffmpeg_path, 'version': version_line})
    except EnvironmentError as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


@app.route('/convert', methods=['POST'])
def convert():
    """
    Reçoit un fichier audio, le convertit avec FFmpeg, retourne le fichier converti.

    Form data attendu :
      - file        : fichier audio (multipart)
      - format      : mp3 | flac | aac | ogg
      - bitrate     : 320k | 256k | 192k | 128k
      - samplerate  : 44100 | 48000 | 96000
      - channels    : 1 | 2
      - output_dir  : (optionnel) chemin local pour sauvegarder en plus
    """

    # ── Validation du fichier ─────────────────────────────────────────────────
    if 'file' not in request.files:
        return jsonify({'error': 'Aucun fichier reçu'}), 400

    uploaded_file = request.files['file']
    if not uploaded_file.filename:
        return jsonify({'error': 'Nom de fichier vide'}), 400

    input_ext = Path(uploaded_file.filename).suffix.lower()
    if input_ext not in SUPPORTED_INPUTS:
        return jsonify({'error': f'Format d\'entrée non supporté : {input_ext}'}), 400

    # ── Validation des paramètres ─────────────────────────────────────────────
    fmt        = request.form.get('format', 'mp3')
    bitrate    = request.form.get('bitrate', '320k')
    samplerate = request.form.get('samplerate', '44100')
    channels   = request.form.get('channels', '2')
    output_dir = request.form.get('output_dir', '').strip()

    if fmt not in SUPPORTED_OUTPUTS:
        return jsonify({'error': f'Format de sortie non supporté : {fmt}'}), 400
    if bitrate not in SUPPORTED_BITRATES:
        return jsonify({'error': f'Bitrate non supporté : {bitrate}'}), 400
    if samplerate not in SUPPORTED_SAMPLERATES:
        return jsonify({'error': f'Sample rate non supporté : {samplerate}'}), 400
    if channels not in SUPPORTED_CHANNELS:
        return jsonify({'error': f'Canaux non supportés : {channels}'}), 400

    # ── Vérification FFmpeg ───────────────────────────────────────────────────
    try:
        check_ffmpeg()
    except EnvironmentError as e:
        return jsonify({'error': str(e)}), 500

    # ── Conversion ────────────────────────────────────────────────────────────
    tmp_dir = tempfile.mkdtemp()
    try:
        # Sauvegarde du fichier uploadé
        input_path = os.path.join(tmp_dir, 'input' + input_ext)
        uploaded_file.save(input_path)

        # Nom du fichier de sortie
        stem = Path(uploaded_file.filename).stem
        output_filename = f"{stem}.{fmt}"
        output_path = os.path.join(tmp_dir, output_filename)

        # Commande FFmpeg
        cmd = build_ffmpeg_cmd(input_path, output_path, fmt, bitrate, samplerate, channels)
        print(f"[FFmpeg] {' '.join(cmd)}")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 min max par fichier
        )

        if result.returncode != 0:
            print(f"[FFmpeg ERROR] {result.stderr}")
            return jsonify({'error': f'FFmpeg a échoué : {result.stderr[-300:]}'}), 500

        # ── Copie optionnelle dans output_dir ─────────────────────────────────
        if output_dir:
            try:
                os.makedirs(output_dir, exist_ok=True)
                dest = os.path.join(output_dir, output_filename)
                shutil.copy2(output_path, dest)
                print(f"[Saved] {dest}")
            except Exception as e:
                print(f"[Warning] Impossible de sauvegarder dans {output_dir} : {e}")

        # Retourne le fichier au navigateur
        return send_file(
            output_path,
            as_attachment=True,
            download_name=output_filename,
            mimetype=f'audio/{fmt}'
        )

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Timeout : le fichier est trop long ou le système est lent'}), 500
    except Exception as e:
        print(f"[ERROR] {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        # Nettoyage des fichiers temporaires
        shutil.rmtree(tmp_dir, ignore_errors=True)

@app.route('/download', methods=['POST'])
def download():
    """
    Télécharge l'audio d'une URL YouTube et le convertit avec FFmpeg.

    Form data attendu :
      - url        : URL YouTube (ou autre source supportée par yt-dlp)
      - format     : mp3 | flac | aac | ogg
      - bitrate    : 320k | 256k | 192k | 128k
      - samplerate : 44100 | 48000 | 96000
      - channels   : 1 | 2
      - output_dir : (optionnel) chemin local pour sauvegarder en plus
    """

    # URL validation
    url = request.form.get('url', '').strip() # youtube.com/watch?v=...
    if not url:
        return jsonify({'error': 'Aucune URL fournie'}), 400

    # Params validation
    fmt        = request.form.get('format', 'mp3')
    bitrate    = request.form.get('bitrate', '320k')
    samplerate = request.form.get('samplerate', '44100')
    channels   = request.form.get('channels', '2')
    output_dir = request.form.get('output_dir', '').strip()

    if fmt not in SUPPORTED_OUTPUTS:
        return jsonify({'error': f'Format de sortie non supporté : {fmt}'}), 400
    if bitrate not in SUPPORTED_BITRATES:
        return jsonify({'error': f'Bitrate non supporté : {bitrate}'}), 400
    if samplerate not in SUPPORTED_SAMPLERATES:
        return jsonify({'error': f'Sample rate non supporté : {samplerate}'}), 400
    if channels not in SUPPORTED_CHANNELS:
        return jsonify({'error': f'Canaux non supportés : {channels}'}), 400

    # Checks if FFMPEG exists on local machine
    try:
        check_ffmpeg()
    except EnvironmentError as e:
        return jsonify({'error': str(e)}), 500

    # Download
    job_id = str(uuid.uuid4())
    progress_queues[job_id] = queue.Queue()
    try:    
        thread = threading.Thread(target=download_worker, args=(job_id, url, fmt, bitrate, samplerate, channels, output_dir))
        thread.start()    
        return jsonify({'job_id': job_id}), 200    
    except Exception as e:
        return jsonify({f"Erreur a l'initialisation du téléchargement: {e}"}), 500

@app.route('/info', methods=['POST'])
def video_info():
    """
    Retourne les métadonnées d'une URL (titre, durée, miniature, etc.)
    
    Form data attendu :
      - url : URL YouTube
    """
    print('info requested')
    url = request.form.get('url', '').strip()
    if not url:
        return jsonify({'error': 'Aucune URL fournie'}), 400

    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'noplaylist': True,
            'socket_timeout' : 10,
            'retries': 3
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        return jsonify({
            'title':     info.get('title'),
            'duration':  info.get('duration'),      # en secondes
            'thumbnail': info.get('thumbnail'),     # URL de la miniature
            'uploader':  info.get('uploader'),
        })

    except yt_dlp.utils.DownloadError as e:
        return jsonify({'error': f'URL invalide ou inaccessible : {str(e)}'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/history', methods=['GET'])
def history():
    """Returns the history of downloaded videos saved in a local SqLite DB."""

    try:
        with get_db() as db:
            cur = db.cursor()
            rows = cur.execute('''
                SELECT * FROM history
            ''').fetchall()

            return jsonify({
                'history': [dict(row) for row in rows]
            })

    except sqlite3.Error as e:
        return jsonify({'error': str(e)}), 500


@app.route('/progress/<job_id>')
def progress(job_id):
    def stream():
        q = progress_queues.get(job_id)
        if not q:
            return
        while True:
            data = q.get()
            yield f"data: {json.dumps(data)}\n\n"
            if data.get('done'):
                break
    return Response(stream_with_context(stream()), mimetype='text/event-stream')

@app.route('/result/<job_id>')
def result(job_id):
    job = job_results.get(job_id)
    if not job:
        return jsonify({'error': 'Job introuvable'}), 404
    if job['status'] == 'error':        
        return jsonify({'error': job['error']}), 500
    
    def cleanup():
        shutil.rmtree(job.get('tmp_dir', ''), ignore_errors=True)
        del job_results[job_id]

    # Cleanup après envoi
    threading.Timer(5, cleanup).start()
    return jsonify({'status': 'done', 'filename': job['filename']})

# ── Point d'entrée ────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 50)
    print("  RipIt — Backend")
    print("  http://localhost:5000")
    print("=" * 50)

    try:
        ffmpeg = check_ffmpeg()
        print(f"  FFmpeg trouvé : {ffmpeg}")
    except EnvironmentError as e:
        print(f"  AVERTISSEMENT : {e}")

    init_db()

    print("=" * 50)
    app.run(debug=True, port=5000, use_reloader=False)
