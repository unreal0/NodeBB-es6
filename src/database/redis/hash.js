module.exports = (redisClient, module) => {
	var helpers = module.helpers.redis;

	module.setObject = (key, data, callback) => {
		callback = callback || function () {};
		if (!key || !data) {
			return callback();
		}

		if (data.hasOwnProperty('')) {
			delete data[''];
		}

		Object.keys(data).forEach((key) => {
			if (data[key] === undefined) {
				delete data[key];
			}
		});

		redisClient.hmset(key, data, (err) => {
			callback(err);
		});
	};

	module.setObjectField = (key, field, value, callback) => {
		callback = callback || function () {};
		redisClient.hset(key, field, value, (err) => {
			callback(err);
		});
	};

	module.getObject = (key, callback) => {
		redisClient.hgetall(key, callback);
	};

	module.getObjects = (keys, callback) => {
		helpers.multiKeys(redisClient, 'hgetall', keys, callback);
	};

	module.getObjectField = (key, field, callback) => {
		module.getObjectFields(key, [field], (err, data) => {
			callback(err, data ? data[field] : null);
		});
	};

	module.getObjectFields = (key, fields, callback) => {
		module.getObjectsFields([key], fields, (err, results) => {
			callback(err, results ? results[0] : null);
		});
	};

	module.getObjectsFields = (keys, fields, callback) => {
		if (!Array.isArray(fields) || !fields.length) {
			return callback(null, keys.map(() => ({})));
		}
		var multi = redisClient.multi();

		for (var x = 0; x < keys.length; x += 1) {
			multi.hmget.apply(multi, [keys[x]].concat(fields));
		}

		function makeObject(array) {
			var obj = {};

			for (var i = 0, ii = fields.length; i < ii; i += 1) {
				obj[fields[i]] = array[i];
			}
			return obj;
		}

		multi.exec(function (err, results) {
			if (err) {
				return callback(err);
			}

			results = results.map(makeObject);
			callback(null, results);
		});
	};

	module.getObjectKeys = (key, callback) => {
		redisClient.hkeys(key, callback);
	};

	module.getObjectValues = (key, callback) => {
		redisClient.hvals(key, callback);
	};

	module.isObjectField = (key, field, callback) => {
		redisClient.hexists(key, field, (err, exists) => {
			callback(err, exists === 1);
		});
	};

	module.isObjectFields = (key, fields, callback) => {
		helpers.multiKeyValues(redisClient, 'hexists', key, fields, (err, results) => {
			callback(err, Array.isArray(results) ? helpers.resultsToBool(results) : null);
		});
	};

	module.deleteObjectField = (key, field, callback) => {
		callback = callback || function () {};
		if (key === undefined || key === null || field === undefined || field === null) {
			return setImmediate(callback);
		}
		redisClient.hdel(key, field, (err) => {
			callback(err);
		});
	};

	module.deleteObjectFields = (key, fields, callback) => {
		helpers.multiKeyValues(redisClient, 'hdel', key, fields, (err) => {
			callback(err);
		});
	};

	module.incrObjectField = (key, field, callback) => {
		redisClient.hincrby(key, field, 1, callback);
	};

	module.decrObjectField = (key, field, callback) => {
		redisClient.hincrby(key, field, -1, callback);
	};

	module.incrObjectFieldBy = (key, field, value, callback) => {
		redisClient.hincrby(key, field, value, callback);
	};
};
