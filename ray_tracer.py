"""
ray_tracer.py — 光线逆向追踪（桌上灯版本）

坐标系:
  - 壳体轴沿 Z 轴, z ∈ [0, H]
  - 光源在壳体中心 (0, 0, H * light_z_ratio)
  - 地板在 z = 0
  - 光线从光源穿过壳体, 投射到地板

算法:
  对每个壳体网格单元 (φ, z), 计算光线穿过该单元打到地板的位置,
  映射回图像像素, 决定该单元是实体还是镂空.
"""

import numpy as np


def _bilinear_sample(image, u, v):
    """
    Bilinear interpolation sampling of a 2D image.
    
    Parameters
    ----------
    image : np.ndarray (H, W) of bool or uint8
    u, v  : np.ndarray of float — continuous pixel coordinates
    
    Returns
    -------
    np.ndarray of float in [0, 1]
    """
    H, W = image.shape
    img_f = image.astype(np.float32)
    
    # Clamp to valid range
    u_c = np.clip(u, 0, W - 1.001)
    v_c = np.clip(v, 0, H - 1.001)
    
    u0 = np.floor(u_c).astype(np.int32)
    v0 = np.floor(v_c).astype(np.int32)
    u1 = np.minimum(u0 + 1, W - 1)
    v1 = np.minimum(v0 + 1, H - 1)
    
    fu = u_c - u0.astype(np.float32)
    fv = v_c - v0.astype(np.float32)
    
    # Four corners
    val00 = img_f[v0, u0]
    val01 = img_f[v0, u1]
    val10 = img_f[v1, u0]
    val11 = img_f[v1, u1]
    
    # Bilinear blend
    val = (val00 * (1 - fu) * (1 - fv) +
           val01 * fu * (1 - fv) +
           val10 * (1 - fu) * fv +
           val11 * fu * fv)
    
    return val


