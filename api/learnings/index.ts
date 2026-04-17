// Vercel routing shim. Handler logic lives in ./list.ts because Bun's test
// runner cannot dynamically import filenames containing brackets.
export { default } from './list.js';
