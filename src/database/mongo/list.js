module.exports = (db, module) => {
	var helpers = module.helpers.mongo;

	module.listPrepend = (key, value, callback) => {
		callback = callback || helpers.noop;

		if (!key) {
			return callback();
		}

		value = helpers.valueToString(value);

		module.isObjectField(key, 'array', (err, exists) => {
			if (err) {
				return callback(err);
			}

			if (exists) {
				db.collection('objects').update({ _key: key }, { $push: { array: { $each: [value], $position: 0 } } }, { upsert: true, w: 1 }, (err) => {
					callback(err);
				});
			} else {
				module.listAppend(key, value, callback);
			}
		});
	};

	module.listAppend = (key, value, callback) => {
		callback = callback || helpers.noop;
		if (!key) {
			return callback();
		}
		value = helpers.valueToString(value);
		db.collection('objects').update({ _key: key }, { $push: { array: value } }, { upsert: true, w: 1 }, (err) => {
			callback(err);
		});
	};

	module.listRemoveLast = (key, callback) => {
		callback = callback || helpers.noop;
		if (!key) {
			return callback();
		}
		module.getListRange(key, -1, -1, (err, value) => {
			if (err) {
				return callback(err);
			}

			db.collection('objects').update({ _key: key }, { $pop: { array: 1 } }, (err) => {
				callback(err, (value && value.length) ? value[0] : null);
			});
		});
	};

	module.listRemoveAll = (key, value, callback) => {
		callback = callback || helpers.noop;
		if (!key) {
			return callback();
		}
		value = helpers.valueToString(value);

		db.collection('objects').update({ _key: key }, { $pull: { array: value } }, (err) => {
			callback(err);
		});
	};

	module.listTrim = (key, start, stop, callback) => {
		callback = callback || helpers.noop;
		if (!key) {
			return callback();
		}
		module.getListRange(key, start, stop, (err, value) => {
			if (err) {
				return callback(err);
			}

			db.collection('objects').update({ _key: key }, { $set: { array: value } }, (err) => {
				callback(err);
			});
		});
	};

	module.getListRange = (key, start, stop, callback) => {
		if (!key) {
			return callback();
		}

		db.collection('objects').findOne({ _key: key }, { array: 1 }, (err, data) => {
			if (err || !(data && data.array)) {
				return callback(err, []);
			}

			if (stop === -1) {
				data.array = data.array.slice(start);
			} else {
				data.array = data.array.slice(start, stop + 1);
			}
			callback(null, data.array);
		});
	};
};
