import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});const report=[];
for(const size of [{width:1440,height:900},{width:390,height:844}]){
  const ctx=await browser.newContext({viewport:size});const p=await ctx.newPage();const cdp=await ctx.newCDPSession(p);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  let bytes=0;const requests=[];cdp.on('Network.loadingFinished',e=>{bytes+=e.encodedDataLength;});cdp.on('Network.requestWillBeSent',e=>requests.push(e.request.url));
  await p.goto('http://127.0.0.1:4173/',{waitUntil:'networkidle'});await p.waitForFunction(()=>!document.querySelector('.loading')&&document.querySelector('canvas'));await p.waitForTimeout(300);
  report.push({viewport:size,initialBytes:bytes,initialMB:Math.round(bytes/10000)/100,requests:requests.length,highResolutionMediaInitiallyRequested:requests.some(u=>u.match(/art\/[^/]+-[01]\.webp/)),budgetMB:size.width>900?12:8});
  await p.screenshot({path:`artifacts/production-${size.width}.png`});await ctx.close();
}
await fs.writeFile('artifacts/transfer.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();
