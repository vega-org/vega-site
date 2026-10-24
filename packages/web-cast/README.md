# Vega Cast

A local-file player and Vega Mobile receiver. The default screen offers **Open a local file** and **Connect your phone**.

## Run locally

Use a Node version supported by Vite 8 (Node 22.12+ or a supported newer release).

```powershell
cd C:\Users\sangw\Desktop\vega-new\vega-web-cast
npm install
npm run dev
```

Open the server's printed address. Vite listens on the LAN and includes the control service at `/vega-cast/v1`. Use the computer's LAN address on another device; `localhost` on a phone means the phone itself.

The first screen asks which environment the receiver uses. Browser mode keeps normal browser restrictions. App mode is available only when an actual host networking bridge is installed. A preference cannot disable CORS or grant request-header permissions.

## Pair Vega Mobile

Rebuild the updated mobile app, including native discovery and Expo Camera. Choose **Connect** on the receiver and open **Play on → Vega Cast** on mobile:

1. Select an available receiver, or choose **Scan QR code**.
2. Check the matching four-digit confirmation and approve it on the receiver.
3. Use the saved receiver entry for subsequent connections.
4. Choose media on the phone. The receiver loads the resolved source and reports its own playback state.

There is no manual pairing-code or IP input. The confirmation number is only for checking the connection.

For local development, the Node service responds to native Android's existing SSDP search with its control-service URL. Mobile fetches the active receiver directory; browsers never scan the LAN. Local IPv4 discovery groups the same /24 and expires offline receivers after 45 seconds. Only receiver names, IDs and selection tokens are listed. Multicast/firewall/client-isolation restrictions can prevent discovery; QR remains available. iOS currently uses QR, remembered service endpoints, or a configured shared service rather than Android native SSDP.

For hosted receivers, set `VEGA_CAST_SERVICE_URL` in the mobile build and `VITE_VEGA_CAST_SERVICE_URL` in the receiver build to the same service. Public discovery groups the exact client address seen by the server (typically a household NAT). Behind a controlled reverse proxy, enable `VEGA_CAST_TRUST_PROXY=1` only if the proxy overwrites `X-Forwarded-For`; otherwise forwarded requests have QR pairing but no nearby directory.

For a stable deployment, set `VEGA_CAST_PUBLIC_URL` to the externally reachable control endpoint when starting the server. Invitations then use that address instead of selecting a LAN interface automatically.

## Standalone control service

```powershell
npm run cast:server
```

The service listens on `0.0.0.0:8787`. Set `VITE_VEGA_CAST_SERVICE_URL` for the receiver build and `VEGA_CAST_SERVICE_URL` for mobile to the same `/vega-cast/v1` endpoint.

The initial transport is authenticated HTTP long polling, with expiring pairing codes and receiver confirmation. It carries commands, descriptors and state, never video. It needs no new runtime package. The broker persists random-token hashes and trust records in `.vega-cast/trust.json`; keep that ignored directory private and persistent.

Use HTTPS for hosted signaling and media delivery. Plain HTTP is suitable only for trusted LAN development. A static upload alone does not run the Node service: deploy it separately or reverse-proxy it alongside the receiver. Vite's embedded service is for local development/preview.

## Delivery

- Direct mode fetches the original source from the receiver. The phone resolves content and sends its descriptor; video does not pass through the broker or phone.
- Provider format, headers, subtitles and original stream metadata are retained. No providers or provider repositories are bundled or installed.
- Mobile always registers a standby proxy through the existing Android delivery server and sends its URL alongside the original source. Registration does not stream media through the phone. The receiver selects the original source first, except for known browser-forbidden headers or phone-local URLs, and switches to the supplied proxy once on CORS/header-access or opaque network/open-source errors. It preserves position and selected tracks where possible and reports the actual delivery mode to mobile. Ordinary buffering does not switch sources.
- Audio/container conversion reuses mobile packaging only when it supports byte-range seeking and a zero timeline offset. Video transcoding is not promised.
- Phone-assisted streams require the phone. Direct playback continues after controller disconnection while the source remains valid.
- When mobile ends direct playback, the receiver shows **Mobile disconnected** with **Continue watching** and **Close playback**. Playback stays running while the choice is shown. Continue keeps its position; Close unloads the source. Phone-proxied playback still stops when mobile ends it. A lost controller connection is detected after about 45–60 seconds without signaling heartbeats; a reconnect dismisses the prompt.
- The receiver offers a **Server** menu when multiple provider streams are available and mobile is connected. It works for direct and plain-proxy playback and is hidden for remuxed streams. Selection sends an opaque choice and the receiver's position back to mobile, which uses the existing stream-selection/resolution flow and sends a fresh descriptor with its standby proxy. Provider code does not run on the receiver. Failed or timed-out requests leave an error rather than silently selecting a server.
- Mixed-content and private-network policies still apply. An HTTP phone proxy is not automatically accessible from an HTTPS website.

## Portable hosts and TV input

Player, cast session, UI, focus navigation and host networking are separate modules. Desktop/TV hosts can reuse this UI and install the `window.vegaCastHost` contract from `src/platform/receiverHost.ts`. A host must implement its advertised networking and return a source libmedia can actually load. Native privileges are never inferred from a platform name. Native platform wrappers are not implemented here.

Directional keys move focus; Enter selects. On the timeline and volume slider, press Enter/OK to adjust with arrows, then Enter/OK or Back/Escape to return to navigation. Playback speed opens a menu: arrows move focus, OK selects, and Back closes it. Audio and subtitle menus show full language names above track details. Back/Escape closes dialogs or returns from playback when no control is being adjusted. Media play/pause keys and Space/K, J/L, M, F and D shortcuts are supported. Focused controls remain visible. App hosts can translate their remote events into these keys.

## Checks

```powershell
npm test
npm run build
npm run lint
npm run test:browser
```

The player uses Vidstack React controls and media icons through a libmedia-only UI adapter. The app and menus use Lucide icons from `react-icons`. Vidstack's native video, HLS and DASH providers are not mounted; playback, subtitles and source ownership remain with `PlayerManager` and libmedia. Browser control tests use Chrome and an instrumented manager to verify command routing, remote state updates, source replacement and keyboard sliders, without fetching media.

See `docs/vega-cast-integration.md` for verification and remaining device checks, and `docs/audio-subtitle-investigation.md` for the libmedia 1.3.1 worker workaround. Cross-device casting, QR scanning, proxy delivery and actual TV behavior still require device verification before release.
