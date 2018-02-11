

var async = require('async');

var rewardsController = module.exports;

rewardsController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			require('../../rewards/admin').get(next);
		},
		(data) => {
			res.render('admin/extend/rewards', data);
		},
	], next);
};


module.exports = rewardsController;
