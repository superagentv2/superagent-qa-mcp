from pathlib import Path
import json,os,subprocess,sys
config=json.loads(Path('.delivery/project.json').read_text())
sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
assert sha==os.environ['GITHUB_SHA'], 'checkout SHA differs from Actions identity'
assert os.environ['GITHUB_REF']=='refs/heads/migration/aws-dev'
assert not Path('src/main/resources/config/docusign-private.key').exists(), 'tracked provider key must be removed BEFORE AWS checkout'
assert not any(p.is_file() for p in Path('artifacts').rglob('*')), 'historical artifact exports must be removed BEFORE AWS checkout'
if config['project']=='superagent-dev-agent':
    assert not any(p.is_file() and p.name!='README.md' for p in Path('simulations').rglob('*')), 'captured simulations must be removed BEFORE AWS checkout'
if sys.argv[1]=='image':
    release=sha+'-'+os.environ['GITHUB_RUN_ID']+'-'+os.environ['GITHUB_RUN_ATTEMPT']
    image=config['registry']+'/'+next(iter(config['images'].values()))['repository']+':'+release
    details=json.loads(subprocess.check_output(['podman','image','inspect',image],text=True))[0]
    assert details['Labels']['org.opencontainers.image.revision']==sha
