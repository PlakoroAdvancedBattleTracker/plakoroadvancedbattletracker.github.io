from pathlib import Path
import json,hashlib,zipfile,shutil,stat
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'_site'
if OUT.exists():shutil.rmtree(OUT)
OUT.mkdir()
manifest=json.loads((ROOT/'asset-manifest.json').read_text())
seen=set()
archives=sorted(ROOT.glob('website-*.zip'))
assert archives,'Website archives are missing'
for archive in archives:
 with zipfile.ZipFile(archive) as z:
  for item in z.infolist():
   p=Path(item.filename)
   assert not p.is_absolute() and '..' not in p.parts and not stat.S_ISLNK(item.external_attr>>16),item.filename
   assert item.filename in manifest and item.filename not in seen,item.filename
   data=z.read(item)
   assert hashlib.sha256(data).hexdigest()==manifest[item.filename],item.filename
   target=OUT/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);seen.add(item.filename)
assert seen==set(manifest),'The website package is incomplete'
assert (OUT/'index.html').is_file()
shutil.copy2(ROOT / 'rules.html', OUT / 'rules.html')
# The tracker toolbar lives in the verified archive.
toolbar = OUT / 'pokedices' / 'tracker-ui.js'
source = toolbar.read_text()
formats_button = """${pdButton('home','Formats')}"""
assert source.count(formats_button) == 1, "Advanced toolbar changed"
rules_link = '<a class="btn btn--sm" href="rules.html" target="_blank" rel="noopener">Rules</a>'
toolbar.write_text(source.replace(formats_button, formats_button + ' ' + rules_link))
print(f'Verified and built {len(seen)} website files.')
