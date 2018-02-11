var async = require('async');
var utils = require('../../utils');

module.exports = (db, module) => {
	var helpers = module.helpers.mongo;

	require('./sorted/add')(db, module);
	require('./sorted/remove')(db, module);
	require('./sorted/union')(db, module);
	require('./sorted/intersect')(db, module);

	module.getSortedSetRange = (key, start, stop, callback) => {
		getSortedSetRange(key, start, stop, 1, false, callback);
	};

	module.getSortedSetRevRange = (key, start, stop, callback) => {
		getSortedSetRange(key, start, stop, -1, false, callback);
	};

	module.getSortedSetRangeWithScores = (key, start, stop, callback) => {
		getSortedSetRange(key, start, stop, 1, true, callback);
	};

	module.getSortedSetRevRangeWithScores = (key, start, stop, callback) => {
		getSortedSetRange(key, start, stop, -1, true, callback);
	};

	function getSortedSetRange(key, start, stop, sort, withScores, callback) {
		if (!key) {
			return callback();
		}

		var fields = { _id: 0, value: 1 };
		if (withScores) {
			fields.score = 1;
		}

		if (Array.isArray(key)) {
			key = { $in: key };
		}

		if (start < 0 && start > stop) {
			return callback(null, []);
		}

		var reverse = false;
		if (start === 0 && stop < -1) {
			reverse = true;
			sort *= -1;
			start = Math.abs(stop + 1);
			stop = -1;
		} else if (start < 0 && stop > start) {
			var tmp1 = Math.abs(stop + 1);
			stop = Math.abs(start + 1);
			start = tmp1;
		}

		var limit = stop - start + 1;
		if (limit <= 0) {
			limit = 0;
		}

		db.collection('objects').find({ _key: key }, { fields: fields })
			.limit(limit)
			.skip(start)
			.sort({ score: sort })
			.toArray((err, data) => {
				if (err || !data) {
					return callback(err);
				}
				if (reverse) {
					data.reverse();
				}
				if (!withScores) {
					data = data.map(item => item.value);
				}

				callback(null, data);
			});
	}

	module.getSortedSetRangeByScore = (key, start, count, min, max, callback) => {
		getSortedSetRangeByScore(key, start, count, min, max, 1, false, callback);
	};

	module.getSortedSetRevRangeByScore = (key, start, count, max, min, callback) => {
		getSortedSetRangeByScore(key, start, count, min, max, -1, false, callback);
	};

	module.getSortedSetRangeByScoreWithScores = (key, start, count, min, max, callback) => {
		getSortedSetRangeByScore(key, start, count, min, max, 1, true, callback);
	};

	module.getSortedSetRevRangeByScoreWithScores = (key, start, count, max, min, callback) => {
		getSortedSetRangeByScore(key, start, count, min, max, -1, true, callback);
	};

	function getSortedSetRangeByScore(key, start, count, min, max, sort, withScores, callback) {
		if (!key) {
			return callback();
		}
		if (parseInt(count, 10) === -1) {
			count = 0;
		}

		var query = { _key: key };

		if (min !== '-inf') {
			query.score = { $gte: min };
		}
		if (max !== '+inf') {
			query.score = query.score || {};
			query.score.$lte = max;
		}

		var fields = { _id: 0, value: 1 };
		if (withScores) {
			fields.score = 1;
		}

		db.collection('objects').find(query, { fields: fields })
			.limit(count)
			.skip(start)
			.sort({ score: sort })
			.toArray((err, data) => {
				if (err) {
					return callback(err);
				}

				if (!withScores) {
					data = data.map(item => item.value);
				}

				callback(err, data);
			});
	}

	module.sortedSetCount = (key, min, max, callback) => {
		if (!key) {
			return callback();
		}

		var query = { _key: key };
		if (min !== '-inf') {
			query.score = { $gte: min };
		}
		if (max !== '+inf') {
			query.score = query.score || {};
			query.score.$lte = max;
		}

		db.collection('objects').count(query, (err, count) => {
			callback(err, count || 0);
		});
	};

	module.sortedSetCard = (key, callback) => {
		if (!key) {
			return callback(null, 0);
		}
		db.collection('objects').count({ _key: key }, (err, count) => {
			count = parseInt(count, 10);
			callback(err, count || 0);
		});
	};

	module.sortedSetsCard = (keys, callback) => {
		if (!Array.isArray(keys) || !keys.length) {
			return callback();
		}
		var pipeline = [
			{ $match: { _key: { $in: keys } } },
			{ $group: { _id: { _key: '$_key' }, count: { $sum: 1 } } },
			{ $project: { _id: 1, count: '$count' } },
		];
		db.collection('objects').aggregate(pipeline, (err, results) => {
			if (err) {
				return callback(err);
			}

			if (!Array.isArray(results)) {
				results = [];
			}

			var map = {};
			results.forEach((item) => {
				if (item && item._id._key) {
					map[item._id._key] = item.count;
				}
			});

			results = keys.map(key => map[key] || 0);
			callback(null, results);
		});
	};

	module.sortedSetRank = (key, value, callback) => {
		getSortedSetRank(module.getSortedSetRange, key, value, callback);
	};

	module.sortedSetRevRank = (key, value, callback) => {
		getSortedSetRank(module.getSortedSetRevRange, key, value, callback);
	};

	function getSortedSetRank(method, key, value, callback) {
		if (!key) {
			return callback();
		}
		value = helpers.valueToString(value);
		method(key, 0, -1, (err, result) => {
			if (err) {
				return callback(err);
			}

			var rank = result.indexOf(value);
			callback(null, rank !== -1 ? rank : null);
		});
	}

	module.sortedSetsRanks = (keys, values, callback) => {
		if (!Array.isArray(keys) || !keys.length) {
			return callback(null, []);
		}
		var data = new Array(values.length);
		for (var i = 0; i < values.length; i += 1) {
			data[i] = { key: keys[i], value: values[i] };
		}

		async.map(data, (item, next) => {
			getSortedSetRank(module.getSortedSetRange, item.key, item.value, next);
		}, callback);
	};

	module.sortedSetRanks = (key, values, callback) => {
		module.getSortedSetRange(key, 0, -1, (err, sortedSet) => {
			if (err) {
				return callback(err);
			}

			var result = values.map((value) => {
				if (!value) {
					return null;
				}
				var index = sortedSet.indexOf(value.toString());
				return index !== -1 ? index : null;
			});

			callback(null, result);
		});
	};

	module.sortedSetScore = (key, value, callback) => {
		if (!key) {
			return callback(null, null);
		}
		value = helpers.valueToString(value);
		db.collection('objects').findOne({ _key: key, value: value }, { fields: { _id: 0, score: 1 } }, (err, result) => {
			callback(err, result ? result.score : null);
		});
	};

	module.sortedSetsScore = (keys, value, callback) => {
		if (!Array.isArray(keys) || !keys.length) {
			return callback();
		}
		value = helpers.valueToString(value);
		db.collection('objects').find({ _key: { $in: keys }, value: value }, { _id: 0, _key: 1, score: 1 }).toArray((err, result) => {
			if (err) {
				return callback(err);
			}

			var map = helpers.toMap(result);
			var returnData = [];
			var item;

			for (var i = 0; i < keys.length; i += 1) {
				item = map[keys[i]];
				returnData.push(item ? item.score : null);
			}

			callback(null, returnData);
		});
	};

	module.sortedSetScores = (key, values, callback) => {
		if (!key) {
			return callback(null, null);
		}
		values = values.map(helpers.valueToString);
		db.collection('objects').find({ _key: key, value: { $in: values } }, { _id: 0, value: 1, score: 1 }).toArray((err, result) => {
			if (err) {
				return callback(err);
			}

			var map = {};
			result.forEach((item) => {
				map[item.value] = item.score;
			});

			var returnData = new Array(values.length);
			var score;

			for (var i = 0; i < values.length; i += 1) {
				score = map[values[i]];
				returnData[i] = utils.isNumber(score) ? score : null;
			}

			callback(null, returnData);
		});
	};

	module.isSortedSetMember = (key, value, callback) => {
		if (!key) {
			return callback();
		}
		value = helpers.valueToString(value);
		db.collection('objects').findOne({ _key: key, value: value }, { _id: 0, value: 1 }, (err, result) => {
			callback(err, !!result);
		});
	};

	module.isSortedSetMembers = (key, values, callback) => {
		if (!key) {
			return callback();
		}
		values = values.map(helpers.valueToString);
		db.collection('objects').find({ _key: key, value: { $in: values } }, { fields: { _id: 0, value: 1 } }).toArray((err, results) => {
			if (err) {
				return callback(err);
			}

			results = results.map(item => item.value);

			values = values.map(value => results.indexOf(value) !== -1);
			callback(null, values);
		});
	};

	module.isMemberOfSortedSets = (keys, value, callback) => {
		if (!Array.isArray(keys)) {
			return callback();
		}
		value = helpers.valueToString(value);
		db.collection('objects').find({ _key: { $in: keys }, value: value }, { fields: { _id: 0, _key: 1, value: 1 } }).toArray((err, results) => {
			if (err) {
				return callback(err);
			}

			results = results.map(item => item._key);

			results = keys.map(key => results.indexOf(key) !== -1);
			callback(null, results);
		});
	};

	module.getSortedSetsMembers = (keys, callback) => {
		if (!Array.isArray(keys) || !keys.length) {
			return callback(null, []);
		}
		db.collection('objects').find({ _key: { $in: keys } }, { _id: 0, _key: 1, value: 1 }).toArray((err, data) => {
			if (err) {
				return callback(err);
			}

			var sets = {};
			data.forEach((set) => {
				sets[set._key] = sets[set._key] || [];
				sets[set._key].push(set.value);
			});

			var returnData = new Array(keys.length);
			for (var i = 0; i < keys.length; i += 1) {
				returnData[i] = sets[keys[i]] || [];
			}
			callback(null, returnData);
		});
	};

	module.sortedSetIncrBy = (key, increment, value, callback) => {
		callback = callback || helpers.noop;
		if (!key) {
			return callback();
		}
		var data = {};
		value = helpers.valueToString(value);
		data.score = parseFloat(increment);

		db.collection('objects').findAndModify({ _key: key, value: value }, {}, { $inc: data }, { new: true, upsert: true }, (err, result) => {
			// if there is duplicate key error retry the upsert
			// https://github.com/NodeBB/NodeBB/issues/4467
			// https://jira.mongodb.org/browse/SERVER-14322
			// https://docs.mongodb.org/manual/reference/command/findAndModify/#upsert-and-unique-index
			if (err && err.message.startsWith('E11000 duplicate key error')) {
				return process.nextTick(module.sortedSetIncrBy, key, increment, value, callback);
			}
			callback(err, result && result.value ? result.value.score : null);
		});
	};

	module.getSortedSetRangeByLex = (key, min, max, start, count, callback) => {
		sortedSetLex(key, min, max, 1, start, count, callback);
	};

	module.getSortedSetRevRangeByLex = (key, max, min, start, count, callback) => {
		sortedSetLex(key, min, max, -1, start, count, callback);
	};

	module.sortedSetLexCount = (key, min, max, callback) => {
		sortedSetLex(key, min, max, 1, 0, 0, (err, data) => {
			callback(err, data ? data.length : null);
		});
	};

	function sortedSetLex(key, min, max, sort, start, count, callback) {
		if (!callback) {
			callback = start;
			start = 0;
			count = 0;
		}

		var query = { _key: key };
		buildLexQuery(query, min, max);

		db.collection('objects').find(query, { _id: 0, value: 1 })
			.sort({ value: sort })
			.skip(start)
			.limit(count === -1 ? 0 : count)
			.toArray((err, data) => {
				if (err) {
					return callback(err);
				}
				data = data.map(item => item && item.value);
				callback(err, data);
			});
	}

	module.sortedSetRemoveRangeByLex = (key, min, max, callback) => {
		callback = callback || helpers.noop;

		var query = { _key: key };
		buildLexQuery(query, min, max);

		db.collection('objects').remove(query, (err) => {
			callback(err);
		});
	};

	function buildLexQuery(query, min, max) {
		if (min !== '-') {
			if (min.match(/^\(/)) {
				query.value = { $gt: min.slice(1) };
			} else if (min.match(/^\[/)) {
				query.value = { $gte: min.slice(1) };
			} else {
				query.value = { $gte: min };
			}
		}
		if (max !== '+') {
			query.value = query.value || {};
			if (max.match(/^\(/)) {
				query.value.$lt = max.slice(1);
			} else if (max.match(/^\[/)) {
				query.value.$lte = max.slice(1);
			} else {
				query.value.$lte = max;
			}
		}
	}

	module.processSortedSet = (setKey, processFn, options, callback) => {
		var done = false;
		var ids = [];
		var cursor = db.collection('objects').find({ _key: setKey })
			.sort({ score: 1 })
			.project({ _id: 0, value: 1 })
			.batchSize(options.batch);

		async.whilst(
			() => !done,
			(next) => {
				async.waterfall([
					(next) => {
						cursor.next(next);
					},
					(item, _next) => {
						if (item === null) {
							done = true;
						} else {
							ids.push(item.value);
						}

						if (ids.length < options.batch && (!done || ids.length === 0)) {
							return process.nextTick(next, null);
						}
						processFn(ids, (err) => {
							_next(err);
						});
					},
					(next) => {
						ids = [];
						if (options.interval) {
							setTimeout(next, options.interval);
						} else {
							process.nextTick(next);
						}
					},
				], next);
			},
			callback
		);
	};
};
