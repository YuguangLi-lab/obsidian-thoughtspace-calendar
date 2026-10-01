import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
await build({entryPoints:['src/main.ts'],bundle:true,platform:'node',external:['obsidian'],format:'cjs',target:'es2022',outfile:'main.js',metafile:true}).then(result=>writeFile('qa/build-inputs.json',JSON.stringify(Object.keys(result.metafile.inputs),null,2)));
await import('./scripts/build-styles.mjs');
