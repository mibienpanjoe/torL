#!/usr/bin/env node
'use strict';

import { runTui } from './src/tui-launcher.js';

process.exitCode = runTui(process.argv.slice(2));
