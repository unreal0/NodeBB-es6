var async = require('async');

var db = require('../database');
var plugins = require('../plugins');
var Meta = require('../meta');

var Settings = module.exports;

Settings.get = (hash, callback) => {
	db.getObject('settings:' + hash, (err, settings) => {
		callback(err, settings || {});
	});
};

Settings.getOne = (hash, field, callback) => {
	db.getObjectField('settings:' + hash, field, callback);
};

Settings.set = (hash, values, quiet, callback) => {
	if (!callback && typeof quiet === 'function') {
		callback = quiet;
		quiet = false;
	} else {
		quiet = quiet || false;
	}

	async.waterfall([
		(next) => {
			db.setObject('settings:' + hash, values, next);
		},
		(next) => {
			plugins.fireHook('action:settings.set', {
				plugin: hash,
				settings: values,
			});

			Meta.reloadRequired = !quiet;
			next();
		},
	], callback);
};

Settings.setOne = (hash, field, value, callback) => {
	var data = {};
	data[field] = value;
	Settings.set(hash, data, callback);
};

Settings.setOnEmpty = (hash, values, callback) => {
	async.waterfall([
		(next) => {
			db.getObject('settings:' + hash, next);
		},
		(settings, next) => {
			settings = settings || {};
			var empty = {};
			Object.keys(values).forEach((key) => {
				if (!settings.hasOwnProperty(key)) {
					empty[key] = values[key];
				}
			});

			if (Object.keys(empty).length) {
				Settings.set(hash, empty, next);
			} else {
				next();
			}
		},
	], callback);
};
