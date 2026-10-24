import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const base = process.env.DEMO_URL ?? 'http://localhost:3109';
const evidence = fileURLToPath(new URL('../../docs/evidence/t9/', import.meta.url));
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, viewport] of [['desktop', {width:1440,height:900}], ['mobile', {width:390,height:844}]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const disclosure = page.getByRole('complementary', {name:'Real versus simulated disclosure'});
    await disclosure.waitFor();
    await page.locator('canvas').waitFor();
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const button = page.getByRole('button', {name:'Send to Dana’s desk'});
    const control = await button.boundingBox();
    const panel = await disclosure.boundingBox();
    assert(control.y + control.height < panel.y, JSON.stringify({name,control,panel}));
    assert.equal(await disclosure.locator('li').count(),10);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await button.click();
    await page.waitForTimeout(200);
    const first = await page.locator('.agent-label.scene-label').getAttribute('style');
    await page.waitForTimeout(350);
    const second = await page.locator('.agent-label.scene-label').getAttribute('style');
    assert.notEqual(first,second,'avatar should move after target row changes');
    await page.screenshot({path:`${evidence}/office-rebased-${name}.png`,fullPage:true});
    await page.getByRole('combobox',{name:'View'}).selectOption('tween');
    await page.getByText('Fixed camera · tweened movement',{exact:true}).waitFor();
    await page.getByRole('combobox',{name:'View'}).selectOption('plan');
    await page.locator('.floor-plan').waitFor();
    await page.getByRole('button',{name:'Return to Collections'}).click();
    await page.getByText('Target: Collections',{exact:false}).waitFor();
    assert.deepEqual(errors,[]);
    console.log(`PASS ${name}: office motion, both fallbacks, 10 disclosure entries, controls above panel, no overflow or page errors`);
    await page.close();
  }
} finally { await browser.close(); }
