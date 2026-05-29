"""
Audio Batch Converter — Backend Flask
Requiert : pip install flask flask-cors
Requiert : ffmpeg installé sur le système
"""

import os
import subprocess
import tempfile
import shutil
from pathlib import Path
from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
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
    result = shutil.which('ffmpeg')
    if result is None:
        raise EnvironmentError("FFmpeg introuvable. Installe-le avec : brew install ffmpeg (Mac) ou sudo apt install ffmpeg (Linux)")
    return result


def build_ffmpeg_cmd(input_path: str, output_path: str, fmt: str, bitrate: str, samplerate: str, channels: str) -> list:
    """Construit la commande FFmpeg."""
    codec = CODEC_MAP[fmt]

    cmd = [
        'ffmpeg',
        '-y',              # overwrite sans demander
        '-i', input_path,
        '-vn',             # pas de vidéo
        '-ar', samplerate,
        '-ac', channels,
        '-c:a', codec,
    ]

    # Le FLAC est lossless, pas de bitrate
    if fmt != 'flac':
        cmd += ['-b:a', bitrate]

    cmd.append(output_path)
    return cmd


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

    # ── Validation de l'URL ───────────────────────────────────────────────────
    url = request.form.get('url', '').strip()
    if not url:
        return jsonify({'error': 'Aucune URL fournie'}), 400

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

    # ── Téléchargement + Conversion ───────────────────────────────────────────
    tmp_dir = tempfile.mkdtemp()
    try:
        raw_path = f"{tmp_dir}/downloaded.%(ext)s"

        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': raw_path,
            'quiet': True,
            'no_warnings': True,
            # On télécharge le fichier brut sans post-traitement yt-dlp,
            # on laisse FFmpeg faire la conversion ensuite
            'postprocessors': [],
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

        # Conversion via FFmpeg (réutilise ta fonction existante)
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

        # ── Copie optionnelle dans output_dir ─────────────────────────────────
        if output_dir:
            try:
                os.makedirs(output_dir, exist_ok=True)
                dest = os.path.join(output_dir, output_filename)
                shutil.copy2(output_path, dest)
                print(f"[Saved] {dest}")
            except Exception as e:
                print(f"[Warning] Impossible de sauvegarder dans {output_dir} : {e}")

        return send_file(
            output_path,
            as_attachment=True,
            download_name=output_filename,
            mimetype=f'audio/{fmt}'
        )

    except yt_dlp.utils.DownloadError as e:
        print(f"[yt-dlp ERROR] {e}")
        return jsonify({'error': f'Impossible de télécharger : {str(e)}'}), 400
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Timeout : la vidéo est trop longue ou le système est lent'}), 500
    except Exception as e:
        print(f"[ERROR] {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

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

# ── Point d'entrée ────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 50)
    print("  Audio Batch Converter — Backend")
    print("  http://localhost:5000")
    print("=" * 50)

    try:
        ffmpeg = check_ffmpeg()
        print(f"  FFmpeg trouvé : {ffmpeg}")
    except EnvironmentError as e:
        print(f"  AVERTISSEMENT : {e}")

    print("=" * 50)
    app.run(debug=True, port=5000)
