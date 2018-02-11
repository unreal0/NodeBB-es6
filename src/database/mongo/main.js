module.exports = (db, module) => {
	var helpers = module.helpers.mongo;

	module.flushdb = (callback) => {
		callback = callback || helpers.noop;
		db.dropDatabase((err) => {
			callback(err);
		});
	};

	module.emptydb = (callback) => {
		callback = callback || helpers.noop;
		db.collection('objects').remove({}, (err) => {
			if (err) {
				return callback(err);
			}
			module.resetObjectCache();
			callback();
		});
	};

	module.exists = (key, callback) => {
		if (!key) {
			return callback();
		}
		db.collection('objects').findOne({ _key: key }, (err, item) => {
			callback(err, item !== undefined && item !== null);
		});
	};

	module.delete = (key, callback) => {
		callback = callback || helpers.noop;
		if (!key) {
			return callback();
		}
		db.collection('objects').remove({ _key: key }, (err) => {
			if (err) {
				return callback(err);
			}
			module.delObjectCache(key);
			callback();
		});
	};

	module.deleteAll = (keys, callback) => {
		callback = callback || helpers.noop;
		if (!Array.isArray(keys) || !keys.length) {
			return callback();
		}
		db.collection('objects').remove({ _key: { $in: keys } }, (err) => {
			if (err) {
				return callback(err);
			}

			keys.forEach((key) => {
				module.delObjectCache(key);
			});

			callback(null);
		});
	};

	module.get = (key, callback) => {
		if (!key) {
			return callback();
		}
		module.getObjectField(key, 'data', callback);
	};

	module.set = (key, value, callback) => {
		callback = callback || helpers.noop;
		if (!key) {
			return callback();
		}
		var data = { data: value };
		module.setObject(key, data, callback);
	};

	module.increment = (key, callback) => {
		callback = callback || helpers.noop;
		if (!key) {
			return callback();
		}
		db.collection('objects').findAndModify({ _key: key }, {}, { $inc: { data: 1 } }, { new: true, upsert: true }, (err, result) => {
			callback(err, result && result.value ? result.value.data : null);
		});
	};

	module.rename = (oldKey, newKey, callback) => {
		callback = callback || helpers.noop;
		db.collection('objects').update({ _key: oldKey }, { $set: { _key: newKey } }, { multi: true }, (err) => {
			if (err) {
				return callback(err);
			}
			module.delObjectCache(oldKey);
			module.delObjectCache(newKey);
			callback();
		});
	};

	module.type = (key, callback) => {
		db.collection('objects').findOne({ _key: key }, (err, data) => {
			if (err) {
				return callback(err);
			}
			if (!data) {
				return callback(null, null);
			}
			delete data.expireAt;
			var keys = Object.keys(data);
			if (keys.length === 4 && data.hasOwnProperty('_key') && data.hasOwnProperty('score') && data.hasOwnProperty('value')) {
				return callback(null, 'zset');
			} else if (keys.length === 3 && data.hasOwnProperty('_key') && data.hasOwnProperty('members')) {
				return callback(null, 'set');
			} else if (keys.length === 3 && data.hasOwnProperty('_key') && data.hasOwnProperty('array')) {
				return callback(null, 'list');
			} else if (keys.length === 3 && data.hasOwnProperty('_key') && data.hasOwnProperty('data')) {
				return callback(null, 'string');
			}
			callback(null, 'hash');
		});
	};

	module.expire = (key, seconds, callback) => {
		module.expireAt(key, Math.round(Date.now() / 1000) + seconds, callback);
	};

	module.expireAt = (key, timestamp, callback) => {
		module.setObjectField(key, 'expireAt', new Date(timestamp * 1000), callback);
	};

	module.pexpire = (key, ms, callback) => {
		module.pexpireAt(key, Date.now() + parseInt(ms, 10), callback);
	};

	module.pexpireAt = (key, timestamp, callback) => {
		timestamp = Math.min(timestamp, 8640000000000000);
		module.setObjectField(key, 'expireAt', new Date(timestamp), callback);
	};
};
