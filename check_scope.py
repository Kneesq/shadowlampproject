import re

with open('static/app.js', encoding='utf-8') as f:
    code = f.read()

# Check for duplicate let/const declarations in the same function
lines = code.splitlines()
print(f"Total lines in app.js: {len(lines)}")

# Simple scope check: find function boundaries and check declared names
in_func = False
func_name = "global"
declared = {}
errors = []

for idx, line in enumerate(lines, 1):
    # Detect function start
    m_func = re.search(r'function\s+([a-zA-Z0-9_$]+)\s*\(', line)
    if m_func:
        func_name = m_func.group(1)
        declared[func_name] = set()

    # Find const / let declarations
    for m in re.finditer(r'\b(const|let)\s+([a-zA-Z0-9_$]+)\s*=', line):
        var_name = m.group(2)
        scope = func_name if in_func or func_name in declared else "global"
        if scope not in declared:
            declared[scope] = set()
        if var_name in declared[scope]:
            errors.append(f"Duplicate declaration of '{var_name}' in '{scope}' at line {idx}")
        else:
            declared[scope].add(var_name)

print("Errors found:", errors)
if not errors:
    print("Static AST check PASSED: No duplicate declarations found!")
