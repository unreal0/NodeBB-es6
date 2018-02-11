var async = require('async');
var nconf = require('nconf');

var db = require('../database');
var pubsub = require('../pubsub');
var cacheBuster = require('./cacheBuster');

module.exports = (Meta) => {
	Meta.config = {};
	Meta.configs = {};

	Meta.configs.init = (callback) => {
		delete Meta.config;

		async.waterfall([
			(next) => {
				Meta.configs.list(next);
			},
			(config, next) => {
				cacheBuster.read((err, buster) => {
					if (err) {
						return next(err);
					}

					config['cache-buster'] = 'v=' + (buster || Date.now());
					// config['cache-buster'] = '';

					Meta.config = config;
					next();
				});
			},
		], callback);
	};

	Meta.configs.list = (callback) => {
		db.getObject('config', (err, config) => {
			config = config || {};
			config.version = nconf.get('version');
			config.registry = nconf.get('registry');
			callback(err, config);
		});
	};

	Meta.configs.get = (field, callback) => {
		db.getObjectField('config', field, callback);
	};

	Meta.configs.getFields = (fields, callback) => {
		db.getObjectFields('config', fields, callback);
	};

	Meta.configs.set = (field, value, callback) => {
		callback = callback || function () {};
		if (!field) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		var data = {};
		data[field] = value;
		Meta.configs.setMultiple(data, callback);
	};


	Meta.configs.setMultiple = (data, callback) => {
		async.waterfall([
			(next) => {
				processConfig(data, next);
			},
			(next) => {
				db.setObject('config', data, next);
			},
			(next) => {
				updateConfig(data);
				setImmediate(next);
			},
		], callback);
	};

	function processConfig(data, callback) {
		if (data.customCSS) {
			return saveRenderedCss(data, callback);
		}
		setImmediate(callback);
	}

	function saveRenderedCss(data, callback) {
		var less = require('less');
		async.waterfall([
			(next) => {
				less.render(data.customCSS, {
					compress: true,
				}, next);
			},
			(lessObject, next) => {
				data.renderedCustomCSS = lessObject.css;
				setImmediate(next);
			},
		], callback);
	}

	function updateConfig(config) {
		pubsub.publish('config:update', config);
	}

	pubsub.on('config:update', function onConfigReceived(config) {
		if (typeof config === 'object' && Meta.config) {
			for (var field in config) {
				if (config.hasOwnProperty(field)) {
					Meta.config[field] = config[field];
				}
			}
		}
	});

	Meta.configs.setOnEmpty = (values, callback) => {
		async.waterfall([
			(next) => {
				db.getObject('config', next);
			},
			(data, next) => {
				data = data || {};
				var empty = {};
				Object.keys(values).forEach((key) => {
					if (!data.hasOwnProperty(key)) {
						empty[key] = values[key];
					}
				});
				if (Object.keys(empty).length) {
					db.setObject('config', empty, next);
				} else {
					setImmediate(next);
				}
			},
		], callback);
	};

	Meta.configs.remove = (field, callback) => {
		db.deleteObjectField('config', field, callback);
	};
};
