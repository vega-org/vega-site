import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {createCastBroker} from '../server/castBroker.mjs';
import {startLanDiscovery} from '../server/lanDiscovery.mjs';

const broker = createCastBroker({stateFile:resolve('.vega-cast/trust.json'), publicUrl:process.env.VEGA_CAST_PUBLIC_URL,trustProxy:process.env.VEGA_CAST_TRUST_PROXY==='1'});
const port = Number(process.env.PORT || 8787);
const server=createServer(broker.handler);
server.listen(port, '0.0.0.0', () => {console.log(`Vega Cast control service listening on port ${port}`);const stop=startLanDiscovery({port,publicUrl:process.env.VEGA_CAST_PUBLIC_URL});server.once('close',stop);});
