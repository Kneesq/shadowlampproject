"""
mesh_generator.py — 桌面灯壳体网格生成

支持圆柱和自定义轮廓, 生成带壁厚的封闭 manifold 网格:
  外壳面 / 内壳面 / 镂空边界侧壁 / 底盖（实心） / 顶盖（环形）
"""

import numpy as np


def generate_lamp_mesh(is_solid, profile_radii, thickness, z_vals, phi_vals, base_shape='circle', with_bottom=False, bottom_hole_diam=30.0):
    """
    Parameters
    ----------
    is_solid : (n_z, n_phi) bool
    profile_radii : (n_z+1,) 内壳半径
    thickness : float 壁厚
    z_vals : (n_z+1,)
    phi_vals : (n_phi,)
    """
    n_z = len(z_vals) - 1
    n_phi = len(phi_vals)
    
    n_sides = 0
    if base_shape == 'triangle': n_sides = 3
    elif base_shape == 'square': n_sides = 4
    elif base_shape == 'pentagon': n_sides = 5
    elif base_shape == 'hexagon': n_sides = 6

    # Polygon scale factor for phi_vals
    scale = np.ones_like(phi_vals)
    if n_sides >= 3:
        segment = 2.0 * np.pi / n_sides
        theta = (phi_vals % segment) - (segment / 2.0)
        scale = 1.0 / np.cos(theta)

    cos_p = np.cos(phi_vals)
    sin_p = np.sin(phi_vals)

    # 顶点网格 (n_z+1, n_phi, 3)
    Ri = profile_radii[:, None] * scale[None, :]
    Ro = (profile_radii + thickness)[:, None] * scale[None, :]
    Zb = np.broadcast_to(z_vals[:, None], (n_z+1, n_phi))

    inner = np.stack([Ri * cos_p, Ri * sin_p, Zb], axis=-1)
    outer = np.stack([Ro * cos_p, Ro * sin_p, Zb], axis=-1)

    # φ+1 环形偏移
    i_jp1 = np.roll(inner, -1, axis=1)
    o_jp1 = np.roll(outer, -1, axis=1)

    # 单元四角 (i=z 行, j=φ 列)
    o00 = outer[:-1];  o01 = o_jp1[:-1]
    o10 = outer[1:];   o11 = o_jp1[1:]
    i00 = inner[:-1];  i01 = i_jp1[:-1]
    i10 = inner[1:];   i11 = i_jp1[1:]

    T = []  # 三角形列表

    # === 外壳面 (法线朝外) ===
    T.append(np.stack([o00, o01, o11], -2)[is_solid].reshape(-1, 3, 3))
    T.append(np.stack([o00, o11, o10], -2)[is_solid].reshape(-1, 3, 3))

    # === 内壳面 (法线朝内, 反转绕序) ===
    T.append(np.stack([i00, i10, i11], -2)[is_solid].reshape(-1, 3, 3))
    T.append(np.stack([i00, i11, i01], -2)[is_solid].reshape(-1, 3, 3))

    # === 侧壁: z 方向 ===
    s_below = np.zeros_like(is_solid)
    s_below[1:] = is_solid[:-1]
    lo = is_solid & ~s_below   # 下边界 (法线 -Z)
    T.append(np.stack([o00, i00, i01], -2)[lo].reshape(-1, 3, 3))
    T.append(np.stack([o00, i01, o01], -2)[lo].reshape(-1, 3, 3))

    s_above = np.zeros_like(is_solid)
    s_above[:-1] = is_solid[1:]
    s_above[-1] = False  # 允许顶部开口
    hi = is_solid & ~s_above   # 上边界 (法线 +Z)
    T.append(np.stack([i10, o10, o11], -2)[hi].reshape(-1, 3, 3))
    T.append(np.stack([i10, o11, i11], -2)[hi].reshape(-1, 3, 3))

    # === 侧壁: φ 方向 ===
    s_left = np.roll(is_solid, 1, axis=1)
    lb = is_solid & ~s_left    # 左边界 (法线 -φ)
    T.append(np.stack([i00, o00, o10], -2)[lb].reshape(-1, 3, 3))
    T.append(np.stack([i00, o10, i10], -2)[lb].reshape(-1, 3, 3))

    s_right = np.roll(is_solid, -1, axis=1)
    rb = is_solid & ~s_right   # 右边界 (法线 +φ)
    T.append(np.stack([o01, i01, i11], -2)[rb].reshape(-1, 3, 3))
    T.append(np.stack([o01, i11, o11], -2)[rb].reshape(-1, 3, 3))

    # === Bottom Plate (Watertight Solid Disc with hole) ===
    if with_bottom:
        R_hole = bottom_hole_diam / 2.0
        min_R_inner = float(profile_radii.min())
        R_hole = min(R_hole, max(5.0, min_R_inner - 5.0))

        t_plate = thickness
        r_t_base = np.interp(t_plate, z_vals, profile_radii)
        
        Ri_0 = profile_radii[0] * scale
        Ri_t = r_t_base * scale

        ib0 = np.stack([Ri_0 * cos_p, Ri_0 * sin_p, np.zeros_like(phi_vals)], axis=-1)
        ibt = np.stack([Ri_t * cos_p, Ri_t * sin_p, np.full_like(phi_vals, t_plate)], axis=-1)
        hb0 = np.stack([R_hole * cos_p, R_hole * sin_p, np.zeros_like(phi_vals)], axis=-1)
        hbt = np.stack([R_hole * cos_p, R_hole * sin_p, np.full_like(phi_vals, t_plate)], axis=-1)

        ib0_jp1 = np.roll(ib0, -1, axis=0)
        ibt_jp1 = np.roll(ibt, -1, axis=0)
        hb0_jp1 = np.roll(hb0, -1, axis=0)
        hbt_jp1 = np.roll(hbt, -1, axis=0)

        # Bottom face
        T.append(np.stack([ib0, hb0_jp1, hb0], axis=-2))
        T.append(np.stack([ib0, ib0_jp1, hb0_jp1], axis=-2))

        # Top face
        T.append(np.stack([ibt, ibt_jp1, hbt_jp1], axis=-2))
        T.append(np.stack([ibt, hbt_jp1, hbt], axis=-2))

        # Hole wall
        T.append(np.stack([hb0, hbt, hbt_jp1], axis=-2))
        T.append(np.stack([hb0, hbt_jp1, hb0_jp1], axis=-2))

    tri = np.concatenate([t for t in T if t.size > 0], axis=0)
    print(f"  Triangles: {len(tri)}  (~{len(tri)*50/1024/1024:.1f} MB)")
    return tri
