"""
shadow_lamp_v2.py — Manifold Shadow Lamp Generator

Uses voxelization + marching cubes for guaranteed watertight mesh.
Replaces the per-cell triangle construction which caused non-manifold edges.

Features:
  ✓ Zero non-manifold edges (watertight)
  ✓ Adjustable base_thickness
  ✓ Smooth contour edges (Gaussian blur + bilinear interpolation)
  ✓ Adaptive quadric decimation (target 200k-400k faces)
  ✓ Laplacian surface smoothing
  ✓ Custom profile / polygon base shapes

Usage:
  python shadow_lamp_v2.py --image cat.png
  python shadow_lamp_v2.py --image logo.png --radius 50 --height 100 --base-thickness 8
  python shadow_lamp_v2.py --create-test-image && python shadow_lamp_v2.py --image test_star.png

Required:
  pip install numpy Pillow scipy scikit-image trimesh fast-simplification flask
"""

import argparse, os, sys, io, time
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter
from scipy.interpolate import RectBivariateSpline
from skimage.measure import marching_cubes
import trimesh

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


# ================================================================
# Image Processing
# ================================================================

def load_and_binarize(path, threshold=128, invert=False):
    """Load image (B&W, colored, or transparent PNG) → extract contour → binary mask.
    True = solid (shadow/opaque), False = hollow cutout (light passes through)."""
    img = Image.open(path)

    # 1. Check alpha transparency (去背/透明PNG：直接取整体轮廓，不辨别内部黑白色)
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        img_rgba = img.convert('RGBA')
        alpha = np.array(img_rgba.getchannel('A'), dtype=np.uint8)
        if np.any(alpha < 200) and np.any(alpha > 20):
            mask = alpha > 30
            if invert:
                mask = ~mask
            print(f"  Background-removed (Alpha) silhouette: {mask.shape[1]}x{mask.shape[0]} Solid: {mask.sum()/mask.size*100:.1f}%")
            return mask

    # 2. Check RGB color image (auto contour from background)
    img_rgb = img.convert('RGB')
    arr_rgb = np.array(img_rgb, dtype=np.float32)
    h, w, _ = arr_rgb.shape

    # Sample border pixels to detect background color
    borders = np.concatenate([
        arr_rgb[0, :, :], arr_rgb[h-1, :, :],
        arr_rgb[:, 0, :], arr_rgb[:, w-1, :]
    ], axis=0)
    bg_color = np.median(borders, axis=0)

    # Color distance from background
    color_dist = np.linalg.norm(arr_rgb - bg_color, axis=-1)
    max_dist = color_dist.max()

    # If substantial color/contrast variation exists from background
    if max_dist > 30.0:
        thresh_val = max(20.0, min(140.0, max_dist * (threshold / 255.0)))
        mask = color_dist >= thresh_val
        print(f"  Color contour binarized (bg={bg_color.round().astype(int)}): Solid: {mask.sum()/mask.size*100:.1f}%")
    else:
        # Fallback to standard grayscale threshold
        gray = np.array(img.convert('L'), dtype=np.uint8)
        mask = gray < threshold
        print(f"  Grayscale binarized: Solid: {mask.sum()/mask.size*100:.1f}%")

    if invert:
        mask = ~mask
    return mask


def extract_profile(image_path, n_z, max_radius, threshold=128):
    """Extract shell radius curve from side-view silhouette."""
    img = Image.open(image_path).convert('L')
    arr = np.array(img, dtype=np.uint8)
    solid = arr < threshold
    H_img, W_img = solid.shape
    cx = W_img // 2
    radii = np.zeros(H_img, dtype=float)
    for row in range(H_img):
        cols = np.where(solid[row])[0]
        if len(cols) > 0:
            radii[row] = np.max(np.abs(cols - cx))
    mx = radii.max()
    if mx > 0:
        radii = radii / mx * max_radius
    radii = radii[::-1]  # flip Y
    src = np.arange(len(radii))
    dst = np.linspace(0, len(radii) - 1, n_z + 1)
    profile = np.interp(dst, src, radii)
    profile = np.maximum(profile, 1.0)
    return profile


