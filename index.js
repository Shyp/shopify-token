'use strict';

var crypto = require('crypto')
  , https = require('https')
  , url = require('url');

/**
 * Encode a string by replacing each instance of the `&` and `%` characters
 * with `%26` and `%25` respectively.
 *
 * @param {String} input The input string
 * @return {String} The encoded string
 * @private
 */
function encodeValue(input) {
  return input.replace(/&/g, '%26').replace(/%/g, '%25');
}

/**
 * Encode a string by replacing each instance of the `&`, `%` and `=` characters
 * with `%26`, `%25` and `%3D` respectively.
 *
 * @param {String} input The input string
 * @return {String} The encoded string
 * @private
 */
function encodeKey(input) {
  return encodeValue(input).replace(/=/g, '%3D');
}

/**
 * Create a ShopifyToken instance.
 *
 * @param {Object} options Configuration options
 * @param {String} options.redirectUri The redirect URL for the Oauth2 flow
 * @param {String} options.sharedSecret The Shared Secret for the app
 * @param {Array|String} [options.scopes] The list of scopes
 * @param {String} options.apiKey The API Key for the app
 * @constructor
 * @public
 */
function ShopifyToken(options) {
  if (!(this instanceof ShopifyToken)) {
    return new ShopifyToken(options);
  }

  if (
      !options
    || !options.sharedSecret
    || !options.redirectUri
    || !options.apiKey
  ) {
    throw new Error('Missing or invalid options');
  }

  this.scopes = 'scopes' in options ? options.scopes : 'read_content';
  this.sharedSecret = options.sharedSecret;
  this.redirectUri = options.redirectUri;
  this.apiKey = options.apiKey;
}

/**
 * Build the authorization URL.
 *
 * @param {String} shop The shop name
 * @param {Array|String} [scopes] The list of scopes
 * @return {String} The authorization URL
 * @public
 */
ShopifyToken.prototype.generateAuthUrl = function generateAuthUrl(shop, scopes) {
  scopes || (scopes = this.scopes);

  var query = {
    scope: Array.isArray(scopes) ? scopes.join(',') : scopes,
    state: crypto.randomBytes(16).toString('hex'),
    redirect_uri: this.redirectUri,
    client_id: this.apiKey
  };

  return url.format({
    pathname: '/admin/oauth/authorize',
    hostname: shop + '.myshopify.com',
    protocol: 'https:',
    query: query
  });
};

/**
 * Verify the hmac returned by Shopify.
 *
 * @param {Object} query The query string object
 * @return {Boolean} `true` if the hmac is valid, else `false`
 * @public
 */
ShopifyToken.prototype.verifyHmac = function verifyHmac(query) {
  var pairs = Object.keys(query).filter(function filter(key) {
    return key !== 'signature' && key !== 'hmac';
  }).map(function map(key) {
    return encodeKey(key) + '=' + encodeValue(query[key]);
  }).sort();

  var digest = crypto.createHmac('sha256', this.sharedSecret)
    .update(pairs.join('&'))
    .digest('hex');

  return digest === query.hmac;
};

/**
 * Request an access token.
 *
 * @param {String} shop The hostname of the shop, e.g. foo.myshopify.com
 * @param {String} code The authorization code
 * @param {Function} fn Callback
 * @return {ShopifyToken} this
 * @public
 */
ShopifyToken.prototype.getAccessToken = function getAccessToken(shop, code, fn) {
  var data = JSON.stringify({
    client_secret: this.sharedSecret,
    client_id: this.apiKey,
    code: code
  });

  var request = https.request({
    headers: {
      'Content-Length': Buffer.byteLength(data),
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    path: '/admin/oauth/access_token',
    hostname: shop,
    method: 'POST'
  }, function reply(response) {
    var status = response.statusCode
      , body = '';

    if (status !== 200) {
      return fn(new Error('Invalid status code (' + status + ') returned'));
    }

    response.setEncoding('utf8');
    response.on('data', function data(chunk) {
      body += chunk;
    });
    response.on('end', function end() {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return fn(new Error('Failed to parse the response body'));
      }

      fn(undefined, body.access_token);
    });
  });

  request.on('error', fn);
  request.end(data);

  return this;
};

module.exports = ShopifyToken;