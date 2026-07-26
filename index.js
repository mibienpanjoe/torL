'use strict';

import download from './src/download.js';
import * as torrentParser from './src/torrent-parser.js';

const torrent = torrentParser.open(process.argv[2]);

download(torrent, torrent.info.name);