# ================================================================
# Ray Tracing → Smooth Float Mask
# ================================================================

def build_cylinder_mask(binary_image, n_phi, n_z, R, H, shadow_size,
                        bulb_height=50.0, smooth_sigma=1.5,
                        projection_mode='floor', base_shape='circle',
                        keep_upper_shell=True, upper_shell_height=15.0,
                        custom_shape_radii=None,
                        support_count=0, support_width=4.0):
    """
    Reverse ray-trace: shell surface → floor → image pixel.
    Returns smoothed float mask (n_z, n_phi) in [0, 1].
    Gaussian blur produces smooth iso-contours for marching cubes.
    custom_shape_radii: optional ndarray(360) of normalized per-angle radii.
    support_count: number of vertical support columns connecting base to top.
    """
    ImgH, ImgW = binary_image.shape
    h_light = bulb_height
    sw, sh = shadow_size, shadow_size * ImgH / ImgW

    z_c = (np.arange(n_z) + 0.5) / n_z * H
    phi_c = (np.arange(n_phi) + 0.5) / n_phi * 2 * np.pi
    Z, PHI = np.meshgrid(z_c, phi_c, indexing='ij')

    # Per-angle scale factor
    if custom_shape_radii is not None and len(custom_shape_radii) > 0:
        # Interpolate from 360-entry radii array
        angle_deg = (PHI * 180.0 / np.pi) % 360.0
        idx0 = np.floor(angle_deg).astype(int) % 360
        idx1 = (idx0 + 1) % 360
        frac = angle_deg - np.floor(angle_deg)
        scale = custom_shape_radii[idx0] * (1 - frac) + custom_shape_radii[idx1] * frac
    else:
        n_sides = {'triangle': 3, 'square': 4, 'pentagon': 5, 'hexagon': 6}.get(base_shape, 0)
        scale = np.ones_like(PHI)
        if n_sides >= 3:
            seg = 2 * np.pi / n_sides
            scale = 1.0 / np.cos(((PHI + seg / 2.0) % seg) - seg / 2.0)

    mask = np.zeros((n_z, n_phi), dtype=np.float64)

    if projection_mode == 'wall':
        u_f = PHI / (2 * np.pi) * ImgW
        v_f = (1.0 - Z / H) * ImgH
        u_i = np.clip(np.round(u_f).astype(int), 0, ImgW - 1)
        v_i = np.clip(np.round(v_f).astype(int), 0, ImgH - 1)
        mask = binary_image[v_i, u_i].astype(float)
    else:
        below = Z < (h_light - 1e-6)
        t = np.where(below, h_light / np.maximum(h_light - Z, 1e-9), 0.0)
        Rsc = R * scale
        xf, yf = Rsc * np.cos(PHI) * t, Rsc * np.sin(PHI) * t
        u = np.round((xf / sw + 0.5) * ImgW).astype(int)
        v = np.round((yf / sh + 0.5) * ImgH).astype(int)
        ok = below & (u >= 0) & (u < ImgW) & (v >= 0) & (v < ImgH)
        mask[ok] = binary_image[v[ok], u[ok]].astype(float)
        if keep_upper_shell:
            # Full solid upper lantern hood from bulb_height up to h_light + upper_shell_height
            solid_top_z = min(h_light + upper_shell_height, H)
            for i in range(n_z):
                if z_c[i] >= h_light - 1e-6:
                    mask[i, :] = 1.0 if z_c[i] < solid_top_z else 0.0
        else:
            # No upper shell: zero everything at or above h_light
            for i in range(n_z):
                if z_c[i] >= h_light - 1e-6:
                    mask[i, :] = 0.0

    # Support columns connecting base upward to top lantern roof
    if support_count > 0:
        angle_step = (2 * np.pi) / support_count
        for k in range(support_count):
            target_phi = k * angle_step
            diff = np.abs(phi_c - target_phi)
            diff = np.minimum(diff, 2 * np.pi - diff)
            col_indices = np.where(diff < (support_width / 2.0) / R)[0]
            if len(col_indices) > 0:
                mask[:, col_indices] = 1.0

    # Force bottom solid rings
    for row in range(min(3, n_z)):
        mask[row, :] = 1.0

    # Gaussian blur (periodic in phi)
    pad = max(2, int(smooth_sigma * 3))
    padded = np.concatenate([mask[:, -pad:], mask, mask[:, :pad]], axis=1)
    blurred = gaussian_filter(padded, sigma=smooth_sigma)
    mask_out = blurred[:, pad:-pad]

    # Re-enforce cutoff after blur
    if projection_mode != 'wall':
        for i in range(n_z):
            if z_c[i] >= h_light - 1e-6:
                if keep_upper_shell:
                    solid_top_z = min(h_light + upper_shell_height, H)
                    mask_out[i, :] = 1.0 if z_c[i] < solid_top_z else 0.0
                else:
                    mask_out[i, :] = 0.0

    s = (mask_out > 0.5).sum()
    print(f"  Mask: {n_z}x{n_phi}  Solid: {s}/{mask_out.size}")
    return mask_out


