'use strict';

var bn = require('bn.js');
var constants = require('../lib/protocol/constants');
var utils = require('../lib/utils/utils');
var assert = require('assert');
var scriptTypes = constants.scriptTypes;
var bench = require('./bench');
var fs = require('fs');
var Coins = require('../lib/chain/coins');
var TX = require('../lib/primitives/tx');

var wtx = fs.readFileSync(__dirname + '/../test/data/wtx.hex', 'utf8');
wtx = tx.fromRaw(wtx.trim(), 'hex');

var coins = Coins.fromTX(wtx);
var raw;

var end = bench('serialize');
for (var i = 0; i < 10000; i++)
  raw = coins.toRaw();
end(i);

var end = bench('parse');
for (var i = 0; i < 10000; i++)
  Coins.fromRaw(raw);
end(i);

var end = bench('parse-single');
var hash = wtx.hash('hex');
for (var i = 0; i < 10000; i++)
  Coins.parseCoin(raw, hash, 5);
end(i);

var coins = Coins.fromRaw(raw);
var end = bench('get');
var j;

for (var i = 0; i < 10000; i++)
  for (var j = 0; j < coins.outputs.length; j++)
    coins.get(j);
end(i * coins.outputs.length);
