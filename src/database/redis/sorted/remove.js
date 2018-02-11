module.exports = (redisClient, module) => {
	var helpers = module.helpers.redis;

	module.sortedSetRemove = (key, value, callback) => {
		callback = callback || function () {};
		if (!value) {
			return callback();
		}
		if (!Array.isArray(value)) {
			value = [value];
		}

		helpers.multiKeyValues(redisClient, 'zrem', key, value, (err) => {
			callback(err);
		});
	};

	module.sortedSetsRemove = (keys, value, callback) => {
		helpers.multiKeysValue(redisClient, 'zrem', keys, value, (err) => {
			callback(err);
		});
	};

	module.sortedSetsRemoveRangeByScore = (keys, min, max, callback) => {
		callback = callback || function () {};
		var multi = redisClient.multi();
		for (var i = 0; i < keys.length; i += 1) {
			multi.zremrangebyscore(keys[i], min, max);
		}
		multi.exec((err) => {
			callback(err);
		});
	};
};
