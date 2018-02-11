var db = require('../../database');

var async = require('async');

module.exports = {
	name: 'Upgrading config urls to use assets route',
	timestamp: Date.UTC(2017, 1, 28),
	method: (callback) => {
		async.waterfall([
			(cb) => {
				db.getObject('config', cb);
			},
			(config, cb) => {
				if (!config) {
					return cb();
				}

				var keys = ['brand:favicon', 'brand:touchicon', 'og:image', 'brand:logo:url', 'defaultAvatar', 'profile:defaultCovers'];

				keys.forEach((key) => {
					var oldValue = config[key];

					if (!oldValue || typeof oldValue !== 'string') {
						return;
					}

					config[key] = oldValue.replace(/(?:\/assets)?\/(images|uploads)\//g, '/assets/$1/');
				});

				db.setObject('config', config, cb);
			},
		], callback);
	},
};
