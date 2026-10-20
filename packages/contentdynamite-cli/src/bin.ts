#!/usr/bin/env bun
import { run } from './program';

process.exitCode = await run(process.argv.slice(2));
