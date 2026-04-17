// Vercel routing shim. Handler logic lives in ../review.ts because Bun's test
// runner cannot dynamically import filenames containing brackets.
export { default } from '../review.js';
