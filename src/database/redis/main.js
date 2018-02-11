module.exports = (redisClient, module) => {
	module.flushdb = (callback) => {
		redisClient.send_command('flushdb', [], (err) => {
			if (typeof callback === 'function') {
				callback(err);
			}
		});
	};

	module.emptydb = (callback) => {
		module.flushdb(callback);
	};

	module.exists = (key, callback) => {
		redisClient.exists(key, (err, exists) => {
			callback(err, exists === 1);
		});
	};

	module.delete = (key, callback) => {
		callback = callback || function () {};
		redisClient.del(key, (err) => {
			callback(err);
		});
	};

	module.deleteAll = (keys, callback) => {
		callback = callback || function () {};
		var multi = redisClient.multi();
		for (var i = 0; i < keys.length; i += 1) {
			multi.del(keys[i]);
		}
		multi.exec((err) => {
			callback(err);
		});
	};

	module.get = (key, callback) => {
		redisClient.get(key, callback);
	};

	module.set = (key, value, callback) => {
		callback = callback || function () {};
		redisClient.set(key, value, (err) => {
			callback(err);
		});
	};

	module.increment = (key, callback) => {
		callback = callback || function () {};
		redisClient.incr(key, callback);
	};

	module.rename = (oldKey, newKey, callback) => {
		callback = callback || function () {};
		redisClient.rename(oldKey, newKey, (err) => {
			callback(err && err.message !== 'ERR no such key' ? err : null);
		});
	};

	module.type = (key, callback) => {
		redisClient.type(key, (err, type) => {
			callback(err, type !== 'none' ? type : null);
		});
	};

	module.expire = (key, seconds, callback) => {
		callback = callback || function () {};
		redisClient.expire(key, seconds, (err) => {
			callback(err);
		});
	};

	module.expireAt = (key, timestamp, callback) => {
		callback = callback || function () {};
		redisClient.expireat(key, timestamp, (err) => {
			callback(err);
		});
	};

	module.pexpire = (key, ms, callback) => {
		callback = callback || function () {};
		redisClient.pexpire(key, ms, (err) => {
			callback(err);
		});
	};

	module.pexpireAt = (key, timestamp, callback) => {
		callback = callback || function () {};
		redisClient.pexpireat(key, timestamp, (err) => {
			callback(err);
		});
	};
};
