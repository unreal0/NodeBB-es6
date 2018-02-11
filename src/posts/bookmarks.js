var async = require('async');

var db = require('../database');
var plugins = require('../plugins');

module.exports = (Posts) => {
	Posts.bookmark = (pid, uid, callback) => {
		toggleBookmark('bookmark', pid, uid, callback);
	};

	Posts.unbookmark = (pid, uid, callback) => {
		toggleBookmark('unbookmark', pid, uid, callback);
	};

	function toggleBookmark(type, pid, uid, callback) {
		if (!parseInt(uid, 10)) {
			return callback(new Error('[[error:not-logged-in]]'));
		}

		var isBookmarking = type === 'bookmark';
		var postData;
		var hasBookmarked;
		var owner;
		async.waterfall([
			(next) => {
				async.parallel({
					owner: (next) => {
						Posts.getPostField(pid, 'uid', next);
					},
					postData: (next) => {
						Posts.getPostFields(pid, ['pid', 'uid'], next);
					},
					hasBookmarked: (next) => {
						Posts.hasBookmarked(pid, uid, next);
					},
				}, next);
			},
			(results, next) => {
				owner = results.owner;
				postData = results.postData;
				hasBookmarked = results.hasBookmarked;

				if (isBookmarking && hasBookmarked) {
					return callback(new Error('[[error:already-bookmarked]]'));
				}

				if (!isBookmarking && !hasBookmarked) {
					return callback(new Error('[[error:already-unbookmarked]]'));
				}

				if (isBookmarking) {
					db.sortedSetAdd('uid:' + uid + ':bookmarks', Date.now(), pid, next);
				} else {
					db.sortedSetRemove('uid:' + uid + ':bookmarks', pid, next);
				}
			},
			(next) => {
				db[isBookmarking ? 'setAdd' : 'setRemove']('pid:' + pid + ':users_bookmarked', uid, next);
			},
			(next) => {
				db.setCount('pid:' + pid + ':users_bookmarked', next);
			},
			(count, next) => {
				postData.bookmarks = count;
				Posts.setPostField(pid, 'bookmarks', count, next);
			},
			(next) => {
				var current = hasBookmarked ? 'bookmarked' : 'unbookmarked';

				plugins.fireHook('action:post.' + type, {
					pid: pid,
					uid: uid,
					owner: owner,
					current: current,
				});

				next(null, {
					post: postData,
					isBookmarked: isBookmarking,
				});
			},
		], callback);
	}

	Posts.hasBookmarked = (pid, uid, callback) => {
		if (!parseInt(uid, 10)) {
			if (Array.isArray(pid)) {
				callback(null, pid.map(() => false));
			} else {
				callback(null, false);
			}
			return;
		}

		if (Array.isArray(pid)) {
			var sets = pid.map(pid => 'pid:' + pid + ':users_bookmarked');

			db.isMemberOfSets(sets, uid, callback);
		} else {
			db.isSetMember('pid:' + pid + ':users_bookmarked', uid, callback);
		}
	};
};
