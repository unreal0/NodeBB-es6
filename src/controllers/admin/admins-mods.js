

var async = require('async');

var groups = require('../../groups');
var categories = require('../../categories');

var AdminsMods = module.exports;

AdminsMods.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			async.parallel({
				admins: (next) => {
					groups.get('administrators', { uid: req.uid }, next);
				},
				globalMods: (next) => {
					groups.get('Global Moderators', { uid: req.uid }, next);
				},
				categories: (next) => {
					getModeratorsOfCategories(req.uid, next);
				},
			}, next);
		},
		(results) => {
			res.render('admin/manage/admins-mods', results);
		},
	], next);
};

function getModeratorsOfCategories(uid, callback) {
	async.waterfall([
		(next) => {
			categories.buildForSelect(uid, 'find', next);
		},
		(categoryData, next) => {
			async.map(categoryData, (category, next) => {
				async.waterfall([
					(next) => {
						categories.getModerators(category.cid, next);
					},
					(moderators, next) => {
						category.moderators = moderators;
						next(null, category);
					},
				], next);
			}, next);
		},
	], callback);
}
