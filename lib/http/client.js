/*!
 * client.js - http client for wallets
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2016, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var Network = require('../protocol/network');
var AsyncObject = require('../utils/async');
var RPCClient = require('./rpcclient');
var utils = require('../utils/utils');
var co = require('../utils/co');
var request = require('./request').promise;

/**
 * BCoin HTTP client.
 * @exports HTTPClient
 * @constructor
 * @param {String} uri
 * @param {Object?} options
 */

function HTTPClient(options) {
  if (!(this instanceof HTTPClient))
    return new HTTPClient(options);

  if (!options)
    options = {};

  if (typeof options === 'string')
    options = { uri: options };

  AsyncObject.call(this);

  this.options = options;
  this.network = Network.get(options.network);

  this.uri = options.uri || 'http://localhost:' + this.network.rpcPort;
  this.socket = null;
  this.apiKey = options.apiKey;
  this.auth = options.auth;
  this.rpc = new RPCClient(options);

  // Open automatically.
  // this.open();
}

utils.inherits(HTTPClient, AsyncObject);

/**
 * Open the client, wait for socket to connect.
 * @alias HTTPClient#open
 * @returns {Promise}
 */

HTTPClient.prototype._open = co(function* _open() {
  var self = this;
  var IOClient;

  try {
    IOClient = require('socket.io-client');
  } catch (e) {
    ;
  }

  if (!IOClient)
    return;

  this.socket = new IOClient(this.uri, {
    transports: ['websocket'],
    forceNew: true
  });

  this.socket.on('error', function(err) {
    self.emit('error', err);
  });

  this.socket.on('version', function(info) {
    if (info.network !== self.network.type)
      self.emit('error', new Error('Wrong network.'));
  });

  this.socket.on('wallet tx', function(details) {
    self.emit('tx', details);
  });

  this.socket.on('wallet confirmed', function(details) {
    self.emit('confirmed', details);
  });

  this.socket.on('wallet unconfirmed', function(details) {
    self.emit('unconfirmed', details);
  });

  this.socket.on('wallet conflict', function(details) {
    self.emit('conflict', details);
  });

  this.socket.on('wallet updated', function(details) {
    self.emit('updated', details);
  });

  this.socket.on('wallet address', function(receive) {
    self.emit('address', receive);
  });

  this.socket.on('wallet balance', function(balance) {
    self.emit('balance', balance);
  });

  yield this._onConnect();
  yield this._sendAuth();
});

HTTPClient.prototype._onConnect = function _onConnect() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self.socket.once('connect', resolve);
  });
};

HTTPClient.prototype._sendAuth = function _sendAuth() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self.socket.emit('auth', self.apiKey, function(err) {
      if (err)
        return reject(new Error(err.error));
      resolve();
    });
  });
};

/**
 * Close the client, wait for the socket to close.
 * @alias HTTPClient#close
 * @returns {Promise}
 */

HTTPClient.prototype._close = function close() {
  if (!this.socket)
    return Promise.resolve(null);

  this.socket.disconnect();
  this.socket = null;

  return Promise.resolve(null);
};

/**
 * Make an http request to endpoint.
 * @private
 * @param {String} method
 * @param {String} endpoint - Path.
 * @param {Object} json - Body or query depending on method.
 * @returns {Promise} - Returns Object?.
 */

HTTPClient.prototype._request = co(function* _request(method, endpoint, json) {
  var query, network, height, res;

  if (this.token) {
    if (!json)
      json = {};
    json.token = this.token;
  }

  if (json && method === 'get') {
    query = json;
    json = null;
  }

  res = yield request({
    method: method,
    uri: this.uri + endpoint,
    query: query,
    json: json,
    auth: {
      username: 'bitcoinrpc',
      password: this.apiKey || ''
    },
    expect: 'json'
  });

  network = res.headers['x-bcoin-network'];

  if (network !== this.network.type)
    throw new Error('Wrong network.');

  height = +res.headers['x-bcoin-height'];

  if (utils.isNumber(height))
    this.network.updateHeight(height);

  if (res.statusCode === 404)
    return;

  if (!res.body)
    throw new Error('No body.');

  if (res.statusCode !== 200) {
    if (res.body.error)
      throw new Error(res.body.error);
    throw new Error('Status code: ' + res.statusCode);
  }

  return res.body;
});

