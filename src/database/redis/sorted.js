module.exports = (redisClient, module) => {
	var utils = require('../../utils');

	var helpers = module.helpers.redis;

	require('./sorted/add')(redisClient, module);
	require('./sorted/remove')(redisClient, module);
	require('./sorted/union')(redisClient, module);
	require('./sorted/intersect')(redisClient, module);

	module.getSortedSetRange = (key, start, stop, callback) => {
		sortedSetRange('zrange', key, start, stop, false, callback);
	};

	module.getSortedSetRevRange = (key, start, stop, callback) => {
		sortedSetRange('zrevrange', key, start, stop, false, callback);
	};

	module.getSortedSetRangeWithScores = (key, start, stop, callback) => {
		sortedSetRange('zrange', key, start, stop, true, callback);
	};

	module.getSortedSetRevRangeWithScores = (key, start, stop, callback) => {
		sortedSetRange('zrevrange', key, start, stop, true, callback);
	};

	function sortedSetRange(method, key, start, stop, withScores, callback) {
		if (Array.isArray(key)) {
			return module.sortedSetUnion({ method: method, sets: key, start: start, stop: stop, withScores: withScores }, callback);
		}

		var params = [key, start, stop];
		if (withScores) {
			params.push('WITHSCORES');
		}

		redisClient[method](params, (err, data) => {
			if (err) {
				return callback(err);
			}
			if (!withScores) {
				return callback(null, data);
			}
			var objects = [];
			for (var i = 0; i < data.length; i += 2) {
				objects.push({ value: data[i], score: parseFloat(data[i + 1]) });
			}
			callback(null, objects);
		});
	}

	module.getSortedSetRangeByScore = (key, start, count, min, max, callback) => {
		redisClient.zrangebyscore([key, min, max, 'LIMIT', start, count], callback);
	};

	module.getSortedSetRevRangeByScore = (key, start, count, max, min, callback) => {
		redisClient.zrevrangebyscore([key, max, min, 'LIMIT', start, count], callback);
	};

	module.getSortedSetRangeByScoreWithScores = (key, start, count, min, max, callback) => {
		sortedSetRangeByScoreWithScores('zrangebyscore', key, start, count, min, max, callback);
	};

	module.getSortedSetRevRangeByScoreWithScores = (key, start, count, max, min, callback) => {
		sortedSetRangeByScoreWithScores('zrevrangebyscore', key, start, count, max, min, callback);
	};

	function sortedSetRangeByScoreWithScores(method, key, start, count, min, max, callback) {
		redisClient[method]([key, min, max, 'WITHSCORES', 'LIMIT', start, count], (err, data) => {
			if (err) {
				return callback(err);
			}
			var objects = [];
			for (var i = 0; i < data.length; i += 2) {
				objects.push({ value: data[i], score: parseFloat(data[i + 1]) });
			}
			callback(null, objects);
		});
	}

	module.sortedSetCount = (key, min, max, callback) => {
		redisClient.zcount(key, min, max, callback);
	};

	module.sortedSetCard = (key, callback) => {
		redisClient.zcard(key, callback);
	};

	module.sortedSetsCard = (keys, callback) => {
		if (Array.isArray(keys) && !keys.length) {
			return callback(null, []);
		}
		var multi = redisClient.multi();
		for (var i = 0; i < keys.length; i += 1) {
			multi.zcard(keys[i]);
		}
		multi.exec(callback);
	};

	module.sortedSetRank = (key, value, callback) => {
		redisClient.zrank(key, value, callback);
	};

	module.sortedSetsRanks = (keys, values, callback) => {
		var multi = redisClient.multi();
		for (var i = 0; i < values.length; i += 1) {
			multi.zrank(keys[i], values[i]);
		}
		multi.exec(callback);
	};

	module.sortedSetRanks = (key, values, callback) => {
		var multi = redisClient.multi();
		for (var i = 0; i < values.length; i += 1) {
			multi.zrank(key, values[i]);
		}
		multi.exec(callback);
	};

	module.sortedSetRevRank = (key, value, callback) => {
		redisClient.zrevrank(key, value, callback);
	};

	module.sortedSetScore = (key, value, callback) => {
		if (!key || value === undefined) {
			return callback(null, null);
		}

		redisClient.zscore(key, value, (err, score) => {
			if (err) {
				return callback(err);
			}
			if (score === null) {
				return callback(null, score);
			}
			callback(null, parseFloat(score));
		});
	};

	module.sortedSetsScore = (keys, value, callback) => {
		helpers.multiKeysValue(redisClient, 'zscore', keys, value, callback);
	};

	module.sortedSetScores = (key, values, callback) => {
		helpers.multiKeyValues(redisClient, 'zscore', key, values, callback);
	};

	module.isSortedSetMember = (key, value, callback) => {
		module.sortedSetScore(key, value, (err, score) => {
			callback(err, utils.isNumber(score));
		});
	};

	module.isSortedSetMembers = (key, values, callback) => {
		helpers.multiKeyValues(redisClient, 'zscore', key, values, (err, results) => {
			if (err) {
				return callback(err);
			}
			callback(null, results.map(Boolean));
		});
	};

	module.isMemberOfSortedSets = (keys, value, callback) => {
		helpers.multiKeysValue(redisClient, 'zscore', keys, value, (err, results) => {
			if (err) {
				return callback(err);
			}
			callback(null, results.map(Boolean));
		});
	};

	module.getSortedSetsMembers = (keys, callback) => {
		var multi = redisClient.multi();
		for (var i = 0; i < keys.length; i += 1) {
			multi.zrange(keys[i], 0, -1);
		}
		multi.exec(callback);
	};

	module.sortedSetIncrBy = (key, increment, value, callback) => {
		callback = callback || helpers.noop;
		redisClient.zincrby(key, increment, value, (err, newValue) => {
			callback(err, !err ? parseFloat(newValue) : undefined);
		});
	};

	module.getSortedSetRangeByLex = (key, min, max, start, count, callback) => {
		sortedSetLex('zrangebylex', false, key, min, max, start, count, callback);
	};

	module.getSortedSetRevRangeByLex = (key, max, min, start, count, callback) => {
		sortedSetLex('zrevrangebylex', true, key, max, min, start, count, callback);
	};

	module.sortedSetRemoveRangeByLex = (key, min, max, callback) => {
		callback = callback || helpers.noop;
		sortedSetLex('zremrangebylex', false, key, min, max, (err) => {
			callback(err);
		});
	};

	module.sortedSetLexCount = (key, min, max, callback) => {
		sortedSetLex('zlexcount', false, key, min, max, callback);
	};

	function sortedSetLex(method, reverse, key, min, max, start, count, callback) {
		callback = callback || start;

		var minmin;
		var maxmax;
		if (reverse) {
			minmin = '+';
			maxmax = '-';
		} else {
			minmin = '-';
			maxmax = '+';
		}

		if (min !== minmin && !min.match(/^[[(]/)) {
			min = '[' + min;
		}
		if (max !== maxmax && !max.match(/^[[(]/)) {
			max = '[' + max;
		}

		if (count) {
			redisClient[method]([key, min, max, 'LIMIT', start, count], callback);
		} else {
			redisClient[method]([key, min, max], callback);
		}
	}
};
