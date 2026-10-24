import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=> 'Vega SmartTV control test'}));
});
for(const [buttonName,dialogName] of [['Subtitles','Subtitle tracks'],['Change server','Servers']]){
 test('first OK opens '+buttonName+' after playing idle without stealing focus',async({page})=>{
  await page.goto('/tests/browser/controls.html');
  await page.evaluate(()=>window.controlTest.loadServers());
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('button',{name:'Play',exact:true}).click();
  const button=page.getByRole('button',{name:buttonName,exact:true});
  await button.focus();
  // Exceed Vidstack's default idle timeout while our TV controls remain focused.
  await page.waitForTimeout(2700);
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog',{name:dialogName,exact:true})).toBeVisible();
  const focused=await page.evaluate(()=>document.activeElement?.textContent);
  await page.waitForTimeout(2700);
  expect(await page.evaluate(()=>document.activeElement?.textContent)).toBe(focused);
  if(buttonName==='Change server'){
   await page.keyboard.press('ArrowDown');
   await page.keyboard.press('Enter');
   expect(await page.evaluate(()=>window.controlTest.calls.filter(call=>call[0]==='server-change'))).toEqual([['server-change','server-1',30]]);
  }
 });
}
test('Vidstack controls use libmedia manager and reflect remote state',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/tests/browser/controls.html');
 await expect(page.getByRole('slider',{name:'Playback position'})).toHaveAttribute('aria-valuenow','25');
 expect(await page.evaluate(()=>window.controlTest.calls)).toEqual([]);
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 await page.getByRole('button',{name:'Forward 10 seconds',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().currentTime)).toBe(40);
 await page.getByRole('button',{name:'Mute',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().isMuted)).toBe(true);
 const timeline=page.getByRole('slider',{name:'Playback position'});
 await timeline.focus();await timeline.press('Enter');await timeline.press('ArrowRight');await timeline.press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().currentTime)).toBeGreaterThan(40);
 const volume=page.getByRole('slider',{name:'Volume'});
 await volume.focus();await volume.press('Enter');await volume.press('ArrowLeft');await volume.press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().volume)).toBeLessThan(1);
 await page.evaluate(()=>window.controlTest.update({status:'playing',currentTime:90}));
 await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
 await expect(timeline).toHaveAttribute('aria-valuenow','75');
 await expect(timeline).toHaveAttribute('aria-valuetext','1 min 30 sec out of 2 min');
 await page.screenshot({path:'test-results/vidstack-controls.png'});
 expect(await page.locator('video,audio').count()).toBe(0);
 expect(errors).toEqual([]);
});
test('source replacement preserves manager preferences and re-enables seeking',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
 await page.evaluate(()=>window.controlTest.update({status:'loading',duration:0,currentTime:0}));
 await page.evaluate(()=>window.controlTest.update({status:'paused',duration:240,currentTime:60,volume:.4,isMuted:true,playbackRate:1.5}));
 await expect(page.getByRole('slider',{name:'Playback position'})).toHaveAttribute('aria-valuenow','25');
 await expect(page.getByRole('button',{name:'Unmute',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.controlTest.calls)).toEqual([]);
 await page.getByRole('button',{name:'Forward 10 seconds',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().currentTime)).toBe(70);
 await page.getByRole('button',{name:'Playback speed',exact:true}).click();
 await page.getByRole('radio',{name:'2x',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().playbackRate)).toBe(2);
});
test('remote arrows navigate controls until OK enters adjustment mode',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 const volume=page.getByRole('slider',{name:'Volume'});
 const timeline=page.getByRole('slider',{name:'Playback position'});
 const speed=page.getByRole('button',{name:'Playback speed',exact:true});
 await page.getByRole('button',{name:'Mute',exact:true}).focus();
 await page.keyboard.press('ArrowRight');
 await expect(volume).toBeFocused();
 await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('button',{name:'Audio tracks',exact:true})).toBeFocused();
 expect(await page.evaluate(()=>window.controlTest.calls)).toEqual([]);
 await volume.focus();await page.keyboard.press('Enter');
 await page.keyboard.press('ArrowLeft',{delay:50});
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().volume)).toBe(.95);
 await page.keyboard.press('ArrowLeft',{delay:50});
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().volume)).toBeLessThan(.95);
 await page.keyboard.press('Escape');
 await expect(volume).toBeFocused();await expect(volume).not.toHaveAttribute('data-remote-editing');
 const volumeAfter=await page.evaluate(()=>window.controlTest.getState().volume);
 await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('button',{name:'Audio tracks',exact:true})).toBeFocused();
 expect(await page.evaluate(()=>window.controlTest.getState().volume)).toBe(volumeAfter);
 await timeline.focus();await page.keyboard.press('ArrowRight');
 expect(await page.evaluate(()=>window.controlTest.getState().currentTime)).toBe(30);
 await page.keyboard.press('ArrowDown');
 await expect(timeline).not.toBeFocused();
 await timeline.focus();await page.keyboard.press('Enter');await page.keyboard.press('ArrowRight');
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().currentTime)).toBeGreaterThan(30);
 await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');
 await expect(timeline).not.toBeFocused();
 await speed.focus();await page.keyboard.press('ArrowRight');
 expect(await page.evaluate(()=>window.controlTest.getState().playbackRate)).toBe(1);
 await expect(page.getByRole('button',{name:'Playback diagnostics',exact:true})).toBeFocused();
 await speed.focus();await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('radio',{name:'1.25x',exact:true})).toBeFocused();
 expect(await page.evaluate(()=>window.controlTest.getState().playbackRate)).toBe(1);
 await page.keyboard.press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().playbackRate)).toBe(1.25);
 await page.keyboard.press('Escape');await page.keyboard.press('ArrowLeft');
 await expect(page.getByRole('button',{name:'Subtitles',exact:true})).toBeFocused();
});
test('arrival key release never adjusts the newly focused slider',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.evaluate(()=>window.controlTest.update({volume:.5}));
 const volume=page.getByRole('slider',{name:'Volume'});
 const timeline=page.getByRole('slider',{name:'Playback position'});
 await expect(volume).toHaveAttribute('aria-valuenow','50');
 await page.getByRole('button',{name:'Audio tracks',exact:true}).focus();
 await page.keyboard.down('ArrowLeft');
 await expect(volume).toBeFocused();
 await page.keyboard.up('ArrowLeft');
 expect(await page.evaluate(()=>window.controlTest.getState().volume)).toBe(.5);
 await expect(volume).toHaveAttribute('aria-valuenow','50');
 await page.getByRole('button',{name:'Play',exact:true}).focus();
 await page.keyboard.down('ArrowUp');
 await expect(timeline).toBeFocused();
 await page.keyboard.up('ArrowUp');
 expect(await page.evaluate(()=>window.controlTest.getState().currentTime)).toBe(30);
 await expect(timeline).toHaveAttribute('aria-valuenow','25');
 expect(await page.evaluate(()=>window.controlTest.calls)).toEqual([]);
 await page.keyboard.press('Enter');
 await page.keyboard.press('ArrowRight',{delay:50});
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().currentTime)).toBeGreaterThan(30);
});
test('holding OK opens audio once and does not activate the newly focused close button',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 const audio=page.getByRole('button',{name:'Audio tracks',exact:true});
 const dialog=page.getByRole('dialog',{name:'Audio tracks',exact:true});
 await audio.focus();
 await page.keyboard.down('Enter');
 await expect(dialog).toBeVisible();
 await page.keyboard.down('Enter');
 await page.keyboard.up('Enter');
 await expect(dialog).toBeVisible();
 await page.getByRole('button',{name:'Close audio tracks menu'}).press('Enter');
 await expect(dialog).toHaveCount(0);
 await expect(audio).toBeFocused();
 for(let i=0;i<4;i++){
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(audio).toBeFocused();
 }
});
async function holdOk(page,button){
 await button.focus();
 await page.keyboard.down('Enter');await page.keyboard.down('Enter');await page.keyboard.down('Enter');await page.keyboard.up('Enter');
}
for(const [buttonName,dialogName,closeName] of [
 ['Subtitles','Subtitle tracks','Close subtitles menu'],
 ['Playback diagnostics','Playback diagnostics','Close diagnostics'],
 ['Playback speed','Playback speed','Close playback speed menu'],
]){
 test('held OK activates '+buttonName+' only once and restores focus',async({page})=>{
  await page.goto('/tests/browser/controls.html');
  const button=page.getByRole('button',{name:buttonName,exact:true});
  const dialog=page.getByRole('dialog',{name:dialogName,exact:true});
  await holdOk(page,button);await expect(dialog).toBeVisible();
  await holdOk(page,page.getByRole('button',{name:closeName,exact:true}));
  await expect(dialog).toHaveCount(0);await expect(button).toBeFocused();
 });
}
test('held OK toggles playback and mute once and seeks once per press',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await holdOk(page,page.getByRole('button',{name:'Play',exact:true}));
 await expect.poll(()=>page.evaluate(()=>window.controlTest.calls.filter(call=>call[0]==='play').length)).toBe(1);
 await holdOk(page,page.getByRole('button',{name:'Pause',exact:true}));
 await expect.poll(()=>page.evaluate(()=>window.controlTest.calls.filter(call=>call[0]==='pause').length)).toBe(1);
 await holdOk(page,page.getByRole('button',{name:'Mute',exact:true}));
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().isMuted)).toBe(true);
 expect(await page.evaluate(()=>window.controlTest.calls.filter(call=>call[0]==='mute').length)).toBe(1);
 await holdOk(page,page.getByRole('button',{name:'Forward 10 seconds',exact:true}));
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().currentTime)).toBe(40);
 await holdOk(page,page.getByRole('button',{name:'Back 10 seconds',exact:true}));
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().currentTime)).toBe(30);
 await holdOk(page,page.getByRole('button',{name:'Back to Vega Cast',exact:true}));
 expect(await page.evaluate(()=>window.controlTest.calls.filter(call=>call[0]==='exit').length)).toBe(1);
});
test('held OK enters and exits fullscreen once',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await holdOk(page,page.getByRole('button',{name:'Fullscreen',exact:true}));
 await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
 await holdOk(page,page.getByRole('button',{name:'Exit fullscreen',exact:true}));
 await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
});
test('audio and subtitle selection buttons activate once per held OK',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.evaluate(()=>window.controlTest.update({
  audioTracks:[{id:1,index:0,type:'audio',language:'eng',label:'English audio',selected:false}],
  subtitleTracks:[{id:2,index:0,type:'subtitle',language:'eng',label:'English subtitles',selected:false}],
 }));
 const audio=page.getByRole('button',{name:'Audio tracks',exact:true});
 await holdOk(page,audio);
 await expect(page.getByRole('dialog',{name:'Audio tracks',exact:true}).locator('.track-item-title')).toHaveText('English');
 await holdOk(page,page.getByRole('button',{name:'English English audio ENG',exact:true}));
 await expect(page.getByRole('dialog',{name:'Audio tracks',exact:true})).toBeVisible();
 await holdOk(page,page.getByRole('button',{name:'Close audio tracks menu',exact:true}));
 await expect(page.getByRole('dialog',{name:'Audio tracks',exact:true})).toHaveCount(0);
 await expect(audio).toBeFocused();
 expect(await page.evaluate(()=>window.controlTest.calls.filter(call=>call[0]==='audio'))).toEqual([['audio',1]]);
 await holdOk(page,page.getByRole('button',{name:'Subtitles',exact:true}));
 await expect(page.getByRole('dialog',{name:'Subtitle tracks',exact:true}).locator('.track-item-title').last()).toHaveText('English');
 await holdOk(page,page.getByRole('button',{name:'English English subtitles ENG',exact:true}));
 expect(await page.evaluate(()=>window.controlTest.calls.filter(call=>call[0]==='subtitle'))).toEqual([['subtitle',2]]);
});
test('direct disconnection dialog works in fullscreen and Continue preserves playback',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.getByRole('button',{name:'Fullscreen',exact:true}).focus();
 await page.keyboard.press('Enter');
 await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
 await page.evaluate(()=>window.controlTest.disconnect());
 const dialog=page.getByRole('dialog',{name:'Mobile disconnected'});
 await expect(dialog).toBeVisible();
 expect(await dialog.evaluate(el=>document.fullscreenElement.contains(el))).toBe(true);
 await expect(page.getByRole('button',{name:'Continue watching',exact:true})).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>window.controlTest.getState().currentTime)).toBe(30);
 expect(await page.evaluate(()=>window.controlTest.getState().status)).toBe('playing');
 expect(await page.evaluate(()=>window.controlTest.calls.map(call=>call[0]))).toEqual(['load']);
});
test('Close playback unloads a disconnected direct source',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.evaluate(()=>window.controlTest.disconnect());
 await page.getByRole('button',{name:'Close playback',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Mobile disconnected'})).toHaveCount(0);
 expect(await page.evaluate(()=>window.controlTest.getState().status)).toBe('idle');
 expect(await page.evaluate(()=>window.controlTest.calls.map(call=>call[0]))).toEqual(['load','unload']);
});
test('server menu uses remote OK navigation and sends the selected server with current position',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.evaluate(()=>window.controlTest.loadServers());
 await holdOk(page,page.getByRole('button',{name:'Change server',exact:true}));
 const menu=page.getByRole('dialog',{name:'Servers',exact:true});
 await expect(menu).toBeVisible();
 await expect(page.getByRole('button',{name:'Alpha 1080p',exact:true})).toBeFocused();
 await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('button',{name:'Beta 720p',exact:true})).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(menu).toHaveCount(0);
 expect(await page.evaluate(()=>window.controlTest.calls.filter(call=>call[0]==='server-change'))).toEqual([['server-change','server-1',30]]);
 await expect(page.getByRole('button',{name:'Change server',exact:true})).toBeDisabled();
 await page.evaluate(()=>window.controlTest.loadServers('remuxed','phone-proxy'));
 await expect(page.getByRole('button',{name:'Change server',exact:true})).toHaveCount(0);
});
test('plain proxy allows the server menu; mobile disconnect hides it',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.evaluate(()=>window.controlTest.loadServers('original','phone-proxy'));
 await expect(page.getByRole('button',{name:'Change server',exact:true})).toBeVisible();
 await page.evaluate(()=>window.controlTest.disconnectController());
 await expect(page.getByRole('button',{name:'Change server',exact:true})).toHaveCount(0);
});

