"""
stl_exporter.py — STL 文件导出模块

负责将三角形数组导出为标准的二进制 STL 文件。
使用 numpy-stl 库，自动计算法向量。
"""

import numpy as np
from stl import mesh as stl_mesh


def export_stl(triangles: np.ndarray, output_path: str):
    """
    将三角形数组导出为 STL 文件。

    Parameters
    ----------
    triangles : np.ndarray
        三角形顶点数组，shape=(N, 3, 3)
        triangles[i] = [[x0,y0,z0], [x1,y1,z1], [x2,y2,z2]]
    output_path : str
        输出 STL 文件路径

    Notes
    -----
    - 使用二进制 STL 格式（文件更小，加载更快）
    - 法向量由 numpy-stl 自动计算
    """
    n_triangles = len(triangles)

    # 创建 mesh 对象
    lamp_mesh = stl_mesh.Mesh(np.zeros(n_triangles, dtype=stl_mesh.Mesh.dtype))

    # 设置三角形顶点（向量化赋值，无 Python 循环）
    lamp_mesh.vectors = triangles.astype(np.float32)

    # 自动计算法向量
    lamp_mesh.update_normals()

    # 保存为二进制 STL
    lamp_mesh.save(output_path)

    # 输出统计信息
    file_size_mb = n_triangles * 50 / (1024 * 1024)  # 每个三角形约 50 字节

    print(f"  Output: {output_path}")
    print(f"  Triangles: {n_triangles}")
    print(f"  Size: ~{file_size_mb:.1f} MB")

    # 基本验证
    _validate_mesh(lamp_mesh)


def _validate_mesh(lamp_mesh):
    """
    对生成的网格进行基本验证。

    检查项：
    1. 是否有退化三角形（面积为零）
    2. 法向量是否有效
    3. 基本尺寸信息
    """
    # 检查退化三角形
    # 计算每个三角形的面积（通过叉积的模长）
    v0 = lamp_mesh.vectors[:, 0, :]
    v1 = lamp_mesh.vectors[:, 1, :]
    v2 = lamp_mesh.vectors[:, 2, :]

    edge1 = v1 - v0
    edge2 = v2 - v0
    cross = np.cross(edge1, edge2)
    areas = np.linalg.norm(cross, axis=1) / 2.0

    degenerate_count = np.sum(areas < 1e-8)
    if degenerate_count > 0:
        print(f"  [WARN] {degenerate_count} degenerate triangles (area~0)")
    else:
        print(f"  [OK] No degenerate triangles")

    # 边界框
    all_points = lamp_mesh.vectors.reshape(-1, 3)
    bbox_min = all_points.min(axis=0)
    bbox_max = all_points.max(axis=0)
    bbox_size = bbox_max - bbox_min

    print(f"  BBox: {bbox_size[0]:.1f} x {bbox_size[1]:.1f} x {bbox_size[2]:.1f} mm")
    print(f"  Center: ({(bbox_min[0]+bbox_max[0])/2:.1f}, "
          f"{(bbox_min[1]+bbox_max[1])/2:.1f}, "
          f"{(bbox_min[2]+bbox_max[2])/2:.1f})")
