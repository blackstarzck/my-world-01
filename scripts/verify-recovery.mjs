import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
try{
 await page.route('**/models/gallery.glb',r=>r.abort());await page.goto('http://127.0.0.1:5173/');await page.locator('.flat-notice').waitFor();
 await page.unroute('**/models/gallery.glb');await page.getByRole('button',{name:'3D 다시 시도',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('canvas')&&!document.querySelector('.loading')&&!document.querySelector('.flat-notice'));
 assert.equal(await page.locator('.is-flat').count(),0);
 await fs.writeFile('artifacts/recovery.json',JSON.stringify({modelLoadFailureFallback:true,retryRestores3D:true},null,2));console.log('PASS: failed model load falls back and retry restores 3D.');
}finally{await browser.close();}
