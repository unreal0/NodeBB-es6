

var async = require('async');

var social = require('../../social');

var socialController = module.exports;

socialController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			social.getPostSharing(next);
		},
		(posts) => {
			res.render('admin/general/social', {
				posts: posts,
			});
		},
	], next);
};
