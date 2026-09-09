from pathlib import Path
import hashlib,json,subprocess,time
root=Path('/Users/chris/sources/yoizen/platform-cluster')
p=root/'manual-loops/architecture/platform-evaluation-config-parent-repair/active'
for n,h in json.loads((p/'handoff.json').read_text()).items():
 assert hashlib.sha256((root/n).read_bytes()).hexdigest()==h,n
with (p/'dispatch-once.json').open('x') as f:json.dump({'started':time.time()},f)
results=[]
for c in json.loads((p/'commands.json').read_text()):
 with (p/(c['id']+'-started.json')).open('x') as f:json.dump(c,f)
 start=time.monotonic()
 r=subprocess.run(c['argv'],cwd=root,capture_output=True,text=True)
 item=dict(c,exit_code=r.returncode,duration_seconds=time.monotonic()-start,stdout=r.stdout,stderr=r.stderr)
 with (p/(c['id']+'-result.json')).open('x') as f:json.dump(item,f,indent=2)
 results.append(item)
 print(json.dumps(item),flush=True)
 if r.returncode:break
with (p/'gate-results.json').open('x') as f:json.dump(results,f,indent=2)