test('mouse movement restores the cursor even if Vidstack retains its idle attributes',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.getByRole('button',{name:'Play',exact:true}).click();
 const player=page.locator('[data-media-player]');
 await expect(player).toHaveAttribute('data-started','');
 await page.evaluate(()=>document.activeElement.blur());
 await expect(page.locator('.video-player-wrapper')).toHaveClass(/hide-cursor/,{timeout:6500});
 await expect(player).toHaveCSS('cursor','none');
 // Vidstack's base stylesheet also hides cursors independently of Vega.
 await player.evaluate(element=>element.removeAttribute('data-controls'));
 await page.mouse.move(400,200);
 await expect(page.locator('.video-player-wrapper')).not.toHaveClass(/hide-cursor/);
 await expect(player).not.toHaveCSS('cursor','none');
 await page.getByRole('button',{name:'Subtitles',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Subtitle tracks',exact:true})).not.toHaveCSS('cursor','none');
});

test('plain subtitles have a readable outline while ASS styling is preserved',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.evaluate(()=>{
  window.controlTest.update({subtitleTracks:[{id:2,type:'subtitle',codec:'94225',label:'English'}],selectedSubtitleTrackId:2,subtitleEnabled:true});
  const layer=document.createElement('div');layer.className='ASS-box';
  layer.innerHTML='<div class="ASS-dialogue"><span data-text style="font-size:36px;color:white;font-family:serif">Subtitles stay readable on bright scenes.</span></div>';
  document.querySelector('.media-canvas-container').append(layer);
 });
 const mount=page.locator('.media-canvas-container');
 const glyph=mount.locator('[data-text]');
 await expect(mount).toHaveAttribute('data-subtitle-style','plain');
 await expect(glyph).toHaveCSS('font-weight','600');
 await expect(glyph).not.toHaveCSS('text-shadow','none');
 await expect(glyph).toHaveCSS('font-size','36px');
 await page.evaluate(()=>window.controlTest.update({subtitleTracks:[{id:2,type:'subtitle',codec:'94230',label:'Styled ASS'}]}));
 await expect(mount).not.toHaveAttribute('data-subtitle-style','plain');
 await expect(glyph).toHaveCSS('text-shadow','none');
 await expect(glyph).toHaveCSS('font-family','serif');
});

