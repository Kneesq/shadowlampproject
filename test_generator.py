import os
import json
import urllib.request
from stl import mesh

def test_generation():
    url = "http://127.0.0.1:5000/api/generate"
    image_path = "test_star.png"
    
    if not os.path.exists(image_path):
        print(f"Error: test_star.png not found at {image_path}")
        return

    print("Sending POST request to generate STL...")
    
    with open(image_path, 'rb') as f:
        img_content = f.read()

    params = {
        'radius': '50.0',
        'height': '0.0',
        'thickness': '2.0',
        'shadow_size': '300.0',
        'resolution': '400',
        'proj_mode': 'floor',
        'light_z_ratio': '0.35',
        'base_shape': 'square'
    }

    boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    body = []

    for name, value in params.items():
        body.append(f'--{boundary}'.encode('utf-8'))
        body.append(f'Content-Disposition: form-data; name="{name}"\r\n'.encode('utf-8'))
        body.append(value.encode('utf-8'))

    body.append(f'--{boundary}'.encode('utf-8'))
    body.append(f'Content-Disposition: form-data; name="image"; filename="test_star.png"'.encode('utf-8'))
    body.append('Content-Type: image/png\r\n'.encode('utf-8'))
    body.append(img_content)
    body.append(f'--{boundary}--'.encode('utf-8'))

    data = b'\r\n'.join(body)

    req = urllib.request.Request(url, data=data)
    req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
    req.add_header('Content-Length', len(data))

    try:
        with urllib.request.urlopen(req) as response:
            res_content = response.read().decode('utf-8')
            res_json = json.loads(res_content)
            print("Success! Response JSON:", res_json)
            
            download_url = res_json.get('url')
            backups = res_json.get('backups', [])

            if not download_url:
                print("Error: No download URL in response")
                return

            if not backups:
                print("Error: No backup files saved in response")
                return

            # Verify backup files exist
            for backup_path in backups:
                if os.path.exists(backup_path):
                    print(f"Verified backup file exists: {backup_path}")
                    try:
                        m = mesh.Mesh.from_file(backup_path)
                        print(f"Successfully loaded backup STL: {len(m.vectors)} triangles")
                        bbox_min = m.vectors.reshape(-1, 3).min(axis=0)
                        bbox_max = m.vectors.reshape(-1, 3).max(axis=0)
                        print(f"Bounding Box: {bbox_max - bbox_min} mm")
                    except Exception as ex:
                        print(f"Error reading STL file: {ex}")
                else:
                    print(f"Error: Backup file does not exist at {backup_path}")
    except Exception as e:
        print("Error sending request:", e)

if __name__ == '__main__':
    test_generation()
