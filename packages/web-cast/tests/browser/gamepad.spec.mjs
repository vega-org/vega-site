import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  window.testPad={connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad]});
 });
 await page.goto('/tests/browser/controls.html');
 await page.bringToFront();
});
async function button(page,index,hold=80){
 await page.evaluate(index=>{window.testPad.buttons[index].pressed=true;},index);
 await page.waitForTimeout(hold);
 await page.evaluate(index=>{window.testPad.buttons[index].pressed=false;},index);
 await page.waitForTimeout(80);
}
test('standard gamepad selects menus on first press, does not repeat OK and closes with Back',async({page})=>{
 const subtitles=page.getByRole('button',{name:'Subtitles',exact:true});await subtitles.focus();
 await button(page,0,600);
 await expect(page.getByRole('dialog',{name:'Subtitle tracks',exact:true})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-navigation-mode','remote');
 await button(page,1);
 await expect(page.getByRole('dialog',{name:'Subtitle tracks',exact:true})).not.toBeVisible();
});
test('D-pad and left stick navigate without adjusting volume until OK enters editing',async({page})=>{
 const volume=page.getByRole('slider',{name:'Volume',exact:true});await volume.focus();
 const before=await page.evaluate(()=>window.controlTest.getState().volume);
 await button(page,14);
 expect(await page.evaluate(()=>window.controlTest.getState().volume)).toBe(before);
 await expect(volume).not.toBeFocused();
 await volume.focus();await button(page,0);await button(page,14);await button(page,0);
 await expect.poll(()=>page.evaluate(()=>window.controlTest.getState().volume)).toBeLessThan(before);
 await page.getByRole('button',{name:'Subtitles',exact:true}).focus();
 await page.evaluate(()=>{window.testPad.axes[0]=-.8;});await page.waitForTimeout(100);
 await page.evaluate(()=>{window.testPad.axes[0]=0;});
 await expect(page.getByRole('button',{name:'Subtitles',exact:true})).not.toBeFocused();
});
test('unknown controller layouts are ignored rather than triggering guessed buttons',async({page})=>{
 await page.evaluate(()=>{window.testPad.mapping='';});
 await page.getByRole('button',{name:'Subtitles',exact:true}).focus();
 await button(page,0);
 await expect(page.getByRole('dialog',{name:'Subtitle tracks',exact:true})).not.toBeVisible();
});
