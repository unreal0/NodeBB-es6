var async = require('async');

var privileges = require('../privileges');
var cache = require('./cache');

module.exports = (Posts) => {
	Posts.tools = {};

	Posts.tools.delete = (uid, pid, callback) => {
		togglePostDelete(uid, pid, true, callback);
	};

	Posts.tools.restore = (uid, pid, callback) => {
		togglePostDelete(uid, pid, false, callback);
	};

	function togglePostDelete(uid, pid, isDelete, callback) {
		async.waterfall([
			(next) => {
				Posts.exists(pid, next);
			},
			(exists, next) => {
				if (!exists) {
					return next(new Error('[[error:no-post]]'));
				}
				Posts.getPostField(pid, 'deleted', next);
			},
			(deleted, next) => {
				if (parseInt(deleted, 10) === 1 && isDelete) {
					return next(new Error('[[error:post-already-deleted]]'));
				} else if (parseInt(deleted, 10) !== 1 && !isDelete) {
					return next(new Error('[[error:post-already-restored]]'));
				}

				privileges.posts.canDelete(pid, uid, next);
			},
			(canDelete, next) => {
				if (!canDelete.flag) {
					return next(new Error(canDelete.message));
				}

				if (isDelete) {
					cache.del(pid);
					Posts.delete(pid, uid, next);
				} else {
					Posts.restore(pid, uid, (err, postData) => {
						if (err) {
							return next(err);
						}
						Posts.parsePost(postData, next);
					});
				}
			},
		], callback);
	}

	Posts.tools.purge = (uid, pid, callback) => {
		async.waterfall([
			(next) => {
				privileges.posts.canPurge(pid, uid, next);
			},
			(canPurge, next) => {
				if (!canPurge) {
					return next(new Error('[[error:no-privileges]]'));
				}
				cache.del(pid);
				Posts.purge(pid, uid, next);
			},
		], callback);
	};
};

