import { helper } from './util.mjs';
import path from 'node:path';
export function scan(dir) { return helper(path.resolve(dir)); }
export function walk() {}
export class Scanner {}
export let mutable = 1;
export var legacy = 2;
export enum Colour { Red }
export interface Shape { x: number }
export type Point = { x: number };
