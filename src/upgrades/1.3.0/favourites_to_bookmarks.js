var db = require('../../database');

var async = require('async');

module.exports = {
	name: 'Favourites to Bookmarks',
	timestamp: Date.UTC(2016, 9, 8),
	method: (callback) => {
		var progress = this.progress;

		function upgradePosts(next) {
			var batch = require('../../batch');

			batch.processSortedSet('posts:pid', (ids, next) => {
				async.each(ids, (id, next) => {
					progress.incr();

					async.waterfall([
						(next) => {
							db.rename('pid:' + id + ':users_favourited', 'pid:' + id + ':users_bookmarked', next);
						},
						(next) => {
							db.getObjectField('post:' + id, 'reputation', next);
						},
						(reputation, next) => {
							if (parseInt(reputation, 10)) {
								db.setObjectField('post:' + id, 'bookmarks', reputation, next);
							} else {
								next();
							}
						},
						(next) => {
							db.deleteObjectField('post:' + id, 'reputation', next);
						},
					], next);
				}, next);
			}, {
				progress: progress,
			}, next);
		}

		function upgradeUsers(next) {
			var batch = require('../../batch');

			batch.processSortedSet('users:joindate', (ids, next) => {
				async.each(ids, (id, next) => {
					db.rename('uid:' + id + ':favourites', 'uid:' + id + ':bookmarks', next);
				}, next);
			}, {}, next);
		}

		async.series([upgradePosts, upgradeUsers], callback);
	},
};
