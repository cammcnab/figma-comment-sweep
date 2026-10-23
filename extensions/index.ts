import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { createService } from '../src/node.js';
import { formatSweep } from '../src/core.js';
import { runCli } from '../src/cli.js';

export default function figmaComments(pi: ExtensionAPI) {
  const service = createService();
  pi.registerTool({
    name: 'figma_comment_sweep',
    label: 'Figma Comment Sweep',
    description: 'Read new and mentioned Figma comments from configured files and optional local discovery. Only reported comments become locally seen; Figma is never modified.',
    parameters: Type.Object({
      includeSeen: Type.Optional(Type.Boolean()),
      maxComments: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    }),
    async execute(_id, params) {
      const result = await service.sweep(params);
      return { content: [{ type: 'text', text: formatSweep(result) }], details: result };
    },
  });
  pi.registerCommand('figma-comments', {
    description: 'status | add <Figma URL> [label] | sweep [--all] [--max-comments N]',
    handler: async (args, ctx) => {
      // URL and multiword labels do not need shell quoting; labels consume the remainder.
      await runCli(args.trim().split(/\s+/).filter(Boolean), {
        service,
        stdout: text => ctx.ui.notify(text, 'info'),
        stderr: text => ctx.ui.notify(text, 'error'),
      });
    },
  });
}