/**
 * Make a GET http request to endpoint.
 * @private
 * @param {String} endpoint - Path.
 * @param {Object} json - Querystring.
 * @returns {Promise} - Returns Object?.
 */

HTTPClient.prototype._get = function _get(endpoint, json) {
  return this._request('get', endpoint, json);
};

/**
 * Make a POST http request to endpoint.
 * @private
 * @param {String} endpoint - Path.
 * @param {Object} json - Body.
 * @returns {Promise} - Returns Object?.
 */

HTTPClient.prototype._post = function _post(endpoint, json) {
  return this._request('post', endpoint, json);
};

/**
 * Make a PUT http request to endpoint.
 * @private
 * @param {String} endpoint - Path.
 * @param {Object} json - Body.
 * @returns {Promise} - Returns Object?.
 */

HTTPClient.prototype._put = function _put(endpoint, json) {
  return this._request('put', endpoint, json);
};

/**
 * Make a DELETE http request to endpoint.
 * @private
 * @param {String} endpoint - Path.
 * @param {Object} json - Body.
 * @returns {Promise} - Returns Object?.
 */

HTTPClient.prototype._del = function _del(endpoint, json) {
  return this._request('delete', endpoint, json);
};

/**
 * Get a mempool snapshot.
 * @returns {Promise} - Returns {@link TX}[].
 */

HTTPClient.prototype.getMempool = function getMempool() {
  return this._get('/mempool');
};

/**
 * Get some info about the server (network and version).
 * @returns {Promise} - Returns Object.
 */

HTTPClient.prototype.getInfo = function getInfo() {
  return this._get('/');
};

/**
 * Get coins that pertain to an address from the mempool or chain database.
 * Takes into account spent coins in the mempool.
 * @param {Base58Address|Base58Address[]} addresses
 * @returns {Promise} - Returns {@link Coin}[].
 */

HTTPClient.prototype.getCoinsByAddress = function getCoinsByAddress(address) {
  var body = { address: address };
  return this._post('/coin/address', body);
};

/**
 * Retrieve a coin from the mempool or chain database.
 * Takes into account spent coins in the mempool.
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise} - Returns {@link Coin}.
 */

HTTPClient.prototype.getCoin = function getCoin(hash, index) {
  return this._get('/coin/' + hash + '/' + index);
};

/**
 * Retrieve transactions pertaining to an
 * address from the mempool or chain database.
 * @param {Base58Address|Base58Address[]} addresses
 * @returns {Promise} - Returns {@link TX}[].
 */

HTTPClient.prototype.getTXByAddress = function getTXByAddress(address) {
  var body = { address: address };
  return this._post('/tx/address', body);
};

/**
 * Retrieve a transaction from the mempool or chain database.
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link TX}.
 */

HTTPClient.prototype.getTX = function getTX(hash) {
  return this._get('/tx/' + hash);
};

/**
 * Retrieve a block from the chain database.
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link Block}.
 */

HTTPClient.prototype.getBlock = function getBlock(hash) {
  return this._get('/block/' + hash);
};

/**
 * Add a transaction to the mempool and broadcast it.
 * @param {TX} tx
 * @returns {Promise}
 */

HTTPClient.prototype.broadcast = function broadcast(tx) {
  var body = { tx: toHex(tx) };

  return this._post('/broadcast', body);
};

/**
 * Rescan the chain.
 * @param {Hash|Number} hash
 * @returns {Promise}
 */

HTTPClient.prototype.rescan = function rescan(hash) {
  var options = { hash: hash };
  return this._post('/rescan', options);
};

/**
 * Zap stale transactions.
 * @param {Number} age
 * @returns {Promise}
 */

HTTPClient.prototype.zap = function zap(age) {
  var options = { age: age };
  return this._post('/zap', options);
};

/**
 * Backup the walletdb.
 * @param {String} path
 * @returns {Promise}
 */

HTTPClient.prototype.backup = function backup(path) {
  var options = { path: path };
  return this._post('/backup', options);
};

/**
 * Listen for events on wallet id.
 * @param {WalletID} id
 */

HTTPClient.prototype.join = function join(id, token) {
  var self = this;

  if (!this.socket)
    return Promise.resolve(null);

  return new Promise(function(resolve, reject) {
    self.socket.emit('wallet join', id, token, function(err) {
      if (err)
        return reject(new Error(err.error));
      resolve();
    });
  });
};

