

var async = require('async');

var navigationAdmin = require('../../navigation/admin');
var navigationController = module.exports;

navigationController.get = (req, res, next) => {
	async.waterfall([
		navigationAdmin.getAdmin,
		(data) => {
			data.enabled.forEach((enabled, index) => {
				enabled.index = index;
				enabled.selected = index === 0;
			});

			data.navigation = data.enabled.slice();

			res.render('admin/general/navigation', data);
		},
	], next);
};
