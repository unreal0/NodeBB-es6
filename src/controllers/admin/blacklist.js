

var async = require('async');
var meta = require('../../meta');
var analytics = require('../../analytics');

var blacklistController = module.exports;

blacklistController.get = (req, res, next) => {
	// Analytics.getBlacklistAnalytics
	async.parallel({
		rules: async.apply(meta.blacklist.get),
		analytics: async.apply(analytics.getBlacklistAnalytics),
	}, (err, data) => {
		if (err) {
			return next(err);
		}

		res.render('admin/manage/ip-blacklist', Object.assign(data, {
			title: '[[pages:ip-blacklist]]',
		}));
	});
};
