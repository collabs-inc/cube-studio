// The overlay for Node scripts: a piece's audio.mjs imports '../../engine/synth.mjs', which a project without its
// own engine/ doesn't have. With this file preloaded (node --import <app>/engine/overlay.mjs, or NODE_OPTIONS, which
// the Studio sets for the Director and everything it starts), an import of <project>/engine/<file> that doesn't
// exist resolves to the app's engine/<file> instead, the same rule paths.mjs applies to pages.
import { register } from 'node:module';

register('./overlay-hooks.mjs', import.meta.url);
