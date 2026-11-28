"""Read the owner's public original-card folders without a visitor login."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import ast, hashlib, json, re, sys, time, urllib.request, warnings
from html.parser import HTMLParser

SOURCE = 'https://drive.google.com/drive/folders/1g7KX3NYqRm6mVtbo_hIkir_6QT27E-tW'
ROOT_ID = SOURCE.rsplit('/', 1)[-1]
PNG = b'\x89PNG\r\n\x1a\n'
CODE = re.compile(r'^(OG[CW]\d+(?:-\d+)+)(?:_[^/]+)?\.(koro|png)$')
CACHE = Path('.card-refresh-cache/drive')

def request(url, max_bytes=20_000_000):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'PlakoroAdvancedBattleTracker/1.0'})
            with urllib.request.urlopen(req, timeout=45) as response:
                data = response.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise ValueError('Card source exceeds the download limit')
            return data
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)

def parse_folder(text):
    match = re.search(r"window\['_DRIVE_ivd'\]\s*=\s*('(?:\\.|[^'\\])*')", text)
    if not match:
        raise ValueError('Public Drive folder listing is unavailable')
    # literal_eval accepts only a literal string, never executable page code.
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', SyntaxWarning)
        data = json.loads(ast.literal_eval(match[1]))
    if isinstance(data, list) and data[0] is None and data[1] is None:
        return []
    if not isinstance(data, list) or not isinstance(data[0], list) or data[1] is not None:
        raise ValueError('Drive folder listing is incomplete or paginated')
    rows = []
    for row in data[0]:
        if len(row) < 14 or not re.fullmatch(r'[\w-]+', row[0]):
            raise ValueError('Invalid Drive file metadata')
        rows.append({'id': row[0], 'name': row[2], 'mime': row[3],
                     'modified': row[10], 'size': row[13]})
    return rows

class EmbeddedEntries(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows = []; self.current = None; self.depth = 0; self.title = False
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'div':
            if 'flip-entry' in attrs.get('class', '').split():
                self.current = {'id': attrs['id'].removeprefix('entry-'), 'name': '', 'mime': 'application/octet-stream', 'modified': None, 'size': None}; self.depth = 1
            elif self.current:
                self.depth += 1
                if attrs.get('class') == 'flip-entry-title': self.title = True
        if self.current and tag == 'a' and '/drive/folders/' in attrs.get('href', ''):
            self.current['mime'] = 'application/vnd.google-apps.folder'
    def handle_endtag(self, tag):
        if tag == 'div' and self.current:
            self.depth -= 1
            if self.title: self.title = False
            if self.depth == 0:
                self.rows.append(self.current); self.current = None
    def handle_data(self, data):
        if self.current and self.title: self.current['name'] += data

def folder(item):
    try:
        rows = parse_folder(request('https://drive.google.com/drive/folders/' + item['id']).decode())
        if len(rows) >= 50:
            text = request('https://drive.google.com/embeddedfolderview?id=' + item['id']).decode()
            if 'flip-entries' not in text: raise ValueError('Complete folder listing is unavailable')
            parser = EmbeddedEntries(); parser.feed(text)
            known = {x['id']: x for x in rows}
            rows = [known.get(x['id'], x) for x in parser.rows]
            if len(rows) < len(known): raise ValueError('Complete folder listing is truncated')
        return rows
    except ValueError as error:
        raise ValueError(str(error) + ': ' + item.get('name', item['id'])) from error

def parallel(fn, items):
    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(fn, items))

def is_folder(item):
    return item['mime'] == 'application/vnd.google-apps.folder'

def discover():
    roots = folder({'id': ROOT_ID})
    edition = next(x for x in roots if x['name'] == '1997' and is_folder(x))
    products = [x for x in folder(edition) if is_folder(x)]
    print(f'Checking {len(products)} public 1997 product folders…', flush=True)
    originals = [x for listing in parallel(folder, products) for x in listing
                 if is_folder(x) and x['name'] == 'OGs']
    if not originals:
        raise ValueError('Original card folders are missing')
    pending, result, seen = originals, {}, set()
    while pending:
        print(f'Checking {len(pending)} OG card folders…', flush=True)
        current = [x for x in pending if x['id'] not in seen]
        seen.update(x['id'] for x in current)
        pending = []
        for listing in parallel(folder, current):
            for item in listing:
                if is_folder(item):
                    if item['name'] not in ('REs', 'JP'):
                        pending.append(item)
                elif CODE.fullmatch(item['name']):
                    match = CODE.fullmatch(item['name']); key = match[1] + '.' + match[2]
                    if key in result and result[key]['id'] != item['id']:
                        raise ValueError('Duplicate original card file: ' + key)
                    result[key] = item
        if len(seen) > 500:
            raise ValueError('Unexpected Drive folder depth')
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / 'last-listing.json').write_text(json.dumps(result))
    print(f'Checked {len(products)} products and {len(seen)} OG folders; found {len(result)} files.', flush=True)
    return result

def download(item):
    signature = hashlib.sha256(json.dumps([item['id'], item['modified'], item['size']]).encode()).hexdigest()
    suffix = Path(item['name']).suffix
    path = CACHE / (signature + suffix)
    if path.exists() and item['modified'] is not None:
        data = path.read_bytes()
    else:
        data = request('https://drive.google.com/uc?export=download&id=' + item['id'], 80_000_000 if suffix == '.koro' else 20_000_000)
        if suffix == '.png' and not data.startswith(PNG):
            raise ValueError('Invalid original PNG: ' + item['name'])
        if suffix == '.koro':
            fields = json.loads(data); fields.pop('mon_data', None)
            data = json.dumps(fields).encode()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    if suffix == '.png' and (not data.startswith(PNG) or item['size'] is not None and len(data) != int(item['size'])):
        raise ValueError('Invalid or incomplete original PNG: ' + item['name'])
    if suffix == '.koro' and not isinstance(json.loads(data), dict):
        raise ValueError('Invalid typed card: ' + item['name'])
    return data

def main(out):
    files = json.loads((CACHE / 'last-listing.json').read_text()) if '--reuse-listing' in sys.argv else discover()
    koros = sorted(name for name in files if name.endswith('.koro'))
    if not koros:
        raise ValueError('No typed original cards were found')
    for name in koros:
        if name[:-5] + '.png' not in files:
            raise ValueError('Upload is incomplete: ' + name + ' has no PNG')
    jobs = [(n, files[n]) for name in koros for n in (name, name[:-5] + '.png')]
    blobs = dict(zip((name for name, _ in jobs), parallel(download, [item for _, item in jobs])))
    cards = []
    for name in koros:
        code = name[:-5]
        fields = json.loads(blobs[name]); fields.pop('mon_data', None)
        png = blobs[code + '.png']; digest = hashlib.sha256(png).hexdigest()
        image = 'published-cards/' + digest + '.png'
        (out / 'published-cards').mkdir(exist_ok=True)
        (out / image).write_bytes(png)
        cards.append({'id': code, 'code': code, 'name': str(fields.get('mon_name' if code.startswith('OGC') else 'move_name', '')).strip(),
                      'year': 1997, 'edition': 'OG', 'image': image, 'imageSha': 'published:' + digest,
                      'sourceUrl': 'https://drive.google.com/file/d/' + files[name]['id'] + '/view',
                      'sourcePath': '1997/OGs/' + name, 'battle': {'schema': 1, 'fields': fields}})
    checked = datetime.now(timezone.utc).isoformat()
    revision = hashlib.sha256(json.dumps(cards, sort_keys=True).encode()).hexdigest()
    feed = {'version': 1, 'complete': True, 'source': SOURCE, 'revision': revision,
            'snapshotDate': checked, 'checkedAt': checked, 'status': 'published', 'cardPolicy': 'og-only',
            'pokemon': [], 'moves': []}
    types = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'dark', 'steel', 'dragon', 'flying', 'normal']
    for card in cards:
        f = card['battle']['fields']
        if card['code'].startswith('OGC'):
            hp = float(str(f.get('hp', '')).strip()); hp = hp * 10 if hp < 30 else hp
            card.update(hp=hp, type=types[f['type']], weakness='', moves=[])
            card['editions'] = {'OG': dict(card)}
            feed['pokemon'].append(card)
        else:
            card.update(owner=str(f.get('mon_name', '')).strip(), species=str(f.get('mon_name', '')).strip())
            feed['moves'].append(card)
    (out / 'published-chronicle.json').write_text(json.dumps(feed, ensure_ascii=False, separators=(',', ':')))
    print(f'Read {len(feed["pokemon"])} original Pokémon and {len(feed["moves"])} moves.', flush=True)

if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else '_site'))
