const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium, _electron} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8765/Playground/pdf-reading-assist/';
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Local tests only');
const output = process.env.TEST_OUTPUT;
if (!output) throw new Error('TEST_OUTPUT must be an isolated temporary directory');

function syntheticPdf() {
  const stream = n => 'BT /F1 14 Tf 40 750 Td ' + Array.from({length:24}, (_,i) => (i ? '0 -25 Td ' : '') + `(Page ${n} reading line ${i+1}) Tj`).join('\n') + ' ET';
  const s1=stream(1), s2=stream(2);
  const objects = ['<< /Type /Catalog /Pages 2 0 R /OpenAction 8 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`, `<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`,
    '<< /S /JavaScript /JS (globalThis.pdfProof = 1;) >>']; // harmless marker, no external effects
  let pdf='%PDF-1.4\n', offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf)); pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const start=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n` + offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
  return Buffer.from(pdf+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}

(async()=>{
  await fs.mkdir(output,{recursive:true});
  const fixture=path.join(output,'synthetic-reading.pdf'); await fs.writeFile(fixture,syntheticPdf());
  const appSource=await fs.readFile(path.join(__dirname,'..','app.js'),'utf8');
  assert(appSource.includes('isEvalSupported: false'));
  assert(!/PDFScriptingManager|new PDFViewer|enableScripting: true/.test(appSource));
  const hashes={ 'pdf.min.mjs':'57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2', 'pdf.worker.min.mjs':'9536359f1b8367850d485731ca1d5e45c159a7b7a0912325e539937aa21ceb18'};
  for (const [name,hash] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(__dirname,'..','vendor',name))).digest('hex'),hash);
  const errors=[], workers=[], remote=[], posts=[];
  const browser=await chromium.launch({channel:'chrome',headless:true}); const context=await browser.newContext(); const page=await context.newPage();
  page.setDefaultTimeout(10000); page.on('pageerror',e=>errors.push(String(e)));
  page.on('console', msg=>{if(msg.type()==='error' && !msg.text().includes('404')) errors.push(msg.text());});
  page.on('worker',worker=>workers.push(worker.url()));
  await context.route('**/*',route=>{
    const request=route.request(); if(request.method()==='POST') posts.push(request.url());
    if(new URL(request.url()).hostname!=='127.0.0.1'){remote.push(request.url());return route.abort();} return route.continue();
  });
  const checkPdf=async (p,hiddenWindow=false)=>{
    await p.locator('#file-input').setInputFiles(fixture);
    await p.waitForFunction(()=>document.querySelector('#line-status').textContent==='48行検出');
    await p.waitForFunction(()=>document.querySelector('#pages canvas')?.width>0);
    assert.equal(await p.locator('#page-count').innerText(),'2');
    assert.equal(await p.evaluate(()=>globalThis.pdfProof),undefined);
    const guideBefore=await p.locator('#viewer').evaluate(el=>el.style.getPropertyValue('--guide-y'));
    await p.locator('#line-down').click();
    assert.notEqual(await p.locator('#viewer').evaluate(el=>el.style.getPropertyValue('--guide-y')),guideBefore);
    await p.locator('#line-up').click();
    const zoomBefore=await p.locator('#zoom-value').innerText(); await p.locator('#zoom-in').click();
    await p.waitForFunction(before=>document.querySelector('#zoom-value').textContent!==before,zoomBefore);
    await p.locator('#zoom-out').click();
    await p.locator('#settings-open').click();
    await p.locator('#guide-height').evaluate(el=>{el.value='48';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await p.locator('#guide-opacity').evaluate(el=>{el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await p.locator('#guide-height-value').innerText(),'48px');
    await p.locator('#settings-close').click();
    await p.locator('#guide-toggle').click(); assert((await p.locator('#viewer').getAttribute('class')).includes('guide-off')); await p.locator('#guide-toggle').click();
    await p.locator('#next-page').click();
    // A hidden native window does not produce smooth-scroll animation frames.
    // The browser branch tests that UI path; use an instant scroll here to test storage.
    if(hiddenWindow) await p.locator('#page-scroll').evaluate(el=>el.scrollTo({top:830,behavior:'instant'}));
    await p.waitForTimeout(700);
    await p.locator('#line-down').click(); await p.waitForTimeout(300);
    const saved=await p.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('readingAssist.position.'));return JSON.parse(localStorage.getItem(key));});
    assert(saved && saved.scrollTop>0,JSON.stringify({saved,keys:await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage))),scroll:await p.locator('#page-scroll').evaluate(el=>({top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight}))}));
    return saved;
  };
  await page.goto(base);
  const version=await page.evaluate(async()=> (await import('./vendor/pdf.min.mjs')).version); assert.equal(version,'6.4.299');
  const saved=await checkPdf(page);
  await page.reload(); await page.locator('#file-input').setInputFiles(fixture);
  await page.waitForFunction(()=>document.querySelector('#line-status').textContent==='48行検出');
  await page.waitForFunction(top=>Math.abs(document.querySelector('#page-scroll').scrollTop-top)<3,saved.scrollTop);
  assert.equal(await page.locator('#guide-height-value').innerText(),'48px');
  const restored=await page.locator('#page-scroll').evaluate(el=>el.scrollTop);
  assert(Math.abs(restored-saved.scrollTop)<3, JSON.stringify({saved,restored,current:await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)))}));
  assert(workers.some(url=>url.endsWith('/vendor/pdf.worker.min.mjs')));
  assert.equal(errors.length,0,errors.join('\n')); assert.equal(remote.length,0); assert.equal(posts.length,0);
  await page.screenshot({path:path.join(output,'pdf-browser.png'),fullPage:true});
  await browser.close();
  console.log('PASS: PDF.js 6.4.299 official hashes, matching worker, 2-page display/48 lines, zoom/line steps/guide settings/save-restore, harmless JS action unused, no external requests');
  if(process.env.ELECTRON_EXE){
    const electronEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE'));
    const profile=path.join(output,'electron-profile-'+crypto.randomUUID());
    const electron=await _electron.launch({executablePath:process.env.ELECTRON_EXE,args:['--user-data-dir='+profile],env:electronEnv});
    assert((await electron.evaluate(({app})=>app.getPath('userData'))).startsWith(output));
    const win=await electron.firstWindow(); await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.webContents.setBackgroundThrottling(false);w.hide();}));
    const desktopErrors=[]; win.on('pageerror',e=>desktopErrors.push(String(e)));
    win.on('console',msg=>console.log('ELECTRON '+msg.type()+': '+msg.text()));
    win.on('requestfailed',req=>console.log('ELECTRON request failed: '+req.url()+' '+req.failure()?.errorText));
    win.setDefaultTimeout(10000);
    await win.waitForLoadState('load');
    try { await checkPdf(win,true); } catch (error) {
      console.error('ELECTRON state:', await win.evaluate(()=>({url:location.href,toast:document.querySelector('#toast').textContent,readerHidden:document.querySelector('#reader').hidden,lines:document.querySelector('#line-status').textContent})),desktopErrors);
      await electron.close(); throw error;
    }
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.showInactive()));
    await win.screenshot({path:path.join(output,'pdf-desktop.png')});
    assert.equal(desktopErrors.length,0,desktopErrors.join('\n'));
    await electron.close(); console.log('PASS: Electron file:// startup/PDF/worker/lines/zoom/guide/save in isolated profile');
  } else console.log('SKIP: Electron launch (ELECTRON_EXE not supplied)');
})().catch(e=>{console.error(e);process.exit(1);});
