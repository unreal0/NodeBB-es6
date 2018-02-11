var async = require('async');
var batch = require('../../batch');
var db = require('../../database');

module.exports = {
	name: 'Add votes to topics',
	timestamp: Date.UTC(2017, 11, 8),
	method: (callback) => {
		var progress = this.progress;

		batch.processSortedSet('topics:tid', (tids, next) => {
			async.eachLimit(tids, 500, (tid, _next) => {
				progress.incr();
				var topicData;
				async.waterfall([
					(next) => {
						db.getObjectFields('topic:' + tid, ['mainPid', 'cid', 'pinned'], next);
					},
					(_topicData, next) => {
						topicData = _topicData;
						if (!topicData.mainPid || !topicData.cid) {
							return _next();
						}
						db.getObject('post:' + topicData.mainPid, next);
					},
					(postData, next) => {
						if (!postData) {
							return _next();
						}
						var upvotes = parseInt(postData.upvotes, 10) || 0;
						var downvotes = parseInt(postData.downvotes, 10) || 0;
						var data = {
							upvotes: upvotes,
							downvotes: downvotes,
						};
						var votes = upvotes - downvotes;
						async.parallel([
							(next) => {
								db.setObject('topic:' + tid, data, next);
							},
							(next) => {
								db.sortedSetAdd('topics:votes', votes, tid, next);
							},
							(next) => {
								if (parseInt(topicData.pinned, 10) !== 1) {
									db.sortedSetAdd('cid:' + topicData.cid + ':tids:votes', votes, tid, next);
								} else {
									next();
								}
							},
						], (err) => {
							next(err);
						});
					},
				], _next);
			}, next);
		}, {
			progress: progress,
			batch: 500,
		}, callback);
	},
};
