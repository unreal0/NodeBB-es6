

var async = require('async');
var nconf = require('nconf');

var databaseController = module.exports;

databaseController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			async.parallel({
				redis: (next) => {
					if (nconf.get('redis')) {
						var rdb = require('../../database/redis');
						rdb.info(rdb.client, next);
					} else {
						next();
					}
				},
				mongo: (next) => {
					if (nconf.get('mongo')) {
						var mdb = require('../../database/mongo');
						mdb.info(mdb.client, next);
					} else {
						next();
					}
				},
			}, next);
		},
		(results) => {
			res.render('admin/advanced/database', results);
		},
	], next);
};
