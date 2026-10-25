import {defineConfig} from '@playwright/test';
const port=Number(process.env.CAST_TEST_PORT)||5173;
export default defineConfig({
 testDir:'./tests/browser',use:{baseURL:`http://localhost:${port}`,channel:'chrome',headless:true},
 webServer:{command:`npm run dev -- --host 127.0.0.1 --port ${port}`,url:`http://localhost:${port}`,reuseExistingServer:!process.env.CI},
});