# ================================================================
# Voxelize + Marching Cubes → Manifold Mesh
# ================================================================

def build_manifold_mesh(mask_smooth, R, thickness, H, base_thickness,
                        voxel_size=None, profile_radii=None,
                        base_shape='circle', bottom_hole_diam=0,
                        z_cutoff=None, custom_shape_radii=None,
                        with_top_hook=False,
                        litho_gray=None, litho_min_thick=0.8,
                        litho_max_thick=2.8, litho_repeat=1,
                        litho_invert=False, lower_body_height=None,
                        litho_width_scale=1.0, litho_height_scale=1.0,
                        litho_offset=0.0):
    """
    Voxelize shell+base, then marching cubes → guaranteed manifold.
    Processes z-slices for memory efficiency.
    Smooth mask values [0,1] produce smooth iso-contours at hole edges.
    z_cutoff: if set, slice off all geometry above this Z height.
    custom_shape_radii: optional ndarray(360) of normalized per-angle radii.
    with_top_hook: if True, adds a 3D hanging hook loop at the top apex.
    litho_gray: optional 2D ndarray grayscale image for 360° lithophane relief.
    """
    min_wall_t = litho_min_thick if litho_gray is not None else thickness
    if voxel_size is None:
        if litho_gray is not None:
            # Fine voxel step for lithophane relief to prevent thin wall pinching & capture sharp details
            voxel_size = round(max(0.32, min(0.42, min_wall_t / 2.0)), 2)
        else:
            voxel_size = round(max(0.4, min(1.0, thickness / 3.0)), 2)

    n_z_mask, n_phi_mask = mask_smooth.shape

    # Per-angle scale: custom shape or polygon
    use_custom = custom_shape_radii is not None and len(custom_shape_radii) > 0
    n_sides = {'triangle': 3, 'square': 4, 'pentagon': 5, 'hexagon': 6}.get(base_shape, 0)
    if use_custom:
        custom_radii_arr = np.asarray(custom_shape_radii, dtype=np.float64)
    else:
        custom_radii_arr = None

    if lower_body_height is None:
        lower_body_height = H

    # Bounding box
    max_R = R * 1.5 if (use_custom or n_sides >= 3) else R
    if litho_gray is not None:
        max_R += litho_max_thick
    margin = max_R + thickness + voxel_size * 2
    x = np.arange(-margin, margin, voxel_size, dtype=np.float32)
    y = np.arange(-margin, margin, voxel_size, dtype=np.float32)
    z_min = -base_thickness if base_thickness > 0 else 0.0
    # Pad 1 voxel below z_min and 2 voxels above H so marching cubes closes rims cleanly into a watertight solid
    z = np.arange(z_min - voxel_size, H + voxel_size * 2, voxel_size, dtype=np.float32)

    nx, ny, nz = len(x), len(y), len(z)
    print(f"  Voxel: {nx}x{ny}x{nz} = {nx*ny*nz/1e6:.1f}M "
          f"(step={voxel_size:.2f}mm, ~{nx*ny*nz*4/1024**2:.0f}MB)")

    # 2D coordinate grid (X, Y)
    X2D, Y2D = np.meshgrid(x, y, indexing='ij')
    r_2d = np.hypot(X2D, Y2D)
    phi_2d = np.arctan2(Y2D, X2D) % (2 * np.pi)

    # Compute scale factor for each 2D point based on its phi angle
    if use_custom:
        angle_deg = (phi_2d * 180.0 / np.pi) % 360.0
        idx0 = np.floor(angle_deg).astype(int) % 360
        idx1 = (idx0 + 1) % 360
        frac = angle_deg - np.floor(angle_deg)
        scale_2d = custom_radii_arr[idx0] * (1 - frac) + custom_radii_arr[idx1] * frac
    elif n_sides >= 3:
        segment = 2 * np.pi / n_sides
        theta = ((phi_2d + segment / 2.0) % segment) - segment / 2.0
        scale_2d = 1.0 / np.cos(theta)
    else:
        scale_2d = np.ones_like(phi_2d)

    # Canonical radius: distance divided by shape scale factor
    r_canonical_2d = r_2d / np.maximum(scale_2d, 1e-6)

    # Profile interpolation along Z
    if profile_radii is not None:
        prof_z = np.linspace(0, H, len(profile_radii))

    # Mask interpolator (bilinear, periodic phi via padding)
    zc = (np.arange(n_z_mask) + 0.5) / n_z_mask * H
    pc = (np.arange(n_phi_mask) + 0.5) / n_phi_mask * 2 * np.pi
    pad = 3
    mask_pad = np.concatenate(
        [mask_smooth[:, -pad:], mask_smooth, mask_smooth[:, :pad]], axis=1)
    phi_pad = np.concatenate(
        [pc[-pad:] - 2 * np.pi, pc, pc[:pad] + 2 * np.pi])
    interp = RectBivariateSpline(zc, phi_pad, mask_pad, kx=1, ky=1)

    R_out_base = R + thickness  # constant for base cylinder
    hole_r = max(0, bottom_hole_diam / 2.0) if bottom_hole_diam > 0 else 0

    volume = np.zeros((nx, ny, nz), dtype=np.float32)

    for k in range(nz):
        zv = float(z[k])

        # Base: solid disc from -base_thickness to 0, with optional hole
        if base_thickness > 0 and -base_thickness <= zv <= 0:
            dist_base = (R_out_base - r_canonical_2d) * scale_2d
            if hole_r > 0:
                dist_hole = r_2d - hole_r
                dist_plate = np.minimum(dist_base, dist_hole)
            else:
                dist_plate = dist_base
            plate_field = np.clip(0.5 + dist_plate / voxel_size, 0.0, 1.0)
            volume[:, :, k] = np.maximum(volume[:, :, k], plate_field)

        # Shell: wall region with mask lookup or lithophane relief
        if 0.0 <= zv <= H:
            if profile_radii is not None:
                R_here = float(np.interp(zv, prof_z, profile_radii))
            else:
                R_here = R
            if litho_gray is not None and zv >= lower_body_height - 1e-4:
                # Upper shell: Lithophane relief thickness modulation with continuous sub-voxel distance field
                upper_h = max(H - lower_body_height, 1.0)
                offset_rad = float(litho_offset) * np.pi / 180.0
                phi_norm = (((phi_2d - offset_rad) / (2 * np.pi) * litho_repeat) % 1.0 + 1.0) % 1.0
                u_frac = (phi_norm - 0.5) / max(litho_width_scale, 0.05) + 0.5
                y_norm = np.clip((zv - lower_body_height) / upper_h, 0.0, 1.0)
                v_frac = (y_norm - 0.5) / max(litho_height_scale, 0.05) + 0.5

                in_u = (u_frac >= 0.0) & (u_frac <= 1.0)
                in_v = (v_frac >= 0.0) & (v_frac <= 1.0)
                in_photo = in_u & in_v

                t_vals = np.full_like(phi_2d, litho_min_thick, dtype=float)
                if in_photo.any():
                    u_px = np.clip(np.round(u_frac * (litho_gray.shape[1] - 1)).astype(int), 0, litho_gray.shape[1] - 1)
                    v_px = int(np.clip(round((1.0 - v_frac) * (litho_gray.shape[0] - 1)), 0, litho_gray.shape[0] - 1))
                    g_vals = litho_gray[v_px, u_px].astype(float)
                    if litho_invert:
                        g_vals = 255.0 - g_vals
                    calc_t = litho_min_thick + (1.0 - g_vals / 255.0) * (litho_max_thick - litho_min_thick)
                    t_vals = np.where(in_photo, calc_t, litho_min_thick)

                R_out_here = R_here + t_vals
                d_in = (r_canonical_2d - R_here) * scale_2d
                d_out = (R_out_here - r_canonical_2d) * scale_2d
                dist = np.minimum(d_in, d_out)
                val_field = np.clip(0.5 + dist / voxel_size, 0.0, 1.0)
                volume[:, :, k] = np.maximum(volume[:, :, k], val_field)
            else:
                # Lower shell / default: shadow lamp stencil with continuous wall field
                R_out_here = R_here + thickness
                d_in = (r_canonical_2d - R_here) * scale_2d
                d_out = (R_out_here - r_canonical_2d) * scale_2d
                dist = np.minimum(d_in, d_out)
                wall_field = np.clip(0.5 + dist / voxel_size, 0.0, 1.0)

                active = wall_field > 1e-3
                if active.any():
                    phi_q = phi_2d[active]
                    vals = interp(zv, phi_q, grid=False).astype(np.float32)
                    v_slice = volume[:, :, k]
                    v_slice[active] = np.maximum(v_slice[active], wall_field[active] * vals)

    # Marching cubes
    print(f"  Marching cubes...")
    t0 = time.time()
    verts, faces, _, _ = marching_cubes(
        volume, level=0.5,
        spacing=(voxel_size, voxel_size, voxel_size))
    verts += [x[0], y[0], z[0]]
    # Flip Y axis to match Three.js preview (Y-up vs Z-up handedness)
    verts[:, 1] = -verts[:, 1]
    dt = time.time() - t0

    mesh = trimesh.Trimesh(vertices=verts, faces=faces)
    mesh.invert()  # flipping an axis reverses winding → invert to fix normals
    mesh.merge_vertices()

    # Z-plane trim: slice off any geometry above z_cutoff
    if z_cutoff is not None and z_cutoff < H - 1e-3:
        print(f"  Trimming top at Z={z_cutoff:.1f}mm...")
        try:
            sliced = mesh.slice_plane(
                plane_origin=[0, 0, z_cutoff],
                plane_normal=[0, 0, -1],  # keep below
                cap=True)
            if sliced is not None and len(sliced.faces) > 0:
                mesh = sliced
                mesh.merge_vertices()
        except Exception as e:
            print(f"  Warning during slice_plane: {e}")

    # Top hanging hook (挂钩)
    if with_top_hook:
        z_hook_base = z_cutoff if z_cutoff is not None else H
        print(f"  Adding top hanging hook at Z={z_hook_base:.1f}mm...")
        try:
            # Torus ring for hanging
            torus = trimesh.creation.torus(major_radius=5.0, minor_radius=1.3, minor_sections=24, major_sections=24)
            rot_mat = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
            torus.apply_transform(rot_mat)
            torus.apply_translation([0, 0, z_hook_base + 6.0])

            # Pedestal connecting top cap to hook loop
            pedestal = trimesh.creation.cylinder(radius=3.5, height=3.0, sections=24)
            pedestal.apply_translation([0, 0, z_hook_base + 1.5])

            hook_mesh = trimesh.util.concatenate([pedestal, torus])
            mesh = trimesh.util.concatenate([mesh, hook_mesh])
            mesh.merge_vertices()
        except Exception as e:
            print(f"  Warning adding hook: {e}")

    if not mesh.is_watertight:
        trimesh.repair.fill_holes(mesh)
        mesh.merge_vertices()

    print(f"  Raw: {len(mesh.faces)} faces ({dt:.1f}s)  "
          f"Watertight: {mesh.is_watertight}")
    return mesh