def build_shell_mask(
    binary_image: np.ndarray,
    n_phi: int,
    n_z: int,
    profile_radii: np.ndarray,
    H: float,
    shadow_size: float,
    light_z_ratio: float = 0.5,
    projection_mode: str = 'floor',
    base_shape: str = 'circle',
    keep_upper_shell: bool = True,
    upper_shell_height: float = 15.0,
    support_count: int = 4,
    support_width: float = 4.0
) -> tuple:
    """
    构建壳体表面的二值掩码.

    Parameters
    ----------
    binary_image : np.ndarray
        shape=(ImgH, ImgW), True=实体（遮光/产生影子）
    n_phi, n_z : int
        方位角/高度方向网格数
    profile_radii : np.ndarray
        shape=(n_z+1,), 每个 z 节点的壳体半径
    H : float
        壳体总高度 (mm)
    shadow_size : float
        地板投影区域宽度 (mm)
    light_z_ratio : float
        光源高度占壳体高度的比例 (默认 0.5=正中央)

    Returns
    -------
    (is_solid, z_vals, phi_vals)
    """
    ImgH, ImgW = binary_image.shape
    
    # If height is extremely small (stencil mode), place the light source at 40mm
    if H <= 0.1:
        h_light = 40.0
    else:
        h_light = H * light_z_ratio

    shadow_w = shadow_size
    shadow_h = shadow_size * ImgH / ImgW

    z_vals = np.linspace(0, H, n_z + 1)
    phi_vals = np.linspace(0, 2 * np.pi, n_phi, endpoint=False)

    # 单元中心
    z_c = (z_vals[:-1] + z_vals[1:]) / 2.0
    phi_c = phi_vals + np.pi / n_phi
    r_c = (profile_radii[:-1] + profile_radii[1:]) / 2.0

    Z, PHI = np.meshgrid(z_c, phi_c, indexing='ij')       # (n_z, n_phi)
    
    n_sides = 0
    if base_shape == 'triangle': n_sides = 3
    elif base_shape == 'square': n_sides = 4
    elif base_shape == 'pentagon': n_sides = 5
    elif base_shape == 'hexagon': n_sides = 6

    # Regular polygon scaling factor for radius at angle PHI
    scale = np.ones_like(PHI)
    if n_sides >= 3:
        segment = 2.0 * np.pi / n_sides
        theta = (PHI % segment) - (segment / 2.0)
        scale = 1.0 / np.cos(theta)

    R = np.broadcast_to(r_c[:, None], Z.shape) * scale

    is_solid = np.zeros((n_z, n_phi), dtype=bool)

    if projection_mode == 'wall':
        # Wall mode: simple cylindrical wrap (like a label on a can)
        # Use bilinear interpolation instead of nearest-neighbor
        u_f = (PHI / (2 * np.pi) * ImgW)
        v_f = ((1.0 - Z / H) * ImgH)
        val = _bilinear_sample(binary_image, u_f, v_f)
        is_solid = val >= 0.5
    else:
        # Determine the cutoff limit height
        h_limit = h_light + upper_shell_height if keep_upper_shell else h_light
        h_limit = min(h_limit, H)

        below = Z < (h_light - 1e-6)
        denom = np.where(below, h_light - Z, 1.0)
        t = np.where(below, h_light / denom, 0.0)

        x_f = R * np.cos(PHI) * t
        y_f = R * np.sin(PHI) * t

        # Continuous pixel coordinates (float) for bilinear interpolation
        u_f = (x_f / shadow_w + 0.5) * ImgW
        v_f = (y_f / shadow_h + 0.5) * ImgH

        ok = below & (u_f >= 0) & (u_f < ImgW) & (v_f >= 0) & (v_f < ImgH)
        
        # Bilinear sample for all valid cells
        val = np.zeros_like(Z, dtype=np.float32)
        if ok.any():
            val[ok] = _bilinear_sample(binary_image, u_f[ok], v_f[ok])
        is_solid[ok] = val[ok] >= 0.5

        # --- Supersampled anti-aliasing for boundary cells ---
        # Detect boundary cells: cells adjacent to different solid/hollow state
        padded = np.pad(is_solid, 1, mode='edge')
        neighbors = (
            padded[:-2, 1:-1] | padded[2:, 1:-1] |  # above, below
            padded[1:-1, :-2] | padded[1:-1, 2:]     # left, right
        )
        boundary = ok & (is_solid != neighbors)
        
        n_boundary = boundary.sum()
        if n_boundary > 0:
            print(f"  Anti-aliasing {n_boundary} boundary cells with 4x4 supersampling")
            
            # Get boundary cell indices
            bi, bj = np.where(boundary)
            
            # Cell dimensions
            dz = H / n_z
            d_phi = 2 * np.pi / n_phi
            
            # 4x4 sub-samples within each boundary cell
            sub_n = 4
            offsets = np.linspace(-0.375, 0.375, sub_n)  # [-0.375, -0.125, 0.125, 0.375]
            
            vote_count = np.zeros(n_boundary, dtype=np.float32)
            
            for dz_off in offsets:
                for dphi_off in offsets:
                    # Sub-sample z and phi positions
                    z_sub = z_c[bi] + dz_off * dz
                    phi_sub = phi_c[bj] + dphi_off * d_phi
                    
                    # Recompute polygon scale for sub-sample phi
                    scale_sub = np.ones(n_boundary, dtype=np.float64)
                    if n_sides >= 3:
                        theta_sub = (phi_sub % segment) - (segment / 2.0)
                        scale_sub = 1.0 / np.cos(theta_sub)
                    
                    r_sub = r_c[bi] * scale_sub
                    
                    below_sub = z_sub < (h_light - 1e-6)
                    denom_sub = np.where(below_sub, h_light - z_sub, 1.0)
                    t_sub = np.where(below_sub, h_light / denom_sub, 0.0)
                    
                    x_sub = r_sub * np.cos(phi_sub) * t_sub
                    y_sub = r_sub * np.sin(phi_sub) * t_sub
                    
                    u_sub = (x_sub / shadow_w + 0.5) * ImgW
                    v_sub = (y_sub / shadow_h + 0.5) * ImgH
                    
                    ok_sub = below_sub & (u_sub >= 0) & (u_sub < ImgW) & (v_sub >= 0) & (v_sub < ImgH)
                    
                    if ok_sub.any():
                        sampled = _bilinear_sample(binary_image, u_sub[ok_sub], v_sub[ok_sub])
                        vote_count[ok_sub] += sampled
            
            # Cell is solid if >= 50% of sub-samples are solid
            total_samples = sub_n * sub_n
            is_solid[boundary] = (vote_count / total_samples) >= 0.5

        # Solidify the upper band between h_light and h_limit
        above = Z >= (h_light - 1e-6)
        above_limit = Z >= (h_limit - 1e-6)
        is_solid[above & ~above_limit] = True
        is_solid[above_limit] = False

        # Add vertical support columns below h_limit
        if support_count > 0:
            for k in range(support_count):
                col_phi = k * (2.0 * np.pi / support_count)
                diff = np.abs(PHI - col_phi)
                diff = np.minimum(diff, 2.0 * np.pi - diff)
                half_width_ang = (support_width / 2.0) / R
                in_col = (diff < half_width_ang) & (Z < h_limit)
                is_solid[in_col] = True

    # 底部强制实体（提供稳固的底盘），保留 3 行
    for row in range(min(3, n_z)):
        is_solid[row, :] = True

    s = is_solid.sum()
    print(f"  Grid: {n_z}x{n_phi} = {is_solid.size}  "
          f"Solid {s} ({s/is_solid.size*100:.0f}%)  "
          f"Hollow {is_solid.size-s}")
    return is_solid, z_vals, phi_vals
