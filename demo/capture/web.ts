import { chromium } from 'playwright';

import { PORTS } from './stage.ts';

/** A 1280×800 shot of a gnoweb page on the local chain, at 2× for a sharp zoom. */
export async function gnowebShot(path: string, file: string) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${PORTS.web}${path}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: file });
  } finally {
    await browser.close();
  }
}
