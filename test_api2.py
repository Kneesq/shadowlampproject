import urllib.request
import urllib.parse
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

# Radius part
body.write(b'--' + boundary.encode() + b'\r\n')
body.write(b'Content-Disposition: form-data; name="radius"\r\n\r\n50\r\n')

# Resolution part
body.write(b'--' + boundary.encode() + b'\r\n')
body.write(b'Content-Disposition: form-data; name="resolution"\r\n\r\n100\r\n')

body.write(b'--' + boundary.encode() + b'--\r\n')

req = urllib.request.Request('http://127.0.0.1:5000/api/generate')
req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
req.data = body.getvalue()

try:
    with urllib.request.urlopen(req) as response:
        content = response.read()
        print(f'Status: {response.status}, Size: {len(content)}')
        with open('test_api_dl.stl', 'wb') as f:
            f.write(content)
except Exception as e:
    print(f'Error: {e}')
