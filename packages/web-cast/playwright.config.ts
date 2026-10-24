import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',use:{baseURL:'http://localhost:5173',channel:'chrome',headless:true},
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://localhost:5173',reuseExistingServer:true},
});
