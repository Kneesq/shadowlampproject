"""
image_processor.py — 图像处理模块

1. load_and_binarize: 加载剪影图片, 二值化
2. compute_shadow_dimensions: 计算投影尺寸
3. extract_profile: 从侧视图轮廓图提取壳体半径曲线
"""

import numpy as np
from PIL import Image


def load_and_binarize(image_path: str, threshold: int = 128, invert: bool = False) -> np.ndarray:
    """加载图片并二值化. True=黑色=实体(遮光)."""
    img = Image.open(image_path).convert('L')
    arr = np.array(img, dtype=np.uint8)
    mask = arr < threshold
    if invert:
        mask = ~mask
    print(f"  Image: {arr.shape[1]}x{arr.shape[0]}  "
          f"Solid {mask.sum()/mask.size*100:.0f}%")
    return mask


def compute_shadow_dimensions(image_shape: tuple, shadow_size: float) -> tuple:
    """根据图片宽高比计算投影尺寸."""
    H, W = image_shape
    return shadow_size, shadow_size * H / W


def extract_profile(image_path: str, n_z: int, max_radius: float,
                    threshold: int = 128) -> np.ndarray:
    """
    从侧视图轮廓图提取壳体半径曲线.

    Parameters
    ----------
    image_path : str  侧视图轮廓图 (黑色=壳体实体)
    n_z : int         高度方向采样数
    max_radius : float 最大半径 (mm)
    threshold : int    二值化阈值

    Returns
    -------
    np.ndarray shape=(n_z+1,) 每个高度节点的半径
    """
    img = Image.open(image_path).convert('L')
    arr = np.array(img, dtype=np.uint8)
    solid = arr < threshold   # 黑色=实体

    H_img, W_img = solid.shape
    cx = W_img // 2

    # 每行找最大离中心距离
    radii = np.zeros(H_img, dtype=float)
    for row in range(H_img):
        cols = np.where(solid[row])[0]
        if len(cols) > 0:
            radii[row] = np.max(np.abs(cols - cx))

    # 归一化到 max_radius
    mx = radii.max()
    if mx > 0:
        radii = radii / mx * max_radius

    # 图片 y 轴朝下, z 轴朝上 → 翻转
    radii = radii[::-1]

    # 重采样到 n_z+1 个节点
    src = np.arange(len(radii))
    dst = np.linspace(0, len(radii) - 1, n_z + 1)
    profile = np.interp(dst, src, radii)

    # 最小半径保底
    profile = np.maximum(profile, 1.0)

    print(f"  Profile: {n_z+1} points, R=[{profile.min():.1f}, {profile.max():.1f}] mm")
    return profile
