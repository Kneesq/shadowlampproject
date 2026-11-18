import urllib.request
from io import BytesIO

with open('test_star.png', 'rb') as f:
    img_data = f.read()

boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
body = BytesIO()

# Image part
body.write(b'--' + boundary.encode() + b'\r\n')
body.write(b'Content-Disposition: form-data; name="image"; filename="test_star.png"\r\n')
body.write(b'Content-Type: image/png\r\n\r\n')
body.write(img_data)
body.write(b'\r\n')

# Proj mode
body.write(b'--' + boundary.encode() + b'\r\n')
body.write(b'Content-Disposition: form-data; name="proj_mode"\r\n\r\nwall\r\n')

body.write(b'--' + boundary.encode() + b'--\r\n')

req = urllib.request.Request('http://127.0.0.1:5000/api/generate')
req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
req.data = body.getvalue()

import json
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))
        print(f'JSON: {data}')
        url = data['url']
        print(f'Fetching {url}...')
        req2 = urllib.request.Request(f'http://127.0.0.1:5000{url}')
        with urllib.request.urlopen(req2) as r2:
            print(f'Download Headers: {r2.headers["Content-Disposition"]}')
            content = r2.read()
            print(f'Download Size: {len(content)}')
except Exception as e:
    print(f'Error: {e}')
