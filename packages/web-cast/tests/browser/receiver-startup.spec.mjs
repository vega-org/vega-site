import {test,expect} from '@playwright/test';

for(const storedProfile of [null,'native']){
 test(`browser receiver starts without an environment prompt (${storedProfile||'fresh installation'})`,async({page})=>{
  await page.addInitScript(profile=>{
   localStorage.clear();
   if(profile)localStorage.setItem('vega.cast.environment',profile);
  },storedProfile);
  await page.goto('/');
  await expect(page.getByRole('dialog',{name:'Where is Vega running?'})).toHaveCount(0);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Browser web security enabled'})).toBeVisible();
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await expect(page.getByRole('button',{name:'Refresh QR code'})).toBeVisible();
  await expect(page.getByRole('img',{name:'Scan to pair Vega Mobile'})).toBeVisible({timeout:10000});
 });
}
