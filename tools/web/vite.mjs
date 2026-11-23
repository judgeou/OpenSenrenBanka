import {build,createServer,preview} from 'vite';
import {projectRoot,webDist} from './web-paths.mjs';
import {readCombinedSession,yoshinoMediaOptions,publishYoshinoMedia,buildYoshinoCandidate} from './yoshino-media-vite.mjs';

const [action,staging='mako-public-y02',...extra]=process.argv.slice(2);
if(!['dev','build','preview','candidate'].includes(action)||extra.length||action==='preview'&&process.argv.length!==3)throw Error('Use dev | build | candidate [mako-public-NAME], or preview for dist');
if(action==='preview'){
  await readCombinedSession(webDist);
  const server=await preview({root:projectRoot});server.printUrls();
}else{
  const options=await yoshinoMediaOptions(staging);
  if(action==='build')await publishYoshinoMedia(build,options);
  else if(action==='candidate')await buildYoshinoCandidate(build,options);
  else{const server=await createServer({root:projectRoot,...options});await server.listen();server.printUrls();}
}
