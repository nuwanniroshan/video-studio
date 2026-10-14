/** `vs dev`: a local preview of the runtime with a scrubber. Same bundle the renderer captures. */
import http from "node:http";
import { prepare, serveProject } from "@vs/render";

const PAGE = (variants: string[]) => `<!doctype html><html><head><meta charset="utf-8"><title>vs dev</title>
<style>body{margin:0;background:#111;color:#ddd;font:14px system-ui;display:flex;flex-direction:column;height:100vh}
#bar{display:flex;gap:12px;align-items:center;padding:10px 14px;background:#1b1b1b}#bar input[type=range]{flex:1}
#wrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden}iframe{border:0;transform-origin:0 0;background:#000}
#lint{padding:6px 14px;color:#f0b429;font-size:12px;max-height:20vh;overflow:auto}</style></head><body>
<div id="bar"><select id="v">${variants.map((v) => `<option>${v}</option>`).join("")}</select><button id="play">Play</button>
<input id="t" type="range" min="0" step="0.001" value="0"><span id="time">0.00</span></div>
<div id="wrap"><div id="box"><iframe id="f"></iframe></div></div><div id="lint"></div>
<script>
let doc, playing=false, t0=0, start=0;
const f=document.getElementById('f'), t=document.getElementById('t'), time=document.getElementById('time');
async function boot(){
  const v=document.getElementById('v').value;
  doc=await (await fetch('/doc?variant='+v)).json();
  f.src=doc.origin+'/runtime/index.html'; f.width=doc.width; f.height=doc.height;
  await new Promise(r=>f.onload=r);
  const r=await f.contentWindow.__vs.load(doc);
  document.getElementById('lint').textContent=r.lint.map(l=>l.level+' ['+l.scene+'] '+l.code+': '+l.message).join('\\n');
  t.max=doc.duration; fit(); seek(+t.value);
}
function fit(){const w=document.getElementById('wrap'), s=Math.min(w.clientWidth/doc.width,w.clientHeight/doc.height)*.96;
  f.style.transform='scale('+s+')'; const b=document.getElementById('box'); b.style.width=doc.width*s+'px'; b.style.height=doc.height*s+'px';}
function seek(x){f.contentWindow.__vs.seek(x); time.textContent=x.toFixed(2)+' / '+doc.duration.toFixed(2);}
t.oninput=()=>seek(+t.value);
document.getElementById('v').onchange=boot;
document.getElementById('play').onclick=()=>{playing=!playing; t0=performance.now(); start=+t.value; if(playing) requestAnimationFrame(tick);};
function tick(now){ if(!playing) return; let x=start+(now-t0)/1000; if(x>=doc.duration){x=doc.duration;playing=false;} t.value=x; seek(x); requestAnimationFrame(tick);}
onresize=fit; boot();
</script></body></html>`;

export async function dev(specPath: string, variant: string | undefined, port: number) {
  let prep = await prepare(specPath);
  const srv = await serveProject(prep.project);
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    try {
      if (/^\/(runtime|brand|assets)\//.test(u.pathname)) {
        // proxy to the runtime server so the player iframe is same-origin with this page
        const up = http.request(srv.origin + u.pathname + u.search, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
        up.on("error", () => { res.writeHead(502); res.end(); });
        return void up.end();
      }
      if (u.pathname === "/doc") {
        prep = await prepare(specPath); // re-read the spec on every load (TTS is cached)
        const v = prep.variants.find((x) => x.id === (u.searchParams.get("variant") ?? variant)) ?? prep.variants[0];
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ ...v.doc, origin: "" }));
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE(prep.variants.map((v) => v.id)));
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String((e as Error).message));
    }
  });
  server.listen(port, "127.0.0.1", () => process.stderr.write(`vs dev: http://127.0.0.1:${port}  (runtime at ${srv.origin})\n`));
}
