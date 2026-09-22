import { scan, walk } from './scan.mjs';
import { helper } from './util.mjs';
export async function main(argv) { return scan(argv[0] || '.') && walk && helper ? 0 : 1; }
export const VERSION = '1.2.3';
