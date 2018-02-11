var async = require('async');

var db = require('../../database');
var batch = require('../../batch');

module.exports = {
	name: 'Delete accidentally long-lived sessions',
	timestamp: Date.UTC(2017, 3, 16),
	method: (callback) => {
		var configJSON = require('../../../config.json');
		var isRedisSessionStore = configJSON.hasOwnProperty('redis');
		var progress = this.progress;

		async.waterfall([
			(next) => {
				if (isRedisSessionStore) {
					var rdb = require('../../database/redis');
					var client = rdb.connect();
					async.waterfall([
						(next) => {
							client.keys('sess:*', next);
						},
						(sessionKeys, next) => {
							progress.total = sessionKeys.length;

							batch.processArray(sessionKeys, (keys, next) => {
								var multi = client.multi();
								keys.forEach((key) => {
									progress.incr();
									multi.del(key);
								});
								multi.exec(next);
							}, {
								batch: 1000,
							}, next);
						},
					], (err) => {
						next(err);
					});
				} else {
					db.client.collection('sessions').deleteMany({}, {}, (err) => {
						next(err);
					});
				}
			},
		], callback);
	},
};
