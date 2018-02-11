module.exports = (db, module) => {
	var helpers = module.helpers.mongo;

	var LRU = require('lru-cache');
	var _ = require('lodash');
	var pubsub = require('../../pubsub');

	var cache = LRU({
		max: 10000,
		length: () => 1,
		maxAge: 0,
	});

	cache.misses = 0;
	cache.hits = 0;
	module.objectCache = cache;

	pubsub.on('mongo:hash:cache:del', (key) => {
		cache.del(key);
	});

	pubsub.on('mongo:hash:cache:reset', () => {
		cache.reset();
	});

	module.delObjectCache = (key) => {
		pubsub.publish('mongo:hash:cache:del', key);
		cache.del(key);
	};

	module.resetObjectCache = () => {
		pubsub.publish('mongo:hash:cache:reset');
		cache.reset();
	};

	module.setObject = (key, data, callback) => {
		callback = callback || helpers.noop;
		if (!key || !data) {
			return callback();
		}
		if (data.hasOwnProperty('')) {
			delete data[''];
		}
		db.collection('objects').update({ _key: key }, { $set: data }, { upsert: true, w: 1 }, (err) => {
			if (err) {
				return callback(err);
			}
			module.delObjectCache(key);
			callback();
		});
	};

	module.setObjectField = (key, field, value, callback) => {
		callback = callback || helpers.noop;
		if (!field) {
			return callback();
		}
		var data = {};
		field = helpers.fieldToString(field);
		data[field] = value;
		module.setObject(key, data, callback);
	};

	module.getObject = (key, callback) => {
		if (!key) {
			return callback();
		}

		module.getObjects([key], (err, data) => {
			if (err) {
				return callback(err);
			}
			callback(null, data && data.length ? data[0] : null);
		});
	};

	module.getObjects = (keys, callback) => {
		var cachedData = {};
		function getFromCache() {
			process.nextTick(callback, null, keys.map(key => _.clone(cachedData[key])));
		}

		if (!Array.isArray(keys) || !keys.length) {
			return callback(null, []);
		}

		var nonCachedKeys = keys.filter((key) => {
			var data = cache.get(key);
			if (data !== undefined) {
				cachedData[key] = data;
			}
			return data === undefined;
		});

		var hits = keys.length - nonCachedKeys.length;
		var misses = keys.length - hits;
		cache.hits += hits;
		cache.misses += misses;

		if (!nonCachedKeys.length) {
			return getFromCache();
		}

		db.collection('objects').find({ _key: { $in: nonCachedKeys } }, { _id: 0 }).toArray((err, data) => {
			if (err) {
				return callback(err);
			}

			var map = helpers.toMap(data);
			nonCachedKeys.forEach((key) => {
				cachedData[key] = map[key] || null;
				cache.set(key, cachedData[key]);
			});

			getFromCache();
		});
	};

	module.getObjectField = (key, field, callback) => {
		if (!key) {
			return callback();
		}
		module.getObject(key, (err, item) => {
			if (err || !item) {
				return callback(err, null);
			}
			callback(null, item.hasOwnProperty(field) ? item[field] : null);
		});
	};

	module.getObjectFields = (key, fields, callback) => {
		if (!key) {
			return callback();
		}
		module.getObject(key, (err, item) => {
			if (err) {
				return callback(err);
			}
			item = item || {};
			var result = {};
			for (var i = 0; i < fields.length; i += 1) {
				result[fields[i]] = item[fields[i]] !== undefined ? item[fields[i]] : null;
			}
			callback(null, result);
		});
	};

	module.getObjectsFields = (keys, fields, callback) => {
		if (!Array.isArray(keys) || !keys.length) {
			return callback(null, []);
		}
		module.getObjects(keys, (err, items) => {
			if (err) {
				return callback(err);
			}
			if (items === null) {
				items = [];
			}

			var returnData = [];
			var item;
			var result;
			for (var i = 0; i < keys.length; i += 1) {
				item = items[i] || {};
				result = {};
				for (var k = 0; k < fields.length; k += 1) {
					result[fields[k]] = item[fields[k]] !== undefined ? item[fields[k]] : null;
				}
				returnData.push(result);
			}

			callback(null, returnData);
		});
	};

	module.getObjectKeys = (key, callback) => {
		module.getObject(key, (err, data) => {
			callback(err, data ? Object.keys(data) : []);
		});
	};

	module.getObjectValues = (key, callback) => {
		module.getObject(key, (err, data) => {
			if (err) {
				return callback(err);
			}

			var values = [];
			for (var key in data) {
				if (data && data.hasOwnProperty(key)) {
					values.push(data[key]);
				}
			}
			callback(null, values);
		});
	};

	module.isObjectField = (key, field, callback) => {
		if (!key) {
			return callback();
		}
		var data = {};
		field = helpers.fieldToString(field);
		data[field] = '';
		db.collection('objects').findOne({ _key: key }, { fields: data }, (err, item) => {
			callback(err, !!item && item[field] !== undefined && item[field] !== null);
		});
	};

	module.isObjectFields = (key, fields, callback) => {
		if (!key) {
			return callback();
		}

		var data = {};
		fields.forEach((field) => {
			field = helpers.fieldToString(field);
			data[field] = '';
		});

		db.collection('objects').findOne({ _key: key }, { fields: data }, (err, item) => {
			if (err) {
				return callback(err);
			}
			var results = [];

			fields.forEach((field, index) => {
				results[index] = !!item && item[field] !== undefined && item[field] !== null;
			});

			callback(null, results);
		});
	};

	module.deleteObjectField = (key, field, callback) => {
		module.deleteObjectFields(key, [field], callback);
	};

	module.deleteObjectFields = (key, fields, callback) => {
		callback = callback || helpers.noop;
		if (!key || !Array.isArray(fields) || !fields.length) {
			return callback();
		}
		fields = fields.filter(Boolean);
		if (!fields.length) {
			return callback();
		}

		var data = {};
		fields.forEach((field) => {
			field = helpers.fieldToString(field);
			data[field] = '';
		});

		db.collection('objects').update({ _key: key }, { $unset: data }, (err) => {
			if (err) {
				return callback(err);
			}
			module.delObjectCache(key);
			callback();
		});
	};

	module.incrObjectField = (key, field, callback) => {
		module.incrObjectFieldBy(key, field, 1, callback);
	};

	module.decrObjectField = (key, field, callback) => {
		module.incrObjectFieldBy(key, field, -1, callback);
	};

	module.incrObjectFieldBy = (key, field, value, callback) => {
		callback = callback || helpers.noop;
		value = parseInt(value, 10);
		if (!key || isNaN(value)) {
			return callback();
		}

		var data = {};
		field = helpers.fieldToString(field);
		data[field] = value;

		db.collection('objects').findAndModify({ _key: key }, {}, { $inc: data }, { new: true, upsert: true }, (err, result) => {
			if (err) {
				return callback(err);
			}
			module.delObjectCache(key);
			callback(null, result && result.value ? result.value[field] : null);
		});
	};
};