test('receiver name field exits to Save with OK or Back without saving automatically',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('vega.cast.environment','browser'));
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const input=page.getByRole('textbox',{name:'Receiver name',exact:true});
 const save=page.getByRole('button',{name:'Save',exact:true});
 await input.fill('Living room');
 await page.keyboard.down('Enter');await page.keyboard.down('Enter');await page.keyboard.up('Enter');
 await expect(save).toBeFocused();
 await expect(page.getByText('Receiver name saved.',{exact:true})).toHaveCount(0);
 await input.focus();await page.keyboard.press('Escape');
 await expect(save).toBeFocused();
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
 await page.keyboard.press('Enter');
 await expect(page.getByText('Receiver name saved.',{exact:true})).toBeVisible();
});

for(const action of ['click','Enter','Space']){
 test(`Play ${action} resumes blocked audio without pausing playback`,async({page})=>{
  await page.goto('/tests/browser/controls.html');
  await page.evaluate(()=>window.controlTest.update({status:'playing',audioNeedsUserGesture:true}));
  const play=page.getByRole('button',{name:'Play',exact:true});
  if(action==='click')await play.click();else{await play.focus();await page.keyboard.press(action);}
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.controlTest.calls)).toEqual([['resume-audio']]);
  await expect(page.getByRole('button',{name:'Enable audio',exact:true})).toHaveCount(0);
 });
}


