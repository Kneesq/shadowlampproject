"""
server.py — Flask API (v2 manifold pipeline)

GET  /                → static/index.html
POST /api/generate    → 接收图片+参数, 返回 watertight STL
"""

import os, time, tempfile
import numpy as np
from PIL import Image
from flask import Flask, request, jsonify, send_from_directory

from shadow_lamp_v2 import (
    load_and_binarize, extract_profile,
    build_cylinder_mask, build_manifold_mesh, smooth_and_decimate,
    export_3mf
)

app = Flask(__name__, static_folder='static', static_url_path='')


@app.route('/')
def index():
    return app.send_static_file('index.html')


@app.route('/api/download/<filename>')
def download_stl(filename):
    path = os.path.join(app.static_folder, filename)
    if os.path.exists(path):
        return send_from_directory(
            app.static_folder, filename,
            as_attachment=True, download_name='shadow_lamp.stl',
            mimetype='application/octet-stream')
    return "Not Found", 404


@app.route('/api/generate', methods=['POST'])
def generate():
    if 'image' not in request.files:
        return jsonify(error='No image uploaded'), 400

    f = request.files['image']
    radius     = float(request.form.get('radius', 50))
    h_slider   = float(request.form.get('height', 100))
    height     = 0.1 if h_slider == 0 else h_slider
    thickness  = float(request.form.get('thickness', 2))
    base_thickness = float(request.form.get('base_thickness', 5))
    shadow_size = float(request.form.get('shadow_size', 300))
    resolution = int(request.form.get('resolution', 200))
    threshold  = int(request.form.get('threshold', 128))
    target_faces = int(request.form.get('target_faces', 300000))
    invert     = request.form.get('invert', 'false').lower() == 'true'
    base_shape = request.form.get('base_shape', 'circle')
    proj_mode  = request.form.get('proj_mode', 'floor')
    bulb_height = float(request.form.get('bulb_height', 50.0))
    keep_upper_shell = request.form.get('keep_upper_shell', 'false').lower() == 'true'
    upper_shell_height = float(request.form.get('upper_shell_height', 15.0))
    with_bottom = request.form.get('with_bottom', 'true').lower() == 'true'
    bottom_hole_diam = float(request.form.get('bottom_hole_diam', 30))
    bottom_thickness = float(request.form.get('bottom_thickness', 3))

    # Custom shape radii (360 normalized floats) — used by both 'custom' and 'match_pattern'
    custom_shape_radii = None
    if base_shape in ('custom', 'match_pattern'):
        raw = request.form.get('custom_shape_radii', '')
        if raw:
            import json
            custom_shape_radii = np.array(json.loads(raw), dtype=np.float64)

    shell_shape = request.form.get('shell_shape', 'cylinder')
    with_top_hook = request.form.get('with_top_hook', 'false').lower() == 'true'
    support_count = int(request.form.get('support_count', 0))
    support_width = float(request.form.get('support_width', 4.0))

    # Lithophane Relief
    litho_gray = None
    litho_min_thick = float(request.form.get('litho_min_thick', 1.2))
    litho_max_thick = float(request.form.get('litho_max_thick', 3.0))
    litho_repeat = int(request.form.get('litho_repeat', 1))
    litho_invert = request.form.get('litho_invert', 'false').lower() == 'true'
    litho_width_scale = float(request.form.get('litho_width_scale', 100.0)) / 100.0
    litho_height_scale = float(request.form.get('litho_height_scale', 100.0)) / 100.0
    litho_offset = float(request.form.get('litho_offset', 0.0))

    if 'litho_image' in request.files and request.files['litho_image'].filename:
        tmp_l = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        request.files['litho_image'].save(tmp_l.name)
        tmp_l.close()
        img = Image.open(tmp_l.name).convert('L')
        litho_gray = np.array(img, dtype=np.uint8)
        os.unlink(tmp_l.name)

    tmp_img = tempfile.NamedTemporaryFile(suffix='.png', delete=False)

    try:
        f.save(tmp_img.name)
        tmp_img.close()

        binary = load_and_binarize(tmp_img.name, threshold, invert)

        # Profile
        profile = None
        if 'profile' in request.files and request.files['profile'].filename:
            tmp_p = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
            request.files['profile'].save(tmp_p.name)
            tmp_p.close()
            profile = extract_profile(tmp_p.name, resolution, radius, threshold)
            os.unlink(tmp_p.name)
        elif request.form.get('pattern_profile'):
            import json
            prof_arr = np.array(json.loads(request.form.get('pattern_profile')), dtype=np.float64)
            src = np.arange(len(prof_arr))
            dst = np.linspace(0, len(prof_arr) - 1, resolution + 1)
            profile = np.interp(dst, src, prof_arr) * radius
            profile = np.maximum(profile, 1.0)

        # Total height: lower body (height) + upper hood (upper_shell_height)
        has_upper_hood = keep_upper_shell or shell_shape == 'lantern'
        total_height = height + (upper_shell_height if has_upper_hood else 0.0)
        z_cutoff = total_height if has_upper_hood else bulb_height

        # Mask (use lower res for mask → faster voxelization)
        mask_res = min(resolution, 400)
        mask = build_cylinder_mask(
            binary, n_phi=mask_res, n_z=mask_res,
            R=radius, H=total_height, shadow_size=shadow_size,
            bulb_height=bulb_height,
            projection_mode=proj_mode, base_shape=base_shape,
            keep_upper_shell=has_upper_hood,
            upper_shell_height=upper_shell_height,
            custom_shape_radii=custom_shape_radii,
            support_count=support_count,
            support_width=support_width)

        # Manifold mesh
        mesh = build_manifold_mesh(
            mask, R=radius, thickness=thickness,
            H=total_height, base_thickness=bottom_thickness if with_bottom else 0,
            bottom_hole_diam=bottom_hole_diam if with_bottom else 0,
            profile_radii=profile, base_shape=base_shape,
            z_cutoff=z_cutoff,
            custom_shape_radii=custom_shape_radii,
            with_top_hook=with_top_hook,
            litho_gray=litho_gray, litho_min_thick=litho_min_thick,
            litho_max_thick=litho_max_thick, litho_repeat=litho_repeat,
            litho_invert=litho_invert, lower_body_height=height,
            litho_width_scale=litho_width_scale,
            litho_height_scale=litho_height_scale,
            litho_offset=litho_offset)

        mesh = smooth_and_decimate(mesh, target_faces=target_faces)

        # Export STL
        filename = f"shadow_lamp_{int(time.time())}.stl"
        out_path = os.path.join(app.static_folder, filename)
        mesh.export(out_path)

        return jsonify(url=f"/api/download/{filename}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(error=str(e)), 500
    finally:
        os.unlink(tmp_img.name)


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
