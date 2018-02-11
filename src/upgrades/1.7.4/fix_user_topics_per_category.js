var async = require('async');
var batch = require('../../batch');
var db = require('../../database');

module.exports = {
	name: 'Fix topics in categories per user if they were moved',
	timestamp: Date.UTC(2018, 0, 22),
	method: (callback) => {
		var progress = this.progress;

		batch.processSortedSet('topics:tid', (tids, next) => {
			async.eachLimit(tids, 500, (tid, _next) => {
				progress.incr();
				var topicData;
				async.waterfall([
					(next) => {
						db.getObjectFields('topic:' + tid, ['cid', 'tid', 'uid', 'oldCid', 'timestamp'], next);
					},
					(_topicData, next) => {
						topicData = _topicData;
						if (!topicData.cid || !topicData.oldCid) {
							return _next();
						}

						db.isSortedSetMember('cid:' + topicData.oldCid + ':uid:' + topicData.uid, topicData.tid, next);
					},
					(isMember, next) => {
						if (isMember) {
							async.series([
								(next) => {
									db.sortedSetRemove('cid:' + topicData.oldCid + ':uid:' + topicData.uid + ':tids', tid, next);
								},
								(next) => {
									db.sortedSetAdd('cid:' + topicData.cid + ':uid:' + topicData.uid + ':tids', topicData.timestamp, tid, next);
								},
							], (err) => {
								next(err);
							});
						} else {
							next();
						}
					},
				], _next);
			}, next);
		}, {
			progress: progress,
			batch: 500,
		}, callback);
	},
};
