import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const projectRoot=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const localAssets=path.join(projectRoot,'local-assets');
export const webDist=path.join(projectRoot,'dist');
export const work=path.join(projectRoot,'work');
