var helpers = module.exports;

helpers.noop = function () {};

helpers.multiKeys = (redisClient, command, keys, callback) => {
	callback = callback || function () {};
	var multi = redisClient.multi();
	for (var i = 0; i < keys.length; i += 1) {
		multi[command](keys[i]);
	}
	multi.exec(callback);
};

helpers.multiKeysValue = (redisClient, command, keys, value, callback) => {
	callback = callback || function () {};
	var multi = redisClient.multi();
	for (var i = 0; i < keys.length; i += 1) {
		multi[command](String(keys[i]), String(value));
	}
	multi.exec(callback);
};

helpers.multiKeyValues = (redisClient, command, key, values, callback) => {
	callback = callback || function () {};
	var multi = redisClient.multi();
	for (var i = 0; i < values.length; i += 1) {
		multi[command](String(key), String(values[i]));
	}
	multi.exec(callback);
};

helpers.resultsToBool = (results) => {
	for (var i = 0; i < results.length; i += 1) {
		results[i] = results[i] === 1;
	}
	return results;
};
