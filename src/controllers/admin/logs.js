

var async = require('async');
var validator = require('validator');

var meta = require('../../meta');

var logsController = module.exports;

logsController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			meta.logs.get(next);
		},
		(logs) => {
			res.render('admin/advanced/logs', {
				data: validator.escape(logs),
			});
		},
	], next);
};


module.exports = logsController;
