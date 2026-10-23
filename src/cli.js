#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createService } from './node.js';
import { formatSweep } from './core.js';
export const HELP = `Figma Comment Sweep

Usage: figma-comment-sweep [status | add <Figma URL> [label] | sweep] [options]
  --help                 Show help (no authentication required)
  --json                 Emit structured JSON
  --all                  Include previously reported comments (sweep only)
  --max-comments <1-1000> Output limit (sweep only; default 100)
Config/state: ~/.config/figma-comments or FIGMA_COMMENTS_HOME.
Token: FIGMA_ACCESS_TOKEN; macOS Keychain requires explicit config opt-in.
Only GET requests are made; Figma read/resolved status is never changed.`;
export async function runCli(argv,{service=createService(),stdout=s=>process.stdout.write(s+'\n'),stderr=s=>process.stderr.write(s+'\n')}={}) {
  const json=argv.includes('--json');
  try {
    if (argv.includes('--help') || argv.includes('-h')) { stdout(HELP); return 0; }
    const args=argv.filter(x=>x!=='--json'); const action=args.shift()??'status';
    let result;
    if (action==='status' && !args.length) result=await service.status();
    else if (action==='add' && args[0] && !args.some(x=>x.startsWith('--'))) result=await service.add(args[0],args.slice(1).join(' ')||undefined);
    else if (action==='sweep') {
      let includeSeen=false,maxComments=100;
      while(args.length) { const flag=args.shift(); if(flag==='--all') includeSeen=true; else if(flag==='--max-comments') {const raw=args.shift(); if(!raw || !/^\d+$/.test(raw)) throw new Error('max-comments must be an integer from 1 to 1000.'); maxComments=Number(raw); if(maxComments<1||maxComments>1000) throw new Error('max-comments must be an integer from 1 to 1000.');} else throw new Error('Unknown sweep option; use --help.'); }
      result=await service.sweep({includeSeen,maxComments});
    } else throw new Error('Invalid command or options; use --help.');
    stdout(json?JSON.stringify(result):action==='sweep'?formatSweep(result):JSON.stringify(result,null,2)); return 0;
  } catch(error) { stderr(json?JSON.stringify({error:error.message}):`Error: ${error.message}`); return 1; }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) process.exitCode=await runCli(process.argv.slice(2));
