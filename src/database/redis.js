var _ = require('lodash');
var async = require('async');
var winston = require('winston');
var nconf = require('nconf');
var semver = require('semver');
var session = require('express-session');
var redis = require('redis');
var redisClient;

var redisModule = module.exports;

redisModule.questions = [
	{
		name: 'redis:host',
		description: 'Host IP or address of your Redis instance',
		default: nconf.get('redis:host') || '127.0.0.1',
	},
	{
		name: 'redis:port',
		description: 'Host port of your Redis instance',
		default: nconf.get('redis:port') || 6379,
	},
	{
		name: 'redis:password',
		description: 'Password of your Redis database',
		hidden: true,
		default: nconf.get('redis:password') || '',
		before: (value) => { value = value || nconf.get('redis:password') || ''; return value; },
	},
	{
		name: 'redis:database',
		description: 'Which database to use (0..n)',
		default: nconf.get('redis:database') || 0,
	},
];

redisModule.init = (callback) => {
	callback = callback || function () { };
	redisClient = redisModule.connect({}, (err) => {
		if (err) {
			winston.error('NodeBB could not connect to your Redis database. Redis returned the following error', err);
			return callback(err);
		}
		redisModule.client = redisClient;

		require('./redis/main')(redisClient, redisModule);
		require('./redis/hash')(redisClient, redisModule);
		require('./redis/sets')(redisClient, redisModule);
		require('./redis/sorted')(redisClient, redisModule);
		require('./redis/list')(redisClient, redisModule);

		callback();
	});
};

redisModule.initSessionStore = (callback) => {
	var meta = require('../meta');
	var sessionStore = require('connect-redis')(session);

	redisModule.sessionStore = new sessionStore({
		client: redisModule.client,
		ttl: meta.getSessionTTLSeconds(),
	});

	if (typeof callback === 'function') {
		callback();
	}
};

redisModule.connect = (options, callback) => {
	callback = callback || function () {};
	var redis_socket_or_host = nconf.get('redis:host');
	var cxn;

	options = options || {};

	if (nconf.get('redis:password')) {
		options.auth_pass = nconf.get('redis:password');
	}

	options = _.merge(options, nconf.get('redis:options') || {});

	if (redis_socket_or_host && redis_socket_or_host.indexOf('/') >= 0) {
		/* If redis.host contains a path name character, use the unix dom sock connection. ie, /tmp/redis.sock */
		cxn = redis.createClient(nconf.get('redis:host'), options);
	} else {
		/* Else, connect over tcp/ip */
		cxn = redis.createClient(nconf.get('redis:port'), nconf.get('redis:host'), options);
	}

	cxn.on('error', (err) => {
		winston.error(err.stack);
		callback(err);
	});

	cxn.on('ready', () => {
		callback();
	});

	if (nconf.get('redis:password')) {
		cxn.auth(nconf.get('redis:password'));
	}

	var dbIdx = parseInt(nconf.get('redis:database'), 10);
	if (dbIdx >= 0) {
		cxn.select(dbIdx, (err) => {
			if (err) {
				winston.error('NodeBB could not select Redis database. Redis returned the following error', err);
				throw err;
			}
		});
	}

	return cxn;
};

redisModule.createIndices = (callback) => {
	setImmediate(callback);
};

redisModule.checkCompatibility = async (callback) => {
	async.waterfall([
		(next) => {
			redisModule.info(redisModule.client, next);
		},
		(info, next) => {
			redisModule.checkCompatibilityVersion(info.redis_version, next);
		},
	], callback);
};

redisModule.checkCompatibilityVersion = (version, callback) => {
	if (semver.lt(version, '2.8.9')) {
		return callback(new Error('Your Redis version is not new enough to support NodeBB, please upgrade Redis to v2.8.9 or higher.'));
	}
	callback();
};

redisModule.close = (callback) => {
	callback = callback || function () {};
	redisClient.quit(callback);
};

redisModule.info = (cxn, callback) => {
	if (!cxn) {
		return callback();
	}
	async.waterfall([
		(next) => {
			cxn.info(next);
		},
		(data, next) => {
			var lines = data.toString().split('\r\n').sort();
			var redisData = {};
			lines.forEach((line) => {
				var parts = line.split(':');
				if (parts[1]) {
					redisData[parts[0]] = parts[1];
				}
			});
			redisData.used_memory_human = (redisData.used_memory / (1024 * 1024 * 1024)).toFixed(3);
			redisData.raw = JSON.stringify(redisData, null, 4);
			redisData.redis = true;

			next(null, redisData);
		},
	], callback);
};

redisModule.helpers = redisModule.helpers || {};
redisModule.helpers.redis = require('./redis/helpers');