test('focused playback controls hide after inactivity and remote OK restores focus without activating',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.getByRole('button',{name:'Play',exact:true}).click();
 const pause=page.getByRole('button',{name:'Pause',exact:true});
 await pause.focus();
 await expect(page.locator('.controls-wrapper')).toHaveAttribute('aria-hidden','true',{timeout:6000});
 await page.keyboard.press('Enter');
 await expect(pause).toBeVisible();await expect(pause).toBeFocused();
 expect(await page.evaluate(()=>window.controlTest.calls)).toEqual([['play']]);
 await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
});


test('desktop mouse leaves no button focused and PC arrows seek without TV navigation',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=> 'Desktop Chrome test'}));
 await page.goto('/tests/browser/controls.html');
 await page.getByRole('button',{name:'Play',exact:true}).click();
 expect(await page.evaluate(()=>document.activeElement?.tagName)).toBe('BODY');
 await page.keyboard.press('ArrowRight');
 expect(await page.evaluate(()=>window.controlTest.getState().currentTime)).toBe(40);
 expect(await page.evaluate(()=>document.activeElement?.tagName)).toBe('BODY');
 await page.keyboard.press('Space');
 await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
});


test('quality menu only appears for multiple renditions and remote OK selects an index',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await expect(page.getByRole('button',{name:'Video quality',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.controlTest.update({qualities:[{id:0,label:'720p',width:1280,height:720,bandwidth:2000000},{id:1,label:'1080p',width:1920,height:1080,bandwidth:5000000}],selectedQualityId:0}));
 await page.getByRole('button',{name:'Video quality',exact:true}).focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Video quality',exact:true})).toBeVisible();
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 expect(await page.evaluate(()=>window.controlTest.calls)).toEqual([['quality',1]]);
 await expect(page.getByRole('dialog',{name:'Video quality',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Video quality',exact:true})).toContainText('1080p');
});


test('active player locks page scrolling while long track menus retain thin scrollbars',async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.evaluate(()=>{
  const tall=document.createElement('div');tall.style.height='2000px';document.body.append(tall);
  window.controlTest.update({audioTracks:Array.from({length:50},(_,id)=>({id,index:id,type:'audio',label:'Track '+id,language:'eng'}))});
 });
 expect(await page.evaluate(()=>[getComputedStyle(document.documentElement).overflowY,getComputedStyle(document.body).overflowY])).toEqual(['hidden','hidden']);
 await page.getByRole('button',{name:'Audio tracks',exact:true}).focus();await page.keyboard.press('Enter');
 const menu=page.getByRole('dialog',{name:'Audio tracks',exact:true});
 await expect(menu).toBeVisible();
 expect(await menu.evaluate(element=>({scrollable:element.scrollHeight>element.clientHeight,overflow:getComputedStyle(element).overflowY,width:getComputedStyle(element).scrollbarWidth}))).toEqual({scrollable:true,overflow:'auto',width:'thin'});
});


for(const kind of ['audio','subtitle'])test(`${kind} switching displays pending feedback until completion`,async({page})=>{
 await page.goto('/tests/browser/controls.html');
 await page.evaluate(kind=>{window.controlTest.switchDelay=1200;window.controlTest.update({[kind==='audio'?'audioTracks':'subtitleTracks']:[{id:7,index:0,type:kind,language:'eng',label:'English'}]});},kind);
 await page.getByRole('button',{name:kind==='audio'?'Audio tracks':'Subtitles',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:kind==='audio'?'Audio tracks':'Subtitle tracks',exact:true});
 await dialog.getByRole('button',{name:/English/}).click();
 await expect(dialog.getByRole('status')).toHaveText(`Switching ${kind}…`);
 await expect(dialog.getByRole('button',{name:/English/})).toBeDisabled();
 await expect(dialog.getByRole('status')).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:/English/})).toBeEnabled();
});
