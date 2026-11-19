"""Local Flask frontend and printable Shadow Lamp mesh export."""

import json
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import numpy as np
from PIL import Image, UnidentifiedImageError
from flask import Flask, jsonify, request, send_from_directory

from shadow_lamp_v2 import (
    build_cylinder_mask, build_manifold_mesh, extract_profile,
    load_and_binarize, smooth_and_decimate, upper_shell_start,
)

app = Flask(__name__, static_folder='static', static_url_path='')
_export_session = tempfile.TemporaryDirectory(prefix='shadow-lamp-exports-', ignore_cleanup_errors=True)
_export_dir = Path(_export_session.name)
_download_lifetime = 24 * 60 * 60


@app.get('/')
def index():
    return app.send_static_file('index.html')


@app.get('/api/download/<filename>')
def download_stl(filename):
    if not filename.startswith('shadow_lamp_') or not filename.endswith('.stl'):
        return 'Not Found', 404
    # Older versions saved downloads under static; their existing URLs still work.
    directory = _export_dir if (_export_dir / filename).is_file() else app.static_folder
    return send_from_directory(directory, filename, as_attachment=True,
                               download_name='shadow_lamp.stl', mimetype='model/stl')


def number(name, default, low, high, kind=float):
    value = kind(request.form.get(name, default))
    if not low <= value <= high:
        raise ValueError(f'{name} must be between {low} and {high}.')
    return value


def enabled(name, default=False):
    return request.form.get(name, str(default)).lower() == 'true'


def normalized_radii(name, size=None):
    values = np.asarray(json.loads(request.form[name]), dtype=np.float64)
    if (values.ndim != 1 or not 2 <= len(values) <= 16384 or
            (size and len(values) != size) or not np.isfinite(values).all()
            or np.any(values < 0) or np.any(values > 1.001)):
        raise ValueError(f'Invalid {name}.')
    return values


@app.post('/api/generate')
def generate():
    if 'image' not in request.files and 'silhouette_mask' not in request.files:
        return jsonify(error='No image uploaded'), 400
    try:
        radius = number('radius', 50, 1, 100)
        height = max(.1, number('height', 100, 0, 300))
        thickness = number('thickness', 2, .4, 10)
        resolution = number('resolution', 200, 16, 1600, int)
        shadow_size = number('shadow_size', 300, 1, 1000)
        threshold = number('threshold', 128, 0, 255, int)
        target_faces = number('target_faces', 300000, 100, 3000000, int)
        bulb_height = number('bulb_height', 50, 1, 300)
        upper_height = number('upper_shell_height', 15, 0, 200)
        base = number('bottom_thickness', 3, 0, 20) if enabled('with_bottom', True) else 0
        hole = number('bottom_hole_diam', 30, 0, 200)
        support_count = number('support_count', 0, 0, 16, int)
        support_width = number('support_width', 4, .1, 30)
        base_shape = request.form.get('base_shape', 'circle')
        mode = request.form.get('proj_mode', 'floor')
        if mode not in ('floor', 'wall'):
            raise ValueError('Unknown projection mode.')

        if 'silhouette_mask' in request.files:
            # The browser sends the exact cleaned coverage shown in the preview.
            with Image.open(request.files['silhouette_mask'].stream) as mask:
                mask.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                coverage = 1.0 - np.asarray(mask.convert('L'), dtype=np.float32) / 255
        else:
            coverage = load_and_binarize(request.files['image'].stream, threshold, enabled('invert'))

        profile = None
        if request.files.get('profile'):
            profile = extract_profile(request.files['profile'].stream, resolution, radius, threshold)
        elif request.form.get('pattern_profile'):
            values = normalized_radii('pattern_profile')
            profile = radius * np.maximum(.02, np.interp(
                np.linspace(0, 1, resolution+1), np.linspace(0, 1, len(values)), values))
        custom = None
        if base_shape in ('custom', 'match_pattern') and request.form.get('custom_shape_radii'):
            custom = np.maximum(.02, normalized_radii('custom_shape_radii', size=360))

        lantern = request.form.get('shell_shape') == 'lantern'
        hood = enabled('keep_upper_shell') or lantern
        total_height = height + (upper_height if hood else 0)
        litho = None
        if request.files.get('litho_image'):
            with Image.open(request.files['litho_image'].stream) as image:
                image.thumbnail((4096, 2048), Image.Resampling.LANCZOS)
                litho = np.asarray(image.convert('L'))
        t_min = number('litho_min_thick', 1.2, .4, 10)
        t_max = number('litho_max_thick', 3, .4, 10)
        if litho is not None and t_min > t_max:
            raise ValueError('Minimum relief thickness exceeds maximum thickness.')

        mask = build_cylinder_mask(
            coverage, resolution, resolution, radius, total_height, shadow_size,
            bulb_height=bulb_height, smooth_sigma=.65, projection_mode=mode,
            base_shape=base_shape, keep_upper_shell=hood, upper_shell_height=upper_height,
            custom_shape_radii=custom, support_count=support_count,
            support_width=support_width, profile_radii=profile, floor_offset=base)

        cutoff = total_height if hood or mode == 'wall' or support_count else min(bulb_height, total_height)
        mesh = build_manifold_mesh(
            mask, radius, thickness, total_height, base,
            bottom_hole_diam=hole, profile_radii=profile, base_shape=base_shape,
            z_cutoff=cutoff, custom_shape_radii=custom, with_top_hook=enabled('with_top_hook'),
            roof_height=(10 if lantern else 5) if hood else 0,
            litho_gray=litho, litho_min_thick=t_min, litho_max_thick=t_max,
            litho_repeat=number('litho_repeat', 1, 1, 16, int),
            litho_invert=enabled('litho_invert'),
            lower_body_height=upper_shell_start(height, bulb_height, mode) if hood else total_height,
            litho_width_scale=number('litho_width_scale', 100, 1, 500)/100,
            litho_height_scale=number('litho_height_scale', 100, 1, 500)/100,
            litho_offset=number('litho_offset', 0, -360, 360))
        mesh = smooth_and_decimate(mesh, target_faces=target_faces)
        filename = f'shadow_lamp_{uuid4().hex}.stl'
        expire_before = time.time() - _download_lifetime
        for old in _export_dir.glob('shadow_lamp_*.stl'):
            try:
                if old.stat().st_mtime < expire_before:
                    old.unlink()
            except (FileNotFoundError, PermissionError):
                # A concurrent request may have expired or may still be downloading it.
                continue
        mesh.export(_export_dir / filename)
        return jsonify(url=f'/api/download/{filename}')
    except (TypeError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        return jsonify(error=str(error)), 400


if __name__ == '__main__':
    import sys
    from werkzeug.serving import make_server

    httpd = make_server('127.0.0.1', 5000, app, threaded=True)
    if '--open' in sys.argv:
        import webbrowser
        webbrowser.open('http://127.0.0.1:5000/')
    print('Shadow Lamp is running at http://127.0.0.1:5000/', flush=True)
    httpd.serve_forever()
