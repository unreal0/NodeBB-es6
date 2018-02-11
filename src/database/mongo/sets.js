module.exports = (db, module) => {
	var helpers = module.helpers.mongo;

	module.setAdd = (key, value, callback) => {
		callback = callback || helpers.noop;
		if (!Array.isArray(value)) {
			value = [value];
		}

		value.forEach((element, index, array) => {
			array[index] = helpers.valueToString(element);
		});

		db.collection('objects').update({
			_key: key,
		}, {
			$addToSet: {
				members: {
					$each: value,
				},
			},
		}, {
			upsert: true,
			w: 1,
		}, (err) => {
			callback(err);
		});
	};

	module.setsAdd = (keys, value, callback) => {
		callback = callback || helpers.noop;

		if (!Array.isArray(keys) || !keys.length) {
			return callback();
		}

		if (!Array.isArray(value)) {
			value = [value];
		}

		value.forEach((element, index, array) => {
			array[index] = helpers.valueToString(element);
		});

		var bulk = db.collection('objects').initializeUnorderedBulkOp();

		for (var i = 0; i < keys.length; i += 1) {
			bulk.find({ _key: keys[i] }).upsert().updateOne({	$addToSet: {
				members: {
					$each: value,
				},
			} });
		}

		bulk.execute((err) => {
			callback(err);
		});
	};

	module.setRemove = (key, value, callback) => {
		callback = callback || helpers.noop;
		if (!Array.isArray(value)) {
			value = [value];
		}

		value.forEach((element, index, array) => {
			array[index] = helpers.valueToString(element);
		});

		db.collection('objects').update({ _key: key }, { $pullAll: { members: value } }, (err) => {
			callback(err);
		});
	};

	module.setsRemove = (keys, value, callback) => {
		callback = callback || helpers.noop;
		if (!Array.isArray(keys) || !keys.length) {
			return callback();
		}
		value = helpers.valueToString(value);

		var bulk = db.collection('objects').initializeUnorderedBulkOp();

		for (var i = 0; i < keys.length; i += 1) {
			bulk.find({ _key: keys[i] }).updateOne({ $pull: {
				members: value,
			} });
		}

		bulk.execute((err) => {
			callback(err);
		});
	};

	module.isSetMember = (key, value, callback) => {
		if (!key) {
			return callback(null, false);
		}
		value = helpers.valueToString(value);

		db.collection('objects').findOne({ _key: key, members: value }, { _id: 0, members: 0 }, (err, item) => {
			callback(err, item !== null && item !== undefined);
		});
	};

	module.isSetMembers = (key, values, callback) => {
		if (!key || !Array.isArray(values) || !values.length) {
			return callback(null, []);
		}

		for (var i = 0; i < values.length; i += 1) {
			values[i] = helpers.valueToString(values[i]);
		}

		db.collection('objects').findOne({ _key: key }, { _id: 0, _key: 0 }, (err, items) => {
			if (err) {
				return callback(err);
			}

			values = values.map(value => !!(items && Array.isArray(items.members) && items.members.indexOf(value) !== -1));

			callback(null, values);
		});
	};

	module.isMemberOfSets = (sets, value, callback) => {
		if (!Array.isArray(sets) || !sets.length) {
			return callback(null, []);
		}
		value = helpers.valueToString(value);

		db.collection('objects').find({ _key: { $in: sets }, members: value }, { _id: 0, members: 0 }).toArray((err, result) => {
			if (err) {
				return callback(err);
			}
			var map = {};
			result.forEach((item) => {
				map[item._key] = true;
			});

			result = sets.map(set => !!map[set]);

			callback(null, result);
		});
	};

	module.getSetMembers = (key, callback) => {
		if (!key) {
			return callback(null, []);
		}
		db.collection('objects').findOne({ _key: key }, { members: 1 }, { _id: 0, _key: 0 }, (err, data) => {
			callback(err, data ? data.members : []);
		});
	};

	module.getSetsMembers = (keys, callback) => {
		if (!Array.isArray(keys) || !keys.length) {
			return callback(null, []);
		}
		db.collection('objects').find({ _key: { $in: keys } }, { _id: 0, _key: 1, members: 1 }).toArray((err, data) => {
			if (err) {
				return callback(err);
			}

			var sets = {};
			data.forEach((set) => {
				sets[set._key] = set.members || [];
			});

			var returnData = new Array(keys.length);
			for (var i = 0; i < keys.length; i += 1) {
				returnData[i] = sets[keys[i]] || [];
			}
			callback(null, returnData);
		});
	};

	module.setCount = (key, callback) => {
		if (!key) {
			return callback(null, 0);
		}
		db.collection('objects').findOne({ _key: key }, { _id: 0 }, (err, data) => {
			callback(err, data ? data.members.length : 0);
		});
	};

	module.setsCount = (keys, callback) => {
		module.getSetsMembers(keys, (err, setsMembers) => {
			if (err) {
				return callback(err);
			}

			var counts = setsMembers.map(members => (members && members.length) || 0);
			callback(null, counts);
		});
	};

	module.setRemoveRandom = (key, callback) => {
		callback = callback || function () {};
		db.collection('objects').findOne({ _key: key }, (err, data) => {
			if (err || !data) {
				return callback(err);
			}

			var randomIndex = Math.floor(Math.random() * data.members.length);
			var value = data.members[randomIndex];
			module.setRemove(data._key, value, (err) => {
				callback(err, value);
			});
		});
	};
};