/**
 * Unlisten for events on wallet id.
 * @param {WalletID} id
 */

HTTPClient.prototype.leave = function leave(id) {
  var self = this;

  if (!this.socket)
    return Promise.resolve(null);

  return new Promise(function(resolve, reject) {
    self.socket.emit('wallet leave', id, function(err) {
      if (err)
        return reject(new Error(err.error));
      resolve();
    });
  });
};

/**
 * Listen for events on all wallets.
 */

HTTPClient.prototype.all = function all(token) {
  return this.join('!all', token);
};

/**
 * Unlisten for events on all wallets.
 */

HTTPClient.prototype.none = function none() {
  return this.leave('!all');
};

/**
 * Request the raw wallet JSON (will create wallet if it does not exist).
 * @private
 * @param {Object} options - See {@link Wallet}.
 * @returns {Promise} - Returns Object.
 */

HTTPClient.prototype.createWallet = function createWallet(options) {
  return this._post('/wallet', options);
};

/**
 * Get the raw wallet JSON.
 * @private
 * @param {WalletID} id
 * @returns {Promise} - Returns Object.
 */

HTTPClient.prototype.getWallet = function getWallet(id) {
  return this._get('/wallet/' + id);
};

/**
 * Get wallet transaction history.
 * @param {WalletID} id
 * @returns {Promise} - Returns {@link TX}[].
 */

HTTPClient.prototype.getHistory = function getHistory(id, account) {
  var options = { account: account };
  return this._get('/wallet/' + id + '/tx/history', options);
};

/**
 * Get wallet coins.
 * @param {WalletID} id
 * @returns {Promise} - Returns {@link Coin}[].
 */

HTTPClient.prototype.getCoins = function getCoins(id, account) {
  var options = { account: account };
  return this._get('/wallet/' + id + '/coin', options);
};

/**
 * Get all unconfirmed transactions.
 * @param {WalletID} id
 * @returns {Promise} - Returns {@link TX}[].
 */

HTTPClient.prototype.getUnconfirmed = function getUnconfirmed(id, account) {
  var options = { account: account };
  return this._get('/wallet/' + id + '/tx/unconfirmed', options);
};

/**
 * Calculate wallet balance.
 * @param {WalletID} id
 * @returns {Promise} - Returns {@link Balance}.
 */

HTTPClient.prototype.getBalance = function getBalance(id, account) {
  var options = { account: account };
  return this._get('/wallet/' + id + '/balance', options);
};

/**
 * Get last N wallet transactions.
 * @param {WalletID} id
 * @param {Number} limit - Max number of transactions.
 * @returns {Promise} - Returns {@link TX}[].
 */

HTTPClient.prototype.getLast = function getLast(id, account, limit) {
  var options = { account: account, limit: limit };
  return this._get('/wallet/' + id + '/tx/last', options);
};

/**
 * Get wallet transactions by timestamp range.
 * @param {WalletID} id
 * @param {Object} options
 * @param {Number} options.start - Start time.
 * @param {Number} options.end - End time.
 * @param {Number?} options.limit - Max number of records.
 * @param {Boolean?} options.reverse - Reverse order.
 * @returns {Promise} - Returns {@link TX}[].
 */

HTTPClient.prototype.getRange = function getRange(id, account, options) {
  options = {
    account: account,
    start: options.start,
    end: options.end ,
    limit: options.limit,
    reverse: options.reverse
  };
  return this._get('/wallet/' + id + '/tx/range', options);
};

/**
 * Get transaction (only possible if the transaction
 * is available in the wallet history).
 * @param {WalletID} id
 * @param {Hash} hash
 * @returns {Promise} - Returns {@link TX}[].
 */

HTTPClient.prototype.getWalletTX = function getWalletTX(id, account, hash) {
  var options = { account: account };
  return this._get('/wallet/' + id + '/tx/' + hash, options);
};

/**
 * Get unspent coin (only possible if the transaction
 * is available in the wallet history).
 * @param {WalletID} id
 * @param {Hash} hash
 * @param {Number} index
 * @returns {Promise} - Returns {@link Coin}[].
 */

