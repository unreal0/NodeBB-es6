var async = require('async');
var nconf = require('nconf');

var admin = require('./admin');
var translator = require('../translator');

var navigation = module.exports;

navigation.get = (callback) => {
	if (admin.cache) {
		return callback(null, admin.cache);
	}

	async.waterfall([
		admin.get,
		(data, next) => {
			data = data.filter(item => item && item.enabled).map((item) => {
				item.originalRoute = item.route;

				if (!item.route.startsWith('http')) {
					item.route = nconf.get('relative_path') + item.route;
				}

				Object.keys(item).forEach((key) => {
					item[key] = translator.unescape(item[key]);
				});

				return item;
			});

			admin.cache = data;

			next(null, data);
		},
	], callback);
};


module.exports = navigation;
