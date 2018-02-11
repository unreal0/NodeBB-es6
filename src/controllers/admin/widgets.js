

var async = require('async');

var widgetsController = module.exports;

widgetsController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			require('../../widgets/admin').get(next);
		},
		(data) => {
			res.render('admin/extend/widgets', data);
		},
	], next);
};
