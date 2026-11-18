import urllib.request

r = urllib.request.urlopen('http://127.0.0.1:5000/')
html = r.read().decode('utf-8')
print('Status:', r.status)
print('HTML length:', len(html))
print('Contains uploadZone:', 'uploadZone' in html)
for line in html.splitlines():
    if 'script' in line or 'uploadZone' in line:
        print('Line:', line)
