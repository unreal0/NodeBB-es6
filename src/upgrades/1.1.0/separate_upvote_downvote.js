var db = require('../../database');

var async = require('async');
var winston = require('winston');

module.exports = {
	name: 'Store upvotes/downvotes separately',
	timestamp: Date.UTC(2016, 5, 13),
	method: (callback) => {
		var batch = require('../../batch');
		var posts = require('../../posts');
		var count = 0;
		var progress = this.progress;

		batch.processSortedSet('posts:pid', (pids, next) => {
			winston.verbose('upgraded ' + count + ' posts');
			count += pids.length;
			async.each(pids, (pid, next) => {
				async.parallel({
					upvotes: (next) => {
						db.setCount('pid:' + pid + ':upvote', next);
					},
					downvotes: (next) => {
						db.setCount('pid:' + pid + ':downvote', next);
					},
				}, (err, results) => {
					if (err) {
						return next(err);
					}
					var data = {};

					if (parseInt(results.upvotes, 10) > 0) {
						data.upvotes = results.upvotes;
					}
					if (parseInt(results.downvotes, 10) > 0) {
						data.downvotes = results.downvotes;
					}

					if (Object.keys(data).length) {
						posts.setPostFields(pid, data, next);
					} else {
						next();
					}

					progress.incr();
				}, next);
			}, next);
		}, {
			progress: progress,
		}, callback);
	},
};
