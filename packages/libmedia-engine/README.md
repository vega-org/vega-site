# Shared libmedia playback engine

The authoritative playback implementation for Vega Cast and Vega Desktop.
This package contains no React, Vidstack, pairing, signaling, providers or app UI.
Hosts attach a div, supply source descriptors, and subscribe to playback state.

```ts
import {LibmediaEngine} from '@vega/libmedia-engine';
const engine = new LibmediaEngine();
engine.attach(container);
engine.setEventListeners({onStateChange: updateExistingControls});
await engine.load({id:'media',source:url,format:'mkv'});
// On disposal:
await engine.destroy();
```

URLs and headers must be accessible to the host. Native networking belongs in
the app adapter; this package does not bypass browser security or run FFmpeg.
Volumes use 0–1; media positions and subtitle delays use seconds. Track IDs are
libmedia IDs, not array indices. Diagnostics report only exposed library data.

Import `copyLibmediaAssets` and `libmediaChunkPlugin` from
`@vega/libmedia-engine/assets` in build tooling. Copy assets to the host's public
directory before building, exclude `@libmedia/avplayer` from Vite prebundling,
and use the plugin for development lazy chunks. The asset tooling applies the
version-checked libmedia 1.3.1 subtitle selection, seek and MKV LanguageIETF fixes.
Both hosts use the same patches. Upgrading libmedia requires reviewing them.

WASM assets currently use the existing pinned libmedia 1.3.1 CDN URL. A host can
supply `new LibmediaEngine({wasmBaseUrl})` for its own decoder distribution.
Bundling all decoders for offline operation is not part of this extraction.

Vega Site consumes this package as a workspace. Desktop installs its versioned
archive under `vendor/`, so standalone desktop checkouts and release builds do
not require the site repository. After editing this source, run
`npm run sync:libmedia` in the sibling desktop checkout, then run both apps'
tests/builds and commit the desktop archive and lockfile with the update.
The sync command accepts an alternate package directory after `--`.
