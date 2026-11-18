import requests
files = {'image': open('test_star.png', 'rb')}
data = {'radius': 50, 'height': 100, 'thickness': 2, 'shadow_size': 300, 'resolution': 100}
r = requests.post('http://127.0.0.1:5000/api/generate', files=files, data=data)
print(f'Status: {r.status_code}, Size: {len(r.content)}')
with open('test_api_dl.stl', 'wb') as f:
    f.write(r.content)
