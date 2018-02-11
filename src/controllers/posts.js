

var async = require('async');

var posts = require('../posts');
var privileges = require('../privileges');
var helpers = require('./helpers');

var postsController = module.exports;

postsController.redirectToPost = (req, res, next) => {
	var pid = parseInt(req.params.pid, 10);
	if (!pid) {
		return next();
	}

	async.waterfall([
		(next) => {
			async.parallel({
				canRead: (next) => {
					privileges.posts.can('read', pid, req.uid, next);
				},
				path: (next) => {
					posts.generatePostPath(pid, req.uid, next);
				},
			}, next);
		},
		(results, next) => {
			if (!results.path) {
				return next();
			}
			if (!results.canRead) {
				return helpers.notAllowed(req, res);
			}
			helpers.redirect(res, results.path);
		},
	], next);
};

postsController.getRecentPosts = (req, res, next) => {
	async.waterfall([
		(next) => {
			posts.getRecentPosts(req.uid, 0, 19, req.params.term, next);
		},
		(data) => {
			res.json(data);
		},
	], next);
};