HTTPClient.prototype.getWalletCoin = function getWalletCoin(id, account, hash, index) {
  var path = '/wallet/' + id + '/coin/' + hash + '/' + index;
  var options = { account: account };
  return this._get(path, options);
};

/**
 * Create a transaction, fill, sign, and broadcast.
 * @param {WalletID} id
 * @param {Object} options
 * @param {Base58Address} options.address
 * @param {Amount} options.value
 * @returns {Promise} - Returns {@link TX}.
 */

HTTPClient.prototype.send = function send(id, options) {
  options = utils.merge({}, options);
  options.outputs = options.outputs || [];

  if (options.rate)
    options.rate = utils.btc(options.rate);

  options.outputs = options.outputs.map(function(output) {
    return {
      value: utils.btc(output.value),
      address: output.address,
      script: toHex(output.script)
    };
  });

  return this._post('/wallet/' + id + '/send', options);
};

/**
 * Generate a new token.
 * @param {(String|Buffer)?} passphrase
 * @returns {Promise}
 */

HTTPClient.prototype.retoken = co(function* retoken(id, passphrase) {
  var options = { passphrase: passphrase };
  var body = yield this._post('/wallet/' + id + '/retoken', options);
  return body.token;
});

/**
 * Change or set master key's passphrase.
 * @param {(String|Buffer)?} old
 * @param {String|Buffer} new_
 * @returns {Promise}
 */

HTTPClient.prototype.setPassphrase = function setPassphrase(id, old, new_) {
  var options = { old: old, passphrase: new_ };
  return this._post('/wallet/' + id + '/passphrase', options);
};

/**
 * Create a transaction, fill.
 * @param {WalletID} id
 * @param {Object} options
 * @returns {Promise} - Returns {@link TX}.
 */

HTTPClient.prototype.createTX = function createTX(id, options) {
  options = utils.merge({}, options);

  if (options.rate)
    options.rate = utils.btc(options.rate);

  options.outputs = options.outputs.map(function(output) {
    return {
      value: utils.btc(output.value),
      address: output.address,
      script: toHex(output.script)
    };
  });

  return this._post('/wallet/' + id + '/create', options);
};

/**
 * Sign a transaction.
 * @param {WalletID} id
 * @param {TX} tx
 * @param {Object} options
 * @returns {Promise} - Returns {@link TX}.
 */

HTTPClient.prototype.sign = function sign(id, tx, options) {
  var body;

  if (!options)
    options = {};

  body = utils.merge({}, options);
  body.tx = toHex(tx);

  return this._post('/wallet/' + id + '/sign', body);
};

/**
 * Fill a transaction with coins.
 * @param {TX} tx
 * @returns {Promise} - Returns {@link TX}.
 */

HTTPClient.prototype.fillCoins = function fillCoins(id, tx) {
  var body = { tx: toHex(tx) };
  return this._post('/wallet/' + id + '/fill', body);
};

/**
 * @param {WalletID} id
 * @param {Number} now - Current time.
 * @param {Number} age - Age delta (delete transactions older than `now - age`).
 * @returns {Promise}
 */

HTTPClient.prototype.zapWallet = function zapWallet(id, account, age) {
  var body = {
    account: account,
    age: age
  };
  return this._post('/wallet/' + id + '/zap', body);
};

/**
 * Add a public account/purpose key to the wallet for multisig.
 * @param {WalletID} id
 * @param {(String|Number)?} account
 * @param {HDPublicKey|Base58String} key - Account (bip44) or
 * Purpose (bip45) key (can be in base58 form).
 * @returns {Promise}
 */

HTTPClient.prototype.addKey = function addKey(id, account, key) {
  var options = { account: account, accountKey: key };
  return this._put('/wallet/' + id + '/key', options);
};

/**
 * Remove a public account/purpose key to the wallet for multisig.
 * @param {WalletID} id
 * @param {(String|Number)?} account
 * @param {HDPublicKey|Base58String} key - Account (bip44) or Purpose
 * (bip45) key (can be in base58 form).
 * @returns {Promise}
 */

HTTPClient.prototype.removeKey = function removeKey(id, account, key) {
  var options = { account: account, accountKey: key };
  return this._del('/wallet/' + id + '/key', options);
};

/**
 * Import private key.
 * @param {String} id
 * @param {Number|String} account
 * @param {String} key
 * @returns {Promise}
 */