# ================================================================
# Post-processing: Smooth + Decimate
# ================================================================

def smooth_and_decimate(mesh, target_faces=300000, smooth_iter=2):
    """Laplacian smoothing (removes voxel staircase) + quadric decimation."""
    if smooth_iter > 0:
        print(f"  Laplacian smoothing ({smooth_iter} iter)...")
        trimesh.smoothing.filter_laplacian(mesh, iterations=smooth_iter)

    n = len(mesh.faces)
    if n > target_faces:
        ratio = 1.0 - target_faces / n
        print(f"  Decimating: {n} -> {target_faces} faces (reduce {ratio:.0%})...")
        import fast_simplification
        verts_out, faces_out = fast_simplification.simplify(
            mesh.vertices, mesh.faces, target_reduction=ratio)
        mesh = trimesh.Trimesh(vertices=verts_out, faces=faces_out)
        mesh.merge_vertices()
        mesh.fix_normals()

    print(f"  Final: {len(mesh.faces)} faces  "
          f"Watertight: {mesh.is_watertight}")
    return mesh


# ================================================================
# Clean 3MF Export (OrcaSlicer compatible)
# ================================================================

def export_3mf(mesh, output_path):
    """
    Export trimesh to 3MF with clean structure for modern slicers.
    Avoids trimesh's 3MF exporter which adds unnecessary extension namespaces.
    """
    import zipfile
    from xml.etree.ElementTree import Element, SubElement, tostring

    NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'

    # 3dmodel.model
    model = Element('model', {
        'xmlns': NS,
        'unit': 'millimeter',
        'xml:lang': 'en-US',
    })
    meta = SubElement(model, 'metadata', name='Application')
    meta.text = 'ShadowLampGenerator'

    resources = SubElement(model, 'resources')
    obj = SubElement(resources, 'object', id='1', name='ShadowLamp', type='model')
    mesh_el = SubElement(obj, 'mesh')

    # Vertices
    vertices_el = SubElement(mesh_el, 'vertices')
    verts = mesh.vertices
    for v in verts:
        SubElement(vertices_el, 'vertex', x=f'{v[0]:.6f}', y=f'{v[1]:.6f}', z=f'{v[2]:.6f}')

    # Triangles
    triangles_el = SubElement(mesh_el, 'triangles')
    for f in mesh.faces:
        SubElement(triangles_el, 'triangle', v1=str(f[0]), v2=str(f[1]), v3=str(f[2]))

    # Build
    build = SubElement(model, 'build')
    SubElement(build, 'item', objectid='1')

    model_xml = b'<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(model, encoding='unicode').encode('utf-8')

    content_types = b'''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>'''

    rels = b'''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>'''

    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml', content_types)
        zf.writestr('_rels/.rels', rels)
        zf.writestr('3D/3dmodel.model', model_xml)

    sz = os.path.getsize(output_path) / 1024 / 1024
    print(f"  Exported: {output_path} ({sz:.1f} MB)")


