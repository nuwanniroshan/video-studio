import { chromium, type Browser, type CDPSession, type Page } from "playwright";
import type { LoadResult, RuntimeDoc } from "@vs/runtime";

export interface OpenedPage { browser: Browser; page: Page; cdp: CDPSession; load: LoadResult; errors: string[] }

export const CHROMIUM_ARGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--font-render-hinting=none", "--hide-scrollbars"];

/** One Chromium per worker: pages sharing a browser serialise on its compositor (1.0 vs 6.6 fps). */
export async function openPage(origin: string, doc: RuntimeDoc, scale = 1): Promise<OpenedPage> {
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: { width: doc.width, height: doc.height }, deviceScaleFactor: scale });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  // Block every origin except our own localhost server.
  await page.route("**/*", (route) => {
    const u = route.request().url();
    return u.startsWith(origin + "/") || u.startsWith("data:") ? route.continue() : route.abort("blockedbyclient");
  });
  await page.goto(`${origin}/runtime/index.html`);
  await page.waitForFunction(() => (window as any).__vs !== undefined);
  const load = (await page.evaluate((d) => (window as any).__vs.load(d), doc)) as LoadResult;
  if (errors.length) throw new Error(errors.join("\n"));
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, cdp, load, errors };
}

export async function seek(page: Page, t: number) {
  await page.evaluate((tt) => (window as any).__vs.seek(tt), t);
}

export async function capture(cdp: CDPSession, format: "png" | "jpeg", quality?: number): Promise<Buffer> {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format, quality: format === "jpeg" ? quality : undefined, optimizeForSpeed: true, captureBeyondViewport: false,
  });
  return Buffer.from(data, "base64");
}
