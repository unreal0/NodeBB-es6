

var async = require('async');
var posts = require('../posts');
var db = require('../database');

module.exports = (Categories) => {
	Categories.getActiveUsers = (cid, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRevRange('cid:' + cid + ':pids', 0, 24, next);
			},
			(pids, next) => {
				posts.getPostsFields(pids, ['uid'], next);
			},
			(posts, next) => {
				var uids = posts.map(post => post.uid).filter((uid, index, array) => parseInt(uid, 10) && array.indexOf(uid) === index);

				next(null, uids);
			},
		], callback);
	};
};
