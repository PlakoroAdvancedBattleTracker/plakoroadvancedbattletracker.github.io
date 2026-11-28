import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const gitSha=b=>crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
const json=x=>JSON.stringify(x);
async function request(url,kind='json'){
 for(let attempt=0;attempt<3;attempt++)try{
  const headers={'User-Agent':'PlakoroAdvancedBattleTracker/1.0'};
  if(url.startsWith('https://api.github.com/')&&process.env.GITHUB_TOKEN)headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`;
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error(`Card source returned HTTP ${response.status}`);
  if(kind==='bytes')return Buffer.from(await response.arrayBuffer());
  return response[kind]();
 }catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
}
async function pool(items,fn){for(let i=0;i<items.length;i+=6)await Promise.all(items.slice(i,i+6).map(fn));}
function constant(source,name,value){const re=new RegExp('^const '+name+'=.*;$','m');if(!re.test(source))throw Error('Missing catalogue constant '+name);return source.replace(re,()=>`const ${name}=${json(value)};`);}
export async function refresh(out,fetcher=request){
 const oldSource=await fs.readFile(path.join(out,'data.js'),'utf8');
 const scope=vm.createContext({});vm.runInContext(oldSource,scope);
 const oldLegacy=vm.runInContext('CHRONICLE_DB',scope);
 const parsers=vm.createContext({window:{},module:{exports:{}}});
 vm.runInContext(await fs.readFile(path.join(out,'plakorodb-source.js'),'utf8'),parsers);
 const source=parsers.module.exports;
 const commit=await fetcher('https://api.github.com/repos/'+source.REPO+'/commits/main');
 if(!/^[a-f0-9]{40}$/.test(commit.sha))throw Error('Invalid modern repository version');
 const tree=await fetcher('https://api.github.com/repos/'+source.REPO+'/git/trees/'+commit.sha+'?recursive=1');tree.sha=commit.sha;
 const texts={};await pool(source.textPaths(tree),async p=>{texts[p]=await fetcher(source.RAW+commit.sha+'/'+p,'text');});
 const modern=source.parse(tree,texts);modern.syncedAt=Date.now();
 // Publication is all-or-nothing. Keep all already-included card identities.
 const previous=vm.runInContext('PLAKORO_BUNDLE',scope);
 const incoming=new Set([...modern.characters,...modern.moves].map(x=>x.code));
 for(const card of [...previous.characters,...previous.moves])if(!incoming.has(card.code))throw Error('Modern source is missing included card '+card.code);
 await pool(source.assets(modern),async a=>{
  const file=path.join(out,a.key);let data;
  try{const local=await fs.readFile(file);if(gitSha(local)===a.sha)data=local;}catch{}
  const cached=path.join('.card-refresh-cache','modern',a.sha+'.png');
  if(!data)try{data=await fs.readFile(cached);}catch{}
  if(!data)data=await fetcher(a.url,'bytes');
  if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||gitSha(data)!==a.sha)throw Error('Invalid modern image '+a.key);
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data);
  await fs.mkdir(path.dirname(cached),{recursive:true});await fs.writeFile(cached,data);
 });
 vm.runInContext(await fs.readFile(path.join(out,'chronicle-og.js'),'utf8'),parsers);
 vm.runInContext(await fs.readFile(path.join(out,'legacy-source.js'),'utf8'),parsers);
 const legacy=JSON.parse(await fs.readFile(path.join(out,'published-chronicle.json'),'utf8'));
 const legacyIds=new Set([...legacy.pokemon,...legacy.moves].map(x=>x.code));
 for(const card of [...Object.values(oldLegacy.pokemon).map(p=>p.pokemon),...Object.values(oldLegacy.movePools).flat()])if(!legacyIds.has(card.code))throw Error('Original source is missing included card '+card.code);
 const names=modern.characters.map(p=>p.name),converted=parsers.window.AdvancedLegacySource.convert(legacy,names);
 const data={order:names,pokemon:Object.fromEntries(modern.characters.map(p=>[p.name,{pokemon:p,moves:modern.moves.filter(m=>m.owner===p.name)}]))};
 const meta=Object.fromEntries(modern.characters.map(p=>[p.name,{hp:p.hp,type:p.type,weakness:p.weakness}]));
 let rebuilt=oldSource;
 for(const [name,value]of Object.entries({DATA:data,POKEMON_META:meta,CHRONICLE_DB:converted,PLAKORO_BUNDLE:modern}))rebuilt=constant(rebuilt,name,value);
 const hashes=Object.fromEntries(source.assets(modern).map(a=>[a.key,a.sha]));
 rebuilt=`window.PLAKORO_PUBLISHED_ASSETS=${json(hashes)};\n`+rebuilt;
 await fs.writeFile(path.join(out,'data.js'),rebuilt);
 await fs.writeFile(path.join(out,'published-modern.json'),json(modern));
 await fs.writeFile(path.join(out,'chronicle-bundle.js'),`window.CHRONICLE_FEED_URL='published-chronicle.json';window.CHRONICLE_SOURCE_URL=${json(legacy.source)};window.CHRONICLE_DATA=${json(legacy)};\n`);
 await patchRuntime(out);
 const report={checkedAt:new Date().toISOString(),modernRevision:modern.sha,legacyRevision:legacy.revision,
  counts:{modernPokemon:modern.characters.length,modernMoves:modern.moves.length,legacyPokemon:converted.order.length,legacyMoves:Object.values(converted.movePools).flat().length}};
 await versionFiles(out,report);
 console.log('Published catalogue prepared:',json(report));return report;
}
export async function patchRuntime(out){
 const edit=async(file,fn)=>{const p=path.join(out,file);await fs.writeFile(p,fn(await fs.readFile(p,'utf8')));};
 await edit('app.js',s=>{
  s=s.replace('const asset=p=>cardUpdater?.asset(p)||PORTABLE_ASSETS[p]||p;',"const asset=p=>cardUpdater?.asset(p)||PORTABLE_ASSETS[p]||(window.PLAKORO_PUBLISHED_ASSETS?.[p]?p+'?v='+window.PLAKORO_PUBLISHED_ASSETS[p]:p);");
  s=s.replace('PlakoroDB is checked when you open the tracker and every 30 minutes while it is open.','The website refreshes its Pokémon and move cards automatically every 30 minutes. This tracker checks the published cards on opening and while you play.');
  s=s.replace("'Included cards: October 26, 2026'","'Included cards: '+esc(new Date(PLAKORO_BUNDLE.syncedAt).toLocaleString())");return s;
 });
 await edit('card-updates.js',s=>{
  const a=s.indexOf("     const commit=await request("),b=s.indexOf('     const assets=source.assets(catalog)',a);
  if(a<0||b<0)throw Error('Modern updater changed');
  s=s.slice(0,a)+`     const catalog=await request('published-modern.json');source.validate(catalog);
     const current=pending||active;
     if(catalog.sha===current.sha){
      const next={...(snapshot||{}),catalog:current,lastChecked:now()};await store.commit(next,[]);snapshot=next;state.lastChecked=next.lastChecked;
      state.message=pending?'Update downloaded. It will apply after your battle.':'Cards are up to date.';return;
     }
`+s.slice(b);
  return s.replace("request(a.url,'blob')","request(a.key+'?v='+a.sha,'blob')").replace('Checking PlakoroDB…','Checking published cards…');
 });
 await edit('chronicle-sync.js',s=>{
  s=s.replace("if(endpoint!=='https://plakoro-public-card-feed.rusty-grass1.chatgpt.site/api/chronicle')", "if(endpoint!=='published-chronicle.json')");
  s=s.replace('const url=new URL(endpoint);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);',"const url=new URL(endpoint,document.baseURI);url.searchParams.set('check',String(Date.now()));");
  s=s.replace("(?:chronicle-cards|chronicle)","(?:chronicle-cards|chronicle|published-cards)");
  const marker="   if(!/^drive:[A-Za-z0-9_-]+$/.test(card.image)";
  if(!s.includes(marker))throw Error('Original image downloader changed');
  s=s.replace(marker,`   if(/^published:[a-f0-9]{64}$/.test(card.imageSha)&&card.image==='published-cards/'+card.imageSha.slice(10)+'.png'){
    const old=previous.get(card.imageSha);
    if(png(old))card.image=old;
    else{if(!pending.has(card.imageSha))pending.set(card.imageSha,[]);pending.get(card.imageSha).push(card);}
    continue;
   }
`+marker);
  const block="      const asset=await request({action:'asset',format:'png',id,revision},signal);";
  if(!s.includes(block))throw Error('Original download worker changed');
  s=s.replace(block,`      if(sha.startsWith('published:')){
       image=await localImage(targets[0].image,signal);if(!png(image))throw invalid('Published card image is missing.');
       const raw=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0));
       const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(n=>n.toString(16).padStart(2,'0')).join('');
       if(hash!==sha.slice(10))throw invalid('Published card image verification failed.');
      }else{
`+block);
  s=s.replace('id=targets[0].driveId,revision=',"id=targets[0].driveId||'',revision=");
  s=s.replace('      image=asset.image;','      image=asset.image;\n      }');
  return s.replaceAll('Drive checks on opening','Published card checks on opening').replaceAll('Checking Chronicle Drive updates…','Checking published Legacy cards…');
 });
}
export async function versionFiles(out,report){
 const hash=async p=>sha256(await fs.readFile(path.join(out,p)));
 // Fingerprint every external script/style in both the standalone document
 // and the actual srcdoc template inside the PokéDices application.
 for(const file of ['tracker.html','pokedices/app.js']){
  let s=await fs.readFile(path.join(out,file),'utf8');const matches=[...s.matchAll(/\b(src|href)="([^"?#]+)(?:\?[^"#]*)?"/g)];
  for(const m of matches){const p=m[2];if(!/\.(js|css)$/.test(p)||p.includes('..')||p.startsWith('/')||p.includes(':'))continue;
   try{s=s.replaceAll(m[0],`${m[1]}="${p}?v=${await hash(p)}"`);}catch(e){throw Error('Missing startup asset '+p,{cause:e});}
  }
  await fs.writeFile(path.join(out,file),s);
 }
 const module='pokedices/app.js?v='+await hash('pokedices/app.js');
 let index=await fs.readFile(path.join(out,'index.html'),'utf8');
 const boot=`<script type="module">let module=${json(module)};try{const r=await fetch('site-release.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Release unavailable');const release=await r.json();if(!/^pokedices\\/app\\.js\\?v=[a-f0-9]{64}$/.test(release.module))throw Error('Invalid release');module=release.module}catch{}await import('./'+module);</script>`;
 index=index.replace(/<script type="module" src="pokedices\/app\.js[^\"]*"><\/script>/,()=>boot);
 index=index.replace('href="pokedices/style.css"','href="pokedices/style.css?v='+await hash('pokedices/style.css')+'"');
 await fs.writeFile(path.join(out,'index.html'),index);
 await fs.writeFile(path.join(out,'site-release.json'),json({...report,module}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await refresh(path.resolve(process.argv[2]||'_site'));
