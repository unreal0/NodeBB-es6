

var async = require('async');

var topics = require('../../topics');

var tagsController = module.exports;

tagsController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			topics.getTags(0, 199, next);
		},
		(tags) => {
			res.render('admin/manage/tags', { tags: tags });
		},
	], next);
};
