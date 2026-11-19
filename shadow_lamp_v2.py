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

import argparse, os, sys, time
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.interpolate import RectBivariateSpline
from skimage.measure import marching_cubes
import trimesh



# ================================================================
# Image Processing
# ================================================================

def load_and_binarize(path, threshold=128, invert=False):
    """Load image (B&W, colored, or transparent PNG) → extract contour → binary mask.
    True = solid (shadow/opaque), False = hollow cutout (light passes through)."""
    img = ImageOps.exif_transpose(Image.open(path))
    img.thumbnail((2048, 2048), Image.Resampling.LANCZOS)

    # 1. Check alpha transparency (去背/透明PNG：直接取整体轮廓，不辨别内部黑白色)
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        img_rgba = img.convert('RGBA')
        alpha = np.array(img_rgba.getchannel('A'), dtype=np.uint8)
        if np.any(alpha < 200) and np.any(alpha > 20):
            mask = alpha.astype(np.float32) / 255
            if invert:
                mask = 1.0 - mask
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
        mask = np.clip(0.5 + (color_dist - thresh_val) / max(thresh_val * .3, 12), 0, 1)
        print(f"  Color contour binarized (bg={bg_color.round().astype(int)}): Solid: {mask.sum()/mask.size*100:.1f}%")
    else:
        # Fallback to standard grayscale threshold
        gray = np.array(img.convert('L'), dtype=np.uint8)
        mask = np.clip(0.5 + (threshold - gray.astype(np.float32)) / 32, 0, 1)
        print(f"  Grayscale binarized: Solid: {mask.sum()/mask.size*100:.1f}%")

    if invert:
        mask = 1.0 - mask
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

def upper_shell_start(lower_height, bulb_height, projection_mode):
    """Z where the patterned lower shell gives way to the solid upper side."""
    return lower_height if projection_mode == 'wall' else min(bulb_height, lower_height)


