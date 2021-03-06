var async = require('async');
var batch = require('../../batch');
var db = require('../../database');

module.exports = {
	name: 'Fix sort by votes for moved topics',
	timestamp: Date.UTC(2018, 0, 8),
	method: (callback) => {
		var progress = this.progress;

		batch.processSortedSet('topics:tid', (tids, next) => {
			async.eachLimit(tids, 500, (tid, _next) => {
				progress.incr();
				var topicData;
				async.waterfall([
					(next) => {
						db.getObjectFields('topic:' + tid, ['cid', 'oldCid', 'upvotes', 'downvotes', 'pinned'], next);
					},
					(_topicData, next) => {
						topicData = _topicData;
						if (!topicData.cid || !topicData.oldCid) {
							return _next();
						}

						var upvotes = parseInt(topicData.upvotes, 10) || 0;
						var downvotes = parseInt(topicData.downvotes, 10) || 0;
						var votes = upvotes - downvotes;

						async.series([
							(next) => {
								db.sortedSetRemove('cid:' + topicData.oldCid + ':tids:votes', tid, next);
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
