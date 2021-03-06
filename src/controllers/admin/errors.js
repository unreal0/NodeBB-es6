

var async = require('async');
var json2csv = require('json-2-csv').json2csv;

var meta = require('../../meta');
var analytics = require('../../analytics');

var errorsController = module.exports;

errorsController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			async.parallel({
				'not-found': async.apply(meta.errors.get, true),
				analytics: async.apply(analytics.getErrorAnalytics),
			}, next);
		},
		(data) => {
			res.render('admin/advanced/errors', data);
		},
	], next);
};

errorsController.export = (req, res, next) => {
	async.waterfall([
		async.apply(meta.errors.get, false),
		async.apply(json2csv),
		(csv) => {
			res.set('Content-Type', 'text/csv').set('Content-Disposition', 'attachment; filename="404.csv"').send(csv);
		},
	], next);
};
