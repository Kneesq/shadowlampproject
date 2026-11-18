import numpy as np
from stl import mesh

try:
    # Load the STL file
    m = mesh.Mesh.from_file('static/shadow_lamp_1782268505.stl')
    print("Successfully loaded static/shadow_lamp_1782268505.stl")
    print(f"Number of triangles: {len(m.vectors)}")
    print(f"Normals shape: {m.normals.shape}")
    print(f"V0 shape: {m.v0.shape}")
    
    # Check if there are any NaN or Inf values
    has_nan = np.isnan(m.vectors).any()
    has_inf = np.isinf(m.vectors).any()
    print(f"Has NaN: {has_nan}, Has Inf: {has_inf}")
    
    # Check bounding box
    bbox_min = m.vectors.reshape(-1, 3).min(axis=0)
    bbox_max = m.vectors.reshape(-1, 3).max(axis=0)
    print(f"BBox Min: {bbox_min}")
    print(f"BBox Max: {bbox_max}")
except Exception as e:
    print(f"Error loading STL: {e}")
