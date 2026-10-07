/*
 * Serves the runtime, brand kits and assets on http://127.0.0.1:<random port>. The renderer
 * blocks every other origin with page.route, so page content can never reach file:// or the network.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { runtimeDist } from "@vs/runtime/paths";
import { brandCss, type BrandKit } from "@vs/brand";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff2": "font/woff2", ".woff": "font/woff",
};

export interface ServeOptions { brandsDir: string; assetsDir?: string }
export interface Served { origin: string; close(): Promise<void> }

function safeJoin(root: string, rel: string): string | null {
  const p = path.resolve(root, "." + path.posix.normalize("/" + decodeURIComponent(rel)));
  return p.startsWith(path.resolve(root) + path.sep) ? p : null;
}

export async function serve(opt: ServeOptions): Promise<Served> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let file: string | null = null;
    let m: RegExpMatchArray | null;
    if ((m = url.pathname.match(/^\/brand\/([a-z0-9-]+)\/brand\.css$/))) {
      const kitPath = path.join(opt.brandsDir, m[1], "brand.json");
      if (!fs.existsSync(kitPath)) return void res.writeHead(404).end();
      const kit = JSON.parse(fs.readFileSync(kitPath, "utf8")) as BrandKit;
      res.writeHead(200, { "content-type": MIME[".css"] });
      return void res.end(brandCss(kit, `/brand/${m[1]}/`));
    }
    if ((m = url.pathname.match(/^\/brand\/([a-z0-9-]+)\/(.+)$/))) file = safeJoin(path.join(opt.brandsDir, m[1]), m[2]);
    else if ((m = url.pathname.match(/^\/assets\/(.+)$/)) && opt.assetsDir) file = safeJoin(opt.assetsDir, m[1]);
    else if ((m = url.pathname.match(/^\/runtime\/(.*)$/))) file = safeJoin(runtimeDist, m[1] || "index.html");
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "access-control-allow-origin": "null" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}
