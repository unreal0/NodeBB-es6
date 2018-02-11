var db = require('../../database');

var async = require('async');

module.exports = {
	name: 'New sorted set posts:votes',
	timestamp: Date.UTC(2017, 1, 27),
	method: (callback) => {
		var progress = this.progress;

		require('../../batch').processSortedSet('posts:pid', (pids, next) => {
			async.each(pids, (pid, next) => {
				db.getObjectFields('post:' + pid, ['upvotes', 'downvotes'], (err, postData) => {
					if (err || !postData) {
						return next(err);
					}

					progress.incr();
					var votes = parseInt(postData.upvotes || 0, 10) - parseInt(postData.downvotes || 0, 10);
					db.sortedSetAdd('posts:votes', votes, pid, next);
				});
			}, next);
		}, {
			progress: this.progress,
		}, callback);
	},
};