# ================================================================
# Test Image
# ================================================================

def create_test_image(output_dir="."):
    size = 512
    img = Image.new('L', (size, size), 255)
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    Ro, Ri = size * 0.4, size * 0.16
    pts = []
    for i in range(10):
        a = np.radians(-90 + i * 36)
        r = Ro if i % 2 == 0 else Ri
        pts.append((cx + r * np.cos(a), cy + r * np.sin(a)))
    draw.polygon(pts, fill=0)
    path = os.path.join(output_dir, "test_star.png")
    img.save(path)
    print(f"[OK] Test image: {path}")
    return path


# ================================================================
# CLI
# ================================================================

def main():
    p = argparse.ArgumentParser(
        description="Shadow Lamp v2 — Manifold mesh, smooth contours")
    p.add_argument('--image', type=str)
    p.add_argument('--output', type=str, default=None)
    p.add_argument('--radius', type=float, default=50.0, help='Inner radius mm')
    p.add_argument('--height', type=float, default=100.0, help='Shell height mm')
    p.add_argument('--thickness', type=float, default=2.0, help='Wall thickness mm')
    p.add_argument('--base-thickness', type=float, default=5.0,
                   help='Base plate thickness mm (0=no base)')
    p.add_argument('--bulb-height', type=float, default=50.0,
                   help='Bulb height mm (independent of shell height)')
    p.add_argument('--shadow-size', type=float, default=300.0)
    p.add_argument('--resolution', type=int, default=400,
                   help='Mask resolution (phi x z grid)')
    p.add_argument('--voxel-size', type=float, default=None,
                   help='Voxel size mm (auto if omitted)')
    p.add_argument('--target-faces', type=int, default=300000,
                   help='Target face count after decimation')
    p.add_argument('--smooth-sigma', type=float, default=1.5,
                   help='Contour Gaussian smoothing')
    p.add_argument('--smooth-iter', type=int, default=2,
                   help='Laplacian surface smoothing iterations')
    p.add_argument('--threshold', type=int, default=128)
    p.add_argument('--invert', action='store_true')
    p.add_argument('--profile', type=str, default=None,
                   help='Custom profile side-view image')
    p.add_argument('--base-shape', type=str, default='circle',
                   choices=['circle', 'triangle', 'square', 'pentagon', 'hexagon'])
    p.add_argument('--create-test-image', action='store_true')
    args = p.parse_args()

    if args.create_test_image:
        create_test_image()
        if not args.image:
            return

    if not args.image:
        p.print_help(); sys.exit(1)
    if not os.path.exists(args.image):
        print(f"Error: {args.image} not found"); sys.exit(1)

    if args.output is None:
        args.output = os.path.splitext(
            os.path.basename(args.image))[0] + '_lamp_v2.stl'

    print("=" * 55)
    print("  Shadow Lamp Generator v2 (Manifold)")
    print("=" * 55)
    t0 = time.time()

    # 1. Image
    print(f"\n[1/4] Loading: {args.image}")
    binary = load_and_binarize(args.image, args.threshold, args.invert)

    # 2. Mask
    print(f"\n[2/4] Ray tracing (res={args.resolution})")
    mask = build_cylinder_mask(
        binary, n_phi=args.resolution, n_z=args.resolution,
        R=args.radius, H=args.height, shadow_size=args.shadow_size,
        bulb_height=args.bulb_height,
        smooth_sigma=args.smooth_sigma, base_shape=args.base_shape)

    # 3. Profile
    profile = None
    if args.profile:
        profile = extract_profile(args.profile, args.resolution, args.radius)

    # 4. Mesh
    print(f"\n[3/4] Voxelize + marching cubes")
    mesh = build_manifold_mesh(
        mask, R=args.radius, thickness=args.thickness,
        H=args.height, base_thickness=args.base_thickness,
        voxel_size=args.voxel_size, profile_radii=profile,
        base_shape=args.base_shape)

    # 5. Polish
    print(f"\n[4/4] Smooth + decimate")
    mesh = smooth_and_decimate(mesh, args.target_faces, args.smooth_iter)

    # 6. Export
    if args.output.lower().endswith('.3mf'):
        export_3mf(mesh, args.output)
    else:
        mesh.export(args.output)
    sz = os.path.getsize(args.output) / 1024 / 1024
    dims = mesh.bounds[1] - mesh.bounds[0]
    print(f"\n  File: {args.output} ({sz:.1f} MB)")
    print(f"  Size: {dims[0]:.1f} x {dims[1]:.1f} x {dims[2]:.1f} mm")
    print(f"  Volume: {abs(mesh.volume):.0f} mm3")
    print(f"\n{'='*55}")
    print(f"  Done in {time.time()-t0:.1f}s")
    print(f"{'='*55}")


if __name__ == '__main__':
    main()
