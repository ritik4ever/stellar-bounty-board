import re

with open('src/test.rs', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix all 6-element setup_test destructuring patterns - add a 7th wildcard
replacements = [
    # 6-element all wildcards
    (r'\(client, _, _, _, _, _\) = setup_test\(&env\)',
     '(client, _, _, _, _, _, _) = setup_test(&env)'),
    # 6-element with arbiter at end
    (r'\(client, _, _, _, _, arbiter\) = setup_test\(&env\)',
     '(client, _, _, _, _, _, arbiter) = setup_test(&env)'),
    # 6-element with maintainer, _, token_id, _, _
    (r'\(client, maintainer, _, token_id, _, _\) = setup_test\(&env\)',
     '(client, maintainer, _, token_id, _, _, _) = setup_test(&env)'),
    # 6-element with maintainer, _, token_id, _, arbiter
    (r'\(client, maintainer, _, token_id, _, arbiter\) = setup_test\(&env\)',
     '(client, maintainer, _, token_id, _, _, arbiter) = setup_test(&env)'),
    # 6-element with maintainer, contributor, token_id, _, _
    (r'\(client, maintainer, contributor, token_id, _, _\) = setup_test\(&env\)',
     '(client, maintainer, contributor, token_id, _, _, _) = setup_test(&env)'),
    # 6-element with maintainer, contributor1, token_id, _, _
    (r'\(client, maintainer, contributor1, token_id, _, _\) = setup_test\(&env\)',
     '(client, maintainer, contributor1, token_id, _, _, _) = setup_test(&env)'),
    # 6-element with maintainer, _contributor, token_id, _, _
    (r'\(client, maintainer, _contributor, token_id, _, _\) = setup_test\(&env\)',
     '(client, maintainer, _contributor, token_id, _, _, _) = setup_test(&env)'),
    # 6-element with _, contributor, _, _, _
    (r'\(client, _, contributor, _, _, _\) = setup_test\(&env\)',
     '(client, _, contributor, _, _, _, _) = setup_test(&env)'),
]

for pattern, replacement in replacements:
    content = re.sub(pattern, replacement, content)

# Fix the .len() calls on ContractEvents - use .events().len() instead
content = content.replace(
    'env.events().all().len()',
    'env.events().all().events().len()'
)

with open('src/test.rs', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done! Replacements applied.")
