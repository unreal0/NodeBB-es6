var async = require('async');

var db = require('../database');
var categories = require('../categories');

module.exports = (User) => {
	User.getIgnoredCategories = (uid, callback) => {
		db.getSortedSetRange('uid:' + uid + ':ignored:cids', 0, -1, callback);
	};

	User.getWatchedCategories = (uid, callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					ignored: (next) => {
						User.getIgnoredCategories(uid, next);
					},
					all: (next) => {
						db.getSortedSetRange('categories:cid', 0, -1, next);
					},
				}, next);
			},
			(results, next) => {
				var watched = results.all.filter(function (cid) {
					return cid && results.ignored.indexOf(cid) === -1;
				});
				next(null, watched);
			},
		], callback);
	};

	User.ignoreCategory = (uid, cid, callback) => {
		if (!uid) {
			return callback();
		}

		async.waterfall([
			(next) => {
				categories.exists(cid, next);
			},
			(exists, next) => {
				if (!exists) {
					return next(new Error('[[error:no-category]]'));
				}
				db.sortedSetAdd('uid:' + uid + ':ignored:cids', Date.now(), cid, next);
			},
			(next) => {
				db.sortedSetAdd('cid:' + cid + ':ignorers', Date.now(), uid, next);
			},
		], callback);
	};

	User.watchCategory = (uid, cid, callback) => {
		if (!uid) {
			return callback();
		}

		async.waterfall([
			(next) => {
				categories.exists(cid, next);
			},
			(exists, next) => {
				if (!exists) {
					return next(new Error('[[error:no-category]]'));
				}
				db.sortedSetRemove('uid:' + uid + ':ignored:cids', cid, next);
			},
			(next) => {
				db.sortedSetRemove('cid:' + cid + ':ignorers', uid, next);
			},
		], callback);
	};
};
