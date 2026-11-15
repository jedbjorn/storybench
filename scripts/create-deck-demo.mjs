import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { openDataRoot } from '../src/services/data-root.js';
import { createDemo } from '../src/deck-demo.js';
export { createDemo } from '../src/deck-demo.js';

// Explicit CLI entry only; importing the module is side-effect free.
if(process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag,folder]=process.argv.slice(2);
  if(!['--workspace','--data-root'].includes(flag) || !folder || !path.isAbsolute(folder)) throw new Error('Usage: node scripts/create-deck-demo.mjs --workspace /absolute/demo-workspace (or --data-root /existing/root)');
  if(flag==='--workspace') await mkdir(folder,{recursive:true});
  const store=flag==='--data-root' ? openDataRoot(folder) : new Store(folder);
  try { const deck=await createDemo(store); console.log(JSON.stringify({id:deck.id,title:deck.title,slides:deck.slides.length,revision:deck.revision})); } finally { store.close(); }
}
