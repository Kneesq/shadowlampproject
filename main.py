"""
main.py — Shadow Lamp STL Generator (桌上灯 CLI)

用法:
  python main.py --image silhouette.png
  python main.py --image cat.png --radius 50 --height 100 --shadow-size 400
  python main.py --image logo.png --profile vase.png
  python main.py --create-test-image
"""

import argparse
import io
import os
import sys
import time

import numpy as np

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
from PIL import Image, ImageDraw


def create_test_image(output_dir: str = "."):
    size = 512
    img = Image.new('L', (size, size), 255)
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    outer_r, inner_r = size * 0.4, size * 0.16
    points = []
    for i in range(10):
        angle = np.radians(-90 + i * 36)
        r = outer_r if i % 2 == 0 else inner_r
        points.append((cx + r * np.cos(angle), cy + r * np.sin(angle)))
    draw.polygon(points, fill=0)
    path = os.path.join(output_dir, "test_star.png")
    img.save(path)
    print(f"[OK] Test image: {path}")
    return path


def main():
    p = argparse.ArgumentParser(description="Shadow Lamp STL Generator (桌上灯)")
    p.add_argument('--image', type=str, help='剪影图片路径')
    p.add_argument('--output', type=str, default=None)
    p.add_argument('--radius', type=float, default=50.0, help='壳体半径 (mm)')
    p.add_argument('--height', type=float, default=100.0, help='壳体高度 (mm)')
    p.add_argument('--thickness', type=float, default=2.0, help='壁厚 (mm)')
    p.add_argument('--shadow-size', type=float, default=300.0, help='地板投影宽度 (mm)')
    p.add_argument('--resolution', type=int, default=200)
    p.add_argument('--threshold', type=int, default=128)
    p.add_argument('--invert', action='store_true')
    p.add_argument('--profile', type=str, default=None, help='自定义轮廓侧视图')
    p.add_argument('--create-test-image', action='store_true')
    args = p.parse_args()

    if args.create_test_image:
        create_test_image()
        if not args.image:
            return

    if not args.image:
        p.print_help()
        sys.exit(1)
    if not os.path.exists(args.image):
        print(f"Error: {args.image} not found")
        sys.exit(1)

    if args.output is None:
        args.output = os.path.splitext(os.path.basename(args.image))[0] + '_lamp.stl'

    print("=" * 50)
    print("  Shadow Lamp Generator (Table Lamp)")
    print("=" * 50)

    t0 = time.time()

    from image_processor import load_and_binarize, compute_shadow_dimensions, extract_profile
    from ray_tracer import build_shell_mask
    from mesh_generator import generate_lamp_mesh
    from stl_exporter import export_stl

    print(f"\n[1/4] Loading image: {args.image}")
    binary = load_and_binarize(args.image, args.threshold, args.invert)
    shadow_w, shadow_h = compute_shadow_dimensions(binary.shape, args.shadow_size)

    print(f"\n[2/4] Building shell profile")
    if args.profile:
        profile = extract_profile(args.profile, args.resolution, args.radius)
    else:
        profile = np.full(args.resolution + 1, args.radius)
        print(f"  Cylinder R={args.radius} mm, H={args.height} mm")

    print(f"\n[3/4] Ray tracing + mesh generation")
    is_solid, z_vals, phi_vals = build_shell_mask(
        binary, n_phi=args.resolution, n_z=args.resolution,
        profile_radii=profile, H=args.height, shadow_size=args.shadow_size
    )
    triangles = generate_lamp_mesh(
        is_solid, profile_radii=profile, thickness=args.thickness,
        z_vals=z_vals, phi_vals=phi_vals
    )

    print(f"\n[4/4] Exporting STL")
    export_stl(triangles, args.output)

    print(f"\n{'='*50}")
    print(f"  Done in {time.time()-t0:.1f}s → {os.path.abspath(args.output)}")
    print(f"{'='*50}")


if __name__ == '__main__':
    main()
