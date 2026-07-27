#!/usr/bin/env node
'use strict';

import run from '../src/cli.js';

run(process.argv).then(code => {
  process.exit(code);
}).catch(err => {
  console.error(err.message);
  process.exit(1);
});
