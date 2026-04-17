// Vercel routing shim. Handler logic lives in ./detail.ts because Bun's test
// runner cannot dynamically import filenames containing brackets.
export { default } from './detail.js';
