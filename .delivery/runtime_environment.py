"""CI-only name allowlist adapter. No values in source/schema or build jobs."""
import json
from pathlib import Path


def from_environment(environ):
    schema=json.loads(Path('.delivery/runtime-schema.json').read_text())
    approved=json.loads(environ.get('RUNTIME_ALLOWED_SECRET_NAMES','[]'))
    if not isinstance(approved,list)or not all(isinstance(k,str)for k in approved):
        raise ValueError('Invalid canonical environment secret-name list')
    result={}
    for component,policy in schema['components'].items():
        fields={}
        for key in policy['public_names']+policy['secret_names']:
            value=environ.get(key,'') if key not in policy['secret_names'] or key in approved else ''
            if not value:
                value=policy.get('defaults',{}).get(key,policy.get('secret_defaults',{}).get(key,''))
            if not isinstance(value,str)or'\n'in value or'\r'in value or'\0'in value:
                raise ValueError('Invalid single-line runtime input: '+key)
            if key in policy['required_secret_names']and (key not in approved or not value.strip()):
                raise ValueError('Missing required runtime input: '+key)
            fields[key]=value
        result[component]=fields
    return result