HTTPClient.prototype.importPrivate = function importPrivate(id, account, key) {
  var options = { privateKey: key };
  return this._post('/wallet/' + id + '/import', options);
};

/**
 * Import public key.
 * @param {String} id
 * @param {Number|String} account
 * @param {String} key
 * @returns {Promise}
 */

HTTPClient.prototype.importPublic = function importPublic(id, account, key) {
  var options = { publicKey: key };
  return this._post('/wallet/' + id + '/import', options);
};

/**
 * Import address.
 * @param {String} id
 * @param {Number|String} account
 * @param {String} address
 * @returns {Promise}
 */

HTTPClient.prototype.importAddress = function importAddress(id, account, address) {
  var options = { address: address };
  return this._post('/wallet/' + id + '/import', options);
};

/**
 * Lock a coin.
 * @param {String} id
 * @param {String} hash
 * @param {Number} index
 * @returns {Promise}
 */

HTTPClient.prototype.lockCoin = function lockCoin(id, hash, index) {
  var options = { hash: hash, index: index };
  return this._put('/wallet/' + id + '/coin/locked', options);
};

/**
 * Unlock a coin.
 * @param {String} id
 * @param {String} hash
 * @param {Number} index
 * @returns {Promise}
 */

HTTPClient.prototype.unlockCoin = function unlockCoin(id, hash, index) {
  var options = { hash: hash, index: index };
  return this._del('/wallet/' + id + '/coin/locked', options);
};

/**
 * Get locked coins.
 * @param {String} id
 * @returns {Promise}
 */

HTTPClient.prototype.getLocked = function getLocked(id) {
  return this._get('/wallet/' + id + '/coin/locked');
};

/**
 * Lock wallet.
 * @param {String} id
 * @returns {Promise}
 */

HTTPClient.prototype.lock = function lock(id) {
  return this._post('/wallet/' + id + '/lock', {});
};

/**
 * Unlock wallet.
 * @param {String} id
 * @param {String} passphrase
 * @param {Number} timeout
 * @returns {Promise}
 */

HTTPClient.prototype.unlock = function unlock(id, passphrase, timeout) {
  var options = { passphrase: passphrase, timeout: timeout };
  return this._post('/wallet/' + id + '/unlock', options);
};

/**
 * Get wallet accounts.
 * @param {WalletID} id
 * @returns {Promise} - Returns Array.
 */

HTTPClient.prototype.getAccounts = function getAccounts(id) {
  var path = '/wallet/' + id + '/account';
  return this._get(path);
};

/**
 * Get wallet account.
 * @param {WalletID} id
 * @param {String} account
 * @returns {Promise} - Returns Array.
 */

HTTPClient.prototype.getAccount = function getAccount(id, account) {
  var path = '/wallet/' + id + '/account/' + account;
  return this._get(path);
};

/**
 * Create account.
 * @param {WalletID} id
 * @param {Object} options
 * @returns {Promise} - Returns Array.
 */

HTTPClient.prototype.createAccount = function createAccount(id, options) {
  var path;

  if (!options)
    options = {};

  if (typeof options === 'string')
    options = { account: options };

  path = '/wallet/' + id + '/account';

  return this._post(path, options);
};

/**
 * Create address.
 * @param {WalletID} id
 * @param {Object} options
 * @returns {Promise} - Returns Array.
 */

HTTPClient.prototype.createAddress = function createAddress(id, options) {
  var path;

  if (!options)
    options = {};

  if (typeof options === 'string')
    options = { account: options };

  path = '/wallet/' + id + '/address';

  return this._post(path, options);
};

/**
 * Create address.
 * @param {WalletID} id
 * @param {Object} options
 * @returns {Promise} - Returns Array.
 */

HTTPClient.prototype.createNested = function createNested(id, options) {
  var path;

  if (!options)
    options = {};

  if (typeof options === 'string')
    options = { account: options };

  path = '/wallet/' + id + '/nested';

  return this._post(path, options);
};

/*
 * Helpers
 */

function toHex(obj) {
  if (!obj)
    return;

  if (obj.toRaw)
    obj = obj.toRaw();

  if (Buffer.isBuffer(obj))
    obj = obj.toString('hex');

  return obj;
}

/*
 * Expose
 */

module.exports = HTTPClient;
