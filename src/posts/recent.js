var async = require('async');
var db = require('../database');
var privileges = require('../privileges');


module.exports = (Posts) => {
	var terms = {
		day: 86400000,
		week: 604800000,
		month: 2592000000,
	};

	Posts.getRecentPosts = (uid, start, stop, term, callback) => {
		var min = 0;
		if (terms[term]) {
			min = Date.now() - terms[term];
		}

		var count = parseInt(stop, 10) === -1 ? stop : stop - start + 1;

		async.waterfall([
			(next) => {
				db.getSortedSetRevRangeByScore('posts:pid', start, count, '+inf', min, next);
			},
			(pids, next) => {
				privileges.posts.filter('read', pids, uid, next);
			},
			(pids, next) => {
				Posts.getPostSummaryByPids(pids, uid, { stripTags: true }, next);
			},
		], callback);
	};

	Posts.getRecentPosterUids = (start, stop, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRevRange('posts:pid', start, stop, next);
			},
			(pids, next) => {
				Posts.getPostsFields(pids, ['uid'], next);
			},
			(postData, next) => {
				var uids = postData.map(post => post && post.uid).filter((uid, index, array) => uid && array.indexOf(uid) === index);
				next(null, uids);
			},
		], callback);
	};
};
