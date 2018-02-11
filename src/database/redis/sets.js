module.exports = (redisClient, module) => {
	var helpers = module.helpers.redis;

	module.setAdd = (key, value, callback) => {
		callback = callback || function () {};
		if (!Array.isArray(value)) {
			value = [value];
		}
		if (!value.length) {
			return callback();
		}
		redisClient.sadd(key, value, (err) => {
			callback(err);
		});
	};

	module.setsAdd = (keys, value, callback) => {
		callback = callback || function () {};
		helpers.multiKeysValue(redisClient, 'sadd', keys, value, (err) => {
			callback(err);
		});
	};

	module.setRemove = (key, value, callback) => {
		callback = callback || function () {};
		redisClient.srem(key, value, (err) => {
			callback(err);
		});
	};

	module.setsRemove = (keys, value, callback) => {
		callback = callback || function () {};
		helpers.multiKeysValue(redisClient, 'srem', keys, value, (err) => {
			callback(err);
		});
	};

	module.isSetMember = (key, value, callback) => {
		redisClient.sismember(key, value, (err, result) => {
			callback(err, result === 1);
		});
	};

	module.isSetMembers = (key, values, callback) => {
		helpers.multiKeyValues(redisClient, 'sismember', key, values, (err, results) => {
			callback(err, results ? helpers.resultsToBool(results) : null);
		});
	};

	module.isMemberOfSets = (sets, value, callback) => {
		helpers.multiKeysValue(redisClient, 'sismember', sets, value, (err, results) => {
			callback(err, results ? helpers.resultsToBool(results) : null);
		});
	};

	module.getSetMembers = (key, callback) => {
		redisClient.smembers(key, callback);
	};

	module.getSetsMembers = (keys, callback) => {
		helpers.multiKeys(redisClient, 'smembers', keys, callback);
	};

	module.setCount = (key, callback) => {
		redisClient.scard(key, callback);
	};

	module.setsCount = (keys, callback) => {
		helpers.multiKeys(redisClient, 'scard', keys, callback);
	};

	module.setRemoveRandom = (key, callback) => {
		callback = callback || function () {};
		redisClient.spop(key, callback);
	};

	return module;
};