def build_cylinder_mask(binary_image, n_phi, n_z, R, H, shadow_size,
                        bulb_height=50.0, smooth_sigma=1.5,
                        projection_mode='floor', base_shape='circle',
                        keep_upper_shell=True, upper_shell_height=15.0,
                        custom_shape_radii=None,
                        support_count=0, support_width=4.0, profile_radii=None, floor_offset=0):
    """
    Reverse ray-trace: shell surface → floor → image pixel.
    Returns smoothed float mask (n_z, n_phi) in [0, 1].
    Gaussian blur produces smooth iso-contours for marching cubes.
    custom_shape_radii: optional ndarray(360) of normalized per-angle radii.
    support_count: number of vertical support columns connecting base to top.
    """
    img_h, img_w = binary_image.shape
    image = np.asarray(binary_image, dtype=np.float32)
    z = ((np.arange(n_z, dtype=np.float32) + .5) * H / n_z)[:, None]
    phi = (np.arange(n_phi, dtype=np.float32) + .5) * (2 * np.pi / n_phi)
    radii = R if profile_radii is None else np.interp(
        z, np.linspace(0, H, len(profile_radii)), profile_radii)
    if custom_shape_radii is not None:
        scale = np.interp(phi, np.arange(len(custom_shape_radii)) * (2*np.pi/len(custom_shape_radii)),
                          custom_shape_radii, period=2*np.pi)
    else:
        sides = {'triangle': 3, 'square': 4, 'pentagon': 5, 'hexagon': 6}.get(base_shape)
        if sides:
            angle = 2 * np.pi / sides
            scale = 1 / np.cos((phi + angle / 2) % angle - angle / 2)
        else:
            scale = 1

    lower_height = max(.1, H - upper_shell_height) if keep_upper_shell else H
    if projection_mode == 'wall':
        u, v = np.broadcast_arrays(phi * (img_w / (2*np.pi)) - .5, (1-z/lower_height) * img_h - .5)
        # Repeat angular samples across the seam and clamp vertical samples at the rim.
        pad_image = np.pad(image, ((0, 0), (1, 1)), mode='wrap')
        mask = map_coordinates(pad_image, [v, u+1], order=1, mode='nearest')
    else:
        t = (bulb_height + floor_offset) / np.maximum(bulb_height - z, .0001)
        r = radii * scale * t
        u = (.5 + r * np.cos(phi) / shadow_size) * img_w - .5
        v = (.5 + r * np.sin(phi) / (shadow_size * img_h / img_w)) * img_h - .5
        mask = map_coordinates(image, [v, u], order=1, mode='grid-constant', cval=0)
        mask[z[:, 0] >= bulb_height] = 0
    mask_out = gaussian_filter(mask, sigma=smooth_sigma, mode=('nearest', 'wrap'))
    if keep_upper_shell:
        hood_start = upper_shell_start(lower_height, bulb_height, projection_mode)
        mask_out[z[:, 0] >= hood_start] = 1
    if support_count > 0:
        step = 2 * np.pi / support_count
        distance = np.abs((phi + step/2) % step - step/2) * radii * scale
        support = np.clip(.5 + (support_width / 2 - distance) / (2 * np.pi * R / n_phi), 0, 1)
        mask_out = np.maximum(mask_out, support)
    # A complete first ring joins the wall to the plate.
    mask_out[:max(1, int(np.ceil(.5 * n_z / H)))] = 1
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
                        litho_offset=0.0, roof_height=0.0):
    """
    Voxelize shell+base, then marching cubes → guaranteed manifold.
    Processes z-slices for memory efficiency.
    Smooth mask values [0,1] produce smooth iso-contours at hole edges.
    z_cutoff: if set, slice off all geometry above this Z height.
    custom_shape_radii: optional ndarray(360) of normalized per-angle radii.
    with_top_hook: if True, adds a 3D hanging hook loop at the top apex.
    litho_gray: optional 2D ndarray grayscale image for 360° lithophane relief.
    """
    n_z_mask, n_phi_mask = mask_smooth.shape
    min_wall = min(thickness, litho_min_thick) if litho_gray is not None else thickness
    if voxel_size is None:
        arc_step = 2 * np.pi * R / n_phi_mask
        voxel_size = min(min_wall / 3, max(.20, min(arc_step, .75)))

    # Per-angle scale: custom shape or polygon
    use_custom = custom_shape_radii is not None and len(custom_shape_radii) > 0
    n_sides = {'triangle': 3, 'square': 4, 'pentagon': 5, 'hexagon': 6}.get(base_shape, 0)
    if use_custom:
        custom_radii_arr = np.asarray(custom_shape_radii, dtype=np.float64)
    else:
        custom_radii_arr = None

    if lower_body_height is None:
        lower_body_height = H

    max_scale = (float(np.max(custom_radii_arr)) if use_custom else
                 1 / np.cos(np.pi / n_sides) if n_sides else 1)
    outer = max(R, max(profile_radii) if profile_radii is not None else R)
    max_radius = (outer + max(thickness, litho_max_thick if litho_gray is not None else 0)) * max_scale
    body_top = min(H, z_cutoff) if z_cutoff is not None else H
    apex = body_top + roof_height
    hook_active = with_top_hook and roof_height > 0
    z_top = apex + (13 if hook_active else 0)
    z_min = -base_thickness
    # Bound the full marching-cubes volume at high resolution / large diameters.
    min_step = ((2*max_radius)**2 * (z_top - z_min) / 24000000) ** (1/3)
    voxel_size = max(voxel_size, min_step)
    z_step = min(voxel_size, body_top / 3)
    # For flat stencils refine just Z. Account for the base plate in that budget.
    voxel_size = max(voxel_size, 2 * max_radius * np.sqrt((z_top-z_min) / z_step / 24000000))
    margin = max_radius + voxel_size * 2
    x = np.arange(-margin, margin + voxel_size, voxel_size, dtype=np.float32)
    y = x
    z = np.arange(np.floor(z_min/z_step)-2, np.ceil(z_top/z_step)+3, dtype=np.float32) * z_step

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

    R_out_base = (profile_radii[0] if profile_radii is not None else R) + thickness  # constant for base cylinder
    hole_r = max(0, bottom_hole_diam / 2.0) if bottom_hole_diam > 0 else 0

    if litho_gray is not None:
        # A full-width panel repeats at the cylinder seam. Sample pixel centers,
        # interpolating the last and first columns on either side of the seam.
        panel_height, panel_width = litho_gray.shape
        phase = ((phi_2d - np.deg2rad(litho_offset)) * litho_repeat / (2*np.pi)) % 1.0
        panel_u = (phase - .5) / litho_width_scale + .5
        in_panel = (panel_u >= 0) & (panel_u <= 1)
        pixel_x = panel_u * panel_width - .5
        left = np.floor(pixel_x).astype(np.intp)
        x_weight = pixel_x - left
        if litho_width_scale == 1.0:
            right = (left + 1) % panel_width
            left %= panel_width
        else:
            right = np.clip(left + 1, 0, panel_width - 1)
            left = np.clip(left, 0, panel_width - 1)

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
        if 0.0 <= zv <= body_top:
            if profile_radii is not None:
                R_here = float(np.interp(zv, prof_z, profile_radii))
            else:
                R_here = R
            if litho_gray is not None and zv >= lower_body_height - 1e-4:
                span = max(H - lower_body_height, 1e-6)
                side_v = np.clip((zv - lower_body_height) / span, 0, 1)
                panel_v = (side_v - .5) / litho_height_scale + .5
                t_vals = litho_min_thick
                if 0 <= panel_v <= 1:
                    pixel_y = (1 - panel_v) * (panel_height - 1)
                    top = int(np.floor(pixel_y))
                    bottom = min(top + 1, panel_height - 1)
                    y_weight = pixel_y - top
                    # Only two 1D source rows are needed per horizontal mesh slice.
                    row = litho_gray[top] * (1 - y_weight) + litho_gray[bottom] * y_weight
                    gray = row[left] * (1 - x_weight) + row[right] * x_weight
                    darkness = gray / 255 if litho_invert else 1 - gray / 255
                    relief = litho_min_thick + darkness * (litho_max_thick - litho_min_thick)
                    t_vals = np.where(in_panel, relief, litho_min_thick)

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

        if roof_height and body_top - min_wall <= zv <= apex:
            # Hollow cone joined to the upper rim, with a solid tip for the hook.
            rim_radius = (profile_radii[-1] if profile_radii is not None else R)
            roof_r = (rim_radius + thickness) * np.clip((apex-zv) / roof_height, 0, 1)
            outside = (roof_r - r_canonical_2d) * scale_2d
            lower_face = zv - (apex - min_wall - roof_height * r_canonical_2d / (rim_radius+thickness))
            roof_field = .5 + np.minimum(outside / voxel_size, lower_face / z_step)
            volume[:, :, k] = np.maximum(volume[:, :, k], np.clip(roof_field, 0, 1))
        if hook_active and apex - 2 <= zv <= apex + 13:
            # Union the pedestal and torus in the same scalar field to create a joined mesh.
            pedestal = np.minimum(3.5 - r_2d, np.minimum(zv - apex + 2, apex + 3.5 - zv))
            torus = 1.3 - np.hypot(np.hypot(X2D, zv - apex - 6) - 5, Y2D)
            hook = np.clip(.5 + np.maximum(pedestal, torus) / voxel_size, 0, 1)
            volume[:, :, k] = np.maximum(volume[:, :, k], hook)

    # Marching cubes
    print(f"  Marching cubes...")
    t0 = time.time()
    verts, faces, _, _ = marching_cubes(
        volume, level=0.5,
        spacing=(voxel_size, voxel_size, z_step), allow_degenerate=False)
    verts += [x[0], y[0], z[0]]
    # Flip Y axis to match Three.js preview (Y-up vs Z-up handedness)
    verts[:, 1] = -verts[:, 1]
    dt = time.time() - t0

    mesh = trimesh.Trimesh(vertices=verts, faces=faces)
    mesh.merge_vertices()
    # An ambiguous voxel near the stencil edge can create a separate, sub-voxel
    # octahedron. Remove only tiny disconnected components, never a thin limb
    # connected to the main silhouette or a distinct full-size design element.
    edges = mesh.edges_unique
    graph = coo_matrix((np.ones(len(edges), dtype=np.uint8), edges.T),
                       shape=(len(mesh.vertices), len(mesh.vertices)))
    count, labels = connected_components(graph, directed=False)
    if count > 1:
        face_labels = labels[mesh.faces[:, 0]]
        counts = np.bincount(face_labels)
        tiny = counts <= 16
        vertices_to_check = tiny[labels]
        if vertices_to_check.any():
            checked_labels = labels[vertices_to_check]
            points = mesh.vertices[vertices_to_check]
            low = np.full((count, 3), np.inf)
            high = -low
            np.minimum.at(low, checked_labels, points)
            np.maximum.at(high, checked_labels, points)
            discard = tiny & ((high - low).max(axis=1) <= voxel_size)
            keep = ~discard[face_labels]
            if keep.any() and not keep.all():
                mesh.update_faces(keep)
                mesh.remove_unreferenced_vertices()
    del graph, edges
    if mesh.volume < 0:
        mesh.invert()

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
        # STL stores float32 vertices. Check topology at that precision because
        # a quadric collapse can merge distinct sides of a narrow cut.
        candidate = trimesh.Trimesh(vertices=verts_out.astype(np.float32), faces=faces_out,
                                    validate=True)
        if candidate.is_watertight and candidate.is_winding_consistent and candidate.volume > 0:
            mesh = candidate
        else:
            print("  Retaining the full mesh to preserve closed contours.")

    # Weld at export precision before verifying the actual STL topology.
    mesh = trimesh.Trimesh(vertices=mesh.vertices.astype(np.float32), faces=mesh.faces,
                           validate=True)
    if not mesh.is_watertight or not mesh.is_winding_consistent:
        raise ValueError("The selected dimensions produce an open mesh. Increase wall thickness or resolution.")

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

    profile = None
    if args.profile:
        profile = extract_profile(args.profile, args.resolution, args.radius)

    # 2. Mask
    print(f"\n[2/4] Ray tracing (res={args.resolution})")
    mask = build_cylinder_mask(
        binary, n_phi=args.resolution, n_z=args.resolution,
        R=args.radius, H=args.height, shadow_size=args.shadow_size,
        bulb_height=args.bulb_height,
        smooth_sigma=args.smooth_sigma, base_shape=args.base_shape,
        profile_radii=profile, floor_offset=args.base_thickness)

    # Mesh
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
