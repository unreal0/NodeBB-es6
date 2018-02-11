module.exports = (redisClient, module) => {
	module.listPrepend = (key, value, callback) => {
		callback = callback || function () {};
		if (!key) {
			return callback();
		}
		redisClient.lpush(key, value, (err) => {
			callback(err);
		});
	};

	module.listAppend = (key, value, callback) => {
		callback = callback || function () {};
		if (!key) {
			return callback();
		}
		redisClient.rpush(key, value, (err) => {
			callback(err);
		});
	};

	module.listRemoveLast = (key, callback) => {
		callback = callback || function () {};
		if (!key) {
			return callback();
		}
		redisClient.rpop(key, callback);
	};

	module.listRemoveAll = (key, value, callback) => {
		callback = callback || function () {};
		if (!key) {
			return callback();
		}
		redisClient.lrem(key, 0, value, (err) => {
			callback(err);
		});
	};

	module.listTrim = (key, start, stop, callback) => {
		callback = callback || function () {};
		if (!key) {
			return callback();
		}
		redisClient.ltrim(key, start, stop, (err) => {
			callback(err);
		});
	};

	module.getListRange = (key, start, stop, callback) => {
		callback = callback || function () {};
		if (!key) {
			return callback();
		}
		redisClient.lrange(key, start, stop, callback);
	};
};
