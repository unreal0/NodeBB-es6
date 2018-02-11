var async = require('async');
var db = require('../../database');

module.exports = {
	name: 'Fix incorrect robots.txt schema',
	timestamp: Date.UTC(2017, 6, 10),
	method: (callback) => {
		async.waterfall([
			(next) => {
				db.getObject('config', next);
			},
			(config, next) => {
				if (!config) {
					return callback();
				}
				// fix mongo nested data
				if (config.robots && config.robots.txt) {
					db.setObjectField('config', 'robots:txt', config.robots.txt, next);
				} else if (typeof config['robots.txt'] === 'string' && config['robots.txt']) {
					db.setObjectField('config', 'robots:txt', config['robots.txt'], next);
				} else {
					next();
				}
			},
			(next) => {
				db.deleteObjectField('config', 'robots', next);
			},
			(next) => {
				db.deleteObjectField('config', 'robots.txt', next);
			},
		], callback);
	},
};
