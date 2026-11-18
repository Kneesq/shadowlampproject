import re

with open('static/index.html', encoding='utf-8') as f:
    html = f.read()
with open('static/app.js', encoding='utf-8') as f:
    js = f.read()

ids_in_html = set(re.findall(r'id=["\']([^"\']+)["\']', html))
ids_in_js = set(re.findall(r"getElementById\(form['\"]([^'\"]+)['\"]\)|getElementById\(['\"]([^'\"]+)['\"]", js))
flattened_js_ids = {a or b for a, b in ids_in_js}

missing = flattened_js_ids - ids_in_html
print('HTML IDs count:', len(ids_in_html))
print('JS IDs count:', len(flattened_js_ids))
print('Missing IDs in HTML needed by JS:', missing)
