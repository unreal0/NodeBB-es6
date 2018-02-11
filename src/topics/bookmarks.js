var async = require('async');

var db = require('../database');
var posts = require('../posts');

module.exports = (Topics) => {
	Topics.getUserBookmark = (tid, uid, callback) => {
		if (!parseInt(uid, 10)) {
			return callback(null, null);
		}
		db.sortedSetScore('tid:' + tid + ':bookmarks', uid, callback);
	};

	Topics.getUserBookmarks = (tids, uid, callback) => {
		if (!parseInt(uid, 10)) {
			return callback(null, tids.map(() => null));
		}
		db.sortedSetsScore(tids.map(tid => 'tid:' + tid + ':bookmarks'), uid, callback);
	};

	Topics.setUserBookmark = (tid, uid, index, callback) => {
		db.sortedSetAdd('tid:' + tid + ':bookmarks', index, uid, callback);
	};

	Topics.getTopicBookmarks = (tid, callback) => {
		db.getSortedSetRangeWithScores(['tid:' + tid + ':bookmarks'], 0, -1, callback);
	};

	Topics.updateTopicBookmarks = (tid, pids, callback) => {
		var maxIndex;

		async.waterfall([
			(next) => {
				Topics.getPostCount(tid, next);
			},
			(postcount, next) => {
				maxIndex = postcount;
				Topics.getTopicBookmarks(tid, next);
			},
			(bookmarks, next) => {
				var forkedPosts = pids.map(pid => ({ pid: pid, tid: tid }));

				var uidData = bookmarks.map(bookmark => ({
					uid: bookmark.value,
					bookmark: bookmark.score,
				}));

				async.eachLimit(uidData, 50, (data, next) => {
					posts.getPostIndices(forkedPosts, data.uid, (err, postIndices) => {
						if (err) {
							return next(err);
						}

						var bookmark = data.bookmark;
						bookmark = bookmark < maxIndex ? bookmark : maxIndex;

						for (var i = 0; i < postIndices.length && postIndices[i] < data.bookmark; i += 1) {
							bookmark -= 1;
						}

						if (parseInt(bookmark, 10) !== parseInt(data.bookmark, 10)) {
							Topics.setUserBookmark(tid, data.uid, bookmark, next);
						} else {
							next();
						}
					});
				}, next);
			},
		], (err) => {
			callback(err);
		});
	};
};
