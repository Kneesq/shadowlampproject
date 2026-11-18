import esprima

with open('static/app.js', encoding='utf-8') as f:
    code = f.read()

tree = esprima.parseScript(code, {'tolerant': True, 'loc': True})

# Collect all top-level global variables
globals_set = {
    'THREE', 'OrbitControls', 'window', 'document', 'console', 'Math', 'Uint8Array', 'Float32Array',
    'FileReader', 'Image', 'FormData', 'JSON', 'Array', 'parseFloat', 'parseInt', 'requestAnimationFrame',
    'devicePixelRatio', 'setTimeout', 'clearTimeout', 'fetch', 'File', 'Blob', 'URL', 'Event', 'alert'
}

for node in tree.body:
    if node.type == 'VariableDeclaration':
        for decl in node.declarations:
            globals_set.add(decl.id.name)
    elif node.type == 'FunctionDeclaration':
        globals_set.add(node.id.name)

# Now check each function for undefined variables
def check_node(node, local_scope, func_name):
    if not node:
        return
    
    # New scope on function declaration or expression
    if node.type in ('FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'):
        new_scope = set(local_scope)
        for param in node.params:
            if param.type == 'Identifier':
                new_scope.add(param.name)
        # Pre-scan body for vars/consts
        scan_vars(node.body, new_scope)
        check_node(node.body, new_scope, getattr(node.id, 'name', func_name))
        return

    # Check variable usage
    if node.type == 'Identifier':
        # Don't check if it's a property in object member expression e.g. obj.prop
        name = node.name
        if name not in local_scope and name not in globals_set:
            print(f"Undefined variable '{name}' in function '{func_name}' at line {getattr(node.loc, 'start', {}).line}")

    # Recursive traversal
    for key, value in node.__dict__.items():
        if key in ('loc', 'range', 'comments'):
            continue
        if isinstance(value, list):
            for item in value:
                if hasattr(item, 'type'):
                    check_child(node, key, item, local_scope, func_name)
        elif hasattr(value, 'type'):
            check_child(node, key, value, local_scope, func_name)

def check_child(parent, prop, child, local_scope, func_name):
    if parent.type == 'MemberExpression' and prop == 'property' and not parent.computed:
        return # Skip obj.prop
    if parent.type == 'Property' and prop == 'key' and not parent.computed:
        return # Skip { key: val }
    if parent.type == 'VariableDeclarator' and prop == 'id':
        return # Skip const id = ...
    check_node(child, local_scope, func_name)

def scan_vars(node, scope):
    if not node or not hasattr(node, '__dict__'):
        return
    if node.type == 'VariableDeclaration':
        for decl in node.declarations:
            if decl.id.type == 'Identifier':
                scope.add(decl.id.name)
    for key, value in node.__dict__.items():
        if isinstance(value, list):
            for item in value:
                scan_vars(item, scope)
        elif hasattr(value, 'type'):
            scan_vars(value, scope)

for node in tree.body:
    if node.type == 'FunctionDeclaration':
        check_node(node, set(), node.id.name)

print("Scan complete.")
