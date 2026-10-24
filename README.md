## Vega Site and Vega Cast

The site hosts Vega's landing page and documentation, plus the standalone Vega Cast receiver at `/cast/`. It is not the mobile content browser and includes no providers or provider sources.

On `vega-app.in` and its subdomains, the Adding Providers guide uses generic instructions without the Zenda-Cross example. The Worker returns 404 for `/add-provider`, `/add-source`, `/zenda-x` and their static HTML aliases before any installer intent can execute. Assets run through the Worker so static serving cannot bypass this domain policy. Other hostnames retain their existing pages.

### Development

```sh
npm install
npm run build:cast
npm run dev
```

Open the Astro development URL at `/cast/`. `build:cast` builds the reusable player into `public/cast/`; rebuild it after changing player source. The directory is generated and ignored by Git.

For live player development and the existing LAN signaling/discovery service, run `npm run dev:cast` (port 5173). The old `vega-web-cast` directory forwards its development commands to this package. Existing local trust records moved with the package and remain ignored.

### Architecture

- `packages/web-cast/src`: reusable React player, libmedia engine, remote navigation and receiver protocol. Libmedia remains the only playback engine; Vidstack supplies controls only.
- `packages/web-cast/server/castBrokerCore.mjs`: shared pairing, role authorization, expiring codes and control queues.
- `packages/web-cast/server/castBroker.mjs`: Node adapter for LAN/desktop development, including local SSDP advertisement.
- `cloudflare/cast.mjs`: one SQLite-backed Durable Object per receiver, plus separate network-scoped discovery objects. Trust, expiring pairing handoffs and receiver presence survive object restarts. Stream URLs, provider headers and control-message queues are not persisted.
- `src/worker.js`: Astro's custom Worker entrypoint; routes `/vega-cast/v1` to the Cloudflare adapter and applies isolation headers to `/cast/` and its assets.

The service preserves the current authenticated HTTP long-poll protocol, including its 15-second idle polls, so mobile does not need a parallel WebSocket implementation. A message wakes a pending poll immediately. These outstanding requests keep an object active and incur Durable Object duration usage; WebSocket hibernation is a possible later transport optimization. Video is never relayed through signaling.

Fresh QR invitations include the receiver's object route. Discovered receiver IDs and saved credentials also carry that route, so remembered receivers still reconnect after their network changes. Discovery uses only the exact observed public address, never a global list. On a shared carrier/campus NAT this can include other receivers using that address; selection still requires receiver confirmation. QR works across different networks. No manual code-entry or IP-entry UI is introduced.

### Cloudflare deployment

```sh
npm run build
npx wrangler deploy --dry-run --config dist/server/wrangler.json
# Publish when ready:
npx wrangler deploy --config dist/server/wrangler.json
```

The checked-in Wrangler configuration declares the `CastSession` and `CastDirectory` bindings and their SQLite migration. Astro produces the final configuration in `dist/server/wrangler.json`; deploy that complete output, including `dist/client`. The deployment needs an account supporting SQLite-backed Durable Objects. Production receiver URL: `https://vega-app.in/cast/`; signaling URL: `https://vega-app.in/vega-cast/v1`.

Mobile defaults discovery to that signaling URL in `app.config.js`; `VEGA_CAST_SERVICE_URL` remains an explicit build-time override for other deployments. Existing saved receivers and LAN discovery remain available. Rebuild mobile to pick up the default endpoint.

See the official [Astro Cloudflare custom entrypoint guide](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) and [Durable Objects storage guidance](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).

### Media delivery limits

Accessible HTTPS direct sources and receiver-local files play independently of the phone. When direct access fails, updated mobile and browser receivers negotiate a WebRTC data channel. The phone reads its existing registered delivery sessions locally and sends the bytes over DTLS. Video never passes through Cloudflare signaling, and the browser does not fetch an HTTP phone URL.

`SecureCastDelivery` in mobile and `SecurePhoneTransport` in the reusable receiver implement this path. A receiver service worker serves ephemeral same-origin virtual media URLs to libmedia; HLS playlists rewrite segment, rendition and key references through the same encrypted channel. Range reads preserve progressive-file seeking. Requests are restricted to registered media/subtitle URLs and references learned from their playlists. Progressive reads are capped at 512 KiB, complete HLS fragments at 16 MiB, and channel frames at 12 KiB of payload with backpressure. Over-limit fragments report an error rather than silently truncating them. No alternative playback engine or FFmpeg browser pipeline is added.

The HTTPS receiver requires WebRTC, service workers and an updated mobile app for phone-assisted playback; it does not silently downgrade to HTTP if encryption fails. Native app hosts can retain their own networking bridges. The phone must stay connected for assisted playback. This does not remove browser CORS rules for original direct sources.

Default ICE configuration is empty, targeting devices on the same LAN. Isolated Wi-Fi clients, mobile hotspots and different networks may need STUN/TURN. Operators can supply `VEGA_CAST_ICE_SERVERS` as a JSON array when configuring mobile; those servers are sent privately to the paired receiver. There are no bundled public relay credentials and no automatic TURN provisioning service. Use temporary, authenticated TURN credentials in production. A relay configuration is required before promising connectivity across restrictive networks.

After installing mobile dependencies, rebuild its native app because `react-native-webrtc` contains native code; an OTA JavaScript update or Expo Go is insufficient. The implementation only creates data channels and never requests microphone, screen capture or additional camera access. Use `https://vega-app.in/cast/` in mobile's info dialog.

### Validation

```sh
npm run test:cast
npm run test:cast:cloudflare
npm run test:cast:browser
npm run test:cast:secure
npx astro check
```

Cloudflare tests use the actual local Workers runtime, exercising QR confirmation, cross-network pairing, private commands, discovery isolation, revoked tokens and trust recovery after a restart. For a built-site browser smoke check, start `npm run preview -- --host 127.0.0.1 --port 4322`, then run `node tests/cast-site-smoke.mjs`. It checks the hosted receiver, isolation headers, pairing confirmation and two-way commands. These checks do not replace codec/4K testing on actual TV hardware.

The secure-delivery browser test bundles the actual mobile sender with browser WebRTC bindings and runs it against the actual receiver/service worker over real peer connections. It verifies range byte accuracy, repeated seeks, backpressure, HLS segment/key rewriting and rejection of unregistered resources. Android native compilation validates linking. Actual phone-to-TV playback and throughput still require device testing.
